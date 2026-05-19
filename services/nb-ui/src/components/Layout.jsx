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
import { NorgesBankLogo } from './NorgesBankLogo.jsx';
import { Button } from './ui.jsx';

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
          </nav>
          <div className="top-bar-right">
            <AuthChrome />
            <span className={`env-pill ${isMock ? 'mock' : ''}`}>
              {isMock ? 'MOCK API' : 'LIVE'}
            </span>
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
