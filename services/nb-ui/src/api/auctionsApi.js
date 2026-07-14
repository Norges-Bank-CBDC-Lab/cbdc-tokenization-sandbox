/**
 * auctionsApi — auction-resource API surface.
 *
 * Maps to the /v1 endpoint catalog (original design notes live in
 * docs/plans/archive/openapi-v2-plan.md §5):
 *   - PATCH /v1/auctions/{id} { status: "closed" }  → close
 *   - DELETE /v1/auctions/{id}                       → cancel
 *   - PUT /v1/auctions/{id}/finalisation             → approve selected allocation
 *
 * Mutations return the updated parent (Bond on create, Auction on
 * close/cancel/finalise) — the cache layer in httpClient drops stale
 * entries automatically.
 */
import { HttpClient } from './httpClient.js';
import { getTestMode } from '../utils/debugSettings.js';

function testModeQuery() {
  return getTestMode() ? { testMode: 'true' } : {};
}

async function listAuctions() {
  return HttpClient.get('/v1/auctions', { query: testModeQuery() });
}

async function getAuction(auctionId) {
  return HttpClient.get(`/v1/auctions/${encodeURIComponent(auctionId)}`, {
    query: testModeQuery(),
  });
}

async function createAuction(isin, payload) {
  // Server returns the updated parent Bond with the new auction in
  // its `auctions[]` array.
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/auctions`, payload);
}

async function closeAuction(auctionId) {
  return HttpClient.patch(
    `/v1/auctions/${encodeURIComponent(auctionId)}`,
    { status: 'closed' },
    { query: testModeQuery() },
  );
}

async function cancelAuction(auctionId) {
  return HttpClient.del(`/v1/auctions/${encodeURIComponent(auctionId)}`);
}

/**
 * Finalise an auction.
 *
 * Approve: pass { approve: true, winningBidIndexes, expectedClearingRate }.
 * Only the *selection* is sent — the backend re-fetches the sealed bids from
 * chain, recomputes the allocation + clearing rate over exactly those bids,
 * cross-checks `expectedClearingRate`, and submits. The operator's selection,
 * not the full close-time allocation, determines what is minted.
 *
 */
async function finaliseAuction(auctionId, { winningBidIndexes, expectedClearingRate }) {
  const body = { approve: true, winningBidIndexes, expectedClearingRate };
  return HttpClient.put(`/v1/auctions/${encodeURIComponent(auctionId)}/finalisation`, body, {
    query: testModeQuery(),
  });
}

export const AuctionsApi = {
  listAuctions,
  getAuction,
  createAuction,
  closeAuction,
  cancelAuction,
  finaliseAuction,
};
