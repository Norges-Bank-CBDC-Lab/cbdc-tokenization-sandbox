/**
 * Test-mode toggle — operator-side umbrella switch for sandbox-only
 * affordances. Persisted in localStorage so it survives page reloads
 * but stays per-browser.
 *
 * Today the toggle controls:
 *  - Unsealing of bids on still-open auctions (operator preview during
 *    the BIDDING phase).
 *  - Skipping the API-side end-time pre-check on close, so the operator
 *    can attempt close before the bidding window expires (the chain
 *    contract still enforces it and reverts with `InBidPhase()`).
 *
 * Future test affordances should hang off the same toggle — read via
 * `getTestMode()` from any API module, append `?testMode=true` to the
 * relevant requests, and the backend's `parseTestMode(req)` will pick
 * it up.
 *
 * Sandbox-only. ArgoCD-managed deployments should ignore this flag.
 */
const LS_KEY = 'nbui.testMode';

const listeners = new Set();

export function getTestMode() {
  try {
    return window.localStorage.getItem(LS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTestMode(value) {
  try {
    if (value) {
      window.localStorage.setItem(LS_KEY, 'true');
    } else {
      window.localStorage.removeItem(LS_KEY);
    }
  } catch {
    // ignore — incognito / blocked localStorage just means the toggle
    // is forgotten on reload, which is fine.
  }
  for (const fn of listeners) fn(Boolean(value));
}

export function subscribeTestMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
