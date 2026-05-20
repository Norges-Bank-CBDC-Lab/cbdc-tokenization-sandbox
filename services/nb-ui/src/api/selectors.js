/**
 * Selectors over the bulky-tree cache.
 *
 * The frontend's primary cache is the Bond[] returned by
 * BondsApi.listBonds(). Pages slice from that tree instead of calling
 * per-feature endpoints — `selectBond`, `selectAuction`, etc. are pure
 * functions that walk the cached structure.
 *
 * Use the `md5` field on any DTO to short-circuit re-renders:
 * `cached.auctions[i].md5 === fresh.auctions[i].md5` ⇒ no change.
 */

/** Find a bond by ISIN in a list of bonds. */
export function selectBond(bonds, isin) {
  if (!Array.isArray(bonds)) return null;
  return bonds.find((b) => b.isin === isin) ?? null;
}

/**
 * Find an auction within a bonds tree by (isin, auctionId).
 * If `isin` is null, scans all bonds.
 */
export function selectAuction(bonds, isin, auctionId) {
  if (!Array.isArray(bonds)) return null;
  const pool = isin ? bonds.filter((b) => b.isin === isin) : bonds;
  for (const b of pool) {
    const hit = b.auctions?.find((a) => a.id === auctionId);
    if (hit) return hit;
  }
  return null;
}

/** Find an auction in a flat Auction[] list. */
export function selectAuctionInList(auctions, auctionId) {
  if (!Array.isArray(auctions)) return null;
  return auctions.find((a) => a.id === auctionId) ?? null;
}

/** All auctions across all bonds, flat. */
export function selectAllAuctions(bonds) {
  if (!Array.isArray(bonds)) return [];
  return bonds.flatMap((b) => b.auctions ?? []);
}

/** Holders for a bond. Returns [] if bond missing. */
export function selectHolders(bonds, isin) {
  return selectBond(bonds, isin)?.holders ?? [];
}

/** Bids for a (isin, auctionId). Returns [] if auction missing. */
export function selectBids(bonds, isin, auctionId) {
  return selectAuction(bonds, isin, auctionId)?.bids ?? [];
}

/** Allocation for a (isin, auctionId). Null if missing or not computed. */
export function selectAllocation(bonds, isin, auctionId) {
  return selectAuction(bonds, isin, auctionId)?.allocation ?? null;
}

/** Latest transaction across the auction's lifecycle, for status banners. */
export function selectLatestAuctionTx(auction) {
  if (!auction?.txs) return null;
  const candidates = [auction.txs.cancel, auction.txs.finalise, auction.txs.close, auction.txs.create].filter(
    Boolean,
  );
  return candidates[0] ?? null;
}
