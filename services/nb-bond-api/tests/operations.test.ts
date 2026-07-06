import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Interface } from 'ethers';

import { openDatabase, type IngestionDatabase } from '../src/ingestion-db';
import {
  classifyFailure,
  listOperationAttempts,
  recordOperationAttempt,
  withOperationRecording,
} from '../src/operations';

type ClosableIngestionDatabase = IngestionDatabase & { close: () => void };

describe('operation attempts (audit trail)', () => {
  let tmpDir: string;
  let db: ClosableIngestionDatabase;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-operations-'));
    dbPath = path.join(tmpDir, 'ingestion.sqlite');
    db = openDatabase({ dbPath }) as ClosableIngestionDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records and lists attempts newest-first with a limit', () => {
    recordOperationAttempt(db, {
      opType: 'WNOK_MINT',
      target: '0xabc',
      status: 'SUCCEEDED',
      txHash: '0xhash1',
      error: null,
      detail: { amount: '100' },
    });
    recordOperationAttempt(db, {
      opType: 'COUPON_PAYMENT',
      target: 'NO0012345678',
      status: 'REVERTED',
      txHash: null,
      error: 'CouponNotReady()',
      detail: { holders: 2 },
    });

    const rows = listOperationAttempts(db);
    expect(rows).toHaveLength(2);
    // Same created_at second is possible — the id tiebreaker keeps
    // insertion order reversed (newest first).
    expect(rows[0].op_type).toBe('COUPON_PAYMENT');
    expect(rows[0].status).toBe('REVERTED');
    expect(rows[0].tx_hash).toBeNull();
    expect(rows[0].error).toBe('CouponNotReady()');
    expect(JSON.parse(rows[0].detail as string)).toEqual({ holders: 2 });
    expect(rows[1].op_type).toBe('WNOK_MINT');
    expect(rows[1].tx_hash).toBe('0xhash1');

    expect(listOperationAttempts(db, 1)).toHaveLength(1);
  });

  it('truncates oversized error text', () => {
    recordOperationAttempt(db, {
      opType: 'REDEMPTION',
      target: 'NO0012345678',
      status: 'FAILED',
      txHash: null,
      error: 'x'.repeat(2000),
      detail: null,
    });
    expect((listOperationAttempts(db)[0].error as string).length).toBe(500);
  });

  it('survives a schema migration (system-of-record, not projection)', () => {
    recordOperationAttempt(db, {
      opType: 'BOND_CREATE',
      target: 'NO0012345678',
      status: 'SUCCEEDED',
      txHash: '0xhash',
      error: null,
      detail: null,
    });
    // Force the migration path on next open: pretend the on-disk schema
    // is ancient. migrateToCurrentVersion drops every projection table —
    // operation_attempts must not be among them.
    db.pragma('user_version = 0');
    db.close();

    const reopened = openDatabase({ dbPath }) as ClosableIngestionDatabase;
    try {
      const rows = listOperationAttempts(reopened);
      expect(rows).toHaveLength(1);
      expect(rows[0].op_type).toBe('BOND_CREATE');
      // ...and the projection really was dropped/recreated (empty).
      const bondEvents = reopened.prepare('SELECT COUNT(*) AS n FROM bond_events').get() as {
        n: number;
      };
      expect(bondEvents.n).toBe(0);
    } finally {
      reopened.close();
    }
  });

  describe('withOperationRecording', () => {
    it('records SUCCEEDED with the extracted tx hash and returns the result', async () => {
      const result = await withOperationRecording(
        {
          db,
          opType: 'WNOK_TRANSFER',
          target: '0xto',
          detail: { amount: '5' },
          txHashOf: (r: { hash: string }) => r.hash,
        },
        async () => ({ hash: '0xsent' }),
      );
      expect(result.hash).toBe('0xsent');
      const [row] = listOperationAttempts(db);
      expect(row.status).toBe('SUCCEEDED');
      expect(row.tx_hash).toBe('0xsent');
      expect(row.error).toBeNull();
    });

    it('records a decoded custom-error revert and rethrows', async () => {
      const iface = new Interface(['error CouponNotReady()']);
      const revertData = iface.encodeErrorResult('CouponNotReady', []);
      const err = Object.assign(new Error('execution reverted'), { data: revertData });

      await expect(
        withOperationRecording(
          { db, opType: 'COUPON_PAYMENT', target: 'NO0012345678', interfaces: [iface] },
          async () => {
            throw err;
          },
        ),
      ).rejects.toThrow('execution reverted');

      const [row] = listOperationAttempts(db);
      expect(row.status).toBe('REVERTED');
      expect(row.error).toContain('CouponNotReady');
      expect(row.tx_hash).toBeNull();
    });

    it('records FAILED for non-revert errors', async () => {
      await expect(
        withOperationRecording({ db, opType: 'TBD_MINT', target: '0xtbd' }, async () => {
          throw new Error('connect ECONNREFUSED');
        }),
      ).rejects.toThrow('ECONNREFUSED');

      const [row] = listOperationAttempts(db);
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('ECONNREFUSED');
    });

    it('never lets a recording failure break the operation', async () => {
      const brokenDb = {
        prepare: () => {
          throw new Error('disk on fire');
        },
      } as unknown as IngestionDatabase;
      const result = await withOperationRecording(
        { db: brokenDb, opType: 'BOND_CREATE', target: 'NO1' },
        async () => 'ok',
      );
      expect(result).toBe('ok');
    });
  });

  describe('toOperationAttemptDto', () => {
    it('maps a row to the wire shape with parsed detail', async () => {
      const { toOperationAttemptDto } = await import('../src/operations');
      recordOperationAttempt(db, {
        opType: 'TBD_TRANSFER',
        target: '0xtbd',
        status: 'SUCCEEDED',
        txHash: '0xsent',
        error: null,
        detail: { to: '0xto', amount: '7' },
      });
      const dto = toOperationAttemptDto(listOperationAttempts(db)[0]);
      expect(dto).toMatchObject({
        opType: 'TBD_TRANSFER',
        target: '0xtbd',
        status: 'SUCCEEDED',
        txHash: '0xsent',
        error: null,
        detail: { to: '0xto', amount: '7' },
      });
      expect(typeof dto.id).toBe('number');
      expect(typeof dto.createdAt).toBe('number');
    });

    it('tolerates corrupt detail JSON', async () => {
      const { toOperationAttemptDto } = await import('../src/operations');
      const dto = toOperationAttemptDto({
        id: 1,
        op_type: 'BOND_CREATE',
        target: 'NO1',
        status: 'FAILED',
        tx_hash: null,
        error: 'x',
        detail: '{not json',
        created_at: 1,
      });
      expect(dto.detail).toBeNull();
    });
  });

  describe('classifyFailure', () => {
    it('classifies a mined-but-reverted CallException with its receipt hash', () => {
      const err = Object.assign(new Error('transaction execution reverted'), {
        code: 'CALL_EXCEPTION',
        receipt: { hash: '0xmined' },
      });
      const out = classifyFailure(err, []);
      expect(out.status).toBe('REVERTED');
      expect(out.txHash).toBe('0xmined');
    });

    it('classifies transport errors as FAILED with no hash', () => {
      const out = classifyFailure(new Error('timeout'), []);
      expect(out).toEqual({ status: 'FAILED', error: 'timeout', txHash: null });
    });
  });
});
