import { Router } from 'express';
import { assertSiteAccess, assertSurveyAssignment } from '../lib/auth.js';
import { getSurvey } from '../lib/resources.js';
import { idValue } from '../lib/validation.js';

export function createActivityRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/activity', async (req, res) => {
    const siteId = req.query.siteId ? idValue(req.query.siteId, 'siteId') : null;
    const surveyId = req.query.surveyId ? idValue(req.query.surveyId, 'surveyId') : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));

    let effectiveSiteId = siteId;
    let role;
    if (surveyId) {
      const survey = await getSurvey(db, surveyId);
      effectiveSiteId = survey.site_id;
      role = await assertSiteAccess(db, req.user, survey.site_id);
      await assertSurveyAssignment(db, req.user, role, surveyId);
    } else if (siteId) {
      role = await assertSiteAccess(db, req.user, siteId);
    } else {
      role = req.user.workspace_access ? req.user.role : 'viewer';
    }

    const isElevated = req.user.role === 'owner' || req.user.role === 'admin' || Boolean(req.user.workspace_access);

    const baseSelect = `SELECT a.id, a.site_id, a.survey_id, a.element_id, a.actor_id, a.action, a.details_json, a.created_at,
                u.name AS actor_name, s.name AS site_name, v.name AS survey_name
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.actor_id
           LEFT JOIN sites s ON s.id = a.site_id
           LEFT JOIN surveys v ON v.id = a.survey_id`;

    let rows;
    if (isElevated || role !== 'viewer') {
      // Owner/admin/workspace members, or a confirmed non-viewer role for this specific site/survey: no extra filtering needed.
      rows = await db
        .prepare(
          `${baseSelect}
          WHERE (? IS NULL OR a.site_id = ?)
            AND (? IS NULL OR a.survey_id = ?)
          ORDER BY a.created_at DESC
          LIMIT ?`,
        )
        .all(effectiveSiteId, effectiveSiteId, surveyId, surveyId, limit);
    } else {
      // Viewer: only activity for surveys they're explicitly assigned to.
      rows = await db
        .prepare(
          `${baseSelect}
           JOIN survey_assignments sa ON sa.survey_id = a.survey_id AND sa.user_id = ?
          WHERE (? IS NULL OR a.site_id = ?)
            AND (? IS NULL OR a.survey_id = ?)
          ORDER BY a.created_at DESC
          LIMIT ?`,
        )
        .all(req.user.id, effectiveSiteId, effectiveSiteId, surveyId, surveyId, limit);
    }

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
