/**
 * bondsApi — bond-resource API surface.
 *
 * The backend serves a bulky resource tree: a single GET /v1/bonds
 * returns every bond with its auctions, bids, allocations, and
 * holders. Pages slice from this tree via selectors rather than
 * calling per-feature endpoints.
 *
 * Components import THIS module — never httpClient or mockClient
 * directly. Selection between mock and real backend is made per call
 * from AppConfig.USE_MOCK.
 */
import { AppConfig } from '../config.js';
import { HttpClient } from './httpClient.js';
import { MockClient } from './mockClient.js';
import { getTestMode } from '../utils/debugSettings.js';

const isMockMode = () => AppConfig.USE_MOCK;

function testModeQuery() {
  return getTestMode() ? { testMode: 'true' } : {};
}

async function listBonds() {
  if (isMockMode()) return MockClient.listBonds();
  return HttpClient.get('/v1/bonds', { query: testModeQuery() });
}

async function getBond(isin) {
  if (isMockMode()) return MockClient.getBond(isin);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}`, { query: testModeQuery() });
}

async function listBondHistory(isin, { before, limit } = {}) {
  if (isMockMode()) return MockClient.listBondHistory(isin, { before, limit });
  const query = {};
  if (before != null) query.before = String(before);
  if (limit != null) query.limit = String(limit);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}/history`, { query });
}

async function payCoupon(isin, holders) {
  const body = { holders: holders ?? null };
  if (isMockMode()) return MockClient.payCoupon(isin, body);
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/coupon-payments`, body);
}

async function redeem(isin, holders) {
  const body = { holders: holders ?? null };
  if (isMockMode()) return MockClient.redeem(isin, body);
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/redemptions`, body);
}

export const BondsApi = {
  listBonds,
  getBond,
  listBondHistory,
  payCoupon,
  redeem,
};
