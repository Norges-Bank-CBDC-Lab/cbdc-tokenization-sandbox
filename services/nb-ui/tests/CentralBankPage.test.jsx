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
    allowlistSize: 3,
  },
  md5: 'a',
};

const FIXTURE_ALLOWLIST = [
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
    expect(screen.getByText('Allowlist size')).toBeInTheDocument();
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

    const transferBtn = screen.getByRole('button', { name: /Transfer from CB/i });
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
});
