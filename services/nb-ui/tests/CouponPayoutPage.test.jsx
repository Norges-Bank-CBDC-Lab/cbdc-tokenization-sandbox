import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fmt } from '../src/utils/format.js';

// CouponPayoutPage lists issued bonds with their coupon schedule and
// pays coupons through the confirmation modal. Eligibility comes ONLY
// from the server-computed coupon.payable flag (chain clock, not wall
// clock) — the tests pin that the button state mirrors the flag, the
// tooltips explain WHY a row is disabled, and the modal shows the
// per-holder cash amounts before calling BondsApi.payCoupon.

const HOLDER_A = '0x1111111111111111111111111111111111111111';
const HOLDER_B = '0x2222222222222222222222222222222222222222';

// Payable: 1 of 5 coupons paid, due time (1060) already reached by the
// chain clock.
const PAYABLE_BOND = {
  isin: 'NO0000000001',
  status: 'outstanding',
  disabled: false,
  totalSupply: '1000',
  contracts: { token: '0xa', auction: '0xb', manager: '0xc' },
  maturity: { duration: '300', durationYears: '5', date: '1300', remaining: '240' },
  coupon: {
    duration: '60',
    durationYears: '1',
    rateBps: '425',
    lastPaymentAt: '1000',
    nextPaymentDue: '1060',
    payable: true,
    payments: { total: '5', made: '1', remaining: '4' },
  },
  holders: [
    { holder: HOLDER_A, balance: '600', md5: 'h1' },
    { holder: HOLDER_B, balance: '400', md5: 'h2' },
  ],
  auctions: [],
  md5: 'b1',
};

// Not due: freshly issued (made=0 — "Previous payout" renders the
// issuance date), next payout still ahead of the chain clock.
const NOT_DUE_BOND = {
  isin: 'NO0000000002',
  status: 'outstanding',
  disabled: false,
  totalSupply: '500',
  contracts: { token: '0xa', auction: '0xb', manager: '0xc' },
  maturity: { duration: '300', durationYears: '5', date: '2300', remaining: '290' },
  coupon: {
    duration: '60',
    durationYears: '1',
    rateBps: '380',
    lastPaymentAt: '2000',
    nextPaymentDue: '2060',
    payable: false,
    payments: { total: '5', made: '0', remaining: '5' },
  },
  holders: [{ holder: HOLDER_A, balance: '500', md5: 'h3' }],
  auctions: [],
  md5: 'b2',
};

// All paid: matured, no next payout.
const ALL_PAID_BOND = {
  isin: 'NO0000000003',
  status: 'matured',
  disabled: false,
  totalSupply: '200',
  contracts: { token: '0xa', auction: '0xb', manager: '0xc' },
  maturity: { duration: '300', durationYears: '5', date: '900', remaining: '0' },
  coupon: {
    duration: '60',
    durationYears: '1',
    rateBps: '425',
    lastPaymentAt: '900',
    nextPaymentDue: null,
    payable: false,
    payments: { total: '5', made: '5', remaining: '0' },
  },
  holders: [{ holder: HOLDER_B, balance: '200', md5: 'h4' }],
  auctions: [],
  md5: 'b3',
};

// Never listed: no minted supply (created, not issued).
const UNISSUED_BOND = {
  isin: 'NO0000000009',
  status: 'staged',
  disabled: false,
  totalSupply: '0',
  contracts: { token: '0xa', auction: '0xb', manager: '0xc' },
  maturity: null,
  coupon: null,
  holders: [],
  auctions: [],
  md5: 'b9',
};

const FIXTURE_BONDS = [PAYABLE_BOND, NOT_DUE_BOND, ALL_PAID_BOND, UNISSUED_BOND];

vi.mock('../src/api/bondsApi.js', () => ({
  BondsApi: {
    listBonds: vi.fn().mockResolvedValue([]),
    getBond: vi.fn(),
    createBond: vi.fn(),
    disableBond: vi.fn(),
    listBondHistory: vi.fn(),
    payCoupon: vi.fn(),
    redeem: vi.fn(),
  },
}));

async function renderPage() {
  const { BondsApi } = await import('../src/api/bondsApi.js');
  BondsApi.listBonds.mockResolvedValue(FIXTURE_BONDS);
  const { CouponPayoutPage } = await import('../src/pages/CouponPayoutPage.jsx');
  const { ToastProvider } = await import('../src/components/ui.jsx');
  const navigate = vi.fn();

  render(
    <ToastProvider>
      <CouponPayoutPage navigate={navigate} />
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.getByText('NO0000000001')).toBeInTheDocument());
  return { BondsApi, navigate };
}

function rowFor(isin) {
  return screen.getByText(isin).closest('tr');
}

describe('CouponPayoutPage', () => {
  it('renders KPIs from the listed bonds', async () => {
    await renderPage();

    const dueNow = screen.getByText('Due now').closest('.kpi');
    expect(within(dueNow).getByText('1')).toBeInTheDocument();

    // 4 + 5 + 0 remaining across the three listed bonds.
    const outstanding = screen.getByText('Coupons outstanding').closest('.kpi');
    expect(within(outstanding).getByText('9')).toBeInTheDocument();

    // Earliest nextPaymentDue across listed bonds = the overdue 1060.
    const nextDue = screen.getByText('Next payout due').closest('.kpi');
    expect(within(nextDue).getByText(Fmt.formatUnixDate('1060'))).toBeInTheDocument();
  });

  it('lists only issued bonds with a coupon schedule', async () => {
    await renderPage();

    expect(screen.getByText('NO0000000002')).toBeInTheDocument();
    expect(screen.getByText('NO0000000003')).toBeInTheDocument();
    expect(screen.queryByText('NO0000000009')).not.toBeInTheDocument();
  });

  it('enables Pay coupon only from the server-side payable flag, with a reason tooltip otherwise', async () => {
    await renderPage();

    const payableBtn = within(rowFor('NO0000000001')).getByRole('button', { name: 'Pay coupon' });
    expect(payableBtn).not.toBeDisabled();
    expect(payableBtn).toHaveClass('btn-primary');

    const notDueBtn = within(rowFor('NO0000000002')).getByRole('button', { name: 'Pay coupon' });
    expect(notDueBtn).toBeDisabled();
    expect(notDueBtn).toHaveAttribute(
      'title',
      `Not due yet — next payout ${Fmt.formatUnixDate('2060')}`,
    );

    const allPaidBtn = within(rowFor('NO0000000003')).getByRole('button', { name: 'Pay coupon' });
    expect(allPaidBtn).toBeDisabled();
    expect(allPaidBtn).toHaveAttribute('title', 'All coupons paid');
  });

  it('renders "Issued <date>" as the previous payout until the first coupon lands', async () => {
    await renderPage();

    // made=0 → issuance-date phrasing; made=1 → plain payout date.
    expect(
      within(rowFor('NO0000000002')).getByText(`Issued ${Fmt.formatUnixDate('2000')}`),
    ).toBeInTheDocument();
    expect(
      within(rowFor('NO0000000001')).getByText(Fmt.formatUnixDate('1000')),
    ).toBeInTheDocument();
    // All coupons paid → no next payout.
    expect(within(rowFor('NO0000000003')).getByText('—')).toBeInTheDocument();
  });

  it('opens the confirmation modal with per-holder amounts and pays on confirm', async () => {
    const { BondsApi } = await renderPage();
    BondsApi.payCoupon.mockResolvedValue({ ...PAYABLE_BOND });
    const user = userEvent.setup();

    await user.click(within(rowFor('NO0000000001')).getByRole('button', { name: 'Pay coupon' }));
    const modal = (
      await screen.findByRole('heading', { name: 'Pay coupon on NO0000000001' })
    ).closest('.modal');

    // balance × 1000 NOK face × 425 bps / 10000: 600 → 25,500 NOK; 400 → 17,000 NOK.
    expect(within(modal).getByText('25.50 K NOK')).toBeInTheDocument();
    expect(within(modal).getByText('17.00 K NOK')).toBeInTheDocument();
    expect(within(modal).getByText('42.50 K NOK')).toBeInTheDocument();

    await user.click(within(modal).getByRole('button', { name: 'Pay coupon' }));

    await waitFor(() => expect(BondsApi.payCoupon).toHaveBeenCalledWith('NO0000000001'));
    // Success: toast + modal closed.
    expect(await screen.findByText('Coupon paid')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Pay coupon on NO0000000001' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the modal open and surfaces the error when the payment fails', async () => {
    const { BondsApi } = await renderPage();
    BondsApi.payCoupon.mockRejectedValue(new Error('CouponNotReady'));
    const user = userEvent.setup();

    await user.click(within(rowFor('NO0000000001')).getByRole('button', { name: 'Pay coupon' }));
    const modal = (
      await screen.findByRole('heading', { name: 'Pay coupon on NO0000000001' })
    ).closest('.modal');

    await user.click(within(modal).getByRole('button', { name: 'Pay coupon' }));

    expect(await within(modal).findByText('CouponNotReady')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pay coupon on NO0000000001' })).toBeInTheDocument();
  });

  it('flags treasury-held units (the bond manager) in the payment preview', async () => {
    // A partial allocation leaves unsold units on the BondManager itself.
    // The contract requires covering EVERY holder, so the preview keeps
    // the manager row (labelled) and warns that the payout will fail on
    // the government TBD allowlist. Mixed casing proves the address
    // match is case-insensitive.
    const MANAGER = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';
    const bond = {
      ...PAYABLE_BOND,
      contracts: { ...PAYABLE_BOND.contracts, manager: MANAGER },
      holders: [
        { holder: HOLDER_A, balance: '600', md5: 'h1' },
        { holder: MANAGER.toLowerCase(), balance: '400', md5: 'hm' },
      ],
    };
    const { PayCouponModal } = await import('../src/pages/PayCouponModal.jsx');
    render(<PayCouponModal bond={bond} onClose={() => {}} onPaid={() => {}} />);

    // Both rows render (header + 2 holders + total), the manager row is
    // labelled, and the warning is shown before any transaction fires.
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('(treasury)')).toBeInTheDocument();
    expect(screen.getByText(/treasury-held units/i)).toBeInTheDocument();
    expect(
      screen.getByText(/will fail unless the manager is explicitly allowlisted/),
    ).toBeInTheDocument();
    // Total covers ALL holders — the full cash leg the contract demands:
    // (600 + 400) units × 4.25% of face = 42.50 K NOK.
    expect(screen.getByText('42.50 K NOK')).toBeInTheDocument();
  });
});
