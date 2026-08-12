import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../src/components/ui.jsx';

// The page reads the banking API; mock it so the test exercises the
// overview + detail rendering without a backend.
vi.mock('../src/api/bankingApi.js', () => ({
  BankingApi: {
    listTbd: vi.fn(),
    listBanks: vi.fn(),
    createBank: vi.fn(),
    addToAllowlist: vi.fn(),
    removeFromAllowlist: vi.fn(),
    mint: vi.fn(),
    burn: vi.fn(),
    transfer: vi.fn(),
  },
}));

import { BankingApi } from '../src/api/bankingApi.js';
import { BankingPage } from '../src/pages/BankingPage.jsx';

const nordea = {
  address: `0x${'1'.repeat(40)}`,
  name: 'TBD Nordea',
  symbol: 'TBDnordea',
  decimals: 0,
  totalSupply: '10000',
  bank: { name: 'Nordea Bank', address: `0x${'a'.repeat(40)}` },
  reserve: { wnokBalance: '1100000', backed: true, bankAllowlisted: true },
  government: { nominated: true, reserveAddress: `0x${'b'.repeat(40)}` },
  holders: [{ address: `0x${'c'.repeat(40)}`, balance: '10000' }],
  md5: 'x',
};
const dnb = {
  ...nordea,
  address: `0x${'2'.repeat(40)}`,
  name: 'TBD DNB',
  symbol: 'TBDdnb',
  bank: { name: 'DNB Bank', address: `0x${'d'.repeat(40)}` },
  reserve: { wnokBalance: '1200000', backed: true, bankAllowlisted: true },
  government: { nominated: false, reserveAddress: null },
};

function renderPage() {
  return render(
    <ToastProvider>
      <BankingPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  BankingApi.listTbd.mockResolvedValue([nordea, dnb]);
  BankingApi.listBanks.mockResolvedValue([
    { name: 'Nordea Bank', address: nordea.bank.address, actAsAvailable: true, md5: 'x' },
    { name: 'DNB Bank', address: dnb.bank.address, actAsAvailable: true, md5: 'x' },
  ]);
});

describe('BankingPage', () => {
  it('shows the overview of all TBDs and a detail panel with actions', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Banking' })).toBeInTheDocument();
    // Both banks appear (overview rows + selector options).
    expect(screen.getAllByText('Nordea Bank').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DNB Bank').length).toBeGreaterThan(0);
    // The detail panel for the default selection exposes the write actions.
    expect(screen.getByRole('button', { name: 'Mint' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Burn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    // The WNOK-settlement indicator reflects the bank's WNOK allowlist status.
    expect(screen.getByText('Allowlisted')).toBeInTheDocument();
  });

  it('disables act-as mutations and labels the option when the API holds no signing key', async () => {
    // The deployed-environment scenario: the on-chain bank exists but was
    // not created with a key this API knows — reads stay available,
    // mutations are gated off.
    BankingApi.listBanks.mockResolvedValue([
      { name: 'Nordea Bank', address: nordea.bank.address, actAsAvailable: false, md5: 'x' },
      { name: 'DNB Bank', address: dnb.bank.address, actAsAvailable: true, md5: 'x' },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Banking' });
    // Default selection is Nordea (first token): all four act-as actions gated.
    expect(screen.getByRole('button', { name: 'Mint' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Burn' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Add to allowlist' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByText(/holds no signing key for Nordea Bank/)).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Nordea Bank — no signing key' }),
    ).toBeInTheDocument();

    // Switching to a bank whose key the API holds re-enables the actions.
    await user.selectOptions(screen.getByRole('combobox'), dnb.bank.address.toLowerCase());
    expect(screen.getByRole('button', { name: 'Mint' })).toBeEnabled();
  });

  it('drives the selector from the token listing even when /banks disagrees', async () => {
    // Regression for the deployed dropdown bug: /banks used to publish
    // key-derived addresses that matched no on-chain bank, leaving the
    // selector unable to follow the table. The selector must offer exactly
    // the banks the token listing renders.
    BankingApi.listBanks.mockResolvedValue([
      { name: 'Ghost Bank', address: `0x${'f'.repeat(40)}`, actAsAvailable: true, md5: 'x' },
    ]);
    renderPage();

    await screen.findByRole('heading', { name: 'Banking' });
    const select = screen.getByRole('combobox');
    const optionNames = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionNames).toEqual(['Nordea Bank', 'DNB Bank']);
    // Unknown capability (no /banks row for these addresses) stays actionable.
    expect(screen.getByRole('button', { name: 'Mint' })).toBeEnabled();
  });

  it('renders an empty state when no TBDs are registered', async () => {
    BankingApi.listTbd.mockResolvedValue([]);
    BankingApi.listBanks.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No TBD tokens found')).toBeInTheDocument();
  });

  describe('Add bank', () => {
    it('opens the AddBank modal with name, keypair radio, and a default-checked WNOK checkbox', async () => {
      const user = userEvent.setup();
      renderPage();

      const addBtn = await screen.findByRole('button', { name: /\+ Add bank/i });
      await user.click(addBtn);

      expect(await screen.findByRole('heading', { name: 'Add bank' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Sparebanken Norge')).toBeInTheDocument();
      expect(screen.getByLabelText(/Generate new keypair/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Import existing private key/i)).toBeInTheDocument();
      // WNOK settlement is opt-out: the checkbox is present and checked.
      const checkbox = screen.getByRole('checkbox', { name: /Enable WNOK settlement/i });
      expect(checkbox).toBeChecked();
    });

    it('creates a bank and reloads the banks + tokens queries', async () => {
      BankingApi.createBank.mockResolvedValue({
        name: 'Testbanken',
        address: `0x${'e'.repeat(40)}`,
        md5: 'x',
      });
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: /\+ Add bank/i }));
      await user.type(screen.getByPlaceholderText('Sparebanken Norge'), 'Testbanken');

      const banksCallsBefore = BankingApi.listBanks.mock.calls.length;
      const tbdCallsBefore = BankingApi.listTbd.mock.calls.length;

      await user.click(screen.getByRole('button', { name: 'Add bank' }));

      expect(BankingApi.createBank).toHaveBeenCalledWith({
        name: 'Testbanken',
        privateKey: undefined,
        enableWnokSettlement: true,
      });
      // Success toast + both queries reloaded so the new bank appears in
      // the dropdown and its TBD in the listing.
      expect(await screen.findByText('Bank added')).toBeInTheDocument();
      await waitFor(() => {
        expect(BankingApi.listBanks.mock.calls.length).toBeGreaterThan(banksCallsBefore);
        expect(BankingApi.listTbd.mock.calls.length).toBeGreaterThan(tbdCallsBefore);
      });
    });
  });
});
