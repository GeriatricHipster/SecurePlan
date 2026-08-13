import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { assertSiteAccess, assertSurveyAssignment } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { deleteStoredFile, cleanTemporaryUpload, storeVideo, storedFileDelivery, validateVideoUpload } from '../lib/storage.js';
import { getSurvey } from '../lib/resources.js';
import { isAiConfigured, transcribeRecording, generateFieldReport } from '../lib/ai.js';
import { idValue, stringValue } from '../lib/validation.js';
import { logActivity } from '../db.js';
import fs from 'node:fs';

function serializeReport(row) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    createdBy: row.created_by,
    title: row.title,
    status: row.status,
    durationSeconds: row.duration_seconds,
    transcript: row.transcript,
    reportText: row.report_text,
    errorMessage: row.error_message,
    hasVideo: Boolean(row.video_storage_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReportsRouter({ db, config, auth, emitSurveyUpdate }) {
  const router = Router();
  const videoUpload = multer({
    dest: config.temporaryFilesDir,
    limits: { fileSize: config.maxVideoBytes, files: 1, fields: 10 },
  });
  router.use(auth.requireAuth);

  router.get('/surveys/:surveyId/reports', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const rows = await db
      .prepare('SELECT * FROM survey_reports WHERE survey_id = ? ORDER BY created_at DESC')
      .all(survey.id);
    const reports = rows.map(serializeReport);
    res.json({ data: reports, reports });
  });

  router.post('/surveys/:surveyId/reports', videoUpload.single('video'), async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    try {
      const role = await assertSiteAccess(db, req.user, survey.site_id, 'installer');
      await assertSurveyAssignment(db, req.user, role, survey.id);
      if (!isAiConfigured(config)) throw badRequest('Voice-to-report is not configured yet. Ask an administrator to set up an AI provider.');
      validateVideoUpload(req.file);
      const durationSeconds = req.body?.durationSeconds ? Number(req.body.durationSeconds) : null;
      const title = req.body?.title ? stringValue(req.body.title, 'title', { max: 200 }) : 'Field report';

      const mimetype = req.file.mimetype;
      const videoKey = await storeVideo(req.file, config);

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO survey_reports
          (id, survey_id, created_by, title, status, video_storage_key, duration_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?)`,
      ).run(id, survey.id, req.user.id, title, videoKey, durationSeconds, now, now);

      res.status(202).json({ data: { id, status: 'processing' } });

      processReportInBackground({ db, config, emitSurveyUpdate, reportId: id, survey, videoKey, mimetype }).catch((error) => {
        console.error(`Report ${id} background processing failed unexpectedly:`, error);
      });
    } catch (error) {
      cleanTemporaryUpload(req.file);
      throw error;
    }
  });

  router.get('/reports/:reportId/video', async (req, res) => {
    const report = await getReport(db, idValue(req.params.reportId, 'reportId'));
    const survey = await getSurvey(db, report.survey_id);
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    if (!report.video_storage_key) throw notFound('Video');
    res.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': report.video_storage_key.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
    });
    const delivery = await storedFileDelivery(report.video_storage_key, 'video', config);
    if (delivery.contents) return res.send(delivery.contents);
    res.sendFile(delivery.path);
  });

  router.delete('/reports/:reportId', async (req, res) => {
    const report = await getReport(db, idValue(req.params.reportId, 'reportId'));
    const survey = await getSurvey(db, report.survey_id);
    await assertSiteAccess(db, req.user, survey.site_id, 'editor');
    if (report.video_storage_key) await deleteStoredFile(report.video_storage_key, 'video', config);
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

async function processReportInBackground({ db, config, emitSurveyUpdate, reportId, survey, videoKey, mimetype }) {
  const markFailed = async (message) => {
    await db.prepare('UPDATE survey_reports SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
      .run('failed', message, new Date().toISOString(), reportId);
    emitSurveyUpdate?.(survey.id, 'report.updated', null, { reportId });
  };

  let buffer;
  try {
    const delivery = await storedFileDelivery(videoKey, 'video', config);
    buffer = delivery.contents || fs.readFileSync(delivery.path);
  } catch (error) {
    await markFailed(`Could not read the stored recording: ${error.message}`);
    return;
  }

  let transcript;
  try {
    transcript = await transcribeRecording(config, buffer, mimetype);
    if (!transcript?.trim()) throw new Error('The recording produced an empty transcript. Try speaking more clearly or closer to the microphone.');
  } catch (error) {
    await markFailed(error.message);
    return;
  }

  let reportText;
  try {
    reportText = await generateFieldReport(config, transcript, { surveyName: survey.name });
  } catch (error) {
    // We still have a usable transcript even if the write-up step failed - save that much rather than losing everything.
    await db.prepare(
      'UPDATE survey_reports SET status = ?, transcript = ?, error_message = ?, updated_at = ? WHERE id = ?',
    ).run('failed', transcript, `Report writing failed, but the transcript was saved: ${error.message}`, new Date().toISOString(), reportId);
    emitSurveyUpdate?.(survey.id, 'report.updated', null, { reportId });
    return;
  }

  await db.prepare(
    'UPDATE survey_reports SET status = ?, transcript = ?, report_text = ?, updated_at = ? WHERE id = ?',
  ).run('complete', transcript, reportText, new Date().toISOString(), reportId);
  await logActivity(db, { surveyId: survey.id, siteId: survey.site_id, actorId: null, action: 'report.generated', details: { reportId } });
  emitSurveyUpdate?.(survey.id, 'report.updated', null, { reportId });
}
