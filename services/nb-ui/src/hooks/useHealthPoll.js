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
 *  - Adaptive cadence — healthy state is checked once a minute because SSE
 *    owns resource freshness. Degraded state is checked more frequently so a
 *    resync remains visible, while an unreachable backend backs off to the
 *    healthy cadence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HealthApi } from '../api/healthApi.js';

export const DEFAULT_POLL_INTERVAL_MS = 60000;
export const DEGRADED_POLL_INTERVAL_MS = 10000;
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

function probeStatus(payload) {
  if (payload?.status === 'ok' || payload?.status === 'degraded') return payload.status;
  return 'down';
}

export function useHealthPoll({
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  degradedIntervalMs = DEGRADED_POLL_INTERVAL_MS,
  enabled = true,
} = {}) {
  const [health, setHealth] = useState(null);
  const mountedRef = useRef(true);
  const failuresRef = useRef(0);
  const statusRef = useRef('ok');
  const scheduleRef = useRef(null);

  // Never throws; returns the scheduling state derived from the response.
  const fetchOnce = useCallback(async () => {
    try {
      const next = await HealthApi.getHealth();
      if (mountedRef.current) setHealth(next);
      return probeStatus(next);
    } catch {
      if (mountedRef.current) setHealth(DOWN_SHAPE);
      return 'down';
    }
  }, []);

  const recordProbe = useCallback((status) => {
    statusRef.current = status;
    failuresRef.current = status === 'down' ? failuresRef.current + 1 : 0;
  }, []);

  // Manual refresh: probe now and re-arm from the newly observed state.
  const reload = useCallback(async () => {
    failuresRef.current = 0;
    const status = await fetchOnce();
    recordProbe(status);
    scheduleRef.current?.();
    return status !== 'down';
  }, [fetchOnce, recordProbe]);

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
      if (statusRef.current === 'ok') return intervalMs;
      if (statusRef.current === 'degraded') return degradedIntervalMs;

      const exponent = Math.max(0, failuresRef.current - 1);
      const factor = 2 ** Math.min(exponent, 10);
      return Math.min(degradedIntervalMs * factor, MAX_BACKOFF_INTERVAL_MS);
    };

    const schedule = () => {
      clearTimer();
      // A hidden tab makes no requests; visibilitychange resumes it.
      if (cancelled || document.hidden) return;
      timer = setTimeout(tick, nextDelay());
    };

    const tick = async () => {
      const status = await fetchOnce();
      if (cancelled) return;
      recordProbe(status);
      schedule();
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      // Back in view: reset backoff, probe immediately, then resume using the
      // state-specific cadence.
      failuresRef.current = 0;
      void tick();
    };

    scheduleRef.current = schedule;

    // Defer the initial probe one microtask so the lint rule that forbids
    // sync setState-via-effect is satisfied (the effect body itself never
    // calls setHealth synchronously). Skip it while the tab is hidden.
    Promise.resolve().then(() => {
      if (!cancelled && !document.hidden) void tick();
    });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimer();
      scheduleRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [degradedIntervalMs, enabled, intervalMs, fetchOnce, recordProbe]);

  return { health, reload };
}
