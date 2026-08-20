import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSiteAccess, hasRole } from '../lib/auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { cloneSite } from '../lib/clone.js';
import { deleteStoredFile } from '../lib/storage.js';
import { getSite } from '../lib/resources.js';
import { serializeSite } from '../lib/serializers.js';
import { idValue, jsonArray, optionalNullableString, stringValue } from '../lib/validation.js';
import { logActivity } from '../db.js';

export function createSitesRouter({ db, config, auth, emitSiteUpdate }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/sites', async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT s.*,
                CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END AS access_role,
                (SELECT COUNT(*) FROM folders f WHERE f.site_id = s.id) AS folder_count,
                (SELECT COUNT(*) FROM surveys v WHERE v.site_id = s.id) AS survey_count,
                (SELECT COUNT(*) FROM site_members m WHERE m.site_id = s.id) AS member_count
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
           LEFT JOIN site_assignments sa ON sa.site_id = s.id AND sa.user_id = ?
          WHERE ? IN ('owner','admin') OR ? = 1
             OR (sm.user_id IS NOT NULL AND (sm.role NOT IN ('viewer', 'installer') OR sa.user_id IS NOT NULL))
          ORDER BY s.order_index, s.name COLLATE NOCASE`,
      )
      .all(
        req.user.role,
        req.user.workspace_access,
        req.user.role,
        req.user.id,
        req.user.id,
        req.user.role,
        req.user.workspace_access,
      );
    res.json({ data: rows.map(serializeSite), sites: rows.map(serializeSite) });
  });

  router.get('/sites/:siteId', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    const role = await assertSiteAccess(db, req.user, site.id);
    const folders = await db.prepare('SELECT * FROM folders WHERE site_id = ? ORDER BY order_index, name').all(site.id);
    const surveys = await db
      .prepare(
        `SELECT s.*, u.name AS updated_by_name, u.email AS updated_by_email,
                (SELECT COUNT(*) FROM elements e WHERE e.survey_id = s.id) AS element_count
           FROM surveys s LEFT JOIN users u ON u.id = s.updated_by
          WHERE s.site_id = ? ORDER BY s.order_index, s.name`,
      )
      .all(site.id);
    res.json({ data: { ...serializeSite({ ...site, access_role: role }), folders, surveys } });
  });

  router.post('/sites', async (req, res) => {
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can create sites.');
    const name = stringValue(req.body?.name, 'name', { min: 1, max: 140 });
    const address = optionalNullableString(req.body?.address, 'address', 300) ?? null;
    const description = optionalNullableString(req.body?.description, 'description', 1000) ?? null;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const orderIndex = (await db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM sites').get()).value;
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO sites
          (id, name, address, description, order_index, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, name, address, description, orderIndex, req.user.id, req.user.id, now, now);
      await db.prepare(
        `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
         VALUES (?, ?, 'admin', ?, ?, ?)`,
      ).run(id, req.user.id, req.user.id, now, now);
      await logActivity(db, { siteId: id, actorId: req.user.id, action: 'site.created', details: { name } });
    })();
    const site = await getSite(db, id);
    emitSiteUpdate(id, 'site.created', req.user, { site: serializeSite(site) });
    res.status(201).json({ data: serializeSite(site), site: serializeSite(site) });
  });

  router.patch('/sites/:siteId', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'manager');
    const name = req.body?.name === undefined ? site.name : stringValue(req.body.name, 'name', { max: 140 });
    const address =
      req.body?.address === undefined ? site.address : optionalNullableString(req.body.address, 'address', 300);
    const description =
      req.body?.description === undefined
        ? site.description
        : optionalNullableString(req.body.description, 'description', 1000);
    const now = new Date().toISOString();
    await db.prepare('UPDATE sites SET name = ?, address = ?, description = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      name,
      address,
      description,
      req.user.id,
      now,
      site.id,
    );
    await logActivity(db, { siteId: site.id, actorId: req.user.id, action: 'site.updated', details: { name } });
    const updated = await getSite(db, site.id);
    emitSiteUpdate(site.id, 'site.updated', req.user, { site: serializeSite(updated) });
    res.json({ data: serializeSite(updated), site: serializeSite(updated) });
  });

  router.post('/sites/:siteId/copy', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'manager');
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can copy sites.');
    const name = stringValue(req.body?.name || `${site.name} Copy`, 'name', { max: 140 });
    const copied = await cloneSite(db, config, site, name, req.user.id);
    await logActivity(db, { siteId: copied.id, actorId: req.user.id, action: 'site.copied', details: { from: site.id } });
    res.status(201).json({ data: serializeSite(copied), site: serializeSite(copied) });
  });

  router.post('/sites/reorder', async (req, res) => {
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can reorder sites.');
    const siteIds = jsonArray(req.body?.siteIds, 'siteIds');
    if (siteIds.length > 1000 || new Set(siteIds).size !== siteIds.length) {
      throw badRequest('siteIds must contain no more than 1,000 unique site IDs.');
    }
    const update = await db.prepare('UPDATE sites SET order_index = ?, updated_by = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    await db.transaction(async () => {
      for (const [index, siteId] of siteIds.entries()) {
        const site = await getSite(db, idValue(siteId, 'siteId'));
        await assertSiteAccess(db, req.user, site.id, 'manager');
        await update.run(index, req.user.id, now, site.id);
      }
    })();
    res.json({ data: { siteIds }, success: true });
  });

  router.delete('/sites/:siteId', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'admin');
    const confirmation = stringValue(req.body?.confirmation, 'confirmation', { max: 140 });
    if (confirmation !== site.name) throw badRequest('Enter the exact site name to confirm deletion.', { field: 'confirmation' });

    const files = await db
      .prepare(
        `SELECT storage_key, 'survey' AS kind FROM surveys WHERE site_id = ? AND storage_key IS NOT NULL
         UNION ALL
         SELECT p.storage_key, 'photo' AS kind
           FROM element_photos p
           JOIN elements e ON e.id = p.element_id
           JOIN surveys s ON s.id = e.survey_id
          WHERE s.site_id = ?`,
      )
      .all(site.id, site.id);
    await db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    for (const file of files) await deleteStoredFile(file.storage_key, file.kind, config);
    emitSiteUpdate(site.id, 'site.deleted', req.user, { siteId: site.id });
    res.json({ data: { deletedId: site.id }, success: true });
  });

  router.get('/sites/:siteId/assignable-users', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'admin');
    const rows = await db
      .prepare("SELECT id, name, email, role FROM users WHERE role IN ('viewer', 'installer') AND disabled_at IS NULL ORDER BY name COLLATE NOCASE")
      .all();
    res.json({ data: rows, users: rows });
  });

  router.get('/sites/:siteId/assignments', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'admin');
    const rows = await db
      .prepare(
        `SELECT u.id, u.name, u.email FROM site_assignments sa
           JOIN users u ON u.id = sa.user_id
          WHERE sa.site_id = ? AND u.disabled_at IS NULL
          ORDER BY u.name COLLATE NOCASE`,
      )
      .all(site.id);
    res.json({ data: rows, assignments: rows });
  });

  router.post('/sites/:siteId/assignments', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'admin');
    const userId = idValue(req.body?.userId, 'userId');
    const target = await db.prepare('SELECT id, role FROM users WHERE id = ? AND disabled_at IS NULL').get(userId);
    if (!target) throw badRequest('User not found.', { field: 'userId' });
    if (!['viewer', 'installer'].includes(target.role)) throw badRequest('Only viewer or installer role users can be assigned to specific sites.', { field: 'userId' });
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO site_assignments (site_id, user_id, added_by, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (site_id, user_id) DO NOTHING`,
    ).run(site.id, userId, req.user.id, now);
    emitSiteUpdate(site.id, 'assignment.created', req.user, { userId });
    res.status(201).json({ data: { siteId: site.id, userId }, success: true });
  });

  router.delete('/sites/:siteId/assignments/:userId', async (req, res) => {
    const site = await getSite(db, idValue(req.params.siteId, 'siteId'));
    await assertSiteAccess(db, req.user, site.id, 'admin');
    const userId = idValue(req.params.userId, 'userId');
    await db.prepare('DELETE FROM site_assignments WHERE site_id = ? AND user_id = ?').run(site.id, userId);
    emitSiteUpdate(site.id, 'assignment.removed', req.user, { userId });
    res.json({ data: { siteId: site.id, userId }, success: true });
  });

  return router;
}
