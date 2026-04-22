import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getAuctionEventsByIsin,
  getBalancesByIsin,
  getBondEventsByIsin,
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
});
