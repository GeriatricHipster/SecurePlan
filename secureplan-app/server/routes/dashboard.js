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

  async function accessibleSiteIds(db, user) {
    const { id: userId, role, workspace_access: workspaceAccess } = user;
    const siteRows = await db
      .prepare(
        `SELECT s.id
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
           LEFT JOIN site_assignments sa ON sa.site_id = s.id AND sa.user_id = ?
          WHERE ? IN ('owner','admin') OR ? = 1
             OR (sm.user_id IS NOT NULL AND (sm.role NOT IN ('viewer', 'installer') OR sa.user_id IS NOT NULL))`,
      )
      .all(userId, userId, role, workspaceAccess);
    return new Set(siteRows.map((row) => row.id));
  }

  router.get('/dashboard-summary', async (req, res) => {
    const accessibleSiteIdSet = await accessibleSiteIds(db, req.user);

    if (!accessibleSiteIdSet.size) {
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
      if (!accessibleSiteIdSet.has(row.site_id)) continue;
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

  router.get('/active-sites', async (req, res) => {
    const accessibleSiteIdSet = await accessibleSiteIds(db, req.user);
    if (!accessibleSiteIdSet.size) return res.json({ data: [], sites: [] });

    const rows = await db
      .prepare(
        `SELECT a.site_id, s.name AS site_name, MAX(a.created_at) AS last_activity_at, COUNT(*) AS change_count
           FROM activity_log a
           JOIN sites s ON s.id = a.site_id
          WHERE a.actor_id = ? AND a.site_id IS NOT NULL
          GROUP BY a.site_id, s.name
          ORDER BY last_activity_at DESC`,
      )
      .all(req.user.id);

    const sites = rows
      .filter((row) => accessibleSiteIdSet.has(row.site_id))
      .map((row) => ({
        siteId: row.site_id,
        siteName: row.site_name,
        lastActivityAt: row.last_activity_at,
        changeCount: Number(row.change_count),
      }));

    res.json({ data: sites, sites });
  });

  return router;
}
