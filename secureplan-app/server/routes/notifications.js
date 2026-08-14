import { Router } from 'express';
import { idValue } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';

function serializeNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    senderName: row.sender_name,
    surveyId: row.survey_id,
    siteId: row.site_id,
    linkPath: row.link_path,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  };
}

export function createNotificationsRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/notifications', async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await db
      .prepare('SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(req.user.id, limit);
    const notifications = rows.map(serializeNotification);
    res.json({ data: notifications, notifications });
  });

  router.get('/notifications/unread-count', async (req, res) => {
    const row = await db
      .prepare('SELECT COUNT(*) AS count FROM user_notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id);
    res.json({ data: { count: Number(row?.count || 0) } });
  });

  router.post('/notifications/:notificationId/read', async (req, res) => {
    const notificationId = idValue(req.params.notificationId, 'notificationId');
    const existing = await db.prepare('SELECT * FROM user_notifications WHERE id = ? AND user_id = ?').get(notificationId, req.user.id);
    if (!existing) throw notFound('Notification');
    if (!existing.read_at) {
      await db.prepare('UPDATE user_notifications SET read_at = ? WHERE id = ?').run(new Date().toISOString(), notificationId);
    }
    res.json({ data: { id: notificationId, read: true } });
  });

  router.post('/notifications/mark-all-read', async (req, res) => {
    await db.prepare('UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(new Date().toISOString(), req.user.id);
    res.json({ data: { success: true } });
  });

  return router;
}
