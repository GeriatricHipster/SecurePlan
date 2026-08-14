import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, nativeTransport, normalizeList } from './api.js';
import { OwnerSetup, ResetPassword, SignIn } from './components/AuthScreens.jsx';
import { Brand, Modal, Spinner, formatWhen, initials } from './components/Common.jsx';
import HomeDashboard from './components/HomeDashboard.jsx';
import SitesDashboard from './components/SitesDashboard.jsx';
import SiteWorkspace from './components/SiteWorkspace.jsx';
import TeamPage from './components/TeamPage.jsx';
import InstallAppPrompt from './components/InstallAppPrompt.jsx';
import FullScreenToggle from './components/FullScreenToggle.jsx';
import { Bell, ChevronDown, FileText, Home as HomeIcon, LayoutGrid, MapPin, Moon, Search, Sun, Users, X as XIcon } from 'lucide-react';
const SurveyEditor = lazy(() => import('./components/SurveyEditor.jsx'));

const THEME_STORAGE_KEY = 'secureplan-theme';

function initialTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function routeFromHash() {
  const [rawPath, rawQuery] = window.location.hash.replace(/^#\/?/, '').split('?');
  const parts = rawPath.split('/').filter(Boolean);
  const params = new URLSearchParams(rawQuery || '');
  if (parts[0] === 'sites' && parts[1]) return { page: 'site', siteId: parts[1] };
  if (parts[0] === 'sites') return { page: 'sites' };
  if (parts[0] === 'surveys' && parts[1]) {
    return { page: 'survey', surveyId: parts[1], siteId: params.get('site') || '' };
  }
  if (parts[0] === 'team') return { page: 'team' };
  if (parts[0] === 'reset-password') {
    return { page: 'reset-password', token: params.get('token') || '' };
  }
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

function AppHeader({ user, route, onLogout, theme, onToggleTheme, isOnline, unreadCount, onOpenInbox }) {
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
      <button type="button" className="icon-button inbox-button" onClick={onOpenInbox} aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}>
        <Bell aria-hidden="true" size={18} />
        {unreadCount > 0 && <span className="inbox-button__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
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

let baseFaviconImagePromise = null;
function loadBaseFaviconImage() {
  if (baseFaviconImagePromise) return baseFaviconImagePromise;
  baseFaviconImagePromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/app-icon.svg';
  });
  return baseFaviconImagePromise;
}

async function updateFaviconBadge(count) {
  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) navigator.setAppBadge(count).catch(() => {});
      else navigator.clearAppBadge?.().catch(() => {});
    }
    const baseImage = await loadBaseFaviconImage();
    if (!baseImage) return;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(baseImage, 0, 0, size, size);
    if (count > 0) {
      const label = count > 99 ? '99+' : String(count);
      const radius = label.length > 2 ? 20 : 16;
      const cx = size - radius * 0.72;
      const cy = radius * 0.72;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#b4232d';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${label.length > 2 ? 15 : 20}px -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 1);
    }
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
  } catch {
    // The favicon badge is a nice-to-have - never let it break the app.
  }
}

function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.25);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.3);
    });
    window.setTimeout(() => ctx.close(), 700);
  } catch {
    // Sound is a nice-to-have - fail silently if the browser blocks audio (e.g. no user interaction yet).
  }
}

function NotificationInboxModal({ open, onClose, onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    api.notifications().then((result) => {
      if (!active) return;
      setItems(normalizeList(result?.notifications ?? result));
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Mark everything read the moment the inbox opens, and clear the badge to match.
    api.markAllNotificationsRead().then(() => {
      onCountChange(0);
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    }).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openItem = (item) => {
    onClose();
    if (item.linkPath) navigate(item.linkPath);
  };

  return (
    <Modal open={open} title="Notifications" description="Updates from your team." onClose={onClose} wide>
      {loading ? (
        <div className="loading-panel"><Spinner label="Loading…" /></div>
      ) : !items.length ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <ul className="notification-inbox">
          {items.map((item) => (
            <li key={item.id} className={`notification-inbox__item ${item.read ? '' : 'notification-inbox__item--unread'}`}>
              <button type="button" onClick={() => openItem(item)}>
                <strong>{item.title}</strong>
                {item.body && <p>{item.body}</p>}
                <time>{formatWhen(item.createdAt)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
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
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showInbox, setShowInbox] = useState(false);
  const [showMissedPrompt, setShowMissedPrompt] = useState(false);

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
    if (!user?.id) return;
    let active = true;
    api.unreadNotificationCount().then((result) => {
      if (!active) return;
      const count = result?.count ?? 0;
      setUnreadCount(count);
      if (count > 0) setShowMissedPrompt(true);
    }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    updateFaviconBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!user?.id) return undefined;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    const socketOptions = {
      withCredentials: !nativeTransport.isNative,
      ...(nativeTransport.isNative ? { auth: { token: nativeTransport.sessionToken() } } : {}),
    };
    const socket = nativeTransport.isNative ? io(nativeTransport.apiOrigin, socketOptions) : io(socketOptions);
    socket.on('user:notification', (notification) => {
      setNotifications((current) => [notification, ...current].slice(0, 5));
      setUnreadCount((current) => current + 1);
      playNotificationChime();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try {
          const browserNotification = new Notification(notification.title || 'SecurePlan', { body: notification.body, tag: notification.id });
          browserNotification.onclick = () => { window.focus(); browserNotification.close(); };
        } catch {
          // Some environments (certain native webviews) don't support the Notification API - fail silently.
        }
      }
    });
    return () => socket.disconnect();
  }, [user?.id]);

  const dismissNotification = (id) => setNotifications((current) => current.filter((item) => item.id !== id));

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

  if (route.page === 'reset-password') {
    return <ResetPassword token={route.token} onSubmit={(values) => api.resetPassword(values)} onDone={() => navigate('home')} />;
  }

  if (setupRequired) {
    return <OwnerSetup setupCodeRequired={setupCodeRequired} onSubmit={(values) => authenticate(api.setupOwner, values)} />;
  }

  if (!user) {
    return <SignIn onLogin={(values) => authenticate(api.login, values)} onRegister={(values) => authenticate(api.register, values)} onForgotPassword={(email) => api.forgotPassword(email)} />;
  }

  return (
    <>
      <div className={`app-shell app-shell--${route.page}`}>
        {route.page !== 'survey' && <AppHeader user={user} route={route} onLogout={logout} theme={theme} onToggleTheme={toggleTheme} isOnline={isOnline} unreadCount={unreadCount} onOpenInbox={() => { setShowInbox(true); setShowMissedPrompt(false); }} />}
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
        {notifications.length > 0 && (
          <div className="notification-stack" role="region" aria-label="Notifications">
            {notifications.map((notification) => (
              <div key={notification.id} className="notification-card">
                <span className="notification-card__icon" aria-hidden="true"><Bell size={16} /></span>
                <div className="notification-card__body">
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  {notification.surveyId && (
                    <button type="button" className="notification-card__view" onClick={() => { dismissNotification(notification.id); navigate(`surveys/${notification.surveyId}?site=${notification.siteId}`); }}>View survey</button>
                  )}
                </div>
                <button type="button" className="notification-card__dismiss" onClick={() => dismissNotification(notification.id)} aria-label="Dismiss notification"><XIcon size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {showMissedPrompt && unreadCount > 0 && (
          <div className="missed-prompt" role="status">
            <span className="missed-prompt__icon" aria-hidden="true"><Bell size={16} /></span>
            <span className="missed-prompt__text">You've missed {unreadCount} update{unreadCount === 1 ? '' : 's'} while you were away.</span>
            <button type="button" className="button button--primary missed-prompt__view" onClick={() => { setShowInbox(true); setShowMissedPrompt(false); }}>View</button>
            <button type="button" className="missed-prompt__dismiss" onClick={() => setShowMissedPrompt(false)} aria-label="Dismiss"><XIcon size={14} /></button>
          </div>
        )}
        <NotificationInboxModal open={showInbox} onClose={() => setShowInbox(false)} onCountChange={setUnreadCount} />
        <div className={`toast ${toast ? 'toast--visible' : ''}`} role="status" aria-live="polite">{toast}</div>
      </div>
    </>
  );
}
