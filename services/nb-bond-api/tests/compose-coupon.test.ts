import { composeAllBonds, composeBond } from '../src/compose';
import { bondSchema } from '../src/contracts/bonds';
import { type IngestionDatabase, openDatabase } from '../src/ingestion-db';

type ClosableDatabase = IngestionDatabase & { close: () => void };

const ISIN = 'NO0000000001';
const TOKEN = '0x' + 'a'.repeat(40);
const AUCTION = '0x' + 'b'.repeat(40);
const MANAGER = '0x' + 'c'.repeat(40);
const PARTITION = '0x' + 'd'.repeat(64);

function seedContext(db: IngestionDatabase, blockTimestamp: number | null): void {
  db.prepare(
    `INSERT INTO projection_context
      (id, manager_address, token_address, auction_address, duration_scalar)
     VALUES (1, ?, ?, ?, '60')`,
  ).run(MANAGER, TOKEN, AUCTION);
  db.prepare(
    `INSERT INTO ingestion_state
      (contract, last_block, last_tx_index, block_timestamp)
     VALUES ('bond-manager', 101, 0, ?)`,
  ).run(blockTimestamp);
}

function seedBond(
  db: IngestionDatabase,
  overrides: {
    isin?: string;
    couponDuration?: string | null;
    couponYield?: string | null;
    lastCouponPayment?: string | null;
    couponPaymentCount?: string;
    isMatured?: number;
    totalSupply?: string;
    everIssued?: number;
    redemptionComplete?: number;
  } = {},
): void {
  const isin = overrides.isin ?? ISIN;
  const partition = isin === ISIN ? PARTITION : '0x' + 'e'.repeat(64);
  db.prepare(
    `INSERT INTO partitions(partition, isin, bond, created_block, disabled)
     VALUES (?, ?, ?, 10, 0)`,
  ).run(partition, isin, TOKEN);
  db.prepare(
    `INSERT INTO bond_state (
      isin, partition, bond_address, disabled, maturity_duration, maturity_date,
      coupon_duration, coupon_yield, last_coupon_payment, coupon_payment_count,
      is_matured, total_supply, offering, ever_issued, redemption_complete,
      updated_block, updated_log_index
    ) VALUES (?, ?, ?, 0, '300', '1300', ?, ?, ?, ?, ?, ?, '100', ?, ?, 100, 0)`,
  ).run(
    isin,
    partition,
    TOKEN,
    overrides.couponDuration === undefined ? '60' : overrides.couponDuration,
    overrides.couponYield === undefined ? '425' : overrides.couponYield,
    overrides.lastCouponPayment === undefined ? '1000' : overrides.lastCouponPayment,
    overrides.couponPaymentCount ?? '0',
    overrides.isMatured ?? 0,
    overrides.totalSupply ?? '100',
    overrides.everIssued ?? 1,
    overrides.redemptionComplete ?? 0,
  );
}

function seedAuction(db: IngestionDatabase, status: 'open' | 'closed' | 'finalised'): void {
  db.prepare(
    `INSERT INTO auctions (
      auction_id, isin, type, created_block, created_tx, bond, owner, end,
      offering, auction_pub_key, status
    ) VALUES (?, ?, 'RATE', 50, ?, ?, ?, '1200', '100', ?, ?)`,
  ).run(
    '0x' + '1'.repeat(64),
    ISIN,
    '0x' + '2'.repeat(64),
    TOKEN,
    MANAGER,
    '0x' + '3'.repeat(64),
    status,
  );
}

describe('composeBond projection checkpoint coupon semantics', () => {
  let db: ClosableDatabase;

  beforeEach(() => {
    db = openDatabase({ dbPath: ':memory:' }) as ClosableDatabase;
  });

  afterEach(() => db.close());

  it('reports an incomplete projection instead of falling back to live chain reads', async () => {
    seedBond(db);
    await expect(composeBond(db, ISIN)).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      dependency: 'projection',
      resource: `bond ${ISIN}`,
    });
  });

  it('is payable exactly when the checkpoint timestamp reaches nextPaymentDue', async () => {
    seedContext(db, 1060);
    seedBond(db);
    const bond = await composeBond(db, ISIN);
    expect(bondSchema.safeParse(bond).success).toBe(true);
    expect(bond?.coupon).toMatchObject({
      lastPaymentAt: '1000',
      nextPaymentDue: '1060',
      payable: true,
      payments: { total: '5', made: '0', remaining: '5' },
    });
  });

  it('is not payable one checkpoint second before the due time', async () => {
    seedContext(db, 1059);
    seedBond(db);
    expect((await composeBond(db, ISIN))?.coupon?.payable).toBe(false);
  });

  it('is not payable once all coupons are paid', async () => {
    seedContext(db, 1400);
    seedBond(db, { couponPaymentCount: '5', isMatured: 1 });
    const coupon = (await composeBond(db, ISIN))?.coupon;
    expect(coupon).toMatchObject({ payable: false, payments: { remaining: '0' } });
  });

  it('is not payable when the checkpoint timestamp is unavailable', async () => {
    seedContext(db, null);
    seedBond(db);
    expect((await composeBond(db, ISIN))?.coupon?.payable).toBe(false);
  });

  it('supports a staged bond with no coupon schedule', async () => {
    seedContext(db, 1060);
    seedBond(db, { couponDuration: null, couponYield: null, lastCouponPayment: null });
    expect((await composeBond(db, ISIN))?.coupon).toBeNull();
  });

  it('composes every bond from the same stored checkpoint without RPC fan-out', async () => {
    seedContext(db, 1060);
    seedBond(db);
    seedBond(db, { isin: 'NO0000000002' });
    const bonds = await composeAllBonds(db);
    expect(bonds).toHaveLength(2);
    expect(bonds.every((bond) => bond.coupon?.payable === true)).toBe(true);
  });

  it.each([
    [{ everIssued: 0, totalSupply: '0' }, undefined, 'staged'],
    [{ everIssued: 0, totalSupply: '0' }, 'open', 'auctioning'],
    [{ everIssued: 1, totalSupply: '100' }, 'finalised', 'outstanding'],
    [{ everIssued: 1, totalSupply: '100', isMatured: 1 }, 'finalised', 'matured'],
    [
      { everIssued: 1, totalSupply: '0', isMatured: 1, redemptionComplete: 1 },
      'finalised',
      'redeemed',
    ],
  ] as const)('derives the durable %s lifecycle status', async (state, auction, expected) => {
    seedContext(db, 1060);
    seedBond(db, state);
    if (auction) seedAuction(db, auction);
    expect((await composeBond(db, ISIN))?.status).toBe(expected);
  });
});
