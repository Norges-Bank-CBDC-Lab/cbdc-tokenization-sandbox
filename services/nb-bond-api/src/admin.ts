/**
 * admin — lifecycle operations on the ingestion loop, surfaced via
 * POST /v1/admin/restart-ingestion.
 *
 * Two flavours:
 *  - `restartIngestionLoop()` — non-destructive. Tears down the
 *    running interval and starts a fresh one through Plan B's
 *    retry-with-backoff helper. Projection survives.
 *  - `resetProjectionAndRestart()` — destructive. Drops every
 *    projection table (auctions, balances, bond_events, …) and
 *    restarts the loop, which will rebuild from `START_BLOCK`.
 *    `bidders` is **preserved** — it's a sandbox system-of-record
 *    holding impersonation keypairs that can't be recovered from
 *    chain (see ingestion-db.ts §SCHEMA_VERSION).
 *
 * Both return after waiting up to `timeoutMs` (default 5s) for
 * `loopRunning` to flip back to true. If the chain is slow to come
 * back (the retry helper is still backing off), we return early with
 * `restarted: false` and the operator UI can poll the badge.
 */
import { envVariables } from './env-vars';
import { dropProjectionTables, openDatabase, type IngestionDatabase } from './ingestion-db';
import {
  type IngestionStatus,
  getIngestionStatus,
  startIngestionLoopWithRetry,
  stopIngestionLoop,
} from './ingestion';

export type RestartOutcome = {
  restarted: boolean;
  status: IngestionStatus;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Test seams. The runtime defaults wire in the real modules. Tests
 * inject stubs so the suite can exercise the timing + projection-drop
 * logic without spinning up a real loop or DB.
 */
export type AdminDeps = {
  stop?: () => void;
  start?: () => Promise<void> | void;
  openWriteDb?: () => IngestionDatabase;
  dropProjection?: (db: IngestionDatabase) => void;
  getStatus?: () => IngestionStatus;
  sleepFn?: (ms: number) => Promise<void>;
};

async function waitForLoopRunning(
  getStatus: () => IngestionStatus,
  sleepFn: (ms: number) => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getStatus().loopRunning) return true;
    await sleepFn(POLL_MS);
  }
  return getStatus().loopRunning;
}

export async function restartIngestionLoop(
  opts: { timeoutMs?: number } & AdminDeps = {},
): Promise<RestartOutcome> {
  const stop = opts.stop ?? stopIngestionLoop;
  const start = opts.start ?? startIngestionLoopWithRetry;
  const getStatus = opts.getStatus ?? getIngestionStatus;
  const sleepFn = opts.sleepFn ?? sleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  stop();
  // Fire-and-forget: the retry helper may keep retrying for arbitrarily
  // long if the chain stays unreachable. We bound *our* wait, not the
  // helper's.
  void Promise.resolve(start()).catch(() => {
    // The helper's own logs surface why; admin shouldn't crash here.
  });

  const restarted = await waitForLoopRunning(getStatus, sleepFn, timeoutMs);
  return { restarted, status: getStatus() };
}

export async function resetProjectionAndRestart(
  opts: { timeoutMs?: number } & AdminDeps = {},
): Promise<RestartOutcome> {
  const stop = opts.stop ?? stopIngestionLoop;
  const start = opts.start ?? startIngestionLoopWithRetry;
  const getStatus = opts.getStatus ?? getIngestionStatus;
  const sleepFn = opts.sleepFn ?? sleep;
  const openWriteDb =
    opts.openWriteDb ?? (() => openDatabase({ dbPath: envVariables.DB_PATH, readonly: false }));
  const dropProjection = opts.dropProjection ?? dropProjectionTables;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  stop();

  // Open a fresh writable handle, drop the projection, close. The
  // loop will open its own handle on restart and re-run createTables
  // (idempotent under CREATE TABLE IF NOT EXISTS).
  const db = openWriteDb();
  try {
    dropProjection(db);
  } finally {
    // better-sqlite3 exposes .close() at runtime even though our
    // interface doesn't declare it — typed-down for portability.
    const maybeCloseable = db as IngestionDatabase & { close?: () => void };
    if (typeof maybeCloseable.close === 'function') maybeCloseable.close();
  }

  void Promise.resolve(start()).catch(() => {
    /* helper handles retries + logs */
  });

  const restarted = await waitForLoopRunning(getStatus, sleepFn, timeoutMs);
  return { restarted, status: getStatus() };
}
