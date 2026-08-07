import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { OwnerSetup, SignIn } from './components/AuthScreens.jsx';
import { Brand, Modal, Spinner, initials } from './components/Common.jsx';
import HomeDashboard from './components/HomeDashboard.jsx';
import SitesDashboard from './components/SitesDashboard.jsx';
import SiteWorkspace from './components/SiteWorkspace.jsx';
import TeamPage from './components/TeamPage.jsx';
import InstallAppPrompt from './components/InstallAppPrompt.jsx';
import FullScreenToggle from './components/FullScreenToggle.jsx';
import { ChevronDown, FileText, Home as HomeIcon, LayoutGrid, MapPin, Moon, Search, Sun, Users } from 'lucide-react';
const SurveyEditor = lazy(() => import('./components/SurveyEditor.jsx'));

const THEME_STORAGE_KEY = 'secureplan-theme';

function initialTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function routeFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'sites' && parts[1]) return { page: 'site', siteId: parts[1] };
  if (parts[0] === 'sites') return { page: 'sites' };
  if (parts[0] === 'surveys' && parts[1]) {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return { page: 'survey', surveyId: parts[1].split('?')[0], siteId: params.get('site') || '' };
  }
  if (parts[0] === 'team') return { page: 'team' };
  return { page: 'home' };
}

function navigate(path) {
  const target = `#/${path.replace(/^\//, '')}`;
  if (window.location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = target;
}

function SearchButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ sites: [], surveys: [] });
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    if (!open) { setQuery(''); setResults({ sites: [], surveys: [] }); }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults({ sites: [], surveys: [] }); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const response = await api.search(trimmed);
        setResults({ sites: response?.sites || [], surveys: response?.surveys || [] });
      } catch {
        setResults({ sites: [], surveys: [] });
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [query]);

  const goToSite = (site) => { setOpen(false); navigate(`sites/${site.id}`); };
  const goToSurvey = (survey) => { setOpen(false); navigate(`surveys/${survey.id}?site=${survey.siteId}`); };

  const trimmed = query.trim();
  const hasResults = results.sites.length > 0 || results.surveys.length > 0;

  return (
    <>
      <button type="button" className="icon-button" onClick={() => setOpen(true)} aria-label="Search sites and surveys" title="Search">
        <Search aria-hidden="true" size={18} />
      </button>
      <Modal open={open} title="Search" onClose={() => setOpen(false)}>
        <div className="search-modal">
          <input
            ref={inputRef}
            type="search"
            className="search-modal__input"
            placeholder="Search sites and surveys…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {trimmed.length > 0 && trimmed.length < 2 && <p className="search-modal__hint">Keep typing — at least 2 characters.</p>}
          {loading && <div className="search-modal__loading"><Spinner label="Searching…" /></div>}
          {!loading && trimmed.length >= 2 && !hasResults && <p className="search-modal__hint">No matches for "{trimmed}".</p>}
          {!loading && results.sites.length > 0 && (
            <div className="search-modal__group">
              <h3>Sites</h3>
              {results.sites.map((site) => (
                <button type="button" key={site.id} className="search-modal__result" onClick={() => goToSite(site)}>
                  <MapPin aria-hidden="true" size={16} />
                  <span>{site.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && results.surveys.length > 0 && (
            <div className="search-modal__group">
              <h3>Surveys</h3>
              {results.surveys.map((survey) => (
                <button type="button" key={survey.id} className="search-modal__result" onClick={() => goToSurvey(survey)}>
                  <FileText aria-hidden="true" size={16} />
                  <span>{survey.name}</span>
                  {survey.siteName && <small>{survey.siteName}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function ThemeButton({ theme, onToggle }) {
  return (
    <button type="button" className="theme-toggle button button--secondary" onClick={onToggle} title="Toggle dark mode" aria-label="Toggle dark mode">
      {theme === 'dark' ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
      <span className="theme-toggle__label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}

function AppHeader({ user, route, onLogout, theme, onToggleTheme, isOnline }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <button type="button" className="brand-button" onClick={() => navigate('home')} aria-label="Go to home">
        <Brand compact />
      </button>
      <nav className="desktop-nav" aria-label="Primary navigation">
        <button type="button" className={route.page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button>
        <button type="button" className={route.page === 'sites' || route.page === 'site' ? 'active' : ''} onClick={() => navigate('sites')}>Sites</button>
        {['owner', 'admin'].includes(user.role) && <button type="button" className={route.page === 'team' ? 'active' : ''} onClick={() => navigate('team')}>Team</button>}
      </nav>
      <div className="header-actions">
        <span className={`connection-pill ${isOnline ? 'connection-pill--online' : 'connection-pill--offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
        <FullScreenToggle />
      </div>
      <SearchButton />
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
      <details className="account-menu" open={menuOpen} onToggle={(e) => setMenuOpen(e.currentTarget.open)}>
        <summary aria-label="Open account menu">
          <span className="avatar">{initials(user.name)}</span>
          <span className="account-menu__name">{user.name}</span>
          <ChevronDown aria-hidden="true" size={16} />
        </summary>
        <div className="account-menu__popover">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
          <span className="role-badge">{user.role}</span>
          <hr />
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </details>
    </header>
  );
}

function MobileNav({ route, user }) {
  if (route.page === 'survey') return null;
  return (
    <nav className={`mobile-nav ${['owner', 'admin'].includes(user.role) ? 'mobile-nav--triple' : ''}`} aria-label="Mobile navigation">
      <button type="button" className={route.page === 'home' ? 'active' : ''} onClick={() => navigate('home')}><HomeIcon aria-hidden="true" size={20} />Home</button>
      <button type="button" className={route.page === 'sites' || route.page === 'site' ? 'active' : ''} onClick={() => navigate('sites')}><LayoutGrid aria-hidden="true" size={20} />Sites</button>
      {['owner', 'admin'].includes(user.role) && <button type="button" className={route.page === 'team' ? 'active' : ''} onClick={() => navigate('team')}><Users aria-hidden="true" size={20} />Team</button>}
    </nav>
  );
}

export default function App() {
  const [status, setStatus] = useState('loading');
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupCodeRequired, setSetupCodeRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState(routeFromHash);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState(initialTheme);
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      api.flushOfflineQueue?.().catch(() => {});
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const pageName = {
      home: 'Home',
      sites: 'Sites',
      site: 'Site workspace',
      survey: 'Survey editor',
      team: 'Team',
    }[route.page] || 'SecurePlan';

    document.title = `${pageName} · SecurePlan Surveyor`;
    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById('main-content');
      if (!main) return;
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [route.page, status, user?.id]);

  const boot = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await api.bootstrap();
      const nextUser = result?.user || null;
      setUser(nextUser);
      setSetupRequired(Boolean(result?.setupRequired ?? result?.needsSetup ?? result?.requiresSetup));
      setSetupCodeRequired(Boolean(result?.setupCodeRequired));
      setStatus('ready');
      api.flushOfflineQueue?.().catch(() => {});
    } catch (error) {
      setStatus('error');
      setToast(error.message);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const authenticate = async (operation, values) => {
    const result = await operation(values);
    const authenticated = result?.user || result;
    setUser(authenticated);
    setSetupRequired(false);
    navigate('home');
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      navigate('home');
    }
  };

  const context = useMemo(() => ({
    user,
    notify: setToast,
    navigate,
    theme,
    toggleTheme,
    isOnline,
  }), [user, theme, toggleTheme, isOnline]);

  if (status === 'loading') {
    return <main id="main-content" className="boot-screen"><Brand /><Spinner label="Opening your workspace…" /></main>;
  }

  if (status === 'error') {
    return (
      <main id="main-content" className="boot-screen">
        <Brand />
        <h1>SecurePlan could not start</h1>
        <p>Check the server connection and try again.</p>
        <button type="button" className="button button--primary" onClick={boot}>Try again</button>
      </main>
    );
  }

  if (setupRequired) {
    return <OwnerSetup setupCodeRequired={setupCodeRequired} onSubmit={(values) => authenticate(api.setupOwner, values)} />;
  }

  if (!user) {
    return <SignIn onLogin={(values) => authenticate(api.login, values)} onRegister={(values) => authenticate(api.register, values)} />;
  }

  return (
    <>
      <div className={`app-shell app-shell--${route.page}`}>
        {route.page !== 'survey' && <AppHeader user={user} route={route} onLogout={logout} theme={theme} onToggleTheme={toggleTheme} isOnline={isOnline} />}
        {!isOnline && <div className="offline-banner" role="status">Offline mode is on. Your edits will queue locally and sync when the connection returns.</div>}
        {route.page === 'home' && <HomeDashboard {...context} />}
        {route.page === 'sites' && <SitesDashboard {...context} />}
        {route.page === 'site' && <SiteWorkspace {...context} siteId={route.siteId} />}
        {route.page === 'survey' && (
          <Suspense fallback={<main id="main-content" className="editor-loading"><Spinner label="Loading survey tools…" /></main>}>
            <SurveyEditor {...context} surveyId={route.surveyId} siteId={route.siteId} />
          </Suspense>
        )}
        {route.page === 'team' && <TeamPage {...context} />}
        <MobileNav route={route} user={user} />
        <InstallAppPrompt />
        <div className={`toast ${toast ? 'toast--visible' : ''}`} role="status" aria-live="polite">{toast}</div>
      </div>
    </>
  );
}
