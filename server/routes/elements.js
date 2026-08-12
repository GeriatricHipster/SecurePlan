import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { assertSiteAccess, hasRole } from '../lib/auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { deleteStoredFile, cleanTemporaryUpload, storePhoto, storedFileDelivery, validatePhotoUpload } from '../lib/storage.js';
import { getElement, getNote, getPhoto, getProfile, getSurvey } from '../lib/resources.js';
import { serializeElement, serializeNote, serializePhoto } from '../lib/serializers.js';
import {
  booleanValue,
  colorValue,
  idValue,
  jsonArray,
  jsonObject,
  numberValue,
  optionalNullableString,
  safeFilename,
  stringValue,
} from '../lib/validation.js';
import { logActivity, logSecurityEvent, touchSurvey } from '../db.js';
import { sendEmail, elementUpdateEmailTemplate } from '../lib/email.js';

export function createElementsRouter({ db, config, auth, emitSurveyUpdate, notifyUser }) {
  const router = Router();
  const photoUpload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxPhotoBytes, files: 1, fields: 10 },
  });
  router.use(auth.requireAuth);

  const listElements = async (req, res) => {
    const surveyId = idValue(req.params.surveyId || req.query.surveyId, 'surveyId');
    const survey = await getSurvey(db, surveyId);
    await assertSiteAccess(db, req.user, survey.site_id);
    const rows = await db
      .prepare(
        `SELECT e.*, COALESCE(n.note_count, 0) AS note_count, COALESCE(p.photo_count, 0) AS photo_count
           FROM elements e
           LEFT JOIN (SELECT element_id, COUNT(*) AS note_count FROM element_notes GROUP BY element_id) n
             ON n.element_id = e.id
           LEFT JOIN (SELECT element_id, COUNT(*) AS photo_count FROM element_photos GROUP BY element_id) p
             ON p.element_id = e.id
          WHERE e.survey_id = ? ORDER BY e.z_index, e.created_at`,
      )
      .all(surveyId);
    const elements = rows.map(serializeElement);
    res.json({ data: elements, elements, devices: elements });
  };
  router.get('/surveys/:surveyId/elements', listElements);
  router.get('/surveys/:surveyId/devices', listElements);
  router.get('/elements', listElements);
  router.get('/devices', listElements);

  router.get('/elements/:elementId', getElementHandler);
  router.get('/devices/:elementId', getElementHandler);

  async function getElementHandler(req, res) {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id);
    const notes = (await listNotes(db, element.id)).map(serializeNote);
    const photos = (await db.prepare('SELECT * FROM element_photos WHERE element_id = ? ORDER BY created_at').all(element.id)).map(serializePhoto);
    res.json({ data: { ...serializeElement(element), notes, photos }, element: serializeElement(element) });
  }

  const createElement = async (req, res) => {
    const surveyId = idValue(req.params.surveyId || req.body?.surveyId, 'surveyId');
    const survey = await getSurvey(db, surveyId);
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const values = validateElementInput(req.body, false);
    if (values.profileId) await validateProfileForSite(db, values.profileId, survey.site_id);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const zIndex = values.zIndex ?? (await db.prepare('SELECT COALESCE(MAX(z_index), -1) + 1 AS value FROM elements WHERE survey_id = ?').get(surveyId)).value;
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO elements
          (id, survey_id, profile_id, category, type, label, x, y, width, height, rotation, color,
           z_index, locked, metadata_json, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        surveyId,
        values.profileId || null,
        values.category,
        values.type,
        values.label,
        values.x,
        values.y,
        values.width,
        values.height,
        values.rotation,
        values.color,
        zIndex,
        values.locked ? 1 : 0,
        JSON.stringify(values.metadata),
        req.user.id,
        req.user.id,
        now,
        now,
      );
      await touchSurvey(db, surveyId, req.user.id);
      await logActivity(db, {
        siteId: survey.site_id,
        surveyId,
        elementId: id,
        actorId: req.user.id,
        action: 'element.created',
        details: { label: values.label, type: values.type },
      });
    })();
    const element = await getElement(db, id);
    const serialized = serializeElement(element);
    emitSurveyUpdate(surveyId, 'element.created', req.user, { element: serialized });
    res.status(201).json({ data: serialized, element: serialized, device: serialized });
  };
  router.post('/surveys/:surveyId/elements', createElement);
  router.post('/surveys/:surveyId/devices', createElement);
  router.post('/elements', createElement);
  router.post('/devices', createElement);

  const updateElement = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id, 'editor');
    const values = validateElementInput(req.body, true, element.type);
    const merged = {
      profileId: values.profileId === undefined ? element.profile_id : values.profileId,
      category: values.category ?? element.category,
      type: values.type ?? element.type,
      label: values.label ?? element.label,
      x: values.x ?? element.x,
      y: values.y ?? element.y,
      width: values.width ?? element.width,
      height: values.height ?? element.height,
      rotation: values.rotation ?? element.rotation,
      color: values.color ?? element.color,
      zIndex: values.zIndex ?? element.z_index,
      locked: values.locked === undefined ? element.locked : values.locked,
      metadata: values.metadata ?? JSON.parse(element.metadata_json || '{}'),
    };
    if (merged.profileId) await validateProfileForSite(db, merged.profileId, element.site_id);
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await db.prepare(
        `UPDATE elements
            SET profile_id = ?, category = ?, type = ?, label = ?, x = ?, y = ?, width = ?, height = ?,
                rotation = ?, color = ?, z_index = ?, locked = ?, metadata_json = ?, updated_by = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        merged.profileId || null,
        merged.category,
        merged.type,
        merged.label,
        merged.x,
        merged.y,
        merged.width,
        merged.height,
        merged.rotation,
        merged.color,
        merged.zIndex,
        merged.locked ? 1 : 0,
        JSON.stringify(merged.metadata),
        req.user.id,
        now,
        element.id,
      );
      await touchSurvey(db, element.survey_id, req.user.id);
      await logActivity(db, {
        siteId: element.site_id,
        surveyId: element.survey_id,
        elementId: element.id,
        actorId: req.user.id,
        action: 'element.updated',
        details: { label: merged.label },
      });
    })();
    const updated = serializeElement(await getElement(db, element.id));
    emitSurveyUpdate(element.survey_id, 'element.updated', req.user, { element: updated });
    res.json({ data: updated, element: updated, device: updated });
  };
  router.patch('/elements/:elementId', updateElement);
  router.patch('/devices/:elementId', updateElement);

  router.get('/elements/:elementId/notify-recipients', async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    const survey = await getSurvey(db, element.survey_id);
    await assertSiteAccess(db, req.user, survey.site_id);
    const rows = await db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email
           FROM users u
           LEFT JOIN site_members sm ON sm.site_id = ? AND sm.user_id = u.id
          WHERE u.disabled_at IS NULL
            AND u.id != ?
            AND (u.workspace_access = 1 OR sm.user_id IS NOT NULL)
          ORDER BY u.name COLLATE NOCASE`,
      )
      .all(survey.site_id, req.user.id);
    res.json({ data: rows, recipients: rows });
  });

  router.post('/elements/:elementId/notify', async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    const survey = await getSurvey(db, element.survey_id);
    await assertSiteAccess(db, req.user, survey.site_id);
    const userIds = jsonArray(req.body?.userIds, 'userIds')
      .filter((value) => typeof value === 'string')
      .slice(0, 20);
    const message = req.body?.message ? stringValue(req.body.message, 'message', { max: 300 }) : null;
    if (!userIds.length) throw badRequest('Select at least one teammate to notify.');

    const placeholders = userIds.map(() => '?').join(',');
    const validRecipients = await db
      .prepare(
        `SELECT u.id, u.email
           FROM users u
           LEFT JOIN site_members sm ON sm.site_id = ? AND sm.user_id = u.id
          WHERE u.id IN (${placeholders})
            AND u.disabled_at IS NULL
            AND u.id != ?
            AND (u.workspace_access = 1 OR sm.user_id IS NOT NULL)`,
      )
      .all(survey.site_id, ...userIds, req.user.id);

    const surveyUrl = `${config.frontendOrigin || ''}/#/surveys/${survey.id}?site=${survey.site_id}`;
    const emailTemplate = elementUpdateEmailTemplate({
      senderName: req.user.name,
      elementLabel: element.label,
      surveyName: survey.name,
      message,
      surveyUrl,
    });
    let emailsSent = 0;
    const emailFailures = [];

    for (const row of validRecipients) {
      notifyUser?.(row.id, {
        type: 'element.notify',
        title: `${req.user.name || 'A teammate'} flagged an update`,
        body: message || `${element.label || 'A device'} was updated on "${survey.name}".`,
        elementId: element.id,
        elementLabel: element.label,
        surveyId: survey.id,
        surveyName: survey.name,
        siteId: survey.site_id,
        senderName: req.user.name,
      });
      if (row.email) {
        try {
          const result = await sendEmail(config, { to: row.email, ...emailTemplate });
          if (result?.sent) emailsSent += 1;
        } catch (error) {
          console.error('Failed to send element-update notification email:', error.message);
          emailFailures.push(row.email);
        }
      }
    }
    if (emailFailures.length) {
      await logSecurityEvent(db, { eventType: 'element_notify.email_failed', severity: 'warning', userId: req.user.id, req, details: { elementId: element.id, failedRecipients: emailFailures } });
    }
    res.json({ data: { notified: validRecipients.length, emailsSent }, success: true });
  });

  router.patch('/surveys/:surveyId/elements/bulk', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const changes = jsonArray(req.body?.changes, 'changes');
    if (changes.length > 500) throw badRequest('No more than 500 elements may be updated at once.');
    const updated = [];
    await db.transaction(async () => {
      for (const change of changes) {
        const element = await getElement(db, idValue(change.id, 'elementId'));
        if (element.survey_id !== survey.id) throw badRequest('Every element must belong to the selected survey.');
        const x = change.x === undefined ? element.x : numberValue(change.x, 'x', { min: -1000000, max: 1000000 });
        const y = change.y === undefined ? element.y : numberValue(change.y, 'y', { min: -1000000, max: 1000000 });
        const rotation = change.rotation === undefined
          ? element.rotation
          : numberValue(change.rotation, 'rotation', { min: -36000, max: 36000 });
        await db.prepare('UPDATE elements SET x = ?, y = ?, rotation = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
          x,
          y,
          rotation,
          req.user.id,
          new Date().toISOString(),
          element.id,
        );
        updated.push(serializeElement(await getElement(db, element.id)));
      }
      await touchSurvey(db, survey.id, req.user.id);
    })();
    emitSurveyUpdate(survey.id, 'elements.bulk-updated', req.user, { elements: updated });
    res.json({ data: updated, elements: updated });
  });

  const duplicateElement = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id, 'editor');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const offsetX = numberValue(req.body?.offsetX ?? 16, 'offsetX', { min: -10000, max: 10000 });
    const offsetY = numberValue(req.body?.offsetY ?? 16, 'offsetY', { min: -10000, max: 10000 });
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO elements
          (id, survey_id, profile_id, category, type, label, x, y, width, height, rotation, color,
           z_index, locked, metadata_json, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        element.survey_id,
        element.profile_id,
        element.category,
        element.type,
        `${element.label} Copy`.slice(0, 180),
        element.x + offsetX,
        element.y + offsetY,
        element.width,
        element.height,
        element.rotation,
        element.color,
        element.z_index + 1,
        0,
        element.metadata_json,
        req.user.id,
        req.user.id,
        now,
        now,
      );
      await touchSurvey(db, element.survey_id, req.user.id);
    })();
    const copied = serializeElement(await getElement(db, id));
    emitSurveyUpdate(element.survey_id, 'element.created', req.user, { element: copied });
    res.status(201).json({ data: copied, element: copied, device: copied });
  };
  router.post('/elements/:elementId/copy', duplicateElement);
  router.post('/devices/:elementId/copy', duplicateElement);

  const deleteElementHandler = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id, 'editor');
    const photos = await db.prepare('SELECT storage_key FROM element_photos WHERE element_id = ?').all(element.id);
    await db.transaction(async () => {
      await db.prepare('DELETE FROM elements WHERE id = ?').run(element.id);
      await touchSurvey(db, element.survey_id, req.user.id);
      await logActivity(db, {
        siteId: element.site_id,
        surveyId: element.survey_id,
        actorId: req.user.id,
        action: 'element.deleted',
        details: { elementId: element.id, label: element.label },
      });
    })();
    for (const photo of photos) {
      try { await deleteStoredFile(photo.storage_key, 'photo', config); }
      catch (error) { console.error('Failed to delete stored photo after element deletion:', error); }
    }
    emitSurveyUpdate(element.survey_id, 'element.deleted', req.user, { elementId: element.id });
    res.json({ data: { deletedId: element.id }, success: true });
  };
  router.delete('/elements/:elementId', deleteElementHandler);
  router.delete('/devices/:elementId', deleteElementHandler);

  const getNotes = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id);
    const notes = (await listNotes(db, element.id)).map(serializeNote);
    res.json({ data: notes, notes });
  };
  router.get('/elements/:elementId/notes', getNotes);
  router.get('/devices/:elementId/notes', getNotes);

  const createNote = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id, 'installer');
    const body = stringValue(req.body?.body ?? req.body?.text, 'body', { max: 10000 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO element_notes (id, element_id, body, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, element.id, body, req.user.id, req.user.id, now, now);
      await touchSurvey(db, element.survey_id, req.user.id);
    })();
    const note = serializeNote((await listNotes(db, element.id)).find((item) => item.id === id));
    emitSurveyUpdate(element.survey_id, 'note.created', req.user, { elementId: element.id, note });
    res.status(201).json({ data: note, note });
  };
  router.post('/elements/:elementId/notes', createNote);
  router.post('/devices/:elementId/notes', createNote);

  router.patch('/notes/:noteId', async (req, res) => {
    const note = await getNote(db, idValue(req.params.noteId, 'noteId'));
    const role = await assertSiteAccess(db, req.user, note.site_id, 'installer');
    if (note.created_by !== req.user.id && !hasRole(role, 'manager')) throw forbidden('Only the author or a manager can edit this note.');
    const body = stringValue(req.body?.body ?? req.body?.text, 'body', { max: 10000 });
    const now = new Date().toISOString();
    await db.transaction(async () => {
      await db.prepare('UPDATE element_notes SET body = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
        body,
        req.user.id,
        now,
        note.id,
      );
      await touchSurvey(db, note.survey_id, req.user.id);
    })();
    const updated = serializeNote((await listNotes(db, note.element_id)).find((item) => item.id === note.id));
    emitSurveyUpdate(note.survey_id, 'note.updated', req.user, { elementId: note.element_id, note: updated });
    res.json({ data: updated, note: updated });
  });

  router.delete('/notes/:noteId', async (req, res) => {
    const note = await getNote(db, idValue(req.params.noteId, 'noteId'));
    const role = await assertSiteAccess(db, req.user, note.site_id, 'installer');
    if (note.created_by !== req.user.id && !hasRole(role, 'manager')) throw forbidden('Only the author or a manager can delete this note.');
    await db.transaction(async () => {
      await db.prepare('DELETE FROM element_notes WHERE id = ?').run(note.id);
      await touchSurvey(db, note.survey_id, req.user.id);
    })();
    emitSurveyUpdate(note.survey_id, 'note.deleted', req.user, { elementId: note.element_id, noteId: note.id });
    res.json({ data: { deletedId: note.id }, success: true });
  });

  const listPhotosHandler = async (req, res) => {
    const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
    await assertSiteAccess(db, req.user, element.site_id);
    const photos = (await db.prepare('SELECT * FROM element_photos WHERE element_id = ? ORDER BY created_at').all(element.id)).map(serializePhoto);
    res.json({ data: photos, photos });
  };
  router.get('/elements/:elementId/photos', listPhotosHandler);
  router.get('/devices/:elementId/photos', listPhotosHandler);

  const uploadPhotoHandler = async (req, res) => {
    try {
      const element = await getElement(db, idValue(req.params.elementId, 'elementId'));
      await assertSiteAccess(db, req.user, element.site_id, 'installer');
      validatePhotoUpload(req.file);
      const originalFilename = safeFilename(req.file.originalname || 'survey-photo');
      const mimeType = req.file.mimetype;
      const sizeBytes = req.file.size;
      const caption = optionalNullableString(req.body?.caption, 'caption', 1000) ?? null;
      const storageKey = await storePhoto(req.file, config);
      req.file = null;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await db.transaction(async () => {
          await db.prepare(
            `INSERT INTO element_photos
              (id, element_id, original_filename, storage_key, mime_type, size_bytes, caption, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, element.id, originalFilename, storageKey, mimeType, sizeBytes, caption, req.user.id, now);
          await touchSurvey(db, element.survey_id, req.user.id);
        })();
      } catch (error) {
        try { await deleteStoredFile(storageKey, 'photo', config); }
        catch (cleanupError) { console.error('Failed to clean up photo after failed upload:', cleanupError); }
        throw error;
      }
      const photo = serializePhoto(await db.prepare('SELECT * FROM element_photos WHERE id = ?').get(id));
      emitSurveyUpdate(element.survey_id, 'photo.created', req.user, { elementId: element.id, photo });
      res.status(201).json({ data: photo, photo });
    } finally {
      cleanTemporaryUpload(req.file);
    }
  };
  router.post('/elements/:elementId/photos', photoUpload.single('photo'), uploadPhotoHandler);
  router.post('/devices/:elementId/photos', photoUpload.single('photo'), uploadPhotoHandler);

  router.get('/photos/:photoId/file', async (req, res) => {
    const photo = await getPhoto(db, idValue(req.params.photoId, 'photoId'));
    await assertSiteAccess(db, req.user, photo.site_id);
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': photo.mime_type,
      'Content-Disposition': `inline; filename="${safeFilename(photo.original_filename)}"`,
    });
    const delivery = await storedFileDelivery(photo.storage_key, 'photo', config);
    if (delivery.contents) return res.send(delivery.contents);
    res.sendFile(delivery.path);
  });

  router.delete('/photos/:photoId', async (req, res) => {
    const photo = await getPhoto(db, idValue(req.params.photoId, 'photoId'));
    const role = await assertSiteAccess(db, req.user, photo.site_id, 'installer');
    if (photo.created_by !== req.user.id && !hasRole(role, 'manager')) throw forbidden('Only the uploader or a manager can delete this photo.');
    await db.transaction(async () => {
      await db.prepare('DELETE FROM element_photos WHERE id = ?').run(photo.id);
      await touchSurvey(db, photo.survey_id, req.user.id);
    })();
    try { await deleteStoredFile(photo.storage_key, 'photo', config); }
    catch (error) { console.error('Failed to delete stored photo:', error); }
    emitSurveyUpdate(photo.survey_id, 'photo.deleted', req.user, { elementId: photo.element_id, photoId: photo.id });
    res.json({ data: { deletedId: photo.id }, success: true });
  });

  return router;
}

function validateElementInput(body = {}, partial, existingType) {
  const effectiveType = body.type !== undefined ? body.type : (partial ? existingType : 'device');
  const isDirectionalMarkup = ['line', 'arrow', 'measure', 'text'].includes(effectiveType);
  const dimensionRange = isDirectionalMarkup ? { min: -10, max: 10 } : { min: 0.001, max: 10 };
  const result = {
    profileId: body.profileId === undefined
      ? undefined
      : optionalNullableString(body.profileId, 'profileId', 80),
    category: body.category === undefined
      ? partial
        ? undefined
        : 'Custom'
      : stringValue(body.category, 'category', { max: 80 }),
    type: body.type === undefined
      ? partial
        ? undefined
        : 'device'
      : stringValue(body.type, 'type', { max: 100 }),
    label: body.label === undefined
      ? partial
        ? undefined
        : 'New Device'
      : stringValue(body.label, 'label', { max: 180 }),
    x: body.x === undefined
      ? partial
        ? undefined
        : 0
      : numberValue(body.x, 'x', { min: -1000000, max: 1000000 }),
    y: body.y === undefined
      ? partial
        ? undefined
        : 0
      : numberValue(body.y, 'y', { min: -1000000, max: 1000000 }),
    width: body.width === undefined
      ? partial
        ? undefined
        : 0.04
      : numberValue(body.width, 'width', dimensionRange),
    height: body.height === undefined
      ? partial
        ? undefined
        : 0.04
      : numberValue(body.height, 'height', dimensionRange),
    rotation: body.rotation === undefined
      ? partial
        ? undefined
        : 0
      : numberValue(body.rotation, 'rotation', { min: -36000, max: 36000 }),
    color: body.color === undefined
      ? partial
        ? undefined
        : '#1769AA'
      : colorValue(body.color),
    zIndex: body.zIndex === undefined
      ? undefined
      : numberValue(body.zIndex, 'zIndex', { integer: true, min: -100000, max: 100000 }),
    locked: body.locked === undefined ? (partial ? undefined : false) : booleanValue(body.locked, 'locked'),
    metadata: body.metadata === undefined
      ? partial
        ? undefined
        : {}
      : jsonObject(body.metadata, 'metadata'),
  };
  if (result.metadata && JSON.stringify(result.metadata).length > 65536) {
    throw badRequest('metadata may not exceed 64 KB.', { field: 'metadata' });
  }
  return result;
}

async function validateProfileForSite(db, profileId, siteId) {
  const profile = await getProfile(db, profileId);
  if (profile.site_id && profile.site_id !== siteId) throw badRequest('The selected profile does not belong to this site.');
  return profile;
}

async function listNotes(db, elementId) {
  return await db
    .prepare(
      `SELECT n.*, u.name AS author_name, u.email AS author_email
         FROM element_notes n LEFT JOIN users u ON u.id = n.created_by
        WHERE n.element_id = ? ORDER BY n.created_at`,
    )
    .all(elementId);
}
