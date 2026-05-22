/**
 * Layout — top bar, nav, footer.
 *
 * Renders an environment pill (MOCK vs LIVE) so you can never deploy thinking
 * you're live when you're not. Also renders the auth chrome (sign-in /
 * user-badge) when AUTH_MODE !== 'none' — see services/nb-ui/src/auth/.
 */
import { useEffect, useState } from 'react';
import { AppConfig } from '../config.js';
import { auth, authMode } from '../auth/index.js';
import { getTestMode, setTestMode, subscribeTestMode } from '../utils/debugSettings.js';
import { HttpClient } from '../api/httpClient.js';
import { HealthBadge } from './HealthBadge.jsx';
import { NorgesBankLogo } from './NorgesBankLogo.jsx';
import { Button } from './ui.jsx';

/**
 * TestModeToggle — top-bar sandbox-only umbrella switch.
 *
 * When ON, the API gets `?testMode=true` on bond/auction reads
 * (unsealing sealed bids on still-open auctions) and on close /
 * finalise mutations (skipping the end-time pre-check so the operator
 * can attempt close before the bidding window expires). Future test
 * affordances will hang off the same flag.
 *
 * State lives in localStorage via `utils/debugSettings.js`. We clear
 * the HttpClient ETag cache on every flip so the next read isn't a
 * 304 against the previous (sealed) body.
 */
function TestModeToggle() {
  const [on, setOn] = useState(() => getTestMode());
  useEffect(() => subscribeTestMode(setOn), []);

  function toggle() {
    const next = !on;
    setTestMode(next);
    HttpClient.clearCache();
    // Clearing the cache alone isn't enough — every active useApi() hook
    // already holds the previous fetch in component state. A full reload
    // re-reads testMode from localStorage on boot and re-fetches every
    // page cleanly. The hash route is preserved across reload, so the
    // operator stays on the page they flipped from.
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={
        on
          ? 'Test mode is ON. Sealed bids on still-open auctions are revealed; close ignores ' +
            'the end-time pre-check (the chain contract still enforces it). Click to disable.'
          : 'Sandbox-only test mode. Reveals sealed bids on open auctions and lets close attempt ' +
            'before the end timestamp. Click to enable.'
      }
      className={`env-pill ${on ? 'test-on' : 'test-off'}`}
      style={{
        background: on ? '#fff7e6' : 'transparent',
        border: `1px solid ${on ? '#f3c969' : '#d0d4dc'}`,
        color: on ? '#5a3a00' : '#6b7280',
        cursor: 'pointer',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      Test: {on ? 'ON' : 'OFF'}
    </button>
  );
}

function AuthChrome() {
  const [account, setAccount] = useState(() => auth.getAccount());
  const [busy, setBusy] = useState(false);

  useEffect(() => auth.subscribe(() => setAccount(auth.getAccount())), []);

  if (authMode === 'none') return null;

  async function onLogin() {
    setBusy(true);
    try {
      await auth.login();
    } finally {
      setBusy(false);
    }
  }
  async function onLogout() {
    setBusy(true);
    try {
      await auth.logout();
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <Button size="sm" variant="primary" onClick={onLogin} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    );
  }
  return (
    <>
      <span className="user-badge" title={account.username}>
        {account.name || account.username}
      </span>
      <Button size="sm" variant="ghost" onClick={onLogout} disabled={busy}>
        Sign out
      </Button>
    </>
  );
}

export function Layout({ route, navigate, children }) {
  const isMock = AppConfig.USE_MOCK;
  const navItem = (key, label, href) => (
    <a
      href={href}
      className={
        route.name === key ||
        (key === 'bonds' && route.name === 'bond') ||
        (key === 'auctions' && route.name === 'auction')
          ? 'active'
          : ''
      }
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
    >
      {label}
    </a>
  );

  // Route-name-to-nav-key collapses detail pages into their parent tab so
  // the active style stays sticky as the operator drills in.

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-inner">
          <a
            href="#/bonds"
            onClick={(e) => {
              e.preventDefault();
              navigate('/bonds');
            }}
            className="brand"
            style={{ textDecoration: 'none' }}
          >
            <NorgesBankLogo height={26} />
            <div className="brand-sub">Bond Auction Service</div>
          </a>
          <nav className="top-nav">
            {navItem('bonds', 'Bonds', '#/bonds')}
            {navItem('auctions', 'Auctions', '#/auctions')}
            {navItem('bidders', 'Bidders', '#/bidders')}
            {navItem('central-bank', 'Central Bank', '#/central-bank')}
          </nav>
          <div className="top-bar-right">
            <AuthChrome />
            <TestModeToggle />
            <HealthBadge />
            <span>v1.0.0</span>
          </div>
        </div>
      </header>
      <main className="content">{children}</main>
      <footer className="app-footer">
        NB Bond Auction Service · OpenAPI 1.0.0 ·{' '}
        {isMock ? 'in-memory mock active' : AppConfig.API_BASE_URL}
      </footer>
    </div>
  );
}
