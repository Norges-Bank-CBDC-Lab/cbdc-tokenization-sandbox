import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// BondDetailPage gates the "Disable bond" button on supply==0 + no
// blocking auction + not already disabled. The destructive confirmation
// requires the operator to type the ISIN. We stub BondsApi at the module
// boundary with three fixtures covering the gate's combinations.

function makeBond(overrides = {}) {
  return {
    isin: 'NO-TEST-001',
    status: 'unknown',
    disabled: false,
    totalSupply: '0',
    contracts: { token: '0xaaaa', auction: '0xbbbb', manager: '0xcccc' },
    maturity: { duration: '157680000', date: null, remaining: null },
    coupon: null,
    holders: [],
    auctions: [],
    md5: 'a',
    ...overrides,
  };
}

const BOND_DISABLE_ABLE = makeBond({ isin: 'NO-DISABLE-OK' });
const BOND_HAS_SUPPLY = makeBond({ isin: 'NO-MINTED', totalSupply: '500000' });
const BOND_IN_FLIGHT = makeBond({
  isin: 'NO-OPEN-AUCTION',
  auctions: [
    {
      id: '0xauc1',
      isin: 'NO-OPEN-AUCTION',
      type: 'RATE',
      status: 'open',
      end: '1893456000',
      size: '1000000',
      owner: '0x0',
      sealingPubKey: '0x0',
      contracts: { auction: '0xbbbb', token: '0xaaaa' },
      bids: [],
      allocation: null,
      md5: 'x',
    },
  ],
});
const BOND_ALREADY_DISABLED = makeBond({ isin: 'NO-DISABLED', disabled: true });

const getBondMock = vi.fn();
const disableBondMock = vi.fn();

vi.mock('../src/api/bondsApi.js', () => ({
  BondsApi: {
    listBonds: vi.fn(),
    getBond: getBondMock,
    createBond: vi.fn(),
    disableBond: disableBondMock,
    listBondHistory: vi.fn(),
    payCoupon: vi.fn(),
    redeem: vi.fn(),
  },
}));

describe('BondDetailPage disable affordance', () => {
  beforeEach(() => {
    window.location.hash = '#/bonds';
    try {
      window.localStorage.removeItem('nb-ui:bonds:showDisabled');
    } catch {
      /* ignore — best effort */
    }
    getBondMock.mockReset();
    disableBondMock.mockReset();
  });

  it('renders the "Disable bond" button when the gate is satisfied', async () => {
    getBondMock.mockResolvedValue(BOND_DISABLE_ABLE);
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_DISABLE_ABLE.isin} navigate={() => {}} />
      </ToastProvider>,
    );

    expect(await screen.findByRole('button', { name: /Disable bond/i })).toBeInTheDocument();
  });

  it('hides the button when the bond has minted supply', async () => {
    getBondMock.mockResolvedValue(BOND_HAS_SUPPLY);
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_HAS_SUPPLY.isin} navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getBondMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Disable bond/i })).toBeNull();
  });

  it('hides the button when the bond has an in-flight auction', async () => {
    getBondMock.mockResolvedValue(BOND_IN_FLIGHT);
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_IN_FLIGHT.isin} navigate={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getBondMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Disable bond/i })).toBeNull();
  });

  it('shows DISABLED pill (and no Disable button) when the bond is already disabled', async () => {
    getBondMock.mockResolvedValue(BOND_ALREADY_DISABLED);
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_ALREADY_DISABLED.isin} navigate={() => {}} />
      </ToastProvider>,
    );

    expect(await screen.findByText('DISABLED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disable bond/i })).toBeNull();
    // Also hides the "+ New auction" affordance — disabled bonds aren't
    // candidates for new auctions.
    expect(screen.queryByRole('button', { name: /\+ New auction/i })).toBeNull();
  });

  it('confirmation modal requires typing the ISIN', async () => {
    getBondMock.mockResolvedValue(BOND_DISABLE_ABLE);
    disableBondMock.mockResolvedValue(undefined);
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_DISABLE_ABLE.isin} navigate={() => {}} />
      </ToastProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Disable bond/i }));

    expect(
      await screen.findByRole('heading', { name: `Disable bond ${BOND_DISABLE_ABLE.isin}` }),
    ).toBeInTheDocument();

    // Submit button is disabled until ISIN is typed.
    const submit = screen.getAllByRole('button', { name: /Disable bond/i }).pop();
    expect(submit).toBeDisabled();

    const input = screen.getByLabelText(/disable-bond-confirm-isin/i);
    await user.type(input, BOND_DISABLE_ABLE.isin);

    expect(submit).not.toBeDisabled();
  });

  it('successful disable navigates back to /bonds with Show-disabled persisted on', async () => {
    getBondMock.mockResolvedValue(BOND_DISABLE_ABLE);
    disableBondMock.mockResolvedValue(undefined);
    const navigate = vi.fn();
    const { BondDetailPage } = await import('../src/pages/BondDetailPage.jsx');
    const { ToastProvider } = await import('../src/components/ui.jsx');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <BondDetailPage isin={BOND_DISABLE_ABLE.isin} navigate={navigate} />
      </ToastProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Disable bond/i }));
    const input = await screen.findByLabelText(/disable-bond-confirm-isin/i);
    await user.type(input, BOND_DISABLE_ABLE.isin);

    const submit = screen.getAllByRole('button', { name: /Disable bond/i }).pop();
    await user.click(submit);

    await waitFor(() => expect(disableBondMock).toHaveBeenCalledWith(BOND_DISABLE_ABLE.isin));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/bonds'));
    expect(window.localStorage.getItem('nb-ui:bonds:showDisabled')).toBe('true');
  });
});
