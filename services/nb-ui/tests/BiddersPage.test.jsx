import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// BiddersPage lists the bidder roster, renders the sandbox banner,
// and opens the AddBidder + PlaceBid modals. We stub BiddersApi and
// BondsApi at their module boundaries with deterministic fixtures.

const FIXTURE_BIDDERS = [
  {
    address: '0x1111111111111111111111111111111111111111',
    name: 'Nordea',
    publicKey: '0xabcd',
    privateKey: '0xdead',
    wnokBalance: '1000000',
    md5: 'a',
  },
  {
    address: '0x2222222222222222222222222222222222222222',
    name: 'DNB',
    publicKey: '0xbeef',
    privateKey: '0xface',
    wnokBalance: '500000',
    md5: 'b',
  },
  {
    address: '0x3333333333333333333333333333333333333333',
    name: 'Alice.tbd',
    publicKey: '0xcafe',
    privateKey: '0xbabe',
    wnokBalance: '250000',
    md5: 'c',
  },
];

const FIXTURE_BONDS = [
  {
    isin: 'NO0012345678',
    status: 'auctioning',
    totalSupply: '5000000000',
    contracts: { token: '0xaaaa', auction: '0xbbbb' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '126144000' },
    coupon: {
      duration: '31536000',
      rateBps: '425',
      payments: { total: '5', made: '1', remaining: '4' },
    },
    holders: [],
    auctions: [
      {
        id: '0xauction1',
        isin: 'NO0012345678',
        type: 'PRICE',
        status: 'open',
        end: String(Math.floor(Date.now() / 1000) + 86400),
        size: '1000000',
        owner: '0x0',
        sealingPubKey: '0x0',
        contracts: { auction: '0xb', token: '0xa' },
        bids: [],
        allocation: null,
        md5: 'x',
      },
    ],
    md5: 'abc',
  },
];

vi.mock('../src/api/biddersApi.js', () => ({
  BiddersApi: {
    listBidders: vi.fn().mockResolvedValue(FIXTURE_BIDDERS),
    createBidder: vi.fn(),
    deleteBidder: vi.fn(),
    placeBid: vi.fn(),
  },
}));

vi.mock('../src/api/bondsApi.js', () => ({
  BondsApi: {
    listBonds: vi.fn().mockResolvedValue(FIXTURE_BONDS),
    getBond: vi.fn(),
    listBondHistory: vi.fn(),
    payCoupon: vi.fn(),
    redeem: vi.fn(),
  },
}));

describe('BiddersPage', () => {
  beforeEach(() => {
    window.location.hash = '#/bidders';
  });

  it('renders the bidder roster + sandbox banner', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Bidders' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Sandbox only/i);

    await waitFor(() => {
      expect(screen.getByText('Nordea')).toBeInTheDocument();
    });
    expect(screen.getByText('DNB')).toBeInTheDocument();
    expect(screen.getByText('Alice.tbd')).toBeInTheDocument();
  });

  it('opens the AddBidder modal with generate-vs-import radio', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    const addBtn = await screen.findByRole('button', { name: /\+ Add bidder/i });
    await user.click(addBtn);

    expect(await screen.findByRole('heading', { name: 'Add bidder' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Generate new keypair/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Import existing private key/i)).toBeInTheDocument();
  });

  it('opens the PlaceBid modal when "Place bid" is clicked on a row', async () => {
    const { BiddersPage } = await import('../src/pages/BiddersPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BiddersPage />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('Nordea'));
    const nordeaRow = screen.getByText('Nordea').closest('tr');
    const placeBid = within(nordeaRow).getByRole('button', { name: /Place bid/i });
    await user.click(placeBid);

    expect(await screen.findByRole('heading', { name: /Place bid as Nordea/ })).toBeInTheDocument();
  });
});
