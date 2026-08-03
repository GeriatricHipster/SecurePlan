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

  router.get('/sites', (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*,
                CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END AS access_role,
                (SELECT COUNT(*) FROM folders f WHERE f.site_id = s.id) AS folder_count,
                (SELECT COUNT(*) FROM surveys v WHERE v.site_id = s.id) AS survey_count,
                (SELECT COUNT(*) FROM site_members m WHERE m.site_id = s.id) AS member_count
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
          WHERE ? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL
          ORDER BY s.order_index, s.name COLLATE NOCASE`,
      )
      .all(
        req.user.role,
        req.user.workspace_access,
        req.user.role,
        req.user.id,
        req.user.role,
        req.user.workspace_access,
      );
    res.json({ data: rows.map(serializeSite), sites: rows.map(serializeSite) });
  });

  router.get('/sites/:siteId', (req, res) => {
    const site = getSite(db, idValue(req.params.siteId, 'siteId'));
    const role = assertSiteAccess(db, req.user, site.id);
    const folders = db.prepare('SELECT * FROM folders WHERE site_id = ? ORDER BY order_index, name').all(site.id);
    const surveys = db
      .prepare(
        `SELECT s.*, u.name AS updated_by_name, u.email AS updated_by_email,
                (SELECT COUNT(*) FROM elements e WHERE e.survey_id = s.id) AS element_count
           FROM surveys s LEFT JOIN users u ON u.id = s.updated_by
          WHERE s.site_id = ? ORDER BY s.order_index, s.name`,
      )
      .all(site.id);
    res.json({ data: { ...serializeSite({ ...site, access_role: role }), folders, surveys } });
  });

  router.post('/sites', (req, res) => {
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can create sites.');
    const name = stringValue(req.body?.name, 'name', { min: 1, max: 140 });
    const address = optionalNullableString(req.body?.address, 'address', 300) ?? null;
    const description = optionalNullableString(req.body?.description, 'description', 1000) ?? null;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const orderIndex = db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM sites').get().value;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO sites
          (id, name, address, description, order_index, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, name, address, description, orderIndex, req.user.id, req.user.id, now, now);
      db.prepare(
        `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
         VALUES (?, ?, 'admin', ?, ?, ?)`,
      ).run(id, req.user.id, req.user.id, now, now);
      logActivity(db, { siteId: id, actorId: req.user.id, action: 'site.created', details: { name } });
    })();
    const site = getSite(db, id);
    emitSiteUpdate(id, 'site.created', req.user, { site: serializeSite(site) });
    res.status(201).json({ data: serializeSite(site), site: serializeSite(site) });
  });

  router.patch('/sites/:siteId', (req, res) => {
    const site = getSite(db, idValue(req.params.siteId, 'siteId'));
    assertSiteAccess(db, req.user, site.id, 'manager');
    const name = req.body?.name === undefined ? site.name : stringValue(req.body.name, 'name', { max: 140 });
    const address =
      req.body?.address === undefined ? site.address : optionalNullableString(req.body.address, 'address', 300);
    const description =
      req.body?.description === undefined
        ? site.description
        : optionalNullableString(req.body.description, 'description', 1000);
    const now = new Date().toISOString();
    db.prepare('UPDATE sites SET name = ?, address = ?, description = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      name,
      address,
      description,
      req.user.id,
      now,
      site.id,
    );
    logActivity(db, { siteId: site.id, actorId: req.user.id, action: 'site.updated', details: { name } });
    const updated = getSite(db, site.id);
    emitSiteUpdate(site.id, 'site.updated', req.user, { site: serializeSite(updated) });
    res.json({ data: serializeSite(updated), site: serializeSite(updated) });
  });

  router.post('/sites/:siteId/copy', (req, res) => {
    const site = getSite(db, idValue(req.params.siteId, 'siteId'));
    assertSiteAccess(db, req.user, site.id, 'manager');
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can copy sites.');
    const name = stringValue(req.body?.name || `${site.name} Copy`, 'name', { max: 140 });
    const copied = cloneSite(db, config, site, name, req.user.id);
    logActivity(db, { siteId: copied.id, actorId: req.user.id, action: 'site.copied', details: { from: site.id } });
    res.status(201).json({ data: serializeSite(copied), site: serializeSite(copied) });
  });

  router.post('/sites/reorder', (req, res) => {
    if (!hasRole(req.user.role, 'manager')) throw forbidden('Only managers and administrators can reorder sites.');
    const siteIds = jsonArray(req.body?.siteIds, 'siteIds');
    if (siteIds.length > 1000 || new Set(siteIds).size !== siteIds.length) {
      throw badRequest('siteIds must contain no more than 1,000 unique site IDs.');
    }
    const update = db.prepare('UPDATE sites SET order_index = ?, updated_by = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    db.transaction(() => {
      siteIds.forEach((siteId, index) => {
        const site = getSite(db, idValue(siteId, 'siteId'));
        assertSiteAccess(db, req.user, site.id, 'manager');
        update.run(index, req.user.id, now, site.id);
      });
    })();
    res.json({ data: { siteIds }, success: true });
  });

  router.delete('/sites/:siteId', (req, res) => {
    const site = getSite(db, idValue(req.params.siteId, 'siteId'));
    assertSiteAccess(db, req.user, site.id, 'admin');
    const confirmation = stringValue(req.body?.confirmation, 'confirmation', { max: 140 });
    if (confirmation !== site.name) throw badRequest('Enter the exact site name to confirm deletion.', { field: 'confirmation' });

    const files = db
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
    db.prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    for (const file of files) deleteStoredFile(file.storage_key, file.kind, config);
    emitSiteUpdate(site.id, 'site.deleted', req.user, { siteId: site.id });
    res.json({ data: { deletedId: site.id }, success: true });
  });

  return router;
}
