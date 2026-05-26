/**
 * auctionsApi — auction-resource API surface.
 *
 * Maps to the v2 endpoint catalog (docs/plans/archive/openapi-v2-plan.md §5):
 *   - PATCH /v1/auctions/{id} { status: "closed" }  → close
 *   - DELETE /v1/auctions/{id}                       → cancel
 *   - PUT /v1/auctions/{id}/finalisation             → approve/reject
 *
 * Mutations return the updated parent (Bond on create, Auction on
 * close/cancel/finalise) — the cache layer in httpClient drops stale
 * entries automatically.
 */
import { HttpClient, NotImplementedError } from './httpClient.js';
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
 * Reopen a closed auction. NOT in the v2 spec and not supported on
 * the BondAuction contract (no closed→open transition). Throws
 * NotImplementedError so the UI can show a clear "reopen unsupported"
 * toast — see docs/KNOWN_ISSUES.md.
 */
async function reopenAuction(_auctionId) {
  throw new NotImplementedError(
    'Reopen auction is not implemented in the backend — see docs/KNOWN_ISSUES.md.',
  );
}

async function finaliseAuction(auctionId, allocationHash, approve) {
  const body = { allocationHash, approve };
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
  reopenAuction,
  finaliseAuction,
};
