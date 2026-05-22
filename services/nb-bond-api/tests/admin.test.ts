import fs from 'fs';
import os from 'os';
import path from 'path';

import { resetProjectionAndRestart, restartIngestionLoop } from '../src/admin';
import { PROJECTION_TABLE_NAMES, openDatabase, type IngestionDatabase } from '../src/ingestion-db';
import type { IngestionStatus } from '../src/ingestion';

function snapshot(): IngestionStatus {
  return {
    loopRunning: false,
    lastTickAt: null,
    consecutiveFailures: 0,
    lastBlockProcessed: null,
    lastEventTxHash: null,
    pollIntervalMs: 3000,
    recentErrors: [],
  };
}

describe('restartIngestionLoop', () => {
  it('calls stop, then start, and returns restarted=true once loopRunning flips', async () => {
    const stop = jest.fn();
    const start = jest.fn().mockResolvedValue(undefined);
    let running = false;
    const getStatus = (): IngestionStatus => ({ ...snapshot(), loopRunning: running });

    // Simulate the retry helper flipping the flag a short time later.
    const startWithFlip = jest.fn(async () => {
      await Promise.resolve();
      running = true;
    });

    const outcome = await restartIngestionLoop({
      stop,
      start: startWithFlip,
      getStatus,
      sleepFn: () => Promise.resolve(),
      timeoutMs: 200,
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(startWithFlip).toHaveBeenCalledTimes(1);
    expect(outcome.restarted).toBe(true);
    expect(outcome.status.loopRunning).toBe(true);
    // The unused stub keeps lint happy without forking the test.
    expect(start).not.toHaveBeenCalled();
  });

  it('returns restarted=false (timeout / 202 path) when start blocks forever', async () => {
    const stop = jest.fn();
    const start = jest.fn(() => new Promise<void>(() => {})); // never resolves
    const getStatus = (): IngestionStatus => snapshot();

    const outcome = await restartIngestionLoop({
      stop,
      start,
      getStatus,
      sleepFn: () => Promise.resolve(),
      timeoutMs: 30,
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcome.restarted).toBe(false);
  });
});

describe('resetProjectionAndRestart', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-admin-'));
    dbPath = path.join(tmpDir, 'ingestion.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drops every projection table but preserves bidders', async () => {
    const db = openDatabase({ dbPath, readonly: false });

    // Seed something into a projection table + the bidders table.
    db.exec(`
      INSERT INTO auctions (auction_id, isin, type, created_block, created_tx)
      VALUES ('0xaaa', 'NO00TEST', 'RATE', 1, '0xbeef');
      INSERT INTO bidders (address, name, public_key, private_key, created_at)
      VALUES ('0x000000000000000000000000000000000000dead', 'Alice', '0xpk', '0xsk', 1);
    `);

    // Wrap the handle so admin.ts's defensive .close() doesn't shut the
    // connection down before the test can assert post-conditions. The
    // real runtime closes — the test wrapper exposes the same surface
    // minus the close() method.
    const noCloseDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'close') return undefined;
        return (target as unknown as Record<PropertyKey, unknown>)[prop];
      },
    });

    const stop = jest.fn();
    const start = jest.fn(async () => {
      /* no-op for the test seam */
    });
    let running = false;
    const getStatus = (): IngestionStatus => ({ ...snapshot(), loopRunning: running });

    const outcome = await resetProjectionAndRestart({
      stop,
      start: async () => {
        await Promise.resolve();
        running = true;
      },
      getStatus,
      sleepFn: () => Promise.resolve(),
      openWriteDb: () => noCloseDb,
      timeoutMs: 200,
    });

    expect(outcome.restarted).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    // start is the default; we overrode it via the bag above, so the
    // jest.fn() stays uncalled — only present here to assert nothing
    // leaks into the runtime helper.
    expect(start).not.toHaveBeenCalled();

    // Projection tables are gone.
    for (const name of PROJECTION_TABLE_NAMES) {
      const exists = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name) as { name?: string } | undefined;
      expect(exists?.name).toBeUndefined();
    }

    // Bidders survived.
    const bidder = db
      .prepare(`SELECT name FROM bidders WHERE address=?`)
      .get('0x000000000000000000000000000000000000dead') as { name?: string } | undefined;
    expect(bidder?.name).toBe('Alice');
  });

  it('uses the injected dropProjection seam exactly once', async () => {
    const dropProjection = jest.fn();
    const fakeDb: IngestionDatabase = {
      exec: jest.fn(),
      prepare: jest.fn(),
      transaction: jest.fn(),
      pragma: jest.fn(),
    } as unknown as IngestionDatabase;

    let running = false;
    const outcome = await resetProjectionAndRestart({
      stop: jest.fn(),
      start: async () => {
        running = true;
      },
      getStatus: () => ({ ...snapshot(), loopRunning: running }),
      sleepFn: () => Promise.resolve(),
      openWriteDb: () => fakeDb,
      dropProjection,
      timeoutMs: 50,
    });

    expect(dropProjection).toHaveBeenCalledTimes(1);
    expect(dropProjection).toHaveBeenCalledWith(fakeDb);
    expect(outcome.restarted).toBe(true);
  });
});
