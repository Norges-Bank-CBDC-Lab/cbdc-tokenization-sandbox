/**
 * App — root component. Wires the router to pages, initialises auth, and
 * gates the whole UI behind the login page when an interactive auth mode
 * has no usable session.
 */
import { useEffect, useState } from 'react';
import { auth, authMode } from './auth/index.js';
import { capabilitiesForAccount } from './auth/capabilities.js';
import { useRoute } from './hooks/useRoute.js';
import { ToastProvider, EmptyState } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { LoginPage } from './components/LoginPage.jsx';
import { AccessDeniedPage } from './components/AccessDeniedPage.jsx';
import { BondsPage } from './pages/BondsPage.jsx';
import { BondDetailPage } from './pages/BondDetailPage.jsx';
import { AuctionsPage } from './pages/AuctionsPage.jsx';
import { AuctionDetailPage } from './pages/AuctionDetailPage.jsx';
import { BiddersPage } from './pages/BiddersPage.jsx';
import { CentralBankPage } from './pages/CentralBankPage.jsx';
import { CouponPayoutPage } from './pages/CouponPayoutPage.jsx';
import { BankingPage } from './pages/BankingPage.jsx';
import { GlobalRegistryPage } from './pages/GlobalRegistryPage.jsx';
import { OperationsPage } from './pages/OperationsPage.jsx';

/**
 * ComingSoon — placeholder for nav destinations that exist in the category
 * structure but aren't built yet (Stocks). Keeps dropdown links live
 * instead of dead-ending.
 */
function ComingSoon({ title }) {
  return (
    <div className="card">
      <EmptyState
        title={`${title} — coming soon`}
        message="This page is part of the planned navigation and isn't built yet."
      />
    </div>
  );
}

export function App() {
  const { route, navigate } = useRoute();

  // Auth gate state. authReady starts true outside entra mode so the gate is
  // inert there (noneAuth never has an account — gating on it would lock the
  // local sandbox out).
  const [authReady, setAuthReady] = useState(authMode !== 'entra');
  const [authState, setAuthState] = useState(() => ({
    account: auth.getAccount(),
    expired: auth.isSessionExpired(),
  }));

  // Run the auth plugin's one-shot init (handles redirect callbacks, restores
  // a cached account, etc.). Safe to call repeatedly per plugin contract
  // (StrictMode runs this effect twice in dev). The subscription keeps the
  // gate in sync with later auth-state changes (sign-out, session expiry).
  useEffect(() => {
    const unsubscribe = auth.subscribe(() =>
      setAuthState({ account: auth.getAccount(), expired: auth.isSessionExpired() }),
    );
    auth
      .init()
      .catch(() => {
        console.warn('Auth init failed; continuing without an account.');
      })
      .finally(() => setAuthReady(true));
    return unsubscribe;
  }, []);

  if (authMode === 'entra') {
    // Hold rendering until handleRedirectPromise has settled, so returning
    // from the Entra redirect shows a splash instead of a login-page flash.
    if (!authReady) {
      return (
        <div className="login-page">
          <p className="login-status">Signing you in…</p>
        </div>
      );
    }
    if (!authState.account || authState.expired) {
      return <LoginPage expired={authState.expired} />;
    }
    if (!capabilitiesForAccount(authState.account).canUseApp) {
      return <AccessDeniedPage account={authState.account} />;
    }
  }

  const caps = capabilitiesForAccount(authState.account);

  let page;
  if (route.name === 'bonds') page = <BondsPage navigate={navigate} />;
  else if (route.name === 'bond')
    page = <BondDetailPage key={route.isin} isin={route.isin} navigate={navigate} />;
  else if (route.name === 'auctions') page = <AuctionsPage navigate={navigate} />;
  else if (route.name === 'auction')
    page = (
      <AuctionDetailPage key={route.auctionId} auctionId={route.auctionId} navigate={navigate} />
    );
  else if (route.name === 'bidders') page = <BiddersPage navigate={navigate} />;
  else if (route.name === 'central-bank')
    page = caps.canAccessCentralBank ? (
      <CentralBankPage navigate={navigate} />
    ) : (
      <div className="card">
        <EmptyState
          title="Not authorised"
          message="The Central Bank surface is operator-only. Ask an operator if you need access."
        />
      </div>
    );
  else if (route.name === 'coupon-payout')
    page = caps.canAccessCentralBank ? (
      <CouponPayoutPage navigate={navigate} />
    ) : (
      <div className="card">
        <EmptyState
          title="Not authorised"
          message="The Central Bank surface is operator-only. Ask an operator if you need access."
        />
      </div>
    );
  else if (route.name === 'stocks') page = <ComingSoon title="Stocks" />;
  else if (route.name === 'registry') page = <GlobalRegistryPage />;
  else if (route.name === 'operations') page = <OperationsPage />;
  else if (route.name === 'tbd')
    page = caps.canAccessBanking ? (
      <BankingPage navigate={navigate} />
    ) : (
      <div className="card">
        <EmptyState
          title="Not authorised"
          message="The Banking surface is operator-only. Ask an operator if you need access."
        />
      </div>
    );
  else page = <BondsPage navigate={navigate} />;

  return (
    <ToastProvider>
      <Layout
        route={route}
        navigate={navigate}
        canAccessCentralBank={caps.canAccessCentralBank}
        canAccessBanking={caps.canAccessBanking}
      >
        {page}
      </Layout>
    </ToastProvider>
  );
}
