/**
 * auctionsApi — public API surface for auction resources.
 *
 * UI imports THIS module. See bondsApi.js for the architectural contract.
 */
import { AppConfig } from '../config.js';
import { HttpClient, NotImplementedError } from './httpClient.js';
import { MockClient } from './mockClient.js';

const isMockMode = () => AppConfig.USE_MOCK;

async function listAllAuctions() {
  if (isMockMode()) return MockClient.listAllAuctions();
  return HttpClient.get('/v1/auctions');
}

async function listAuctionsForBond(isin) {
  if (isMockMode()) return MockClient.listAuctionsForBond(isin);
  return HttpClient.get(`/v1/bonds/${encodeURIComponent(isin)}/auctions`);
}

async function createAuction(isin, payload) {
  if (isMockMode()) return MockClient.createAuction(isin, payload);
  return HttpClient.post(`/v1/bonds/${encodeURIComponent(isin)}/auctions`, payload);
}

async function getAuctionStatus(auctionId) {
  if (isMockMode()) return MockClient.getAuctionStatus(auctionId);
  return HttpClient.get(`/v1/auctions/${encodeURIComponent(auctionId)}`);
}

async function getAuctionBids(auctionId) {
  if (isMockMode()) return MockClient.getAuctionBids(auctionId);
  return HttpClient.get(`/v1/auctions/${encodeURIComponent(auctionId)}/bids`);
}

async function getAuctionAllocations(auctionId) {
  if (isMockMode()) return MockClient.getAuctionAllocations(auctionId);
  return HttpClient.get(`/v1/auctions/${encodeURIComponent(auctionId)}/allocations`);
}

async function closeAuction(auctionId) {
  if (isMockMode()) return MockClient.closeAuction(auctionId);
  return HttpClient.post(`/v1/auctions/${encodeURIComponent(auctionId)}/close`);
}

/**
 * Reopen a closed auction. NOT in the current OpenAPI spec and not supported
 * by the BondAuction contract (it has no closed→open transition). The mock
 * fakes it for UI prototyping; the real client throws NotImplementedError so
 * the UI can show a clear "reopen unsupported" toast.
 *
 * Backend follow-up: see docs/KNOWN_ISSUES.md "nb-ui: reopenAuction needs
 * backend / on-chain support".
 */
async function reopenAuction(auctionId) {
  if (isMockMode()) return MockClient.reopenAuction(auctionId);
  throw new NotImplementedError(
    'Reopen auction is not implemented in the backend yet — see docs/KNOWN_ISSUES.md.',
  );
}

/**
 * Finalise the auction.
 *
 * @param {string} auctionId
 * @param {string} allocationHash
 * @param {boolean} approve
 * @param {number[]=} winners - operator-selected winning bid indices (mock only).
 *   The real backend computes the allocation server-side and ignores this
 *   field; the parameter is kept here so the UI doesn't have to know the
 *   difference. See docs/KNOWN_ISSUES.md "nb-ui: operator-selectable winners".
 */
async function finaliseAuction(auctionId, allocationHash, approve, winners) {
  const body = { allocationHash, approve, winners };
  if (isMockMode()) return MockClient.finaliseAuction(auctionId, body);
  return HttpClient.put(`/v1/auctions/${encodeURIComponent(auctionId)}/finalisation`, body);
}

async function cancelAuction(auctionId) {
  if (isMockMode()) return MockClient.cancelAuction(auctionId);
  return HttpClient.post(`/v1/auctions/${encodeURIComponent(auctionId)}/cancel`);
}

export const AuctionsApi = {
  listAllAuctions,
  listAuctionsForBond,
  createAuction,
  getAuctionStatus,
  getAuctionBids,
  getAuctionAllocations,
  closeAuction,
  reopenAuction,
  finaliseAuction,
  cancelAuction,
};
