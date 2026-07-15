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

  it('rebuilds a v3 projection while preserving every system-of-record table', () => {
    // Create the relevant v3 projection shape plus the three durable tables.
    // These counts mirror the live migration contract without using real keys.
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
        CREATE TABLE bidders (
          address TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          public_key TEXT NOT NULL, private_key TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE banks (
          address TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
          private_key TEXT NOT NULL, contract_name TEXT NOT NULL UNIQUE,
          tbd_address TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
        );
        CREATE TABLE operation_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, op_type TEXT NOT NULL,
          target TEXT NOT NULL, status TEXT NOT NULL, tx_hash TEXT,
          error TEXT, detail TEXT, created_at INTEGER NOT NULL
        );
        INSERT INTO auction_events(auction_id, isin, type, block, tx_hash, payload)
          VALUES ('0xpre-v2', 'NO0012345678', 'RATE', 5, '0xold', '{}');
        INSERT INTO ingestion_state(contract, last_block, last_tx_index)
          VALUES ('bond-manager', 5, 0);
        INSERT INTO bidders(address, name, public_key, private_key, created_at)
          VALUES ('0x0000000000000000000000000000000000000001', 'Bidder', '0xpub', '0xpriv', 1);
        INSERT INTO banks(address, name, private_key, contract_name, tbd_address, created_at)
          VALUES ('0x0000000000000000000000000000000000000002', 'Bank', '0xpriv', 'TBD Bank',
                  '0x0000000000000000000000000000000000000003', 2);
        INSERT INTO operation_attempts(op_type, target, status, tx_hash, created_at)
          VALUES ('BOND_CREATE', 'NO0012345678', 'SUCCEEDED', '0xtx', 3);
        PRAGMA user_version = 3;
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

      // Locally generated records are not projections and must survive exactly.
      expect(rowCount(db, 'bidders')).toBe(1);
      expect(rowCount(db, 'banks')).toBe(1);
      expect(rowCount(db, 'operation_attempts')).toBe(1);
      expect(db.pragma('quick_check', { simple: true })).toBe('ok');

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

  it('rolls back projection drops when schema recreation fails', () => {
    {
      const raw = new DatabaseConstructor(dbPath);
      raw.exec(`
        CREATE TABLE auction_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id TEXT, isin TEXT, type TEXT,
          block INTEGER, tx_hash TEXT, payload TEXT
        );
        INSERT INTO auction_events(auction_id, isin, type, block, tx_hash, payload)
          VALUES ('0xpreserved', 'NO0012345678', 'RATE', 5, '0xold', '{}');
        CREATE TABLE operation_attempts (id INTEGER PRIMARY KEY);
        PRAGMA user_version = 3;
      `);
      raw.close();
    }

    // The incompatible durable table makes createTables fail after migration
    // starts. The transaction must restore the old projection and version.
    expect(() => openDatabase({ dbPath })).toThrow();

    const check = new DatabaseConstructor(dbPath, { readonly: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(3);
      expect(
        (
          check.prepare(`SELECT COUNT(*) AS n FROM auction_events`).get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
      expect(check.pragma('quick_check', { simple: true })).toBe('ok');
    } finally {
      check.close();
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
