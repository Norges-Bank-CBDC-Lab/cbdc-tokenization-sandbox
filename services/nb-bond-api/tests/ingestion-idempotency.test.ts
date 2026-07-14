/**
 * Coverage for the schema-v2 idempotency guarantees on the three event
 * tables (`auction_events`, `balance_events`, `bond_events`).
 *
 * These tests exercise the actual ingestion helpers (`upsertAuctionEvent`,
 * `applyBalanceDelta`, `insertBondEvent`) so they also lock down the
 * `log_index` plumbing — a regression that "forgets" to thread
 * `log.index` from a handler would show as duplicates flooding the
 * dedup tests below.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import DatabaseConstructor from 'better-sqlite3';

import { applyBalanceDelta, insertBondEvent, upsertAuctionEvent } from '../src/ingestion';
import { type IngestionDatabase, openDatabase } from '../src/ingestion-db';

type ClosableIngestionDatabase = IngestionDatabase & { close: () => void };

function rowCount(db: IngestionDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function getBalance(db: IngestionDatabase, isin: string, holder: string): string | null {
  const row = db
    .prepare(`SELECT balance FROM balances WHERE isin = ? AND holder = ?`)
    .get(isin, holder) as { balance: string } | undefined;
  return row?.balance ?? null;
}

describe('ingestion event idempotency (schema v2)', () => {
  let tmpDir: string;
  let db: ClosableIngestionDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-idem-'));
    db = openDatabase({
      dbPath: path.join(tmpDir, 'ingestion.sqlite'),
    }) as ClosableIngestionDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('auction_events', () => {
    const baseEvent = {
      auctionId: '0xauction',
      isin: 'NO0012345678',
      type: 'RATE',
      block: 10,
      logIndex: 3,
      txHash: '0xabc',
      payload: { sample: 'value' },
    };

    it('inserts a row on first call', () => {
      upsertAuctionEvent(db, baseEvent);
      expect(rowCount(db, 'auction_events')).toBe(1);
    });

    it('does not duplicate when called again with the same (tx_hash, log_index)', () => {
      upsertAuctionEvent(db, baseEvent);
      upsertAuctionEvent(db, { ...baseEvent, payload: { sample: 'different' } });
      expect(rowCount(db, 'auction_events')).toBe(1);
    });

    it('inserts a second row when log_index differs (same tx_hash)', () => {
      upsertAuctionEvent(db, baseEvent);
      upsertAuctionEvent(db, { ...baseEvent, logIndex: 4 });
      expect(rowCount(db, 'auction_events')).toBe(2);
    });

    it('inserts a second row when tx_hash differs (same log_index)', () => {
      upsertAuctionEvent(db, baseEvent);
      upsertAuctionEvent(db, { ...baseEvent, txHash: '0xdef' });
      expect(rowCount(db, 'auction_events')).toBe(2);
    });
  });

  describe('bond_events', () => {
    const baseEvent = {
      isin: 'NO0012345678',
      type: 'COUPON_PAID',
      block: 20,
      logIndex: 1,
      txHash: '0xcoupon',
      payload: { holder: '0xabc', amount: '100' },
    };

    it('inserts a row on first call', () => {
      insertBondEvent(db, baseEvent);
      expect(rowCount(db, 'bond_events')).toBe(1);
    });

    it('does not duplicate on replay with the same (tx_hash, log_index)', () => {
      insertBondEvent(db, baseEvent);
      insertBondEvent(db, baseEvent);
      expect(rowCount(db, 'bond_events')).toBe(1);
    });

    it('inserts a second row for a distinct log_index in the same tx', () => {
      insertBondEvent(db, baseEvent);
      insertBondEvent(db, { ...baseEvent, logIndex: 2 });
      expect(rowCount(db, 'bond_events')).toBe(2);
    });
  });

  describe('balance_events (dedup includes holder)', () => {
    const isin = 'NO0012345678';
    const txHash = '0xtransfer';
    const logIndex = 5;

    it('inserts a row on first call', () => {
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: 100n,
        block: 30,
        logIndex,
        txHash,
        kind: 'issue',
      });
      expect(rowCount(db, 'balance_events')).toBe(1);
      expect(getBalance(db, isin, '0xalice')).toBe('100');
    });

    it('does not duplicate the same (tx_hash, log_index, holder)', () => {
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: 100n,
        block: 30,
        logIndex,
        txHash,
        kind: 'issue',
      });
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: 100n,
        block: 30,
        logIndex,
        txHash,
        kind: 'issue',
      });
      expect(rowCount(db, 'balance_events')).toBe(1);
      // Critical: balance must NOT be double-applied on replay.
      expect(getBalance(db, isin, '0xalice')).toBe('100');
    });

    it('persists both debit and credit rows for one transfer log', () => {
      // One ERC-1410 TransferByPartition log produces two
      // applyBalanceDelta calls — debit `from` and credit `to`.
      // They share (tx_hash, log_index) but differ on holder.
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: -50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      applyBalanceDelta(db, {
        isin,
        holder: '0xbob',
        delta: 50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      expect(rowCount(db, 'balance_events')).toBe(2);
      expect(getBalance(db, isin, '0xalice')).toBe('-50');
      expect(getBalance(db, isin, '0xbob')).toBe('50');
    });

    it('replaying a full transfer log is a no-op', () => {
      // Apply once.
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: -50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      applyBalanceDelta(db, {
        isin,
        holder: '0xbob',
        delta: 50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      // Replay the same two calls.
      applyBalanceDelta(db, {
        isin,
        holder: '0xalice',
        delta: -50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      applyBalanceDelta(db, {
        isin,
        holder: '0xbob',
        delta: 50n,
        block: 30,
        logIndex,
        txHash,
        kind: 'transfer',
      });
      expect(rowCount(db, 'balance_events')).toBe(2);
      expect(getBalance(db, isin, '0xalice')).toBe('-50');
      expect(getBalance(db, isin, '0xbob')).toBe('50');
    });

    it('defensively ignores a zero-address holder', () => {
      applyBalanceDelta(db, {
        isin,
        holder: '0x0000000000000000000000000000000000000000',
        delta: 100n,
        block: 30,
        logIndex,
        txHash,
        kind: 'mint',
      });
      expect(rowCount(db, 'balance_events')).toBe(0);
      expect(getBalance(db, isin, '0x0000000000000000000000000000000000000000')).toBeNull();
    });
  });
});

describe('ingestion DB migration (PRAGMA user_version)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-migration-'));
    dbPath = path.join(tmpDir, 'ingestion.sqlite');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drops event tables and clears checkpoint when opening at a lower user_version', () => {
    // Step 1: create a v0-shaped file directly with the OLD schema and
    // a row of stale data. This simulates a deployment that pre-dates
    // the current SCHEMA_VERSION.
    {
      const raw = new DatabaseConstructor(dbPath);
      raw.exec(`
        CREATE TABLE auction_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id TEXT, isin TEXT, type TEXT,
          block INTEGER, tx_hash TEXT, payload TEXT
        );
        CREATE TABLE bond_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          isin TEXT, type TEXT,
          block INTEGER, tx_hash TEXT, payload TEXT
        );
        CREATE TABLE balance_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          isin TEXT, holder TEXT, delta TEXT,
          balance_after TEXT, block INTEGER, tx_hash TEXT, kind TEXT
        );
        CREATE TABLE ingestion_state (
          contract TEXT PRIMARY KEY, last_block INTEGER, last_tx_index INTEGER
        );
        INSERT INTO auction_events(auction_id, isin, type, block, tx_hash, payload)
          VALUES ('0xpre-v2', 'NO0012345678', 'RATE', 5, '0xold', '{}');
        INSERT INTO ingestion_state(contract, last_block, last_tx_index)
          VALUES ('bond-manager', 5, 0);
        PRAGMA user_version = 0;
      `);
      raw.close();
    }

    // Step 2: open via the real loader. Migration must drop the event
    // tables, clear the checkpoint, recreate the new schema, and bump
    // user_version to the current SCHEMA_VERSION.
    const db = openDatabase({ dbPath }) as ClosableIngestionDatabase;
    try {
      const userVersion = Number(db.pragma('user_version', { simple: true }) ?? 0);
      expect(userVersion).toBe(6);

      // Tables exist (recreated by createTables after the drop).
      expect(rowCount(db, 'auction_events')).toBe(0);
      expect(rowCount(db, 'bond_events')).toBe(0);
      expect(rowCount(db, 'balance_events')).toBe(0);
      expect(rowCount(db, 'bond_state')).toBe(0);
      expect(rowCount(db, 'auction_bids')).toBe(0);
      expect(rowCount(db, 'auction_allocations')).toBe(0);

      // Checkpoint was cleared so the polling loop will rebuild from
      // START_BLOCK.
      const checkpointRow = db.prepare(`SELECT * FROM ingestion_state`).get();
      expect(checkpointRow).toBeUndefined();

      // New schema is in place: the UNIQUE INDEX exists and prevents
      // duplicate (tx_hash, log_index) insertions.
      upsertAuctionEvent(db, {
        auctionId: '0xpost-v2',
        isin: 'NO0012345678',
        type: 'PRICE',
        block: 10,
        logIndex: 0,
        txHash: '0xnew',
        payload: {},
      });
      upsertAuctionEvent(db, {
        auctionId: '0xpost-v2',
        isin: 'NO0012345678',
        type: 'PRICE',
        block: 10,
        logIndex: 0,
        txHash: '0xnew',
        payload: {},
      });
      expect(rowCount(db, 'auction_events')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is a no-op when the file is already at the current version', () => {
    // First open creates the DB at the current version.
    const first = openDatabase({ dbPath }) as ClosableIngestionDatabase;
    upsertAuctionEvent(first, {
      auctionId: '0xa',
      isin: 'NO0012345678',
      type: 'RATE',
      block: 1,
      logIndex: 0,
      txHash: '0xtx',
      payload: {},
    });
    first.close();

    // Re-open: should preserve the row (no migration runs).
    const second = openDatabase({ dbPath }) as ClosableIngestionDatabase;
    try {
      expect(rowCount(second, 'auction_events')).toBe(1);
      const userVersion = Number(second.pragma('user_version', { simple: true }) ?? 0);
      expect(userVersion).toBe(6);
    } finally {
      second.close();
    }
  });
});
