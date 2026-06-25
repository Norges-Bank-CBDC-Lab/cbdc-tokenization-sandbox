import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// CentralBankPage renders the CB summary, allowlist, and action
// buttons. Each WNOK action button opens its modal. We stub
// CentralBankApi at the module boundary.

const FIXTURE_CB = {
  available: true,
  address: '0xcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcb',
  wnok: {
    contractAddress: '0xwnokwnokwnokwnokwnokwnokwnokwnokwnokwnok',
    balance: '10000000',
    totalSupply: '25000000',
    allowlistSize: 3,
  },
  govSettlementBank: { name: 'DNB', address: '0x3333333333333333333333333333333333333333' },
  md5: 'a',
};

const FIXTURE_ALLOWLIST = [
  { address: '0xcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcb' },
  { address: '0x1111111111111111111111111111111111111111' },
  { address: '0x2222222222222222222222222222222222222222' },
];

vi.mock('../src/api/centralBankApi.js', () => ({
  CentralBankApi: {
    getCentralBank: vi.fn().mockResolvedValue(FIXTURE_CB),
    listAllowlist: vi.fn().mockResolvedValue(FIXTURE_ALLOWLIST),
    addToAllowlist: vi.fn(),
    removeFromAllowlist: vi.fn(),
    mintWnok: vi.fn(),
    burnWnok: vi.fn(),
    transferWnok: vi.fn(),
  },
}));

vi.mock('../src/api/biddersApi.js', () => ({
  BiddersApi: {
    listBidders: vi
      .fn()
      .mockResolvedValue([
        { address: '0x1111111111111111111111111111111111111111', name: 'Nordea' },
      ]),
  },
}));

describe('CentralBankPage', () => {
  beforeEach(() => {
    window.location.hash = '#/central-bank';
  });

  it('renders the CB summary + sandbox banner + allowlist table', async () => {
    const { CentralBankPage } = await import('../src/pages/CentralBankPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <CentralBankPage />
      </ToastProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Central Bank' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Sandbox only/i);
    await waitFor(() => {
      expect(screen.getByText('WNOK balance')).toBeInTheDocument();
    });
    expect(screen.getByText('WNOK supply')).toBeInTheDocument();
    expect(screen.getByText('In circulation')).toBeInTheDocument();
    expect(screen.getByText('Government bank')).toBeInTheDocument();
    expect(screen.getByText('DNB')).toBeInTheDocument();
  });

  it('opens the Mint, Burn, and Transfer modals', async () => {
    const { CentralBankPage } = await import('../src/pages/CentralBankPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <CentralBankPage />
      </ToastProvider>,
    );

    const mintBtn = await screen.findByRole('button', { name: /^Mint$/ });
    await user.click(mintBtn);
    expect(await screen.findByRole('heading', { name: 'Mint WNOK' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    const burnBtn = screen.getByRole('button', { name: /^Burn$/ });
    await user.click(burnBtn);
    expect(await screen.findByRole('heading', { name: 'Burn WNOK' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    const transferBtn = screen.getByRole('button', { name: /^Transfer$/ });
    await user.click(transferBtn);
    expect(
      await screen.findByRole('heading', { name: 'Transfer WNOK from CB' }),
    ).toBeInTheDocument();
  });

  it('opens the allowlist add modal', async () => {
    const { CentralBankPage } = await import('../src/pages/CentralBankPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <CentralBankPage />
      </ToastProvider>,
    );

    const addBtn = await screen.findByRole('button', { name: /\+ Add address/i });
    await user.click(addBtn);
    expect(
      await screen.findByRole('heading', { name: 'Add to WNOK allowlist' }),
    ).toBeInTheDocument();
  });

  it('labels allowlist entries with bidder name and type', async () => {
    const { CentralBankPage } = await import('../src/pages/CentralBankPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <CentralBankPage />
      </ToastProvider>,
    );

    // Bidder match → roster name + "Bidder" type.
    expect(await screen.findByText('Nordea')).toBeInTheDocument();
    expect(screen.getByText('Bidder')).toBeInTheDocument();
    // The CB's own allowlisted address → "Central Bank" (also the page h1, so ≥ 2).
    expect(screen.getAllByText('Central Bank').length).toBeGreaterThanOrEqual(2);
  });
});
