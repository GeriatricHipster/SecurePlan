import { Router } from 'express';
import { assertSiteAccess } from '../lib/auth.js';
import { idValue } from '../lib/validation.js';

export function createActivityRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/activity', async (req, res) => {
    const siteId = req.query.siteId ? idValue(req.query.siteId, 'siteId') : null;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    if (siteId) await assertSiteAccess(db, req.user, siteId);
    const { id: userId, role, workspace_access: workspaceAccess } = req.user;

    const rows = await db
      .prepare(
        `SELECT a.id, a.site_id, a.survey_id, a.element_id, a.actor_id, a.action, a.details_json, a.created_at,
                u.name AS actor_name, s.name AS site_name, v.name AS survey_name
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.actor_id
           LEFT JOIN sites s ON s.id = a.site_id
           LEFT JOIN surveys v ON v.id = a.survey_id
           LEFT JOIN site_members sm ON sm.site_id = a.site_id AND sm.user_id = ?
           LEFT JOIN survey_assignments sa ON sa.survey_id = a.survey_id AND sa.user_id = ?
          WHERE (? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL)
            AND (? IS NULL OR a.site_id = ?)
            AND (
              (CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END) != 'viewer'
              OR a.survey_id IS NULL
              OR sa.survey_id IS NOT NULL
            )
          ORDER BY a.created_at DESC
          LIMIT ?`,
      )
      .all(userId, userId, role, workspaceAccess, siteId, siteId, role, workspaceAccess, role, limit);

    const activity = rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorName: row.actor_name || 'Someone',
      siteName: row.site_name,
      surveyName: row.survey_name,
      details: JSON.parse(row.details_json || '{}'),
      createdAt: row.created_at,
    }));
    res.json({ data: activity, activity });
  });

  return router;
}
