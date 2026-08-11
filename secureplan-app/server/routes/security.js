import { Router } from 'express';
import { forbidden } from '../lib/errors.js';

export function createSecurityRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/security-events', async (req, res) => {
    if (!req.user.workspace_access || !['owner', 'admin'].includes(req.user.role)) {
      throw forbidden('Only owners and admins can view the security log.');
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = await db
      .prepare(
        `SELECT se.id, se.event_type, se.severity, se.user_id, se.email_attempted, se.ip_address, se.details_json, se.created_at,
                u.name AS user_name, u.email AS user_email
           FROM security_events se
           LEFT JOIN users u ON u.id = se.user_id
          ORDER BY se.created_at DESC
          LIMIT ?`,
      )
      .all(limit);

    const events = rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      userName: row.user_name,
      userEmail: row.user_email || row.email_attempted,
      ipAddress: row.ip_address,
      details: JSON.parse(row.details_json || '{}'),
      createdAt: row.created_at,
    }));
    res.json({ data: events, events });
  });

  return router;
}
