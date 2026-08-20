import React, { useEffect, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { Modal, Spinner, formatWhen } from './Common.jsx';
import { Activity, ChartBar, FilePlus, FolderPlus, MapPin, Search } from 'lucide-react';

const WELCOME_STORAGE_KEY = 'secureplan-welcomed';

function WelcomeModal({ open, onClose }) {
  return (
    <Modal open={open} title="Welcome to SecurePlan" onClose={onClose}>
      <p className="welcome-modal__intro">A quick look at what's here before you dive in.</p>
      <ul className="welcome-modal__list">
        <li>
          <span className="welcome-modal__icon" aria-hidden="true"><Search size={18} /></span>
          <div><strong>Search anything</strong><p>Click the search icon in the header to jump straight to a site or survey by name.</p></div>
        </li>
        <li>
          <span className="welcome-modal__icon" aria-hidden="true"><ChartBar size={18} /></span>
          <div><strong>See what needs attention</strong><p>Home surfaces the sites with the least install progress, so you always know where to focus next.</p></div>
        </li>
        <li>
          <span className="welcome-modal__icon" aria-hidden="true"><Activity size={18} /></span>
          <div><strong>See recent activity</strong><p>Every change across the workspace shows up right on Home — who did what, and when.</p></div>
        </li>
      </ul>
      <div className="modal__actions">
        <button type="button" className="button button--primary" onClick={onClose}>Got it, let's go</button>
      </div>
    </Modal>
  );
}

function StatTile({ label, value, note, icon: Icon }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__top">
        <span className="stat-tile__label">{label}</span>
        {Icon && <span className="stat-tile__icon" aria-hidden="true"><Icon size={16} /></span>}
      </div>
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
  const [activeSites, setActiveSites] = useState([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const canManageTeam = ['owner', 'admin'].includes(user.role);

  useEffect(() => {
    if (!window.localStorage.getItem(WELCOME_STORAGE_KEY)) setShowWelcome(true);
  }, []);

  const dismissWelcome = () => {
    window.localStorage.setItem(WELCOME_STORAGE_KEY, '1');
    setShowWelcome(false);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [sitesResult, summary, activeSitesResult] = await Promise.all([
          api.sites(),
          api.dashboardSummary().catch(() => ({ totalDevices: 0, siteProgress: [] })),
          api.activeSites().catch(() => ({ sites: [] })),
        ]);
        const sites = normalizeList(sitesResult);
        const totals = sites.reduce((current, site) => ({
          surveys: current.surveys + Number(site.surveyCount ?? site.survey_count ?? 0),
          folders: current.folders + Number(site.folderCount ?? site.folder_count ?? 0),
        }), { surveys: 0, folders: 0 });

        if (active) {
          setStats({ sites: sites.length, surveys: totals.surveys, folders: totals.folders, devices: summary?.totalDevices || 0 });
          setActiveSites(normalizeList(activeSitesResult?.sites ?? activeSitesResult));
        }
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
      <WelcomeModal open={showWelcome} onClose={dismissWelcome} />
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
            <StatTile label="Sites" value={stats.sites} note="Open locations" icon={MapPin} />
            <StatTile label="Surveys" value={stats.surveys} note="Active floor plans" icon={FilePlus} />
            <StatTile label="Folders" value={stats.folders} note="Organized groups" icon={FolderPlus} />
            <StatTile label="Plotted devices" value={stats.devices} note="Items on plans" icon={ChartBar} />
          </div>

          <div className="home-progress">
            <div className="home-progress__heading">
              <div>
                <h2>Your active sites</h2>
                <p>Sites you've made changes to.</p>
              </div>
              <button type="button" className="button button--ghost home-progress__view-all" onClick={() => navigate('sites')}>View all sites</button>
            </div>
            {!activeSites.length ? (
              <p className="muted">Nothing here yet — sites you edit will show up as you go.</p>
            ) : (
              <ul className="active-sites-list">
                {activeSites.map((site) => (
                  <li key={site.siteId}>
                    <button type="button" onClick={() => navigate(`sites/${site.siteId}`)}>
                      <span className="active-sites-list__name">{site.siteName}</span>
                      <span className="active-sites-list__meta">{site.changeCount} change{site.changeCount === 1 ? '' : 's'} · {formatWhen(site.lastActivityAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
