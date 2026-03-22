import { AuctionCache } from './types';

// TODO: swap out the in-memory store.

const auctionsById = new Map<string, AuctionCache>();
const isinToAuctionIds = new Map<string, Set<string>>();

function indexAuctionId(auctionId: string, isin: string) {
  const existing = isinToAuctionIds.get(isin) ?? new Set<string>();
  existing.add(auctionId);
  isinToAuctionIds.set(isin, existing);
}

export function getAuctionById(auctionId: string): AuctionCache | undefined {
  return auctionsById.get(auctionId);
}

export function getAuctionsByIsin(isin: string): AuctionCache[] {
  const ids = isinToAuctionIds.get(isin);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => auctionsById.get(id))
    .filter(Boolean) as AuctionCache[];
}

export function upsertAuction(auctionId: string, patch: Partial<AuctionCache>): AuctionCache {
  const existing = auctionsById.get(auctionId) ?? { auctionId };
  const updated = { ...existing, ...patch, auctionId };
  if (!updated.isin && patch.isin !== undefined) {
    updated.isin = patch.isin;
  }
  auctionsById.set(auctionId, updated);
  if (updated.isin) {
    indexAuctionId(auctionId, updated.isin);
  }
  return updated;
}

export function resetAuction(auctionId: string): void {
  const existing = auctionsById.get(auctionId);
  auctionsById.delete(auctionId);
  if (existing?.isin) {
    const ids = isinToAuctionIds.get(existing.isin);
    ids?.delete(auctionId);
    if (ids && ids.size === 0) {
      isinToAuctionIds.delete(existing.isin);
    }
  }
}

export function listAuctions(): AuctionCache[] {
  return Array.from(auctionsById.values());
}
