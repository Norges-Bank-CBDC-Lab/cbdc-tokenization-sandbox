/**
 * bondsApi — public API surface for bond resources.
 *
 * Components and hooks import THIS module — never httpClient or mockClient
 * directly. Selection between mock and real backend is made per call from
 * AppConfig.USE_MOCK.
 */
import { AppConfig } from '../config.js';
import { HttpClient } from './httpClient.js';
import { MockClient } from './mockClient.js';

const isMockMode = () => AppConfig.USE_MOCK;

async function listBonds() {
  if (isMockMode()) return MockClient.listBonds();
  return HttpClient.get('/v1/bonds');
}

async function getBond(isin) {
  if (isMockMode()) return MockClient.getBond(isin);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}`);
}

async function getBondHolders(isin) {
  if (isMockMode()) return MockClient.getBondHolders(isin);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}/holders`);
}

async function getBondHistory(isin) {
  if (isMockMode()) return MockClient.getBondHistory(isin);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}/history`);
}

async function payCoupon(isin, holders) {
  const body = { holders };
  if (isMockMode()) return MockClient.payCoupon(isin, body);
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/coupon-payments`, body);
}

async function redeem(isin, holders) {
  const body = { holders };
  if (isMockMode()) return MockClient.redeem(isin, body);
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/redemptions`, body);
}

export const BondsApi = {
  listBonds,
  getBond,
  getBondHolders,
  getBondHistory,
  payCoupon,
  redeem,
};
