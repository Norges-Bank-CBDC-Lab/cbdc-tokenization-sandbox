/**
 * UI primitives — small, composable components used across pages.
 * Style hooks live in styles.css.
 */
import React, { useEffect, useState, useCallback, useContext, createContext } from 'react';

export function Button({ variant = 'default', size, children, className = '', ...rest }) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'danger' && 'btn-danger',
    variant === 'ghost' && 'btn-ghost',
    size === 'sm' && 'btn-sm',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

/**
 * Renders a long hex string in full, wrappable + monospace, with a one-click
 * Copy button. Falls back to triple-click select when the clipboard API is
 * unavailable (e.g. a non-secure context).
 */
export function CopyableHex({ value }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can still triple-click to select */
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <code
        className="mono"
        style={{
          flex: 1,
          wordBreak: 'break-all',
          background: 'var(--surface-2, #f5f6fa)',
          padding: '4px 6px',
          borderRadius: 4,
          fontSize: 12,
          userSelect: 'all',
        }}
      >
        {value}
      </code>
      <Button size="sm" variant="ghost" onClick={onCopy} title="Copy to clipboard">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function StatusBadge({ status }) {
  if (!status) return <span className="muted">—</span>;
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function TypeBadge({ type }) {
  if (!type) return <span className="muted">—</span>;
  return <span className="badge badge-type no-dot">{type}</span>;
}

export function Modal({ title, onClose, children, footer, maxWidth = 560 }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}
    >
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function Input({ mono, ...props }) {
  return <input className={`input ${mono ? 'mono' : ''}`} {...props} />;
}

export function Select({ children, ...rest }) {
  return (
    <select className="select" {...rest}>
      {children}
    </select>
  );
}

/**
 * Single-select radio group with built-in support for non-selectable
 * options.
 *
 * Each option may carry:
 *   - `disabled?: boolean` — renders the option visibly but blocks
 *     selection. The native `disabled` attribute on the input also
 *     suppresses onChange, so callers don't need to re-guard.
 *   - `title?: string` — text shown as a browser tooltip on hover,
 *     primarily used to explain *why* a disabled option is unavailable
 *     (e.g. "RATE auctions are only valid when issuing a new bond").
 *     Set on both label and input so the tooltip appears wherever the
 *     user hovers within the chip.
 */
export function RadioGroup({ name, value, onChange, options }) {
  return (
    <div className="radio-group">
      {options.map((o) => (
        <React.Fragment key={o.value}>
          <input
            type="radio"
            id={`${name}-${o.value}`}
            name={name}
            checked={value === o.value}
            disabled={Boolean(o.disabled)}
            title={o.title}
            onChange={() => onChange(o.value)}
          />
          <label
            htmlFor={`${name}-${o.value}`}
            data-disabled={o.disabled ? 'true' : undefined}
            title={o.title}
          >
            {o.label}
          </label>
        </React.Fragment>
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state">
      <div className="spinner" />
      <div className="state-msg" style={{ marginTop: 8 }}>
        {label}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const msg = error?.message || 'Something went wrong.';
  return (
    <div className="state">
      <div className="state-icon">!</div>
      <div className="state-title">Request failed</div>
      <div className="state-msg">{msg}</div>
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <Button onClick={onRetry} size="sm">
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="state">
      <div className="state-icon">◇</div>
      <div className="state-title">{title}</div>
      {message && <div className="state-msg">{message}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    const toast = {
      id,
      kind: t.kind || 'ok',
      title: t.title,
      body: t.body,
      ttl: t.ttl || 4500,
    };
    setItems((xs) => [...xs, toast]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), toast.ttl);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.title && <div className="toast-title">{t.title}</div>}
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/**
 * SandboxOnlyBanner — visible warning that the surface stores plaintext
 * private keys and is not safe outside the local sandbox. Used at the
 * top of the Bidders and Central Bank pages.
 */
export function SandboxOnlyBanner({ children }) {
  return (
    <div
      role="alert"
      className="sandbox-banner"
      style={{
        background: '#fff7e6',
        border: '1px solid #f3c969',
        color: '#5a3a00',
        padding: '10px 14px',
        borderRadius: 6,
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong>Sandbox only.</strong>{' '}
      {children ||
        'Private keys are stored in plaintext in the local SQLite DB and the operator config. Never deploy this configuration against real funds.'}
    </div>
  );
}
