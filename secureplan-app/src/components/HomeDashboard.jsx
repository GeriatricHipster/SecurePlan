import React, { useEffect, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { Spinner } from './Common.jsx';

function StatTile({ label, value, note }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">{label}</span>
      <strong className="stat-tile__value">{value}</strong>
      {note && <span className="stat-tile__note">{note}</span>}
    </div>
  );
}

function ActionCard({ title, description, buttonText, onClick }) {
  return (
    <div className="home-action-card">
      <h3>{title}</h3>
      <p>{description}</p>
      <button type="button" className="button button--primary" onClick={onClick}>{buttonText}</button>
    </div>
  );
}

export default function HomeDashboard({ user, navigate, notify }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ sites: 0, surveys: 0, folders: 0, devices: 0 });
  const canManageTeam = ['owner', 'admin'].includes(user.role);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const sites = normalizeList(await api.sites());
        const totals = sites.reduce((current, site) => ({
          surveys: current.surveys + Number(site.surveyCount ?? site.survey_count ?? 0),
          folders: current.folders + Number(site.folderCount ?? site.folder_count ?? 0),
        }), { surveys: 0, folders: 0 });

        const surveyLists = await Promise.all(sites.map((site) => api.surveys(site.id).catch(() => [])));
        const devices = surveyLists.reduce((total, list) => total + normalizeList(list)
          .reduce((sum, survey) => sum + Number(survey.elementCount ?? survey.element_count ?? 0), 0), 0);

        if (active) setStats({ sites: sites.length, surveys: totals.surveys, folders: totals.folders, devices });
      } catch (error) {
        if (active) notify(error.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [notify]);

  const firstName = (user.name || '').trim().split(' ')[0] || 'there';

  return (
    <main id="main-content" className="page page--home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace overview</p>
          <h1>Welcome back, {firstName}</h1>
          <p>A quick look at every site, survey, and team across SecurePlan.</p>
        </div>
      </div>

      {loading ? <div className="loading-panel"><Spinner label="Loading overview…" /></div> : (
        <>
          <div className="home-stats">
            <StatTile label="Sites" value={stats.sites} note="Open locations" />
            <StatTile label="Surveys" value={stats.surveys} note="Active floor plans" />
            <StatTile label="Folders" value={stats.folders} note="Organized groups" />
            <StatTile label="Plotted devices" value={stats.devices} note="Items on plans" />
          </div>

          <div className="home-actions">
            <ActionCard
              title="Open Sites"
              description="Browse every site, folder, and survey, or start a new one."
              buttonText="Go to Sites"
              onClick={() => navigate('sites')}
            />
            {canManageTeam && (
              <ActionCard
                title="Team & Invitations"
                description="Manage roles, members, and invitation codes from one place."
                buttonText="Go to Team"
                onClick={() => navigate('team')}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
