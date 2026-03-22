import DatabaseConstructor from 'better-sqlite3';
import path from 'path';

export interface IngestionDatabaseStatement<T = unknown> {
  all: (...args: unknown[]) => T[];
  get: (...args: unknown[]) => T | undefined;
  run: (...args: unknown[]) => { changes?: number; lastInsertRowid?: number };
}

export interface IngestionDatabase {
  exec: (sql: string) => void;
  prepare: <T = unknown>(sql: string) => IngestionDatabaseStatement<T>;
  transaction: <T>(fn: () => T) => () => T;
}

export interface IngestionConfig {
  dbPath: string;
  readonly?: boolean;
}

export interface AuctionEventRow {
  auction_id: string;
  isin: string;
  type: string;
  block: number;
  tx_hash: string;
  payload: string;
}

export interface BalanceRow {
  isin: string;
  holder: string;
  balance: string;
}

function createTables(db: IngestionDatabase) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS ingestion_state (
      contract TEXT PRIMARY KEY,
      last_block INTEGER,
      last_tx_index INTEGER
    );

    CREATE TABLE IF NOT EXISTS auctions (
      auction_id TEXT PRIMARY KEY,
      isin TEXT,
      type TEXT,
      created_block INTEGER,
      created_tx TEXT,
      bond TEXT
    );

    CREATE TABLE IF NOT EXISTS auction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id TEXT,
      isin TEXT,
      type TEXT,
      block INTEGER,
      tx_hash TEXT,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auction_events_isin_block ON auction_events(isin, block, id);
    CREATE INDEX IF NOT EXISTS idx_auction_events_auction_block ON auction_events(auction_id, block, id);

    CREATE TABLE IF NOT EXISTS partitions (
      partition TEXT PRIMARY KEY,
      isin TEXT,
      bond TEXT,
      created_block INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_partitions_isin ON partitions(isin);

    CREATE TABLE IF NOT EXISTS balances (
      isin TEXT,
      holder TEXT,
      balance TEXT,
      PRIMARY KEY (isin, holder)
    );
    CREATE INDEX IF NOT EXISTS idx_balances_isin ON balances(isin);
    CREATE INDEX IF NOT EXISTS idx_balances_holder ON balances(holder);

    CREATE TABLE IF NOT EXISTS balance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isin TEXT,
      holder TEXT,
      delta TEXT,
      balance_after TEXT,
      block INTEGER,
      tx_hash TEXT,
      kind TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_balance_events_isin_block ON balance_events(isin, block, id);
    CREATE INDEX IF NOT EXISTS idx_balance_events_holder ON balance_events(holder, isin, block);

    CREATE TABLE IF NOT EXISTS bond_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isin TEXT,
      type TEXT,
      block INTEGER,
      tx_hash TEXT,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bond_events_isin_block ON bond_events(isin, block, id);
  `);
}

export function openDatabase(config: IngestionConfig): IngestionDatabase {
  const fullPath = path.resolve(config.dbPath);
  const options: { fileMustExist: boolean; readonly: boolean } = {
    fileMustExist: false,
    readonly: config.readonly ?? false,
  };
  const db = new DatabaseConstructor(fullPath, options) as IngestionDatabase;
  if (!config.readonly) {
    createTables(db);
  }
  return db;
}

export function getAuctionEventsByIsin(
  db: IngestionDatabase,
  isin: string,
  limit = 200,
  offset = 0,
) {
  const stmt = db.prepare(
    `SELECT auction_id, isin, type, block, tx_hash, payload
     FROM auction_events
     WHERE isin = ?
     ORDER BY block, id
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(isin, limit, offset) as AuctionEventRow[];
}

export function getBalancesByIsin(db: IngestionDatabase, isin: string) {
  const stmt = db.prepare(
    `SELECT isin, holder, balance
     FROM balances
     WHERE isin = ?
     AND CAST(balance as INTEGER) > 0
     ORDER BY holder`,
  );
  return stmt.all(isin) as BalanceRow[];
}

export function getBondEventsByIsin(db: IngestionDatabase, isin: string, limit = 200, offset = 0) {
  const stmt = db.prepare(
    `SELECT isin, type, block, tx_hash, payload
     FROM bond_events
     WHERE isin = ?
     ORDER BY block, id
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(isin, limit, offset) as Array<{
    isin: string;
    type: string;
    block: number;
    tx_hash: string;
    payload: string;
  }>;
}
