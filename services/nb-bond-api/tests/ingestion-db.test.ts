import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getAuctionEventsByIsin,
  getBalancesByIsin,
  getBondEventsByIsin,
  listAllAuctions,
  listAllBonds,
  type IngestionDatabase,
  openDatabase,
} from '../src/ingestion-db';

type ClosableIngestionDatabase = IngestionDatabase & { close: () => void };

describe('ingestion database', () => {
  let tmpDir: string;
  let db: ClosableIngestionDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-ingestion-'));
    db = openDatabase({
      dbPath: path.join(tmpDir, 'ingestion.sqlite'),
    }) as ClosableIngestionDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the ingestion schema and reads persisted history rows', () => {
    const isin = 'NO0012345678';

    db.prepare(
      `INSERT INTO auction_events(auction_id, isin, type, block, tx_hash, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('auction-1', isin, 'created', 12, '0xauction', '{"status":"open"}');
    db.prepare(`INSERT INTO balances(isin, holder, balance) VALUES (?, ?, ?)`).run(
      isin,
      '0xabc',
      '100',
    );
    db.prepare(`INSERT INTO balances(isin, holder, balance) VALUES (?, ?, ?)`).run(
      isin,
      '0xdef',
      '0',
    );
    db.prepare(
      `INSERT INTO bond_events(isin, type, block, tx_hash, payload)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(isin, 'issued', 13, '0xbond', '{"amount":"100"}');

    expect(getAuctionEventsByIsin(db, isin)).toEqual([
      {
        auction_id: 'auction-1',
        isin,
        type: 'created',
        block: 12,
        tx_hash: '0xauction',
        payload: '{"status":"open"}',
      },
    ]);
    expect(getBalancesByIsin(db, isin)).toEqual([
      {
        isin,
        holder: '0xabc',
        balance: '100',
      },
    ]);
    expect(getBondEventsByIsin(db, isin)).toEqual([
      {
        isin,
        type: 'issued',
        block: 13,
        tx_hash: '0xbond',
        payload: '{"amount":"100"}',
      },
    ]);
  });

  it('lists all auctions across ISINs, newest first', () => {
    db.prepare(
      `INSERT INTO auctions(auction_id, isin, type, created_block, created_tx, bond)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('0xaaaa', 'NO0000000001', 'RATE', 100, '0xtx1', '0xbond1');
    db.prepare(
      `INSERT INTO auctions(auction_id, isin, type, created_block, created_tx, bond)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('0xbbbb', 'NO0000000002', 'PRICE', 200, '0xtx2', '0xbond2');
    db.prepare(
      `INSERT INTO auctions(auction_id, isin, type, created_block, created_tx, bond)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('0xcccc', 'NO0000000001', 'BUYBACK', 150, '0xtx3', '0xbond1');

    const rows = listAllAuctions(db);
    expect(rows.map((r) => r.auction_id)).toEqual(['0xbbbb', '0xcccc', '0xaaaa']);
    expect(rows[0]).toMatchObject({
      auction_id: '0xbbbb',
      isin: 'NO0000000002',
      type: 'PRICE',
      created_block: 200,
      created_tx: '0xtx2',
      bond: '0xbond2',
    });
  });

  it('lists all bonds as unique (isin, bond) pairs with earliest block', () => {
    db.prepare(
      `INSERT INTO partitions(partition, isin, bond, created_block)
       VALUES (?, ?, ?, ?)`,
    ).run('0xpart1', 'NO0000000001', '0xbond1', 100);
    db.prepare(
      `INSERT INTO partitions(partition, isin, bond, created_block)
       VALUES (?, ?, ?, ?)`,
    ).run('0xpart2', 'NO0000000002', '0xbond2', 200);
    // Same (isin, bond) at a later block — should collapse to the earlier block.
    db.prepare(
      `INSERT INTO partitions(partition, isin, bond, created_block)
       VALUES (?, ?, ?, ?)`,
    ).run('0xpart3', 'NO0000000001', '0xbond1', 300);

    const rows = listAllBonds(db);
    expect(rows).toEqual([
      { isin: 'NO0000000001', bond: '0xbond1', created_block: 100 },
      { isin: 'NO0000000002', bond: '0xbond2', created_block: 200 },
    ]);
  });

  it('returns an empty array when no bonds or auctions have been ingested', () => {
    expect(listAllAuctions(db)).toEqual([]);
    expect(listAllBonds(db)).toEqual([]);
  });
});
