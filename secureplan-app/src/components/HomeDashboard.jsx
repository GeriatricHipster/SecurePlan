import React, { useEffect, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { Modal, Spinner, formatWhen, initials } from './Common.jsx';
import { workflowStatusFor } from './deviceLibrary.js';
import { Activity, ChartBar, Copy, FilePlus, FolderPlus, MapPin, Pencil, RotateCw, Search, Trash2 } from 'lucide-react';

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
          <div><strong>Track install progress</strong><p>Home shows each site's completion percentage, least-finished first, so you always know what needs attention.</p></div>
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

const ACTIVITY_ICONS = {
  'element.created': FilePlus,
  'element.updated': Pencil,
  'element.deleted': Trash2,
  'folder.created': FolderPlus,
  'folder.updated': Pencil,
  'folder.deleted': Trash2,
  'folder.copied': Copy,
  'site.created': MapPin,
  'site.updated': Pencil,
  'site.copied': Copy,
  'survey.created': FilePlus,
  'survey.updated': Pencil,
  'survey.copied': Copy,
  'survey.moved': FilePlus,
  'survey.rotated': RotateCw,
};

function describeActivity(entry) {
  const { action, details = {}, siteName, surveyName } = entry;
  const survey = surveyName ? `"${surveyName}"` : 'a survey';
  const site = siteName ? `"${siteName}"` : 'a site';
  switch (action) {
    case 'element.created': return <>plotted <strong>{details.label || details.type || 'a device'}</strong> on {survey}</>;
    case 'element.updated': return <>updated <strong>{details.label || 'a device'}</strong> on {survey}</>;
    case 'element.deleted': return <>removed <strong>{details.label || 'a device'}</strong> from {survey}</>;
    case 'folder.created': return <>created folder <strong>{details.name}</strong> in {site}</>;
    case 'folder.updated': return <>renamed a folder in {site}</>;
    case 'folder.deleted': return <>deleted a folder from {site}</>;
    case 'folder.copied': return <>copied a folder in {site}</>;
    case 'site.created': return <>created site <strong>{details.name}</strong></>;
    case 'site.updated': return <>updated {site} details</>;
    case 'site.copied': return <>duplicated a site</>;
    case 'survey.created': return <>created survey <strong>{details.name}</strong> in {site}</>;
    case 'survey.updated': return <>updated {survey}</>;
    case 'survey.copied': return <>copied a survey</>;
    case 'survey.moved': return <>moved a survey</>;
    case 'survey.rotated': return <>rotated {survey}</>;
    default: return action.replace('.', ' ');
  }
}

function ActivityFeed({ entries }) {
  if (!entries.length) return null;
  return (
    <div className="home-activity">
      <div className="home-progress__heading">
        <h2>Recent activity</h2>
        <p>What's changed across the workspace lately.</p>
      </div>
      <ul className="activity-feed">
        {entries.map((entry) => {
          const Icon = ACTIVITY_ICONS[entry.action] || Pencil;
          return (
            <li key={entry.id} className="activity-feed__item">
              <span className="activity-feed__icon" aria-hidden="true"><Icon size={15} /></span>
              <span className="mini-avatar" aria-hidden="true">{initials(entry.actorName)}</span>
              <p><strong>{entry.actorName}</strong> {describeActivity(entry)}</p>
              <time>{formatWhen(entry.createdAt)}</time>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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

function ProgressRow({ site, onOpen }) {
  const hasDevices = site.deviceCount > 0;
  const percent = hasDevices ? site.progress : 0;
  return (
    <button type="button" className="progress-row" onClick={onOpen}>
      <div className="progress-row__heading">
        <span className="progress-row__name">{site.name}</span>
        <span className="progress-row__percent">{hasDevices ? `${percent}%` : 'No devices yet'}</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${site.name} install progress`}>
        <div className="progress-bar__fill" style={{ width: `${hasDevices ? percent : 0}%` }} />
      </div>
      <span className="progress-row__meta">{site.deviceCount} device{site.deviceCount === 1 ? '' : 's'} plotted</span>
    </button>
  );
}

export default function HomeDashboard({ user, navigate, notify }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ sites: 0, surveys: 0, folders: 0, devices: 0 });
  const [siteProgress, setSiteProgress] = useState([]);
  const [activity, setActivity] = useState([]);
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
        const sites = normalizeList(await api.sites());
        const totals = sites.reduce((current, site) => ({
          surveys: current.surveys + Number(site.surveyCount ?? site.survey_count ?? 0),
          folders: current.folders + Number(site.folderCount ?? site.folder_count ?? 0),
        }), { surveys: 0, folders: 0 });

        const surveyListsBySite = await Promise.all(sites.map((site) => api.surveys(site.id).catch(() => [])));
        const surveysWithSite = sites.flatMap((site, index) => normalizeList(surveyListsBySite[index]).map((survey) => ({ ...survey, siteId: site.id })));

        const devices = surveysWithSite.reduce((sum, survey) => sum + Number(survey.elementCount ?? survey.element_count ?? 0), 0);

        const elementListsBySurvey = await Promise.all(surveysWithSite.map((survey) => api.elements(survey.id).catch(() => [])));

        const progressBySite = sites.map((site) => {
          const deviceElements = surveysWithSite.reduce((collected, survey, index) => {
            if (survey.siteId !== site.id) return collected;
            const elements = normalizeList(elementListsBySurvey[index]).filter((element) => element.category !== 'markup');
            return collected.concat(elements);
          }, []);
          const progress = deviceElements.length
            ? Math.round(deviceElements.reduce((sum, element) => sum + workflowStatusFor(element).progress, 0) / deviceElements.length)
            : 0;
          return { id: site.id, name: site.name, progress, deviceCount: deviceElements.length };
        }).sort((a, b) => a.progress - b.progress);

        const activityResult = await api.activity({ limit: 15 }).catch(() => ({ activity: [] }));

        if (active) {
          setStats({ sites: sites.length, surveys: totals.surveys, folders: totals.folders, devices });
          setSiteProgress(progressBySite);
          setActivity(normalizeList(activityResult?.activity ?? activityResult));
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
            <StatTile label="Sites" value={stats.sites} note="Open locations" />
            <StatTile label="Surveys" value={stats.surveys} note="Active floor plans" />
            <StatTile label="Folders" value={stats.folders} note="Organized groups" />
            <StatTile label="Plotted devices" value={stats.devices} note="Items on plans" />
          </div>

          {siteProgress.length > 0 && (
            <div className="home-progress">
              <div className="home-progress__heading">
                <h2>Install progress by site</h2>
                <p>Sorted least-complete first, so you can see what needs attention.</p>
              </div>
              <div className="home-progress__list">
                {siteProgress.map((site) => (
                  <ProgressRow key={site.id} site={site} onOpen={() => navigate(`sites/${site.id}`)} />
                ))}
              </div>
            </div>
          )}

          <ActivityFeed entries={activity} />

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
