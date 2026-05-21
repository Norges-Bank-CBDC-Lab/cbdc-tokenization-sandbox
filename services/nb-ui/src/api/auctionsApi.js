/**
 * auctionsApi — auction-resource API surface.
 *
 * Maps to the v2 endpoint catalog (docs/plans/openapi-v2-plan.md §5):
 *   - PATCH /v1/auctions/{id} { status: "closed" }  → close
 *   - DELETE /v1/auctions/{id}                       → cancel
 *   - PUT /v1/auctions/{id}/finalisation             → approve/reject
 *
 * Mutations return the updated parent (Bond on create, Auction on
 * close/cancel/finalise) — the cache layer in httpClient drops stale
 * entries automatically.
 */
import { AppConfig } from '../config.js';
import { HttpClient, NotImplementedError } from './httpClient.js';
import { MockClient } from './mockClient.js';
import { getTestMode } from '../utils/debugSettings.js';

const isMockMode = () => AppConfig.USE_MOCK;

function testModeQuery() {
  return getTestMode() ? { testMode: 'true' } : {};
}

async function listAuctions() {
  if (isMockMode()) return MockClient.listAuctions();
  return HttpClient.get('/v1/auctions', { query: testModeQuery() });
}

async function getAuction(auctionId) {
  if (isMockMode()) return MockClient.getAuction(auctionId);
  return HttpClient.get(`/v1/auctions/${encodeURIComponent(auctionId)}`, {
    query: testModeQuery(),
  });
}

async function createAuction(isin, payload) {
  if (isMockMode()) return MockClient.createAuction(isin, payload);
  // Server returns the updated parent Bond with the new auction in
  // its `auctions[]` array.
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/auctions`, payload);
}

async function closeAuction(auctionId) {
  if (isMockMode()) return MockClient.closeAuction(auctionId);
  return HttpClient.patch(
    `/v1/auctions/${encodeURIComponent(auctionId)}`,
    { status: 'closed' },
    { query: testModeQuery() },
  );
}

async function cancelAuction(auctionId) {
  if (isMockMode()) return MockClient.cancelAuction(auctionId);
  return HttpClient.del(`/v1/auctions/${encodeURIComponent(auctionId)}`);
}

/**
 * Reopen a closed auction. NOT in the v2 spec and not supported on
 * the BondAuction contract (no closed→open transition). Mock fakes
 * it for UI prototyping; real client throws NotImplementedError so
 * the UI can show a clear "reopen unsupported" toast.
 */
async function reopenAuction(auctionId) {
  if (isMockMode()) return MockClient.reopenAuction(auctionId);
  throw new NotImplementedError(
    'Reopen auction is not implemented in the backend — see docs/KNOWN_ISSUES.md.',
  );
}

/**
 * Finalise the auction.
 *
 * @param {string} auctionId
 * @param {string} allocationHash
 * @param {boolean} approve
 * @param {number[]=} winners - mock-only: operator-selected winning
 *   bid indices. The real backend computes the allocation server-side
 *   and ignores this field.
 */
async function finaliseAuction(auctionId, allocationHash, approve, winners) {
  const body = { allocationHash, approve };
  if (isMockMode()) return MockClient.finaliseAuction(auctionId, { ...body, winners });
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
