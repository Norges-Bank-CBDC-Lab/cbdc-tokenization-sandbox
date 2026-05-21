/**
 * App — root component. Wires the router to pages and initialises auth.
 */
import { useEffect } from 'react';
import { auth } from './auth/index.js';
import { useRoute } from './hooks/useRoute.js';
import { ToastProvider } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { BondsPage } from './pages/BondsPage.jsx';
import { BondDetailPage } from './pages/BondDetailPage.jsx';
import { AuctionsPage } from './pages/AuctionsPage.jsx';
import { AuctionDetailPage } from './pages/AuctionDetailPage.jsx';
import { BiddersPage } from './pages/BiddersPage.jsx';
import { CentralBankPage } from './pages/CentralBankPage.jsx';

export function App() {
  const { route, navigate } = useRoute();

  // Run the auth plugin's one-shot init (handles redirect callbacks, restores
  // a cached account, etc.). Safe to call repeatedly per plugin contract.
  useEffect(() => {
    auth.init().catch(() => {
      console.warn('Auth init failed; continuing without an account.');
    });
  }, []);

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
  else if (route.name === 'central-bank') page = <CentralBankPage navigate={navigate} />;
  else page = <BondsPage navigate={navigate} />;

  return (
    <ToastProvider>
      <Layout route={route} navigate={navigate}>
        {page}
      </Layout>
    </ToastProvider>
  );
}
