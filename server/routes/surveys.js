import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { assertSiteAccess, assertSurveyAssignment, hasRole } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { cloneSurvey } from '../lib/clone.js';
import { deleteStoredFile, cleanTemporaryUpload, storePdf, storedFileDelivery, validatePdfUpload } from '../lib/storage.js';
import { getFolder, getSite, getSurvey } from '../lib/resources.js';
import { serializeSurvey } from '../lib/serializers.js';
import { idValue, numberValue, optionalNullableString, safeFilename, stringValue } from '../lib/validation.js';
import { logActivity } from '../db.js';

export function createSurveysRouter({ db, config, auth, emitSurveyUpdate, emitSiteUpdate }) {
  const router = Router();
  const upload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxPdfBytes, files: 1, fields: 20 },
  });
  const batchUpload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxPdfBytes, files: 20, fields: 10 },
  });
  router.use(auth.requireAuth);

  router.get('/surveys', async (req, res) => {
    const siteId = idValue(req.query.siteId, 'siteId');
    await getSite(db, siteId);
    const role = await assertSiteAccess(db, req.user, siteId);
    const folderId = optionalNullableString(req.query.folderId, 'folderId', 80);
    const params = [siteId];
    let folderClause = '';
    if (req.query.folderId !== undefined) {
      folderClause = "AND COALESCE(s.folder_id, '') = COALESCE(?, '')";
      params.push(folderId || null);
    }
    let assignmentClause = '';
    if (role === 'viewer') {
      assignmentClause = 'AND EXISTS (SELECT 1 FROM survey_assignments sa WHERE sa.survey_id = s.id AND sa.user_id = ?)';
      params.push(req.user.id);
    }
    const rows = await db
      .prepare(
        `SELECT s.*, u.name AS updated_by_name, u.email AS updated_by_email,
                (SELECT COUNT(*) FROM elements e WHERE e.survey_id = s.id) AS element_count
           FROM surveys s LEFT JOIN users u ON u.id = s.updated_by
          WHERE s.site_id = ? ${folderClause} ${assignmentClause}
          ORDER BY s.order_index, s.name COLLATE NOCASE`,
      )
      .all(...params);
    const surveys = rows.map(serializeSurvey);
    res.json({ data: surveys, surveys });
  });

  router.get('/surveys/:surveyId', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const activity = (await db
      .prepare(
        `SELECT a.id, a.action, a.details_json, a.created_at,
                u.id AS actor_id, u.name AS actor_name, u.email AS actor_email
           FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.survey_id = ? ORDER BY a.created_at DESC LIMIT 30`,
      )
      .all(survey.id))
      .map((row) => ({
        id: row.id,
        action: row.action,
        details: JSON.parse(row.details_json || '{}'),
        createdAt: row.created_at,
        actor: row.actor_id ? { id: row.actor_id, name: row.actor_name, email: row.actor_email } : null,
      }));
    res.json({ data: { ...serializeSurvey(survey), activity }, survey: serializeSurvey(survey) });
  });

  router.post('/surveys', upload.single('pdf'), async (req, res) => {
    try {
      const siteId = idValue(req.body?.siteId, 'siteId');
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'editor');
      const folderId = optionalNullableString(req.body?.folderId, 'folderId', 80) ?? null;
      if (folderId) {
        const folder = await getFolder(db, folderId);
        if (folder.site_id !== siteId) throw badRequest('The folder must be in the selected site.', { field: 'folderId' });
      }
      if (req.file) validatePdfUpload(req.file);
      const originalFilename = req.file ? safeFilename(req.file.originalname || 'floor-plan.pdf') : null;
      const sizeBytes = req.file?.size || 0;
      const name = stringValue(
        req.body?.name || originalFilename?.replace(/\.pdf$/i, '') || 'Untitled Survey',
        'name',
        { max: 180 },
      );
      const description = optionalNullableString(req.body?.description, 'description', 2000) ?? null;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const orderIndex = (await db
        .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM surveys WHERE site_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')")
        .get(siteId, folderId)).value;
      const storageKey = req.file ? await storePdf(req.file, config) : null;
      req.file = null;
      try {
        await db.transaction(async () => {
          await db.prepare(
            `INSERT INTO surveys
              (id, site_id, folder_id, name, description, original_filename, storage_key, mime_type, size_bytes,
               rotation, order_index, version, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?)`,
          ).run(
            id,
            siteId,
            folderId,
            name,
            description,
            originalFilename,
            storageKey,
            storageKey ? 'application/pdf' : null,
            sizeBytes,
            orderIndex,
            req.user.id,
            req.user.id,
            now,
            now,
          );
          await logActivity(db, { siteId, surveyId: id, actorId: req.user.id, action: 'survey.created', details: { name } });
        })();
      } catch (error) {
        await deleteStoredFile(storageKey, 'survey', config);
        throw error;
      }
      const survey = await getSurvey(db, id);
      emitSiteUpdate(siteId, 'survey.created', req.user, { survey: serializeSurvey(survey) });
      res.status(201).json({ data: serializeSurvey(survey), survey: serializeSurvey(survey) });
    } finally {
      cleanTemporaryUpload(req.file);
    }
  });

  router.post('/surveys/batch', batchUpload.array('pdfs', 20), async (req, res) => {
    const files = req.files || [];
    const uploaded = [];
    try {
      const siteId = idValue(req.body?.siteId, 'siteId');
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'editor');
      const folderId = optionalNullableString(req.body?.folderId, 'folderId', 80) ?? null;
      if (folderId) {
        const folder = await getFolder(db, folderId);
        if (folder.site_id !== siteId) throw badRequest('The folder must be in the selected site.', { field: 'folderId' });
      }
      if (!files.length) throw badRequest('Select at least one PDF floor plan.', { field: 'pdfs' });

      let details;
      try {
        details = JSON.parse(String(req.body?.surveys || '[]'));
      } catch {
        throw badRequest('Survey details are invalid.', { field: 'surveys' });
      }
      if (!Array.isArray(details) || details.length !== files.length) {
        throw badRequest('Provide a name for every selected PDF.', { field: 'surveys' });
      }

      const rows = files.map((file, index) => {
        validatePdfUpload(file);
        const originalFilename = safeFilename(file.originalname || `floor-plan-${index + 1}.pdf`);
        return {
          id: crypto.randomUUID(),
          file,
          originalFilename,
          name: stringValue(details[index]?.name || originalFilename.replace(/\.pdf$/i, ''), `surveys[${index}].name`, { max: 180 }),
          description: optionalNullableString(details[index]?.description, `surveys[${index}].description`, 2000) ?? null,
        };
      });
      const now = new Date().toISOString();
      const firstOrder = (await db
        .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM surveys WHERE site_id = ? AND COALESCE(folder_id, '') = COALESCE(?, '')")
        .get(siteId, folderId)).value;

      for (const row of rows) {
        row.storageKey = await storePdf(row.file, config);
        uploaded.push(row.storageKey);
      }

      try {
        await db.transaction(async () => {
          for (const [index, row] of rows.entries()) {
            await db.prepare(
              `INSERT INTO surveys
                (id, site_id, folder_id, name, description, original_filename, storage_key, mime_type,
                 size_bytes, rotation, order_index, version, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, 0, ?, 1, ?, ?, ?, ?)`,
            ).run(
              row.id, siteId, folderId, row.name, row.description, row.originalFilename, row.storageKey,
              row.file.size || 0, firstOrder + index, req.user.id, req.user.id, now, now,
            );
            await logActivity(db, {
              siteId, surveyId: row.id, actorId: req.user.id, action: 'survey.created',
              details: { name: row.name, batch: true },
            });
          }
        })();
      } catch (error) {
        await Promise.allSettled(uploaded.map((key) => deleteStoredFile(key, 'survey', config)));
        throw error;
      }

      const created = [];
      for (const row of rows) created.push(serializeSurvey(await getSurvey(db, row.id)));
      for (const survey of created) emitSiteUpdate(siteId, 'survey.created', req.user, { survey });
      res.status(201).json({ data: created, surveys: created });
    } finally {
      for (const file of files) cleanTemporaryUpload(file);
    }
  });

  router.patch('/surveys/:surveyId', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const name = req.body?.name === undefined ? survey.name : stringValue(req.body.name, 'name', { max: 180 });
    const description = req.body?.description === undefined
      ? survey.description
      : optionalNullableString(req.body.description, 'description', 2000);
    const orderIndex =
      req.body?.orderIndex === undefined
        ? survey.order_index
        : numberValue(req.body.orderIndex, 'orderIndex', { integer: true, min: 0, max: 100000 });
    const scalePaperInches = req.body?.scalePaperInches === undefined
      ? survey.scale_paper_inches
      : numberValue(req.body.scalePaperInches, 'scalePaperInches', { min: 0.001, max: 1000 });
    const scaleRealFeet = req.body?.scaleRealFeet === undefined
      ? survey.scale_real_feet
      : numberValue(req.body.scaleRealFeet, 'scaleRealFeet', { min: 0.001, max: 100000 });
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE surveys SET name = ?, description = ?, order_index = ?, scale_paper_inches = ?, scale_real_feet = ?,
              updated_by = ?, updated_at = ?, version = version + 1
        WHERE id = ?`,
    ).run(name, description, orderIndex, scalePaperInches, scaleRealFeet, req.user.id, now, survey.id);
    await logActivity(db, {
      siteId: survey.site_id,
      surveyId: survey.id,
      actorId: req.user.id,
      action: 'survey.updated',
      details: { name },
    });
    const updated = await getSurvey(db, survey.id);
    emitSurveyUpdate(survey.id, 'survey.updated', req.user, { survey: serializeSurvey(updated) });
    res.json({ data: serializeSurvey(updated), survey: serializeSurvey(updated) });
  });

  router.post('/surveys/:surveyId/move', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const siteId = req.body?.siteId ? idValue(req.body.siteId, 'siteId') : survey.site_id;
    await getSite(db, siteId);
    await assertSiteAccess(db, req.user, siteId, 'editor');
    const folderId = optionalNullableString(req.body?.folderId, 'folderId', 80) ?? null;
    if (folderId) {
      const folder = await getFolder(db, folderId);
      if (folder.site_id !== siteId) throw badRequest('The destination folder must be in the destination site.');
    }
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await db.prepare(
        `UPDATE surveys SET site_id = ?, folder_id = ?, updated_by = ?, updated_at = ?, version = version + 1
          WHERE id = ?`,
      ).run(siteId, folderId, req.user.id, now, survey.id);
      if (siteId !== survey.site_id) {
        await db.prepare(
          `UPDATE elements SET profile_id = NULL
            WHERE survey_id = ? AND profile_id IN
              (SELECT id FROM icon_profiles WHERE site_id IS NOT NULL AND site_id <> ?)`,
        ).run(survey.id, siteId);
      }
      await logActivity(db, {
        siteId,
        surveyId: survey.id,
        actorId: req.user.id,
        action: 'survey.moved',
        details: { fromSiteId: survey.site_id, siteId, folderId },
      });
    })();
    const updated = await getSurvey(db, survey.id);
    emitSurveyUpdate(survey.id, 'survey.moved', req.user, { survey: serializeSurvey(updated) });
    emitSiteUpdate(survey.site_id, 'survey.moved-out', req.user, { surveyId: survey.id });
    emitSiteUpdate(siteId, 'survey.moved-in', req.user, { survey: serializeSurvey(updated) });
    res.json({ data: serializeSurvey(updated), survey: serializeSurvey(updated) });
  });

  router.post('/surveys/:surveyId/rotate', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    let rotation;
    if (req.body?.rotation !== undefined || req.body?.orientation !== undefined) {
      rotation = numberValue(req.body.rotation ?? req.body.orientation, 'rotation', { integer: true, min: 0, max: 270 });
    } else {
      const delta = numberValue(req.body?.delta ?? 90, 'delta', { integer: true, min: -270, max: 270 });
      rotation = ((survey.rotation + delta) % 360 + 360) % 360;
    }
    if (![0, 90, 180, 270].includes(rotation)) throw badRequest('rotation must be 0, 90, 180, or 270 degrees.');
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE surveys SET rotation = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).run(rotation, req.user.id, now, survey.id);
    await logActivity(db, {
      siteId: survey.site_id,
      surveyId: survey.id,
      actorId: req.user.id,
      action: 'survey.rotated',
      details: { rotation },
    });
    const updated = await getSurvey(db, survey.id);
    emitSurveyUpdate(survey.id, 'survey.rotated', req.user, { survey: serializeSurvey(updated) });
    res.json({ data: serializeSurvey(updated), survey: serializeSurvey(updated) });
  });

  router.post('/surveys/:surveyId/copy', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const siteId = req.body?.siteId ? idValue(req.body.siteId, 'siteId') : survey.site_id;
    await getSite(db, siteId);
    await assertSiteAccess(db, req.user, siteId, 'editor');
    const folderId = req.body?.folderId === undefined
      ? survey.folder_id
      : optionalNullableString(req.body.folderId, 'folderId', 80);
    if (folderId) {
      const folder = await getFolder(db, folderId);
      if (folder.site_id !== siteId) throw badRequest('The destination folder must be in the destination site.');
    }
    const name = stringValue(req.body?.name || `${survey.name} Copy`, 'name', { max: 180 });
    const copied = await cloneSurvey(db, config, survey, { siteId, folderId, name }, req.user.id);
    await logActivity(db, {
      siteId,
      surveyId: copied.id,
      actorId: req.user.id,
      action: 'survey.copied',
      details: { from: survey.id },
    });
    const serialized = serializeSurvey(await getSurvey(db, copied.id));
    emitSiteUpdate(siteId, 'survey.created', req.user, { survey: serialized });
    res.status(201).json({ data: serialized, survey: serialized });
  });

  router.get('/surveys/:surveyId/file', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    if (!survey.storage_key) throw badRequest('This demo survey does not have a PDF yet.');
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeFilename(survey.original_filename || `${survey.name}.pdf`)}"`,
    });
    const delivery = await storedFileDelivery(survey.storage_key, 'survey', config);
    if (delivery.contents) return res.send(delivery.contents);
    res.sendFile(delivery.path);
  });

  router.delete('/surveys/:surveyId', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const photos = await db
      .prepare(
        `SELECT p.storage_key FROM element_photos p
          JOIN elements e ON e.id = p.element_id WHERE e.survey_id = ?`,
      )
      .all(survey.id);
    await db.prepare('DELETE FROM surveys WHERE id = ?').run(survey.id);
    await deleteStoredFile(survey.storage_key, 'survey', config);
    for (const photo of photos) await deleteStoredFile(photo.storage_key, 'photo', config);
    emitSurveyUpdate(survey.id, 'survey.deleted', req.user, { surveyId: survey.id });
    emitSiteUpdate(survey.site_id, 'survey.deleted', req.user, { surveyId: survey.id });
    res.json({ data: { deletedId: survey.id }, success: true });
  });

  router.get('/surveys/:surveyId/assignable-viewers', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'admin');
    const rows = await db
      .prepare("SELECT id, name, email FROM users WHERE role = 'viewer' AND disabled_at IS NULL ORDER BY name COLLATE NOCASE")
      .all();
    res.json({ data: rows, viewers: rows });
  });

  router.get('/surveys/:surveyId/assignments', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'admin');
    const rows = await db
      .prepare(
        `SELECT u.id, u.name, u.email FROM survey_assignments sa
           JOIN users u ON u.id = sa.user_id
          WHERE sa.survey_id = ? AND u.disabled_at IS NULL
          ORDER BY u.name COLLATE NOCASE`,
      )
      .all(survey.id);
    res.json({ data: rows, assignments: rows });
  });

  router.post('/surveys/:surveyId/assignments', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'admin');
    const userId = idValue(req.body?.userId, 'userId');
    const target = await db.prepare('SELECT id, role FROM users WHERE id = ? AND disabled_at IS NULL').get(userId);
    if (!target) throw notFound('User');
    if (target.role !== 'viewer') throw badRequest('Only viewer-role users can be assigned to specific surveys.', { field: 'userId' });
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO survey_assignments (survey_id, user_id, added_by, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (survey_id, user_id) DO NOTHING`,
    ).run(survey.id, userId, req.user.id, now);
    emitSurveyUpdate(survey.id, 'assignment.created', req.user, { userId });
    res.status(201).json({ data: { surveyId: survey.id, userId }, success: true });
  });

  router.delete('/surveys/:surveyId/assignments/:userId', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'admin');
    const userId = idValue(req.params.userId, 'userId');
    await db.prepare('DELETE FROM survey_assignments WHERE survey_id = ? AND user_id = ?').run(survey.id, userId);
    emitSurveyUpdate(survey.id, 'assignment.removed', req.user, { userId });
    res.json({ data: { surveyId: survey.id, userId }, success: true });
  });

  return router;
}
