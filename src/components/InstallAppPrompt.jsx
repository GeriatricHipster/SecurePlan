import React, { useEffect, useState } from 'react';
import { Modal } from './Common.jsx';
import './install-app.css';

const DISMISS_KEY = 'secureplan-install-dismissed-at';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
let pendingInstallEvent = null;
const installEventSubscribers = new Set();

// Capture the browser event as soon as this module loads, including while the
// authentication bootstrap screen is still visible.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pendingInstallEvent = event;
    installEventSubscribers.forEach((subscriber) => subscriber(event));
  });
  window.addEventListener('appinstalled', () => {
    pendingInstallEvent = null;
    installEventSubscribers.forEach((subscriber) => subscriber(null));
  });
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
    || window.Capacitor?.isNativePlatform?.() === true;
}

function isIosBrowser() {
  const platform = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(platform)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function recentlyDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(pendingInstallEvent);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [visible, setVisible] = useState(false);
  const ios = isIosBrowser();

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return undefined;

    const onInstallReady = (event) => {
      setInstallEvent(event);
      setVisible(Boolean(event));
    };

    installEventSubscribers.add(onInstallReady);
    if (pendingInstallEvent) onInstallReady(pendingInstallEvent);

    // iOS does not emit beforeinstallprompt, so offer its native Share-sheet steps.
    if (ios) setVisible(true);

    return () => {
      installEventSubscribers.delete(onInstallReady);
    };
  }, [ios]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private browsing and managed devices may make storage unavailable.
    }
    setVisible(false);
    setShowIosHelp(false);
  };

  const install = async () => {
    if (!installEvent) {
      setShowIosHelp(true);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      setVisible(false);
      try {
        window.localStorage.removeItem(DISMISS_KEY);
      } catch {
        // Installation still succeeded when storage is unavailable.
      }
    }
    pendingInstallEvent = null;
    setInstallEvent(null);
  };

  if (!visible || isStandalone()) return null;

  return (
    <>
      <aside className="install-prompt" aria-label="Install SecurePlan Surveyor">
        <img src="/app-icon.svg" alt="" aria-hidden="true" />
        <div>
          <strong>Install SecurePlan</strong>
          <span>Open surveys faster from your home screen.</span>
        </div>
        <button type="button" className="button button--primary" onClick={install}>
          {installEvent ? 'Install' : 'How to install'}
        </button>
        <button type="button" className="icon-button" onClick={dismiss} aria-label="Dismiss install suggestion">×</button>
      </aside>

      <Modal open={showIosHelp} title="Add SecurePlan to your Home Screen" onClose={() => setShowIosHelp(false)}>
        <ol className="install-steps">
          <li><span aria-hidden="true">1</span><p>Open SecurePlan in your browser.</p></li>
          <li><span aria-hidden="true">2</span><p>Tap the <strong>Share</strong> button in the browser toolbar or menu.</p></li>
          <li><span aria-hidden="true">3</span><p>Choose <strong>Add to Home Screen</strong>. If offered, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</p></li>
        </ol>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={dismiss}>Don’t remind me</button>
          <button type="button" className="button button--primary" onClick={() => setShowIosHelp(false)}>Got it</button>
        </div>
      </Modal>
    </>
  );
}
