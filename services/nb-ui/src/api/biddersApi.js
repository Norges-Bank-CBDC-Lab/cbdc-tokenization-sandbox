/**
 * biddersApi — sandbox bidder roster + impersonated bid submission.
 *
 * Mirrors the v1 catalog in services/nb-bond-api/openapi.json under
 * the `bidders` tag.
 *
 * Sandbox-only — see the SandboxOnlyBanner rendered on BiddersPage.
 */
import { HttpClient } from './httpClient.js';

async function listBidders() {
  return HttpClient.get('/v1/bidders');
}

async function createBidder({ name, privateKey }) {
  const body = { name };
  if (privateKey) body.privateKey = privateKey;
  return HttpClient.post('/v1/bidders', body);
}

async function deleteBidder(address) {
  return HttpClient.del(`/v1/bidders/${encodeURIComponent(address)}`);
}

async function placeBid(address, { auctionId, units, rate }) {
  const body = { auctionId, units, rate };
  return HttpClient.post(`/v1/bidders/${encodeURIComponent(address)}/bids`, body);
}

export const BiddersApi = {
  listBidders,
  createBidder,
  deleteBidder,
  placeBid,
};
