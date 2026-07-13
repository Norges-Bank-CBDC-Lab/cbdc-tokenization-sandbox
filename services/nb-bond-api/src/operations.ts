import { Interface } from 'ethers';

import { describeRevert } from './chain';
import {
  IngestionDatabase,
  OperationAttemptRow,
  insertOperationAttemptRow,
  listOperationAttemptRows,
} from './ingestion-db';
import { type LiveResourceKey, publishLiveChange } from './live-events';

/**
 * Operator audit trail.
 *
 * Every operator-initiated on-chain operation is recorded in the
 * `operation_attempts` system-of-record table with its outcome. Reverts
 * mostly never reach the chain (gas estimation rejects them before
 * broadcast), so this table is the only durable record of failed
 * operator actions — see docs/plans/operator-audit-trail-design.md.
 *
 * Recording is record-and-rethrow: `withOperationRecording` never
 * changes what the caller (and therefore the HTTP client) sees.
 */

export const OPERATION_TYPES = [
  'BOND_CREATE',
  'BOND_DISABLE',
  'AUCTION_CREATE',
  'AUCTION_CLOSE',
  'AUCTION_CANCEL',
  'AUCTION_FINALISE',
  'COUPON_PAYMENT',
  'REDEMPTION',
  'BID_SUBMISSION',
  'WNOK_MINT',
  'WNOK_BURN',
  'WNOK_TRANSFER',
  'WNOK_ALLOWLIST_ADD',
  'WNOK_ALLOWLIST_REMOVE',
  'BANK_CREATE',
  'TBD_MINT',
  'TBD_BURN',
  'TBD_TRANSFER',
  'TBD_ALLOWLIST_ADD',
  'TBD_ALLOWLIST_REMOVE',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_STATUSES = ['SUCCEEDED', 'REVERTED', 'FAILED', 'PARTIAL'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

const MAX_ERROR_LENGTH = 500;

export interface RecordedOperation {
  opType: OperationType;
  target: string;
  status: OperationStatus;
  txHash: string | null;
  error: string | null;
  detail: Record<string, unknown> | null;
}

export function recordOperationAttempt(db: IngestionDatabase, op: RecordedOperation): void {
  insertOperationAttemptRow(db, {
    op_type: op.opType,
    target: op.target,
    status: op.status,
    tx_hash: op.txHash,
    error: op.error === null ? null : op.error.slice(0, MAX_ERROR_LENGTH),
    detail: op.detail === null ? null : JSON.stringify(op.detail),
    created_at: Math.floor(Date.now() / 1000),
  });
}

export function listOperationAttempts(db: IngestionDatabase, limit = 200): OperationAttemptRow[] {
  return listOperationAttemptRows(db, limit);
}

/** Wire shape of one audit-trail entry (matches `OperationAttempt` in schemas.ts). */
export interface OperationAttemptDto {
  id: number;
  opType: OperationType;
  target: string;
  status: OperationStatus;
  txHash: string | null;
  error: string | null;
  detail: Record<string, unknown> | null;
  createdAt: number;
}

export function toOperationAttemptDto(row: OperationAttemptRow): OperationAttemptDto {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail) as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }
  return {
    id: row.id,
    opType: row.op_type as OperationType,
    target: row.target,
    status: row.status as OperationStatus,
    txHash: row.tx_hash,
    error: row.error,
    detail,
    createdAt: row.created_at,
  };
}

/**
 * A mined-but-reverted transaction (rare: chain state changed between
 * gas estimation and mining) surfaces as an ethers CallException that
 * carries the receipt. Estimation-rejected sends carry no receipt —
 * there is nothing on-chain to point at.
 */
function minedRevertHash(err: unknown): string | null {
  const e = err as { receipt?: { hash?: unknown } };
  return typeof e?.receipt?.hash === 'string' ? e.receipt.hash : null;
}

function isCallException(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 'CALL_EXCEPTION';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export function classifyFailure(
  err: unknown,
  interfaces: Interface[],
): { status: OperationStatus; error: string; txHash: string | null } {
  const decoded = interfaces.length > 0 ? describeRevert(err, interfaces) : null;
  if (decoded) {
    return { status: 'REVERTED', error: decoded, txHash: minedRevertHash(err) };
  }
  if (isCallException(err)) {
    return { status: 'REVERTED', error: errorMessage(err), txHash: minedRevertHash(err) };
  }
  return { status: 'FAILED', error: errorMessage(err), txHash: null };
}

export interface OperationRecordingOptions<T> {
  db: IngestionDatabase;
  opType: OperationType;
  target: string;
  /** Small JSON payload (amounts as strings, counts — never key material). */
  detail?: Record<string, unknown>;
  /** Contract interfaces used to decode custom-error revert data. */
  interfaces?: Interface[];
  /** Extract the tx hash from a successful result (null when the op has no single tx). */
  txHashOf?: (result: T) => string | null;
  /** Non-projection resources made stale when the operation succeeds. */
  changedResources?: LiveResourceKey[];
}

/**
 * Run `fn`, record the outcome in the audit trail, and rethrow on
 * failure so existing error handling (ProblemDetails mapping) is
 * unchanged. Recording failures are logged-and-swallowed by design —
 * the trail must never break the operation it observes.
 */
export async function withOperationRecording<T>(
  opts: OperationRecordingOptions<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const base = {
    opType: opts.opType,
    target: opts.target,
    detail: opts.detail ?? null,
  };
  try {
    const result = await fn();
    safeRecord(opts.db, {
      ...base,
      status: 'SUCCEEDED',
      txHash: opts.txHashOf ? opts.txHashOf(result) : null,
      error: null,
    });
    if (opts.changedResources) publishLiveChange(opts.changedResources);
    return result;
  } catch (err) {
    const failure = classifyFailure(err, opts.interfaces ?? []);
    safeRecord(opts.db, {
      ...base,
      status: failure.status,
      txHash: failure.txHash,
      error: failure.error,
    });
    throw err;
  }
}

function safeRecord(db: IngestionDatabase, op: RecordedOperation): void {
  try {
    recordOperationAttempt(db, op);
    publishLiveChange(['operations']);
  } catch {
    // Swallow: an audit-trail write failure must not fail the operation.
    // (WAL-mode SQLite makes this effectively unreachable locally.)
  }
}
