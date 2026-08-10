import { Router } from 'express';

const WORKFLOW_PROGRESS = {
  planned: 0,
  ready: 10,
  in_progress: 40,
  installed: 70,
  tested: 90,
  complete: 100,
  blocked: 40,
};

export function createDashboardRouter({ db, auth }) {
  const router = Router();
  router.use(auth.requireAuth);

  router.get('/dashboard-summary', async (req, res) => {
    const { id: userId, role, workspace_access: workspaceAccess } = req.user;

    const siteRows = await db
      .prepare(
        `SELECT s.id
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
          WHERE ? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL`,
      )
      .all(userId, role, workspaceAccess);
    const accessibleSiteIds = new Set(siteRows.map((row) => row.id));

    if (!accessibleSiteIds.size) {
      return res.json({ data: { totalDevices: 0, siteProgress: [] }, totalDevices: 0, siteProgress: [] });
    }

    const rows = await db
      .prepare(
        `SELECT v.site_id AS site_id, e.metadata_json AS metadata_json
           FROM elements e
           JOIN surveys v ON v.id = e.survey_id
          WHERE e.category != 'markup'`,
      )
      .all();

    const bySite = new Map();
    let totalDevices = 0;
    for (const row of rows) {
      if (!accessibleSiteIds.has(row.site_id)) continue;
      totalDevices += 1;
      let status = 'planned';
      try { status = JSON.parse(row.metadata_json || '{}').workflowStatus || 'planned'; }
      catch { /* fall back to planned if metadata is malformed */ }
      const progress = WORKFLOW_PROGRESS[status] ?? 0;
      const entry = bySite.get(row.site_id) || { count: 0, progressSum: 0 };
      entry.count += 1;
      entry.progressSum += progress;
      bySite.set(row.site_id, entry);
    }

    const siteProgress = [...bySite.entries()].map(([siteId, entry]) => ({
      siteId,
      deviceCount: entry.count,
      progress: entry.count ? Math.round(entry.progressSum / entry.count) : 0,
    }));

    res.json({ data: { totalDevices, siteProgress }, totalDevices, siteProgress });
  });

  return router;
}
