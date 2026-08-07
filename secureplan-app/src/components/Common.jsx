import React, { useEffect, useId, useRef } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

export function Brand({ compact = false }) {
  return (
    <span className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="SecurePlan Surveyor">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M16 2.8 27 6.9v7.6c0 6.7-4.2 11.4-11 13.8C9.2 25.9 5 21.2 5 14.5V6.9L16 2.8Z" />
          <path d="M10.8 13.2h10.4M12.5 18.1h7M14.2 22.8h3.6" />
        </svg>
      </span>
      <span className="brand__words">
        <strong>SecurePlan</strong>
        {!compact && <small>Surveyor</small>}
      </span>
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({ icon = '◇', title, children, action }) {
  return (
    <section className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
      {action}
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  const hintId = useId();
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(children, {
          'aria-describedby': hint || error ? hintId : children.props['aria-describedby'],
          'aria-invalid': error ? 'true' : undefined,
        })
        : children}
      {(hint || error) && (
        <small id={hintId} className={error ? 'field__error' : 'field__hint'}>
          {error || hint}
        </small>
      )}
    </label>
  );
}

export function Modal({ open, title, description, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const cancel = (event) => {
      event.preventDefault();
      onClose();
    };
    const click = (event) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('click', click);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('click', click);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${wide ? 'modal--wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div className="modal__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="modal__body">{children}</div>
    </dialog>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', busy, onConfirm, onClose }) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="confirm-copy">{children}</div>
      <div className="modal__actions">
        <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="button button--danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Menu({ label = 'More actions', children }) {
  return (
    <details className="menu">
      <summary className="icon-button" aria-label={label} title={label}>
        <MoreHorizontal aria-hidden="true" size={18} />
      </summary>
      <div className="menu__popover">{children}</div>
    </details>
  );
}

export function MenuButton({ children, danger = false, ...props }) {
  return (
    <button type="button" className={danger ? 'danger-text' : ''} {...props}>
      {children}
    </button>
  );
}

export function initials(name = '?') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

export function formatWhen(value) {
  if (!value) return 'No edits yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const delta = Date.now() - date.getTime();
  if (delta >= 0 && delta < 60_000) return 'just now';
  if (delta >= 0 && delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta >= 0 && delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(date);
}

export function roleCanEdit(role) {
  return ['owner', 'admin', 'manager', 'editor'].includes(role);
}

export function roleCanAnnotate(role) {
  return ['owner', 'admin', 'manager', 'editor', 'installer'].includes(role);
}

export function roleCanManage(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}
