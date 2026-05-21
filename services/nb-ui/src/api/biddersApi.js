/**
 * biddersApi — sandbox bidder roster + impersonated bid submission.
 *
 * Mirrors the v1 catalog in services/nb-bond-api/openapi.json under
 * the `bidders` tag. Like bondsApi/auctionsApi, this module switches
 * between mock and real backend based on AppConfig.USE_MOCK.
 *
 * Sandbox-only — see the SandboxOnlyBanner rendered on BiddersPage.
 */
import { AppConfig } from '../config.js';
import { HttpClient } from './httpClient.js';
import { MockClient } from './mockClient.js';

const isMockMode = () => AppConfig.USE_MOCK;

async function listBidders() {
  if (isMockMode()) return MockClient.listBidders();
  return HttpClient.get('/v1/bidders');
}

async function createBidder({ name, privateKey }) {
  const body = { name };
  if (privateKey) body.privateKey = privateKey;
  if (isMockMode()) return MockClient.createBidder(body);
  return HttpClient.post('/v1/bidders', body);
}

async function deleteBidder(address) {
  if (isMockMode()) return MockClient.deleteBidder(address);
  return HttpClient.del(`/v1/bidders/${encodeURIComponent(address)}`);
}

async function placeBid(address, { auctionId, units, rate }) {
  const body = { auctionId, units, rate };
  if (isMockMode()) return MockClient.placeBidderBid(address, body);
  return HttpClient.post(`/v1/bidders/${encodeURIComponent(address)}/bids`, body);
}

export const BiddersApi = {
  listBidders,
  createBidder,
  deleteBidder,
  placeBid,
};
