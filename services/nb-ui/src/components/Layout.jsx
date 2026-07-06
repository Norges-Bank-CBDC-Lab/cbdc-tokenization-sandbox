/**
 * Layout — top bar, nav, footer.
 *
 * Renders the auth chrome (sign-in / user-badge) when AUTH_MODE !== 'none'
 * — see services/nb-ui/src/auth/.
 */
import { useEffect, useRef, useState } from 'react';
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

// Category model for the top nav. Each item's `match` lists the route names
// that should light the item (and its category) as active — detail routes
// collapse into their parent (bond->bonds, auction->auctions). A category with
// a `gate` is only rendered when that capability flag is true, mirroring the
// per-page guards in App.jsx.
const NAV_CATEGORIES = [
  {
    key: 'central-bank',
    label: 'Central Bank',
    gate: 'canAccessCentralBank',
    items: [
      { label: 'wNOK', href: '#/central-bank', match: ['central-bank'] },
      { label: 'Coupon payout', href: '#/coupon-payout', match: ['coupon-payout'] },
    ],
  },
  {
    key: 'securities',
    label: 'Securities',
    items: [
      { label: 'Bonds', href: '#/bonds', match: ['bonds', 'bond'] },
      { label: 'Stocks', href: '#/stocks', match: ['stocks'] },
      { label: 'Auctions', href: '#/auctions', match: ['auctions', 'auction'] },
      { label: 'Bidders', href: '#/bidders', match: ['bidders'] },
    ],
  },
  {
    key: 'banking',
    label: 'Banking',
    gate: 'canAccessBanking',
    items: [{ label: 'TBD', href: '#/tbd', match: ['tbd'] }],
  },
  {
    key: 'system',
    label: 'System',
    items: [
      { label: 'Global Registry', href: '#/registry', match: ['registry'] },
      { label: 'Operations', href: '#/operations', match: ['operations'] },
    ],
  },
];

/**
 * CategoryNav — top-bar nav grouped into dropdown categories. One menu is open
 * at a time; it closes on outside click, Escape, or after navigating. A gated
 * category is hidden when its capability flag is false, so a non-operator in
 * entra mode never sees Central Bank or Banking.
 */
function CategoryNav({ route, navigate, canAccessCentralBank = true, canAccessBanking = true }) {
  const gates = { canAccessCentralBank, canAccessBanking };
  const categories = NAV_CATEGORIES.filter((c) => !c.gate || gates[c.gate]);
  const [openKey, setOpenKey] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    if (!openKey) return undefined;
    const onDocClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenKey(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenKey(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKey]);

  const go = (href) => {
    setOpenKey(null);
    navigate(href);
  };

  return (
    <nav className="top-nav" ref={navRef}>
      {categories.map((cat) => {
        const active = cat.items.some((it) => it.match.includes(route.name));
        const open = openKey === cat.key;
        return (
          <div key={cat.key} className="nav-category">
            <button
              type="button"
              className={`nav-cat-trigger${active ? ' active' : ''}`}
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : cat.key)}
            >
              {cat.label}
              <span className="nav-cat-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {open && (
              <div className="nav-dropdown" role="menu">
                {cat.items.map((it) => (
                  <a
                    key={it.href}
                    href={it.href}
                    role="menuitem"
                    className={it.match.includes(route.name) ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      go(it.href);
                    }}
                  >
                    {it.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Layout({
  route,
  navigate,
  children,
  canAccessCentralBank = true,
  canAccessBanking = true,
}) {
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
          <CategoryNav
            route={route}
            navigate={navigate}
            canAccessCentralBank={canAccessCentralBank}
            canAccessBanking={canAccessBanking}
          />
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
        NB Bond Auction Service · OpenAPI 1.0.0 · {AppConfig.API_BASE_URL}
      </footer>
    </div>
  );
}
