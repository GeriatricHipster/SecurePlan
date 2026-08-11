import { Router } from 'express';
import { assertSiteAccess, assertSurveyAssignment } from '../lib/auth.js';
import { getSurvey } from '../lib/resources.js';
import { idValue } from '../lib/validation.js';

export function createActivityRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/activity', async (req, res) => {
    try {
      const siteId = req.query.siteId ? idValue(req.query.siteId, 'siteId') : null;
      const surveyId = req.query.surveyId ? idValue(req.query.surveyId, 'surveyId') : null;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));

      let effectiveSiteId = siteId;
      let isViewerRestricted = false;

      if (surveyId) {
        const survey = await getSurvey(db, surveyId);
        effectiveSiteId = survey.site_id;
        const role = await assertSiteAccess(db, req.user, survey.site_id);
        isViewerRestricted = role === 'viewer';
        if (isViewerRestricted) await assertSurveyAssignment(db, req.user, role, surveyId);
      } else if (siteId) {
        const role = await assertSiteAccess(db, req.user, siteId);
        isViewerRestricted = role === 'viewer';
      } else if (!req.user.workspace_access && req.user.role !== 'owner' && req.user.role !== 'admin') {
        isViewerRestricted = true;
      }

      const params = [];
      let query = `SELECT a.id, a.site_id, a.survey_id, a.element_id, a.actor_id, a.action, a.details_json, a.created_at,
                u.name AS actor_name, s.name AS site_name, v.name AS survey_name
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.actor_id
           LEFT JOIN sites s ON s.id = a.site_id
           LEFT JOIN surveys v ON v.id = a.survey_id`;

      if (isViewerRestricted) {
        query += ' JOIN survey_assignments sa ON sa.survey_id = a.survey_id AND sa.user_id = ?';
        params.push(req.user.id);
      }

      query += ' WHERE 1 = 1';
      if (effectiveSiteId) { query += ' AND a.site_id = ?'; params.push(effectiveSiteId); }
      if (surveyId) { query += ' AND a.survey_id = ?'; params.push(surveyId); }
      query += ' ORDER BY a.created_at DESC LIMIT ?';
      params.push(limit);

      const rows = await db.prepare(query).all(...params);

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
    } catch (error) {
      console.error('GET /api/activity failed:', { message: error.message, stack: error.stack, query: req.query });
      throw error;
    }
  });

  return router;
}
