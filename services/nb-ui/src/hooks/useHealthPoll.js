/**
 * useHealthPoll — shared polling hook for /v1/health.
 *
 * The top-bar HealthBadge and the NetworkHealthModal both poll the
 * same endpoint at the same cadence; centralising the fetch + cleanup
 * here keeps both surfaces in sync and avoids leaking timers.
 *
 *  - On fetch failure the state collapses to a synthetic `down` payload
 *    so the UI always has a consistent shape to render.
 *  - `reload()` re-fetches immediately without waiting for the next
 *    interval tick — used by the modal's Refresh button and after a
 *    Reconnect submit so the operator sees the post-restart state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HealthApi } from '../api/healthApi.js';

export const DEFAULT_POLL_INTERVAL_MS = 7000;

const DOWN_SHAPE = Object.freeze({
  status: 'down',
  contracts: {
    bondManager: '0x0000000000000000000000000000000000000000',
    bondAuction: '0x0000000000000000000000000000000000000000',
    bondToken: '0x0000000000000000000000000000000000000000',
    wnok: null,
  },
  sealingPubKey: '0x',
  chain: { rpcUrl: '', chainId: null, head: null, headReachable: false },
  ingestion: {
    loopRunning: false,
    lastBlockProcessed: null,
    lag: null,
    pollIntervalMs: 0,
    lastTickAt: null,
    lastEventTxHash: null,
    consecutiveFailures: 0,
    recentErrors: [],
  },
});

export function useHealthPoll({ intervalMs = DEFAULT_POLL_INTERVAL_MS, enabled = true } = {}) {
  const [health, setHealth] = useState(null);
  const mountedRef = useRef(true);

  const fetchOnce = useCallback(async () => {
    try {
      const next = await HealthApi.getHealth();
      if (mountedRef.current) setHealth(next);
    } catch {
      if (mountedRef.current) setHealth(DOWN_SHAPE);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return undefined;
    // Defer the initial fetch one microtask so the lint rule that
    // forbids sync setState-via-effect is satisfied — the effect body
    // itself doesn't invoke setHealth synchronously.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void fetchOnce();
    });
    const timer = setInterval(fetchOnce, intervalMs);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, fetchOnce]);

  return { health, reload: fetchOnce };
}
