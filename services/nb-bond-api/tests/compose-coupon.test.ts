/**
 * composeBond coupon-payability tests.
 *
 * The `payable` flag mirrors BondManager.payCoupon's on-chain gate:
 * paymentCount < expectedPayments AND block.timestamp >= lastPayment +
 * couponDuration. The sandbox chain only mints blocks on transactions,
 * so eligibility is computed against the LATEST BLOCK timestamp — the
 * tests here pin the boundary behaviour (due exactly at the block
 * timestamp), the not-yet-due case, the all-paid case, and the
 * once-per-pass block read in composeAllBonds.
 *
 * Chain reads are mocked at the src/chain module boundary; the
 * ingestion DB is mocked flat (no holders, no auctions) so the coupon
 * block is the only thing under test.
 */

// Per-partition chain reads, mutated per test. Values chosen around a
// sandbox-like schedule: 60s coupon interval, 300s maturity => 5
// expected payments; issuance (lastCouponPayment init) at t=1000.
const mockChainState = {
  contractsAvailable: true,
  coreReadFailure: false,
  maturityDuration: 300n as bigint | null,
  couponDuration: 60n as bigint | null,
  couponYield: 425n as bigint | null,
  lastCouponPayment: 1000n as bigint | null,
  couponPaymentCount: 0n as bigint | null,
  isMatured: false,
  totalSupply: 100n as bigint | null,
  maturityDate: 1300n as bigint | null,
  latestBlockTimestamp: 1060n as bigint | null,
};

const mockGetLatestBlockTimestamp = jest.fn(async () => mockChainState.latestBlockTimestamp);

const mockDbState = {
  bondRows: [] as Array<{ isin: string }>,
};

jest.mock('../src/chain', () => ({
  getBondToken: async () => {
    if (!mockChainState.contractsAvailable) throw new Error('private RPC detail');
    return {
      maturityDuration: async () => mockChainState.maturityDuration,
      couponDuration: async () => {
        if (mockChainState.coreReadFailure) throw new Error('coupon RPC failed');
        return mockChainState.couponDuration;
      },
      couponYield: async () => mockChainState.couponYield,
      lastCouponPayment: async () => mockChainState.lastCouponPayment,
      couponPaymentCount: async () => mockChainState.couponPaymentCount,
      isMatured: async () => mockChainState.isMatured,
      totalSupplyByPartition: async () => mockChainState.totalSupply,
      maturityDate: async () => mockChainState.maturityDate,
      balanceOfByPartition: async () => 0n,
    };
  },
  getBondManager: async () => ({
    BOND_TOKEN: async () => '0x' + 'a'.repeat(40),
    target: '0x' + 'b'.repeat(40),
  }),
  getBondAuction: async () => {
    throw new Error('not used in these tests');
  },
  getBondAuctionAddress: async () => '0x' + 'c'.repeat(40),
  getDurationScalar: async () => 60n,
  getLatestBlockTimestamp: mockGetLatestBlockTimestamp,
}));

jest.mock('../src/ingestion-db', () => ({
  getAuctionEventsByIsin: () => [],
  getAuctionEventsById: () => [],
  getAuctionRowById: () => null,
  getBalancesByIsin: () => [],
  getBondEventsByIsin: () => [],
  isBondDisabled: () => false,
  listAllAuctions: () => [],
  listAllBonds: () => mockDbState.bondRows,
  listAuctionRowsByIsin: () => [],
}));

import { composeAllBonds, composeBond } from '../src/compose';
import type { IngestionDatabase } from '../src/ingestion-db';

const db = {} as IngestionDatabase;
const ISIN = 'NO0000000001';

beforeEach(() => {
  mockChainState.contractsAvailable = true;
  mockChainState.coreReadFailure = false;
  mockChainState.maturityDuration = 300n;
  mockChainState.couponDuration = 60n;
  mockChainState.couponYield = 425n;
  mockChainState.lastCouponPayment = 1000n;
  mockChainState.couponPaymentCount = 0n;
  mockChainState.isMatured = false;
  mockChainState.totalSupply = 100n;
  mockChainState.maturityDate = 1300n;
  mockChainState.latestBlockTimestamp = 1060n;
  mockDbState.bondRows = [];
  mockGetLatestBlockTimestamp.mockClear();
});

describe('composeBond coupon payability', () => {
  it('rejects with an explicit dependency failure when required contracts are unavailable', async () => {
    mockChainState.contractsAvailable = false;
    await expect(composeBond(db, ISIN)).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      dependency: 'chain',
      resource: `bond ${ISIN}`,
    });
  });

  it('rejects instead of returning a partial bond when a required field read fails', async () => {
    mockChainState.coreReadFailure = true;
    await expect(composeBond(db, ISIN)).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      resource: `bond ${ISIN}`,
    });
  });

  it('is payable when the latest block timestamp reaches nextPaymentDue exactly (boundary)', async () => {
    // lastPayment 1000 + duration 60 => due at 1060; block clock at 1060.
    mockChainState.latestBlockTimestamp = 1060n;
    const bond = await composeBond(db, ISIN);

    expect(bond).not.toBeNull();
    expect(bond?.coupon?.lastPaymentAt).toBe('1000');
    expect(bond?.coupon?.nextPaymentDue).toBe('1060');
    expect(bond?.coupon?.payable).toBe(true);
  });

  it('is NOT payable one second before the due time, even if wall clock is far past it', async () => {
    // The chain clock lags wall clock in the sandbox; only the latest
    // block timestamp counts. Date.now() >> 1059 here, yet not payable.
    mockChainState.latestBlockTimestamp = 1059n;
    const bond = await composeBond(db, ISIN);

    expect(bond?.coupon?.nextPaymentDue).toBe('1060');
    expect(bond?.coupon?.payable).toBe(false);
  });

  it('reports the issuance timestamp as lastPaymentAt before the first payout (made=0)', async () => {
    const bond = await composeBond(db, ISIN);

    // A freshly issued bond has made='0' (not null) so the first coupon
    // can be paid, and lastPaymentAt equals the issuance timestamp.
    expect(bond?.coupon?.payments.made).toBe('0');
    expect(bond?.coupon?.payments.remaining).toBe('5');
    expect(bond?.coupon?.lastPaymentAt).toBe('1000');
  });

  it('is NOT payable once all coupons are paid: nextPaymentDue null, remaining 0', async () => {
    // 5 of 5 payments made; block clock well past the last interval.
    mockChainState.couponPaymentCount = 5n;
    mockChainState.lastCouponPayment = 1240n;
    mockChainState.latestBlockTimestamp = 9999n;
    const bond = await composeBond(db, ISIN);

    expect(bond?.coupon?.payments.made).toBe('5');
    expect(bond?.coupon?.payments.remaining).toBe('0');
    expect(bond?.coupon?.nextPaymentDue).toBeNull();
    expect(bond?.coupon?.payable).toBe(false);
  });

  it('is NOT payable when the latest-block read fails (null timestamp)', async () => {
    mockChainState.latestBlockTimestamp = null;
    const bond = await composeBond(db, ISIN);

    expect(bond?.coupon?.nextPaymentDue).toBe('1060');
    expect(bond?.coupon?.payable).toBe(false);
  });

  it('has no coupon schedule => coupon block without due date, not payable', async () => {
    mockChainState.couponDuration = null;
    mockChainState.lastCouponPayment = null;
    const bond = await composeBond(db, ISIN);

    expect(bond?.coupon?.nextPaymentDue).toBeNull();
    expect(bond?.coupon?.payable).toBe(false);
  });
});

describe('composeAllBonds latest-block fan-out', () => {
  it('reads the latest block timestamp ONCE per compose pass, not once per bond', async () => {
    mockDbState.bondRows = [{ isin: 'NO0000000001' }, { isin: 'NO0000000002' }];
    const bonds = await composeAllBonds(db);

    expect(bonds).toHaveLength(2);
    expect(bonds.every((b) => b.coupon?.payable === true)).toBe(true);
    expect(mockGetLatestBlockTimestamp).toHaveBeenCalledTimes(1);
  });
});
