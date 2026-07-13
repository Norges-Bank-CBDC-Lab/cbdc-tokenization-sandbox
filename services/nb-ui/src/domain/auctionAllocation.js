import { parseUnsignedInteger } from './amounts.js';

function compareIntegers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Orders bids like the backend allocation engine:
 * PRICE highest-rate-first; RATE/BUYBACK lowest-rate-first; ties prefer
 * the larger number of units.
 */
export function compareAuctionBids(left, right, auctionType) {
  const leftRate = parseUnsignedInteger(left.rate, 'bid rate');
  const rightRate = parseUnsignedInteger(right.rate, 'bid rate');
  const rateOrder = compareIntegers(leftRate, rightRate);

  if (rateOrder !== 0) return auctionType === 'PRICE' ? -rateOrder : rateOrder;

  const leftUnits = parseUnsignedInteger(left.units, 'bid units');
  const rightUnits = parseUnsignedInteger(right.units, 'bid units');
  return -compareIntegers(leftUnits, rightUnits);
}

export function sortAuctionBids(bids, auctionType) {
  return [...bids].sort((left, right) => compareAuctionBids(left, right, auctionType));
}

/** Return original array positions selected to cover the offering. */
export function selectAuctionBidPositions(bids, auctionType, offering) {
  const capacity = parseUnsignedInteger(offering, 'offering');
  if (capacity === 0n) return new Set();

  const ranked = bids.map((bid, position) => ({ ...bid, position }));
  ranked.sort((left, right) => compareAuctionBids(left, right, auctionType));

  const selected = new Set();
  let accumulated = 0n;
  for (const bid of ranked) {
    if (accumulated >= capacity) break;
    selected.add(bid.position);
    accumulated += parseUnsignedInteger(bid.units, 'bid units');
  }
  return selected;
}

/** Marginal (last-filled) rate over the selected bids. */
export function marginalClearingRate(picked, auctionType, offering) {
  if (!picked || picked.length === 0) return 0n;

  let remaining = parseUnsignedInteger(offering, 'offering');
  if (remaining === 0n) return 0n;

  let clearingRate = 0n;
  for (const bid of sortAuctionBids(picked, auctionType)) {
    if (remaining === 0n) break;
    const units = parseUnsignedInteger(bid.units, 'bid units');
    if (units === 0n) continue;
    remaining -= units > remaining ? remaining : units;
    clearingRate = parseUnsignedInteger(bid.rate, 'bid rate');
  }
  return clearingRate;
}

export function summarizeAuctionSelection(picked, auctionType, offering) {
  const capacity = parseUnsignedInteger(offering, 'offering');
  const totalUnits = picked.reduce(
    (total, bid) => total + parseUnsignedInteger(bid.units, 'bid units'),
    0n,
  );

  return {
    count: picked.length,
    totalUnits,
    clearingRate: marginalClearingRate(picked, auctionType, capacity),
    overAllocated: capacity > 0n && totalUnits > capacity,
    underFilled: capacity > 0n && totalUnits < capacity,
  };
}
