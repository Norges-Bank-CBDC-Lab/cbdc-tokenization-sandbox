import DatabaseConstructor from 'better-sqlite3';
import path from 'path';

import { logger } from './logger';

/**
 * On-disk schema version for the ingestion DB.
 *
 * Tracked via `PRAGMA user_version`. When the on-disk value is lower
 * than this constant, `openDatabase` (write mode) runs a one-shot
 * migration that drops the event tables and clears the ingestion
 * checkpoint, then `createTables` recreates the new schema. The
 * polling loop repopulates the projection from chain on its next
 * tick. This is safe because the DB is a projection of chain state,
 * not a system of record.
 *
 * Bump this when a schema change cannot be expressed as an additive
 * `CREATE … IF NOT EXISTS`.
 *
 * History:
 *  - v1: initial schema (event tables keyed only by AUTOINCREMENT id;
 *        event inserts were not idempotent under re-processing).
 *  - v2: added `log_index` + UNIQUE INDEX on `(tx_hash, log_index, …)`
 *        across the three event tables so re-processing the same
 *        chain log is a no-op.
 *  - v3: added `partitions.disabled` for the bond soft-delete flow
 *        (BondManager.disableBond / BondToken.disablePartition). Bumped
 *        the version so the projection is rebuilt cleanly on first boot
 *        after upgrade — CREATE TABLE IF NOT EXISTS would otherwise
 *        keep the old shape.
 *
 * Note on the `bidders`, `banks` and `operation_attempts` tables:
 * unlike every other table in this file, they are *systems of record*,
 * not chain projections. They are created additively via
 * `CREATE TABLE IF NOT EXISTS` and must NEVER be added to the drop
 * list in `migrateToCurrentVersion` — that function only drops
 * projection tables that can be rebuilt from chain. Bidder and bank
 * keypairs are sandbox-impersonation keys, and operation attempts
 * record failed sends that never reached the chain; neither can be
 * recovered from chain state.
 */
const SCHEMA_VERSION = 3;

export interface IngestionDatabaseStatement<T = unknown> {
  all: (...args: unknown[]) => T[];
  get: (...args: unknown[]) => T | undefined;
  run: (...args: unknown[]) => { changes?: number; lastInsertRowid?: number };
}

export interface IngestionDatabase {
  exec: (sql: string) => void;
  prepare: <T = unknown>(sql: string) => IngestionDatabaseStatement<T>;
  transaction: <T>(fn: () => T) => () => T;
  pragma: (statement: string, options?: { simple?: boolean }) => unknown;
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
  // Event tables carry both an AUTOINCREMENT `id` (used as a stable
  // tiebreaker for `ORDER BY block, id`) and a `log_index` column.
  // The UNIQUE indexes on `(tx_hash, log_index, …)` enforce per-chain-log
  // idempotency so re-processing the same block range is a no-op.
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
      log_index INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auction_events_isin_block ON auction_events(isin, block, id);
    CREATE INDEX IF NOT EXISTS idx_auction_events_auction_block ON auction_events(auction_id, block, id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_events_dedup ON auction_events(tx_hash, log_index);

    CREATE TABLE IF NOT EXISTS partitions (
      partition TEXT PRIMARY KEY,
      isin TEXT,
      bond TEXT,
      created_block INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0
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
      log_index INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      kind TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_balance_events_isin_block ON balance_events(isin, block, id);
    CREATE INDEX IF NOT EXISTS idx_balance_events_holder ON balance_events(holder, isin, block);
    -- One ERC-1410 TransferByPartition log produces two balance_events
    -- (debit + credit), so the dedup key must include holder to keep
    -- both rows distinguishable.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_balance_events_dedup
      ON balance_events(tx_hash, log_index, holder);

    CREATE TABLE IF NOT EXISTS bond_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isin TEXT,
      type TEXT,
      block INTEGER,
      log_index INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bond_events_isin_block ON bond_events(isin, block, id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bond_events_dedup ON bond_events(tx_hash, log_index);

    -- System-of-record table: sandbox bidder roster used by the
    -- impersonated-bid flow. NEVER add this to the drop list in
    -- migrateToCurrentVersion — see the SCHEMA_VERSION doc comment.
    CREATE TABLE IF NOT EXISTS bidders (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- System-of-record table: banks created from the Banking page. Each
    -- row holds the bank keypair plus the TBD contract deployed for it
    -- (registered in GlobalRegistry under contract_name). NEVER add this
    -- to the drop list in migrateToCurrentVersion — see the
    -- SCHEMA_VERSION doc comment.
    CREATE TABLE IF NOT EXISTS banks (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      private_key TEXT NOT NULL,
      contract_name TEXT NOT NULL UNIQUE,
      tbd_address TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    -- System-of-record table: the operator audit trail. One row per
    -- operator-initiated on-chain operation attempt (success, revert
    -- with decoded reason, or transport failure). Failed sends are
    -- usually rejected at gas estimation and never reach the chain, so
    -- these rows cannot be rebuilt from chain logs. NEVER add this to
    -- the drop list in migrateToCurrentVersion — see the
    -- SCHEMA_VERSION doc comment.
    CREATE TABLE IF NOT EXISTS operation_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_type TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT,
      error TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operation_attempts_created
      ON operation_attempts(created_at, id);
  `);
}

/**
 * Drop the entire projection and clear the ingestion checkpoint when
 * the on-disk schema is older than `SCHEMA_VERSION`. The polling loop
 * then rebuilds every table from chain on its next tick.
 *
 * We drop **all** ingestion tables (not just the event tables) because
 * `applyBalanceDelta` reads `balances` to compute `balance_after`. If
 * we kept stale balance rows from the old projection and then replayed
 * every event from `START_BLOCK`, the deltas would accumulate on top of
 * the stale base and the resulting balances would be wrong. Dropping
 * the whole projection is the only way to guarantee a consistent
 * rebuild.
 *
 * Sandbox-appropriate: nb-bond-api's data volume is an emptyDir, so
 * this fires at most once per pod lifetime and the rebuild is cheap.
 * Before promoting to a persistent-DB deployment (PVC-backed or
 * Postgres), replace this with an in-place migration that preserves
 * existing rows.
 *
 * Fresh-DB safety: every DROP is `IF EXISTS`, and PRAGMA
 * user_version is set unconditionally, so on a brand-new file the
 * migration is a no-op except for stamping the version.
 */
/**
 * Names of every projection table the ingestion loop owns. **Excludes
 * `bidders` and `banks`** — those tables are sandbox systems-of-record
 * (impersonation keypairs that can't be recovered from chain) and must
 * never be added here. Adding a new projection table? Add its name here
 * AND it will be picked up by both the schema migration and the admin
 * reset path.
 */
export const PROJECTION_TABLE_NAMES = [
  'ingestion_state',
  'auctions',
  'auction_events',
  'partitions',
  'balances',
  'balance_events',
  'bond_events',
] as const;

export function dropProjectionTables(db: IngestionDatabase): void {
  const stmts = PROJECTION_TABLE_NAMES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n');
  db.exec(stmts);
}

function migrateToCurrentVersion(db: IngestionDatabase): {
  ran: boolean;
  from: number;
  to: number;
} {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (current >= SCHEMA_VERSION) {
    return { ran: false, from: current, to: current };
  }
  dropProjectionTables(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return { ran: true, from: current, to: SCHEMA_VERSION };
}

export function openDatabase(config: IngestionConfig): IngestionDatabase {
  const fullPath = path.resolve(config.dbPath);
  const options: { fileMustExist: boolean; readonly: boolean } = {
    fileMustExist: false,
    readonly: config.readonly ?? false,
  };
  const db = new DatabaseConstructor(fullPath, options) as IngestionDatabase;
  if (!config.readonly) {
    // Migration MUST run before createTables: the migration drops the
    // old-shape event tables so that the subsequent CREATE TABLE IF
    // NOT EXISTS in createTables actually creates them with the new
    // shape (otherwise IF NOT EXISTS would silently keep the old).
    const migration = migrateToCurrentVersion(db);
    createTables(db);
    if (migration.ran) {
      logger.info(
        `ingestion DB schema migrated from v${migration.from} to v${migration.to}; ` +
          `event tables dropped, checkpoint reset — ingestion will rebuild projection from chain.`,
      );
    } else {
      logger.debug(`ingestion DB schema at v${migration.to} (no migration needed)`);
    }
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

export interface AuctionRow {
  auction_id: string;
  isin: string;
  type: string | null;
  created_block: number | null;
  created_tx: string | null;
  bond: string | null;
}

export function getAuctionRowById(db: IngestionDatabase, auctionId: string): AuctionRow | null {
  const stmt = db.prepare(
    `SELECT auction_id, isin, type, created_block, created_tx, bond
     FROM auctions
     WHERE auction_id = ?`,
  );
  return (stmt.get(auctionId) as AuctionRow | undefined) ?? null;
}

export function getAuctionEventsById(
  db: IngestionDatabase,
  auctionId: string,
  limit = 200,
  offset = 0,
): AuctionEventRow[] {
  const stmt = db.prepare(
    `SELECT auction_id, isin, type, block, tx_hash, payload
     FROM auction_events
     WHERE auction_id = ?
     ORDER BY block, id
     LIMIT ? OFFSET ?`,
  );
  return stmt.all(auctionId, limit, offset) as AuctionEventRow[];
}

export function listAuctionRowsByIsin(db: IngestionDatabase, isin: string): AuctionRow[] {
  const stmt = db.prepare(
    `SELECT auction_id, isin, type, created_block, created_tx, bond
     FROM auctions
     WHERE isin = ?
     ORDER BY created_block, auction_id`,
  );
  return stmt.all(isin) as AuctionRow[];
}

export function listAllAuctions(db: IngestionDatabase): AuctionRow[] {
  const stmt = db.prepare(
    `SELECT auction_id, isin, type, created_block, created_tx, bond
     FROM auctions
     ORDER BY created_block DESC, auction_id`,
  );
  return stmt.all() as AuctionRow[];
}

export interface BondRow {
  isin: string;
  bond: string | null;
  created_block: number | null;
}

// #region Bidders (system-of-record) ────────────────────────────────

export interface BidderRow {
  address: string;
  name: string;
  public_key: string;
  private_key: string;
  created_at: number;
}

export function listBidderRows(db: IngestionDatabase): BidderRow[] {
  return db
    .prepare(
      `SELECT address, name, public_key, private_key, created_at
       FROM bidders
       ORDER BY created_at, address`,
    )
    .all() as BidderRow[];
}

export function getBidderRowByAddress(db: IngestionDatabase, address: string): BidderRow | null {
  const row = db
    .prepare(
      `SELECT address, name, public_key, private_key, created_at
       FROM bidders
       WHERE LOWER(address) = LOWER(?)`,
    )
    .get(address);
  return (row as BidderRow | undefined) ?? null;
}

export function getBidderRowByName(db: IngestionDatabase, name: string): BidderRow | null {
  const row = db
    .prepare(
      `SELECT address, name, public_key, private_key, created_at
       FROM bidders
       WHERE name = ?`,
    )
    .get(name);
  return (row as BidderRow | undefined) ?? null;
}

export function insertBidderRow(db: IngestionDatabase, row: BidderRow): void {
  db.prepare(
    `INSERT INTO bidders(address, name, public_key, private_key, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.address, row.name, row.public_key, row.private_key, row.created_at);
}

export function deleteBidderRow(db: IngestionDatabase, address: string): number {
  const result = db.prepare(`DELETE FROM bidders WHERE LOWER(address) = LOWER(?)`).run(address);
  return result.changes ?? 0;
}

export function countBidderRows(db: IngestionDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM bidders`).get() as { n: number };
  return row.n;
}

// #endregion

// #region Banks (system-of-record) ──────────────────────────────────

export interface BankRow {
  address: string;
  name: string;
  private_key: string;
  contract_name: string;
  tbd_address: string;
  created_at: number;
}

const BANK_ROW_COLUMNS = 'address, name, private_key, contract_name, tbd_address, created_at';

export function listBankRows(db: IngestionDatabase): BankRow[] {
  return db
    .prepare(
      `SELECT ${BANK_ROW_COLUMNS}
       FROM banks
       ORDER BY created_at, address`,
    )
    .all() as BankRow[];
}

export function getBankRowByAddress(db: IngestionDatabase, address: string): BankRow | null {
  const row = db
    .prepare(
      `SELECT ${BANK_ROW_COLUMNS}
       FROM banks
       WHERE LOWER(address) = LOWER(?)`,
    )
    .get(address);
  return (row as BankRow | undefined) ?? null;
}

export function getBankRowByName(db: IngestionDatabase, name: string): BankRow | null {
  const row = db
    .prepare(
      `SELECT ${BANK_ROW_COLUMNS}
       FROM banks
       WHERE LOWER(name) = LOWER(?)`,
    )
    .get(name);
  return (row as BankRow | undefined) ?? null;
}

export function insertBankRow(db: IngestionDatabase, row: BankRow): void {
  db.prepare(
    `INSERT INTO banks(${BANK_ROW_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.address, row.name, row.private_key, row.contract_name, row.tbd_address, row.created_at);
}

// #endregion

// #region Operation attempts (system-of-record) ─────────────────────

export interface OperationAttemptRow {
  id: number;
  op_type: string;
  target: string;
  status: string;
  tx_hash: string | null;
  error: string | null;
  detail: string | null;
  created_at: number;
}

export function insertOperationAttemptRow(
  db: IngestionDatabase,
  row: Omit<OperationAttemptRow, 'id'>,
): void {
  db.prepare(
    `INSERT INTO operation_attempts(op_type, target, status, tx_hash, error, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.op_type, row.target, row.status, row.tx_hash, row.error, row.detail, row.created_at);
}

export function listOperationAttemptRows(
  db: IngestionDatabase,
  limit = 200,
): OperationAttemptRow[] {
  return db
    .prepare(
      `SELECT id, op_type, target, status, tx_hash, error, detail, created_at
       FROM operation_attempts
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit) as OperationAttemptRow[];
}

// #endregion

export function listAllBonds(
  db: IngestionDatabase,
  opts: { includeDisabled?: boolean } = {},
): BondRow[] {
  // One row per (isin, bond) tuple. Multiple partitions can share an ISIN
  // (different bond contracts), so we group and take the earliest creation
  // block as the bond's "born at".
  // Disabled bonds are hidden by default — pass includeDisabled to surface them.
  const filter = opts.includeDisabled ? '' : 'AND disabled = 0';
  const stmt = db.prepare(
    `SELECT isin, bond, MIN(created_block) AS created_block
     FROM partitions
     WHERE isin IS NOT NULL ${filter}
     GROUP BY isin, bond
     ORDER BY created_block, isin`,
  );
  return stmt.all() as BondRow[];
}

export function isBondDisabled(db: IngestionDatabase, isin: string): boolean {
  const stmt = db.prepare(`SELECT MAX(disabled) AS disabled FROM partitions WHERE isin = ?`);
  const row = stmt.get(isin) as { disabled: number | null } | undefined;
  return Boolean(row?.disabled);
}
