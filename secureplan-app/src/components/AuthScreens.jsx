import React, { useState } from 'react';
import { Brand, Field } from './Common.jsx';

function AuthLayout({ eyebrow, title, copy, children }) {
  return (
    <main id="main-content" className="auth-page">
      <section className="auth-visual" aria-label="SecurePlan Surveyor overview">
        <Brand />
        <div className="auth-visual__content">
          <p className="eyebrow">Field-ready security surveys</p>
          <h1>Turn floor plans into coordinated security system surveys.</h1>
          <p>Plot devices, attach field conditions, and work from one live plan on desktop, tablet, or phone.</p>
          <ul className="feature-list">
            <li><span aria-hidden="true">✓</span> Collaborative blueprint markup</li>
            <li><span aria-hidden="true">✓</span> Access control, CCTV, intrusion, and doors</li>
            <li><span aria-hidden="true">✓</span> Cloud photos, notes, schedules, and history</li>
          </ul>
        </div>
        <p className="auth-visual__footer">Secure by design · Built for survey teams</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__mobile-brand"><Brand /></div>
        <div className="auth-card">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="auth-card__copy">{copy}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

function ErrorNotice({ message }) {
  if (!message) return null;
  return <div className="notice notice--error" role="alert">{message}</div>;
}

export function OwnerSetup({ onSubmit, setupCodeRequired = false }) {
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmation: '', setupCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (values.password !== values.confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ name: values.name, email: values.email, password: values.password, ...(setupCodeRequired ? { setupCode: values.setupCode } : {}) });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="First-time setup"
      title="Create the owner account"
      copy="This account controls your organization, team invitations, and all survey sites."
    >
      <form className="stack-form" onSubmit={submit}>
        <ErrorNotice message={error} />
        {setupCodeRequired && (
          <Field label="Owner setup code" hint="Find this one-time code in your deployment environment settings.">
            <input required autoComplete="one-time-code" value={values.setupCode} onChange={(e) => setValues({ ...values, setupCode: e.target.value })} />
          </Field>
        )}
        <Field label="Full name"><input required autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></Field>
        <Field label="Work email"><input required type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></Field>
        <Field label="Password" hint="Use at least 10 characters with a letter and number.">
          <input required minLength="10" type="password" autoComplete="new-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        </Field>
        <Field label="Confirm password"><input required minLength="10" type="password" autoComplete="new-password" value={values.confirmation} onChange={(e) => setValues({ ...values, confirmation: e.target.value })} /></Field>
        <button className="button button--primary button--wide" disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace'}</button>
      </form>
    </AuthLayout>
  );
}

export function SignIn({ initialMode = 'login', onLogin, onRegister }) {
  const [mode, setMode] = useState(initialMode);
  const [values, setValues] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const changeMode = (next) => {
    setMode(next);
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? { email: values.email, password: values.password }
        : { name: values.name, email: values.email, password: values.password, inviteCode: values.inviteCode.trim() };
      await (mode === 'login' ? onLogin(payload) : onRegister(payload));
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow={mode === 'login' ? 'Welcome back' : 'Join your survey team'}
      title={mode === 'login' ? 'Sign in to SecurePlan' : 'Create your account'}
      copy={mode === 'login' ? 'Continue to your sites and active surveys.' : 'Use the invitation code provided by your workspace owner.'}
    >
      <div className="segmented" role="group" aria-label="Account access">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => changeMode('login')}>Sign in</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => changeMode('register')}>Use invite code</button>
      </div>
      <form className="stack-form" onSubmit={submit}>
        <ErrorNotice message={error} />
        {mode === 'register' && (
          <>
            <Field label="Invitation code" hint="Codes are not case-sensitive.">
              <input required autoCapitalize="characters" autoComplete="one-time-code" placeholder="ABCD-EFGH-IJKL" value={values.inviteCode} onChange={(e) => setValues({ ...values, inviteCode: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Full name"><input required autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></Field>
          </>
        )}
        <Field label="Email"><input required type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 10 characters with a letter and number.' : undefined}>
          <input required minLength={mode === 'register' ? 10 : undefined} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        </Field>
        <button className="button button--primary button--wide" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Join workspace'}
        </button>
      </form>
      <p className="auth-help">Need an invitation? Ask the workspace owner or administrator to create one from the Team page.</p>
    </AuthLayout>
  );
}
