import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { assertSiteAccess, assertSurveyAssignment } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { deleteStoredFile, cleanTemporaryUpload, storePhoto, storedFileDelivery, validatePhotoUpload } from '../lib/storage.js';
import { getSurvey } from '../lib/resources.js';
import { sendEmail, surveyReportEmailTemplate } from '../lib/email.js';
import { idValue, jsonArray, safeFilename, stringValue } from '../lib/validation.js';
import { logActivity, logSecurityEvent } from '../db.js';

function serializeReportPhoto(row) {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    url: `/api/report-photos/${row.id}/file`,
  };
}

function serializeReport(row, photos) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    title: row.title,
    bodyText: row.report_text,
    photos: photos.map(serializeReportPhoto),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReportsRouter({ db, config, auth }) {
  const router = Router();
  const photoUpload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxPhotoBytes, files: 10, fields: 10 },
  });
  router.use(auth.requireAuth);

  router.get('/surveys/:surveyId/reports', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const reportRows = await db
      .prepare(
        `SELECT r.*, u.name AS created_by_name
           FROM survey_reports r
           LEFT JOIN users u ON u.id = r.created_by
          WHERE r.survey_id = ?
          ORDER BY r.created_at DESC`,
      )
      .all(survey.id);
    const reports = [];
    for (const reportRow of reportRows) {
      const photoRows = await db.prepare('SELECT * FROM survey_report_photos WHERE report_id = ? ORDER BY created_at').all(reportRow.id);
      reports.push(serializeReport(reportRow, photoRows));
    }
    res.json({ data: reports, reports });
  });

  router.get('/surveys/:surveyId/report-recipients', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    await assertSiteAccess(db, req.user, survey.site_id);
    const rows = await db
      .prepare(
        `SELECT DISTINCT u.id, u.name
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

  router.post('/surveys/:surveyId/reports', photoUpload.array('photos', 10), async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const files = req.files || [];
    try {
      const role = await assertSiteAccess(db, req.user, survey.site_id, 'installer');
      await assertSurveyAssignment(db, req.user, role, survey.id);
      const title = req.body?.title ? stringValue(req.body.title, 'title', { max: 200 }) : 'Field report';
      const bodyText = stringValue(req.body?.bodyText, 'bodyText', { max: 10000 });
      files.forEach(validatePhotoUpload);

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO survey_reports
          (id, survey_id, created_by, title, status, report_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'complete', ?, ?, ?)`,
      ).run(id, survey.id, req.user.id, title, bodyText, now, now);

      const photoRows = [];
      for (const file of files) {
        const storageKey = await storePhoto(file, config);
        const photoId = crypto.randomUUID();
        await db.prepare(
          `INSERT INTO survey_report_photos (id, report_id, storage_key, original_filename, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(photoId, id, storageKey, file.originalname, file.mimetype, file.size, now);
        photoRows.push({ id: photoId, report_id: id, storage_key: storageKey, original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size, created_at: now });
      }

      await logActivity(db, { surveyId: survey.id, siteId: survey.site_id, actorId: req.user.id, action: 'report.created', details: { reportId: id, photoCount: photoRows.length } });

      const reportRow = await db.prepare('SELECT * FROM survey_reports WHERE id = ?').get(id);
      reportRow.created_by_name = req.user.name;
      res.status(201).json({ data: serializeReport(reportRow, photoRows) });
    } catch (error) {
      files.forEach(cleanTemporaryUpload);
      throw error;
    }
  });

  router.get('/report-photos/:photoId/file', async (req, res) => {
    const photoId = idValue(req.params.photoId, 'photoId');
    const photo = await db.prepare('SELECT * FROM survey_report_photos WHERE id = ?').get(photoId);
    if (!photo) throw notFound('Photo');
    const report = await db.prepare('SELECT * FROM survey_reports WHERE id = ?').get(photo.report_id);
    const survey = await getSurvey(db, report.survey_id);
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': photo.mime_type,
      'Content-Disposition': `inline; filename="${safeFilename(photo.original_filename || 'photo.jpg')}"`,
    });
    const delivery = await storedFileDelivery(photo.storage_key, 'photo', config);
    if (delivery.contents) return res.send(delivery.contents);
    res.sendFile(delivery.path);
  });

  router.post('/reports/:reportId/send', async (req, res) => {
    const report = await getReport(db, idValue(req.params.reportId, 'reportId'));
    const survey = await getSurvey(db, report.survey_id);
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const userIds = jsonArray(req.body?.userIds, 'userIds')
      .filter((value) => typeof value === 'string')
      .slice(0, 20);
    if (!userIds.length) throw badRequest('Select at least one recipient.');

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

    const photoRows = await db.prepare('SELECT * FROM survey_report_photos WHERE report_id = ?').all(report.id);
    const attachments = await Promise.all(photoRows.map(async (photo) => {
      const delivery = await storedFileDelivery(photo.storage_key, 'photo', config);
      const buffer = delivery.contents || fs.readFileSync(delivery.path);
      return { filename: photo.original_filename || `photo-${photo.id}.jpg`, contentType: photo.mime_type, buffer };
    }));

    const surveyUrl = `${config.frontendOrigin || ''}/#/surveys/${survey.id}?site=${survey.site_id}`;
    const template = surveyReportEmailTemplate({
      senderName: req.user.name,
      title: report.title,
      bodyText: report.report_text,
      surveyName: survey.name,
      surveyUrl,
      photoCount: attachments.length,
    });

    let emailsSent = 0;
    const failures = [];
    for (const recipient of validRecipients) {
      if (!recipient.email) continue;
      try {
        const result = await sendEmail(config, { to: recipient.email, ...template, attachments });
        if (result?.sent) emailsSent += 1;
      } catch (error) {
        console.error('Failed to send survey report email:', error.message);
        failures.push(recipient.email);
      }
    }
    if (failures.length) {
      await logSecurityEvent(db, { eventType: 'report.email_failed', severity: 'warning', userId: req.user.id, req, details: { reportId: report.id, failedRecipients: failures } });
    }
    res.json({ data: { sent: emailsSent }, success: true });
  });

  router.delete('/reports/:reportId', async (req, res) => {
    const report = await getReport(db, idValue(req.params.reportId, 'reportId'));
    const survey = await getSurvey(db, report.survey_id);
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    const photoRows = await db.prepare('SELECT * FROM survey_report_photos WHERE report_id = ?').all(report.id);
    for (const photo of photoRows) {
      await deleteStoredFile(photo.storage_key, 'photo', config).catch(() => {});
    }
    await db.prepare('DELETE FROM survey_reports WHERE id = ?').run(report.id);
    res.json({ data: { deletedId: report.id } });
  });

  return router;
}

async function getReport(db, reportId) {
  const row = await db.prepare('SELECT * FROM survey_reports WHERE id = ?').get(reportId);
  if (!row) throw notFound('Report');
  return row;
}
