import { Router } from 'express';
import { serializeSite, serializeSurvey } from '../lib/serializers.js';

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function createSearchRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/search', async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 200);
    if (query.length < 2) {
      return res.json({ data: { sites: [], surveys: [] }, sites: [], surveys: [] });
    }
    const like = `%${escapeLike(query)}%`;
    const { id: userId, role, workspace_access: workspaceAccess } = req.user;

    const siteRows = await db
      .prepare(
        `SELECT s.*
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
          WHERE (? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL)
            AND s.name LIKE ? ESCAPE '\\'
          ORDER BY s.name COLLATE NOCASE
          LIMIT 20`,
      )
      .all(userId, role, workspaceAccess, like);

    const surveyRows = await db
      .prepare(
        `SELECT v.*, s.name AS site_name,
                CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END AS effective_role
           FROM surveys v
           JOIN sites s ON s.id = v.site_id
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
           LEFT JOIN survey_assignments sa ON sa.survey_id = v.id AND sa.user_id = ?
          WHERE (? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL)
            AND v.name LIKE ? ESCAPE '\\'
            AND (
              (CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END) != 'viewer'
              OR sa.survey_id IS NOT NULL
            )
          ORDER BY v.name COLLATE NOCASE
          LIMIT 20`,
      )
      .all(role, workspaceAccess, role, userId, userId, role, workspaceAccess, like, role, workspaceAccess, role);

    const sites = siteRows.map(serializeSite);
    const surveys = surveyRows.map((row) => ({ ...serializeSurvey(row), siteName: row.site_name }));
    res.json({ data: { sites, surveys }, sites, surveys });
  });

  return router;
}
