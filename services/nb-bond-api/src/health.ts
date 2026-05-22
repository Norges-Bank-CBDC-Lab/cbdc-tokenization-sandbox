/**
 * Pure helpers for the /v1/health endpoint. Kept in their own module so
 * status derivation can be unit-tested without spinning up the express
 * app, the provider, or the ingestion DB.
 */
import type { IngestionStatus } from './ingestion';

export type ChainProbe = {
  chainId: number | null;
  head: number | null;
  headReachable: boolean;
};

export type DerivedStatus = 'ok' | 'degraded' | 'down';

const LAG_DEGRADED_BLOCKS = 5;
const STALE_DEGRADED_MS = 30_000;
const STALE_DOWN_MS = 60_000;

/**
 * Render the configured RPC URL into a form safe to expose via /v1/health.
 * Strips credentials, query string, and path — keeps just `protocol//host[:port]`.
 *
 * Falls back to the literal input when URL parsing fails so the handler
 * never surfaces 500s on a malformed env var.
 */
export function sanitiseRpcUrl(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return rpcUrl;
  }
}

/**
 * Derive the three-state health status from the chain probe + ingestion
 * snapshot. Thresholds documented inline.
 *
 *  - `down` — chain unreachable, OR loop never started, OR last tick > 60s ago.
 *  - `degraded` — on-chain healthy but ingestion is lagging by >5 blocks,
 *    has consecutive failures, or hasn't ticked in >30s.
 *  - `ok` — everything within thresholds.
 */
export function deriveStatus(
  chain: ChainProbe,
  ingestion: IngestionStatus,
  now: number = Date.now(),
): DerivedStatus {
  if (!chain.headReachable) return 'down';
  if (!ingestion.loopRunning) return 'down';
  if (ingestion.lastTickAt !== null && now - ingestion.lastTickAt > STALE_DOWN_MS) return 'down';

  const lag =
    chain.head !== null && ingestion.lastBlockProcessed !== null
      ? chain.head - ingestion.lastBlockProcessed
      : null;
  if (lag !== null && lag > LAG_DEGRADED_BLOCKS) return 'degraded';
  if (ingestion.consecutiveFailures > 0) return 'degraded';
  if (ingestion.lastTickAt !== null && now - ingestion.lastTickAt > STALE_DEGRADED_MS)
    return 'degraded';
  return 'ok';
}

export function computeLag(chain: ChainProbe, ingestion: IngestionStatus): number | null {
  if (chain.head === null || ingestion.lastBlockProcessed === null) return null;
  return chain.head - ingestion.lastBlockProcessed;
}
