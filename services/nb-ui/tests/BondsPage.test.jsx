import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// BondsPage loads bonds via BondsApi, renders the index, supports the
// ISIN filter, and opens the create-bond modal. We stub BondsApi at
// the module boundary so the page sees a fixed roster without a real
// backend.

const FIXTURE_BONDS = [
  {
    isin: 'NO0012345678',
    status: 'maturing',
    totalSupply: '5000000000',
    contracts: { token: '0xaaaa', auction: '0xbbbb' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '126144000' },
    coupon: {
      duration: '31536000',
      rateBps: '425',
      payments: { total: '5', made: '1', remaining: '4' },
    },
    holders: [],
    auctions: [],
    md5: 'abc',
  },
  {
    isin: 'NO0098765432',
    status: 'minting',
    totalSupply: '2500000000',
    contracts: { token: '0xcccc', auction: '0xdddd' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '126144000' },
    coupon: {
      duration: '31536000',
      rateBps: '385',
      payments: { total: '10', made: '0', remaining: '10' },
    },
    holders: [],
    auctions: [],
    md5: 'def',
  },
  {
    isin: 'NO0011223344',
    status: 'matured',
    totalSupply: '1000000000',
    contracts: { token: '0xeeee', auction: '0xffff' },
    maturity: { duration: '157680000', date: '1893456000', remaining: '0' },
    coupon: {
      duration: '31536000',
      rateBps: '275',
      payments: { total: '3', made: '3', remaining: '0' },
    },
    holders: [],
    auctions: [],
    md5: 'ghi',
  },
];

vi.mock('../src/api/bondsApi.js', () => ({
  BondsApi: {
    listBonds: vi.fn().mockResolvedValue(FIXTURE_BONDS),
    getBond: vi.fn(),
    listBondHistory: vi.fn(),
    payCoupon: vi.fn(),
    redeem: vi.fn(),
  },
}));

describe('BondsPage', () => {
  beforeEach(() => {
    window.location.hash = '#/bonds';
  });

  it('renders the bond list from the API', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    expect(screen.getByText('Bonds')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('NO0012345678')).toBeInTheDocument();
    });
    expect(screen.getByText('NO0098765432')).toBeInTheDocument();
    expect(screen.getByText('NO0011223344')).toBeInTheDocument();
  });

  it('filters bonds by ISIN substring', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => screen.getByText('NO0012345678'));

    const filter = screen.getByPlaceholderText(/Filter by ISIN/i);
    await user.type(filter, '9876');

    await waitFor(() => {
      expect(screen.queryByText('NO0012345678')).not.toBeInTheDocument();
    });
    expect(screen.getByText('NO0098765432')).toBeInTheDocument();
  });

  it('opens the create-bond modal when the action button is clicked', async () => {
    const { BondsPage } = await import('../src/pages/BondsPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondsPage navigate={() => {}} />
      </ToastProvider>,
    );

    const newBondButtons = await screen.findAllByRole('button', { name: /\+ New bond/i });
    await user.click(newBondButtons[0]);

    expect(await screen.findByText('Issue new bond')).toBeInTheDocument();
  });
});
