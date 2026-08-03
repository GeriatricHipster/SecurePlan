import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSiteAccess } from '../lib/auth.js';
import { badRequest, conflict } from '../lib/errors.js';
import { cloneFolderTree } from '../lib/clone.js';
import { deleteStoredFile } from '../lib/storage.js';
import { getFolder, getSite } from '../lib/resources.js';
import { serializeFolder } from '../lib/serializers.js';
import { idValue, numberValue, optionalNullableString, stringValue } from '../lib/validation.js';
import { logActivity } from '../db.js';

export function createFoldersRouter({ db, config, auth, emitSiteUpdate }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/folders', async (req, res) => {
    const siteId = idValue(req.query.siteId, 'siteId');
    await getSite(db, siteId);
    await assertSiteAccess(db, req.user, siteId);
    const rows = await db
      .prepare('SELECT * FROM folders WHERE site_id = ? ORDER BY parent_id, order_index, name COLLATE NOCASE')
      .all(siteId);
    const folders = rows.map(serializeFolder);
    res.json({ data: folders, folders, tree: makeFolderTree(folders) });
  });

  router.post('/folders', async (req, res) => {
    const siteId = idValue(req.body?.siteId, 'siteId');
    await getSite(db, siteId);
    await assertSiteAccess(db, req.user, siteId, 'editor');
    const parentId = optionalNullableString(req.body?.parentId, 'parentId', 80) ?? null;
    if (parentId) {
      const parent = await getFolder(db, parentId);
      if (parent.site_id !== siteId) throw badRequest('The parent folder must be in the same site.', { field: 'parentId' });
    }
    const name = stringValue(req.body?.name, 'name', { max: 140 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const orderIndex = (await db
      .prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM folders WHERE site_id = ? AND parent_id IS ?')
      .get(siteId, parentId)).value;
    await db.prepare(
      `INSERT INTO folders
        (id, site_id, parent_id, name, order_index, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, siteId, parentId, name, orderIndex, req.user.id, req.user.id, now, now);
    await logActivity(db, { siteId, actorId: req.user.id, action: 'folder.created', details: { folderId: id, name } });
    const folder = await getFolder(db, id);
    emitSiteUpdate(siteId, 'folder.created', req.user, { folder: serializeFolder(folder) });
    res.status(201).json({ data: serializeFolder(folder), folder: serializeFolder(folder) });
  });

  router.patch('/folders/:folderId', async (req, res) => {
    const folder = await getFolder(db, idValue(req.params.folderId, 'folderId'));
    await assertSiteAccess(db, req.user, folder.site_id, 'editor');
    const name = req.body?.name === undefined ? folder.name : stringValue(req.body.name, 'name', { max: 140 });
    let parentId = folder.parent_id;
    if (req.body?.parentId !== undefined) {
      parentId = optionalNullableString(req.body.parentId, 'parentId', 80);
      if (parentId === folder.id) throw badRequest('A folder cannot contain itself.', { field: 'parentId' });
      if (parentId) {
        const parent = await getFolder(db, parentId);
        if (parent.site_id !== folder.site_id) throw badRequest('The parent folder must be in the same site.');
        const isDescendant = await db
          .prepare(
            `WITH RECURSIVE descendants(id) AS (
               SELECT id FROM folders WHERE parent_id = ?
               UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
             ) SELECT 1 AS found FROM descendants WHERE id = ?`,
          )
          .get(folder.id, parentId);
        if (isDescendant) throw badRequest('A folder cannot be moved inside one of its descendants.');
      }
    }
    const orderIndex =
      req.body?.orderIndex === undefined
        ? folder.order_index
        : numberValue(req.body.orderIndex, 'orderIndex', { integer: true, min: 0, max: 100000 });
    const now = new Date().toISOString();
    await db.prepare(
      'UPDATE folders SET name = ?, parent_id = ?, order_index = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    ).run(name, parentId || null, orderIndex, req.user.id, now, folder.id);
    const updated = await getFolder(db, folder.id);
    await logActivity(db, {
      siteId: folder.site_id,
      actorId: req.user.id,
      action: 'folder.updated',
      details: { folderId: folder.id, name, parentId },
    });
    emitSiteUpdate(folder.site_id, 'folder.updated', req.user, { folder: serializeFolder(updated) });
    res.json({ data: serializeFolder(updated), folder: serializeFolder(updated) });
  });

  router.post('/folders/:folderId/move', async (req, res, next) => {
    req.body = { ...req.body, parentId: req.body?.parentId ?? null };
    req.url = `/folders/${req.params.folderId}`;
    req.method = 'PATCH';
    router.handle(req, res, next);
  });

  router.post('/folders/:folderId/copy', async (req, res) => {
    const folder = await getFolder(db, idValue(req.params.folderId, 'folderId'));
    await assertSiteAccess(db, req.user, folder.site_id, 'editor');
    const parentId = optionalNullableString(req.body?.parentId, 'parentId', 80) ?? folder.parent_id;
    if (parentId) {
      const parent = await getFolder(db, parentId);
      if (parent.site_id !== folder.site_id) throw badRequest('The destination folder must be in the same site.');
    }
    const name = stringValue(req.body?.name || `${folder.name} Copy`, 'name', { max: 140 });
    const copied = await cloneFolderTree(db, config, folder, parentId, name, req.user.id);
    await logActivity(db, {
      siteId: folder.site_id,
      actorId: req.user.id,
      action: 'folder.copied',
      details: { from: folder.id, folderId: copied.id },
    });
    emitSiteUpdate(folder.site_id, 'folder.copied', req.user, { folder: serializeFolder(copied) });
    res.status(201).json({ data: serializeFolder(copied), folder: serializeFolder(copied) });
  });

  router.delete('/folders/:folderId', async (req, res) => {
    const folder = await getFolder(db, idValue(req.params.folderId, 'folderId'));
    await assertSiteAccess(db, req.user, folder.site_id, 'editor');
    // The product confirmation dialog explicitly warns that contents are removed.
    // API clients can request the safer non-recursive check with ?recursive=false.
    const recursive = req.query.recursive !== 'false';
    const counts = await db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         )
         SELECT
           (SELECT COUNT(*) - 1 FROM descendants) AS child_count,
           (SELECT COUNT(*) FROM surveys WHERE folder_id IN (SELECT id FROM descendants)) AS survey_count`,
      )
      .get(folder.id);
    if (!recursive && (counts.child_count || counts.survey_count)) {
      throw conflict('Folder is not empty. Retry with ?recursive=true to delete its subfolders and surveys.', counts);
    }

    const files = await db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         ), target_surveys(id, storage_key) AS (
           SELECT id, storage_key FROM surveys WHERE folder_id IN (SELECT id FROM descendants)
         )
         SELECT storage_key, 'survey' AS kind FROM target_surveys WHERE storage_key IS NOT NULL
         UNION ALL
         SELECT p.storage_key, 'photo' AS kind
           FROM element_photos p JOIN elements e ON e.id = p.element_id
          WHERE e.survey_id IN (SELECT id FROM target_surveys)`,
      )
      .all(folder.id);
    await db.transaction(async () => {
      await db.prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         ) DELETE FROM surveys WHERE folder_id IN (SELECT id FROM descendants)`,
      ).run(folder.id);
      await db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
      await logActivity(db, {
        siteId: folder.site_id,
        actorId: req.user.id,
        action: 'folder.deleted',
        details: { folderId: folder.id, name: folder.name },
      });
    })();
    for (const file of files) await deleteStoredFile(file.storage_key, file.kind, config);
    emitSiteUpdate(folder.site_id, 'folder.deleted', req.user, { folderId: folder.id });
    res.json({ data: { deletedId: folder.id }, success: true });
  });

  return router;
}

function makeFolderTree(folders) {
  const nodes = new Map(folders.map((folder) => [folder.id, { ...folder, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}
