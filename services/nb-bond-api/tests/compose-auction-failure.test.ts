import { composeAllAuctions, composeAuction } from '../src/compose';
import { auctionSchema } from '../src/contracts/auctions';
import { type IngestionDatabase, openDatabase } from '../src/ingestion-db';

type ClosableDatabase = IngestionDatabase & { close: () => void };

const AUCTION_ID = '0x' + '1'.repeat(64);
const ISIN = 'NO0000000001';
const TOKEN = '0x' + 'a'.repeat(40);
const AUCTION = '0x' + 'b'.repeat(40);
const MANAGER = '0x' + 'c'.repeat(40);

function seedContext(db: IngestionDatabase): void {
  db.prepare(
    `INSERT INTO projection_context
      (id, manager_address, token_address, auction_address, duration_scalar)
     VALUES (1, ?, ?, ?, '60')`,
  ).run(MANAGER, TOKEN, AUCTION);
  db.prepare(
    `INSERT INTO ingestion_state
      (contract, last_block, last_tx_index, block_timestamp)
     VALUES ('bond-manager', 101, 0, 1234)`,
  ).run();
}

function seedAuction(db: IngestionDatabase, withMetadata = true): void {
  db.prepare(
    `INSERT INTO auctions (
      auction_id, isin, type, created_block, created_tx, bond, owner, end,
      offering, auction_pub_key, status, closed_at, finalised_at
    ) VALUES (?, ?, 'RATE', 10, ?, ?, ?, ?, ?, ?, 'finalised', 1200000, 1234000)`,
  ).run(
    AUCTION_ID,
    ISIN,
    '0x' + '2'.repeat(64),
    TOKEN,
    withMetadata ? MANAGER : null,
    withMetadata ? '1200' : null,
    withMetadata ? '100' : null,
    withMetadata ? '0x1234' : null,
  );
  db.prepare(
    `INSERT INTO auction_allocations
      (auction_id, position, bidder, units, rate, auction_type, source_block)
     VALUES (?, 0, ?, '100', '425', 'RATE', 100)`,
  ).run(AUCTION_ID, '0x' + 'd'.repeat(40));
}

describe('auction projection read semantics', () => {
  let db: ClosableDatabase;

  beforeEach(() => {
    db = openDatabase({ dbPath: ':memory:' }) as ClosableDatabase;
  });

  afterEach(() => db.close());

  it('returns null for an identifier missing from the projection', async () => {
    seedContext(db);
    await expect(composeAuction(db, AUCTION_ID)).resolves.toBeNull();
  });

  it('does not silently return an auction when projection context is missing', async () => {
    seedAuction(db);
    await expect(composeAllAuctions(db)).rejects.toMatchObject({
      name: 'DependencyUnavailableError',
      dependency: 'projection',
      resource: 'auctions',
    });
  });

  it('composes without request-path chain reads', async () => {
    seedContext(db);
    seedAuction(db);
    const auction = await composeAuction(db, AUCTION_ID);
    expect(auctionSchema.safeParse(auction).success).toBe(true);
    expect(auction).toMatchObject({
      id: AUCTION_ID,
      status: 'finalised',
      size: '100',
      contracts: { auction: AUCTION, token: TOKEN },
    });
  });

  it('uses the finalisation timestamp so unchanged allocation md5 is stable', async () => {
    seedContext(db);
    seedAuction(db);
    const first = await composeAuction(db, AUCTION_ID);
    const second = await composeAuction(db, AUCTION_ID);
    expect(first?.allocation?.computedAt).toBe(1_234_000);
    expect(second?.allocation?.md5).toBe(first?.allocation?.md5);
  });
});
