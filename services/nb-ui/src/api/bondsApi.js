/**
 * bondsApi — bond-resource API surface.
 *
 * The backend serves a bulky resource tree: a single GET /v1/bonds
 * returns every bond with its auctions, bids, allocations, and
 * holders. Pages slice from this tree via selectors rather than
 * calling per-feature endpoints.
 *
 * Components import THIS module — never httpClient directly.
 */
import { HttpClient } from './httpClient.js';
import { getTestMode } from '../utils/debugSettings.js';

function testModeQuery() {
  return getTestMode() ? { testMode: 'true' } : {};
}

async function listBonds({ includeDisabled = false } = {}) {
  const query = testModeQuery();
  if (includeDisabled) query.includeDisabled = 'true';
  return HttpClient.get('/v1/bonds', { query });
}

async function getBond(isin) {
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}`, { query: testModeQuery() });
}

async function createBond({ isin, maturityDuration }) {
  // Standalone bond create — no auction. The operator schedules the first
  // auction from BondDetailPage afterward (per the decoupled flow).
  return HttpClient.post('/v1/bonds', { isin, maturityDuration });
}

async function disableBond(isin) {
  // Idempotent soft-delete. Backend returns 204 on success or when the
  // bond is already disabled; HTTP 409 surfaces gate failures with a
  // structured problem+json body.
  return HttpClient.del(`/v1/bonds/${encodeURIComponent(isin)}`);
}

async function listBondHistory(isin, { before, limit } = {}) {
  const query = {};
  if (before != null) query.before = String(before);
  if (limit != null) query.limit = String(limit);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}/history`, { query });
}

async function payCoupon(isin, holders) {
  const body = { holders: holders ?? null };
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/coupon-payments`, body);
}

async function redeem(isin, holders) {
  const body = { holders: holders ?? null };
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/redemptions`, body);
}

export const BondsApi = {
  listBonds,
  getBond,
  createBond,
  disableBond,
  listBondHistory,
  payCoupon,
  redeem,
};
