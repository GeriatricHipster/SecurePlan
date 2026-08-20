import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSiteAccess, assertSurveyAssignment } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { getSurvey } from '../lib/resources.js';
import { idValue, optionalNullableString, stringValue } from '../lib/validation.js';
import { logActivity } from '../db.js';
import { mergedFieldOptions, rememberCustomFieldValue } from '../lib/customOptions.js';

const TASK_NAME_OPTIONS = [
  'Parts Procurement',
  'Preprogramming (Vendor)',
  'Preprogramming (Ccure Team) clearances/schedules etc.',
  'Ccure Operator Established',
  'UIT (IP Addresses, Firewall)',
  'Conduit Install',
  'Cable Install',
  'ADA Install',
  'Ccure Hardware Install',
  'Camera Hardware Install',
  'Panel Install',
  'Fire Integration',
  'Alarm Panel Install/Integration',
  'Elevator Integration',
  'Final Programming',
  'Vendor Testing',
  'CCure/Camera Testing',
  'Key Shop Hardware Change',
  'Punchlist',
  'Closeout',
];

const ASSIGNED_TO_OPTIONS = [
  'James', 'James & Kyra', 'James & Ryan', 'James & Locksmiths', 'James & Suvam', 'James & Justin', 'James & Derick', 'James & Kenna', 'James & Justin, Suvam',
  'Kenna', 'Kenna & Kyra', 'Kenna & Ryan', 'Kenna & Locksmiths', 'Kenna & Justin', 'Kenna & Suvam', 'Kenna & Derick', 'Kenna & Justin, Suvam',
  'Derick', 'Derick & Kyra', 'Derick & Ryan', 'Derick & Locksmiths', 'Derick & Justin', 'Derick & Suvam', 'Derick & James', 'Derick & Kenna', 'Derick & Justin, Suvam',
  'Justin', 'Justin & Kyra', 'Justin & Ryan', 'Justin & Locksmiths', 'Justin & Derick', 'Justin & Suvam', 'Justin & Kenna', 'Justin & James',
  'Suvam', 'Suvam & Kyra', 'Suvam & Ryan', 'Suvam & Locksmiths', 'Suvam & Derick', 'Suvam & Kenna', 'Suvam & Justin', 'Suvam & James',
  'Ryan', 'Kyra', 'Bill', 'Bennett', 'Jim', 'Chris',
];

const VENDOR_OPTIONS = [
  'AVTEC', 'Beacon', 'Convergint', 'DSI', 'EverBase', 'G4S', 'Ideacom', 'IES', 'PTI', 'S101',
  'Stone', 'Pavion', 'Yamas', 'USHOP', 'Misc', 'SMT', 'Accent Auto',
];

const FIELD_TYPES = {
  taskName: 'task_name',
  assignedTo: 'assigned_to',
  vendor: 'vendor',
};

const BASE_OPTIONS = {
  task_name: TASK_NAME_OPTIONS,
  assigned_to: ASSIGNED_TO_OPTIONS,
  vendor: VENDOR_OPTIONS,
};

function serializeTask(row) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    taskName: row.task_name,
    assignedTo: row.assigned_to,
    vendor: row.vendor,
    deadline: row.deadline,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTasksRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  const mergedOptions = (fieldType) => mergedFieldOptions(db, fieldType, BASE_OPTIONS[fieldType] || []);
  const rememberCustomValue = (fieldType, value) => rememberCustomFieldValue(db, fieldType, BASE_OPTIONS[fieldType] || [], value);

  router.get('/task-options', async (req, res) => {
    const [taskName, assignedTo, vendor] = await Promise.all([
      mergedOptions(FIELD_TYPES.taskName),
      mergedOptions(FIELD_TYPES.assignedTo),
      mergedOptions(FIELD_TYPES.vendor),
    ]);
    res.json({ data: { taskName, assignedTo, vendor } });
  });

  router.get('/surveys/:surveyId/tasks', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id);
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const rows = await db.prepare('SELECT * FROM survey_tasks WHERE survey_id = ? ORDER BY (deadline IS NULL), deadline, created_at').all(survey.id);
    const tasks = rows.map(serializeTask);
    res.json({ data: tasks, tasks });
  });

  router.post('/surveys/:surveyId/tasks', async (req, res) => {
    const survey = await getSurvey(db, idValue(req.params.surveyId, 'surveyId'));
    const role = await assertSiteAccess(db, req.user, survey.site_id, 'installer');
    await assertSurveyAssignment(db, req.user, role, survey.id);
    const taskName = stringValue(req.body?.taskName, 'taskName', { max: 300 });
    const assignedTo = optionalNullableString(req.body?.assignedTo, 'assignedTo', 300);
    const vendor = optionalNullableString(req.body?.vendor, 'vendor', 300);
    const deadline = optionalNullableString(req.body?.deadline, 'deadline', 40);

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO survey_tasks (id, survey_id, task_name, assigned_to, vendor, deadline, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, survey.id, taskName, assignedTo, vendor, deadline, req.user.id, now, now);

    await Promise.all([
      rememberCustomValue(FIELD_TYPES.taskName, taskName),
      rememberCustomValue(FIELD_TYPES.assignedTo, assignedTo),
      rememberCustomValue(FIELD_TYPES.vendor, vendor),
    ]);

    await logActivity(db, { surveyId: survey.id, siteId: survey.site_id, actorId: req.user.id, action: 'task.created', details: { taskId: id, taskName } });

    const row = await db.prepare('SELECT * FROM survey_tasks WHERE id = ?').get(id);
    res.status(201).json({ data: serializeTask(row) });
  });

  router.patch('/tasks/:taskId', async (req, res) => {
    const existing = await db.prepare('SELECT * FROM survey_tasks WHERE id = ?').get(idValue(req.params.taskId, 'taskId'));
    if (!existing) throw notFound('Task');
    const survey = await getSurvey(db, existing.survey_id);
    const role = await assertSiteAccess(db, req.user, survey.site_id, 'installer');
    await assertSurveyAssignment(db, req.user, role, survey.id);

    const taskName = req.body?.taskName !== undefined ? stringValue(req.body.taskName, 'taskName', { max: 300 }) : existing.task_name;
    const assignedTo = req.body?.assignedTo !== undefined ? optionalNullableString(req.body.assignedTo, 'assignedTo', 300) : existing.assigned_to;
    const vendor = req.body?.vendor !== undefined ? optionalNullableString(req.body.vendor, 'vendor', 300) : existing.vendor;
    const deadline = req.body?.deadline !== undefined ? optionalNullableString(req.body.deadline, 'deadline', 40) : existing.deadline;

    const now = new Date().toISOString();
    await db.prepare(
      'UPDATE survey_tasks SET task_name = ?, assigned_to = ?, vendor = ?, deadline = ?, updated_at = ? WHERE id = ?',
    ).run(taskName, assignedTo, vendor, deadline, now, existing.id);

    await Promise.all([
      rememberCustomValue(FIELD_TYPES.taskName, taskName),
      rememberCustomValue(FIELD_TYPES.assignedTo, assignedTo),
      rememberCustomValue(FIELD_TYPES.vendor, vendor),
    ]);

    const row = await db.prepare('SELECT * FROM survey_tasks WHERE id = ?').get(existing.id);
    res.json({ data: serializeTask(row) });
  });

  router.delete('/tasks/:taskId', async (req, res) => {
    const existing = await db.prepare('SELECT * FROM survey_tasks WHERE id = ?').get(idValue(req.params.taskId, 'taskId'));
    if (!existing) throw notFound('Task');
    const survey = await getSurvey(db, existing.survey_id);
    const role = await assertSiteAccess(db, req.user, survey.site_id, 'installer');
    await assertSurveyAssignment(db, req.user, role, survey.id);
    await db.prepare('DELETE FROM survey_tasks WHERE id = ?').run(existing.id);
    res.json({ data: { deletedId: existing.id } });
  });

  return router;
}
