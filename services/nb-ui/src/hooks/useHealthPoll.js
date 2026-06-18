/**
 * useHealthPoll — shared poller for /v1/health.
 *
 * The top-bar HealthBadge and the NetworkHealthModal share one fetch +
 * cleanup here so both surfaces stay in sync and no timers leak.
 *
 *  - On fetch failure the state collapses to a synthetic `down` payload so
 *    the UI always has a consistent shape to render.
 *  - `reload()` re-fetches immediately and clears any backoff — used by the
 *    modal's Refresh button and after a Reconnect submit so the operator sees
 *    the post-restart state right away.
 *
 * Two traffic-shaping behaviours keep the poll from being wasteful once the
 * UI runs behind a shared gateway (harmless locally, but a tab left open all
 * day would otherwise hit the backend every interval forever):
 *
 *  - Page Visibility gating — while the tab is hidden the poll is paused
 *    entirely; focusing the tab probes once immediately and resumes.
 *  - Exponential backoff — while the backend is `down`/unreachable the poll
 *    interval doubles (up to MAX_BACKOFF_INTERVAL_MS) instead of hammering a
 *    dead endpoint at full cadence, then snaps back to base on recovery or a
 *    manual reload().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HealthApi } from '../api/healthApi.js';

export const DEFAULT_POLL_INTERVAL_MS = 7000;
export const MAX_BACKOFF_INTERVAL_MS = 60000;

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

// `down` (or a missing payload) is the only state we back off on; `degraded`
// is still reachable, so we keep watching it at the base cadence.
function isReachable(payload) {
  return payload != null && payload.status !== 'down';
}

export function useHealthPoll({ intervalMs = DEFAULT_POLL_INTERVAL_MS, enabled = true } = {}) {
  const [health, setHealth] = useState(null);
  const mountedRef = useRef(true);
  const failuresRef = useRef(0);
  const scheduleRef = useRef(null);

  // Never throws; returns whether the probe reached a non-`down` backend so
  // the scheduler can grow or reset the backoff.
  const fetchOnce = useCallback(async () => {
    try {
      const next = await HealthApi.getHealth();
      if (mountedRef.current) setHealth(next);
      return isReachable(next);
    } catch {
      if (mountedRef.current) setHealth(DOWN_SHAPE);
      return false;
    }
  }, []);

  // Manual refresh: clear backoff, probe now, and re-arm at the base cadence.
  const reload = useCallback(async () => {
    failuresRef.current = 0;
    const reachable = await fetchOnce();
    scheduleRef.current?.();
    return reachable;
  }, [fetchOnce]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return undefined;

    let cancelled = false;
    let timer = null;

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const nextDelay = () => {
      const factor = 2 ** Math.min(failuresRef.current, 10);
      return Math.min(intervalMs * factor, MAX_BACKOFF_INTERVAL_MS);
    };

    const schedule = () => {
      clearTimer();
      // A hidden tab makes no requests; visibilitychange resumes it.
      if (cancelled || document.hidden) return;
      timer = setTimeout(tick, nextDelay());
    };

    const tick = async () => {
      const reachable = await fetchOnce();
      if (cancelled) return;
      failuresRef.current = reachable ? 0 : failuresRef.current + 1;
      schedule();
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      // Back in view: reset backoff, probe immediately, resume the loop.
      failuresRef.current = 0;
      void fetchOnce();
      schedule();
    };

    scheduleRef.current = schedule;

    // Defer the initial probe one microtask so the lint rule that forbids
    // sync setState-via-effect is satisfied (the effect body itself never
    // calls setHealth synchronously). Skip it while the tab is hidden.
    Promise.resolve().then(() => {
      if (!cancelled && !document.hidden) void fetchOnce();
    });
    // Arm the recurring timer eagerly — independent of the first probe's
    // resolution — then keep it alive across tab focus changes.
    schedule();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimer();
      scheduleRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, fetchOnce]);

  return { health, reload };
}
