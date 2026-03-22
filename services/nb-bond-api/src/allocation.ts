import { AbiCoder, keccak256 } from 'ethers';
import { Allocation, AllocationResult, AuctionType, UnsealedBid } from './types';
import { parseBigInt, parsePositiveBigInt } from './parsing';
import { auctionTypeToString } from './utils';

const coder = AbiCoder.defaultAbiCoder();

export type AllocationTupleInput = {
  isin: string;
  bidder: string;
  units?: unknown;
  rate?: unknown;
  auctionType?: unknown;
};

// Spec ordering: RATE and BUYBACK prefer the lowest rate, PRICE prefers the highest.
const AUCTION_RATE_ORDER: Record<AuctionType, 'lower' | 'higher'> = {
  [AuctionType.RATE]: 'lower',
  [AuctionType.PRICE]: 'higher',
  [AuctionType.BUYBACK]: 'lower',
};

export function computeUniformAllocation(
  isin: string,
  auctionType: AuctionType,
  bids: UnsealedBid[],
  offeringUnits: bigint,
): AllocationResult {
  if (auctionType === AuctionType.BUYBACK) {
    throw new Error('use computeBuybackAllocation for BUYBACK auctions');
  }
  if (offeringUnits <= 0n) {
    throw new Error('offering must be positive');
  }

  const sorted = sortBidsByAuctionType(bids, auctionType);

  let remaining = offeringUnits;
  const allocations: Allocation[] = [];
  let clearingRate: bigint | null = null;
  let totalAllocated = 0n;

  for (const bid of sorted) {
    const units = parsePositiveBigInt(bid.plaintext.units, 'units');
    const rate = parsePositiveBigInt(bid.plaintext.rate, 'rate');

    if (remaining === 0n) {
      break;
    }

    const fill = units > remaining ? remaining : units;
    if (fill === 0n) {
      continue;
    }

    allocations.push({ isin, bidder: bid.bidder, units: fill, rate, auctionType });
    totalAllocated += fill;
    remaining -= fill;
    clearingRate = rate;
  }

  if (allocations.length === 0 || clearingRate === null) {
    throw new Error('no allocatable bids');
  }

  const uniformAllocations: Allocation[] = allocations.map((a) => ({
    ...a,
    rate: clearingRate as bigint,
  }));

  const allocationHash = buildAllocationHash(isin, auctionType, clearingRate, uniformAllocations);

  return {
    clearingRate,
    auctionType,
    totalAllocated,
    allocations: uniformAllocations,
    allocationHash,
    computedAt: Date.now(),
  };
}

export function computeBuybackAllocation(
  isin: string,
  bids: UnsealedBid[],
  targetSize: bigint,
): AllocationResult {
  if (targetSize <= 0n) {
    throw new Error('buyback size must be positive');
  }

  const sorted = sortBidsByAuctionType(bids, AuctionType.BUYBACK);

  let remaining = targetSize;
  const allocations: Allocation[] = [];
  let totalAllocated = 0n;

  for (const bid of sorted) {
    if (remaining === 0n) {
      break;
    }
    const units = parsePositiveBigInt(bid.plaintext.units, 'units');
    const rate = parsePositiveBigInt(bid.plaintext.rate, 'rate');
    const fill = units > remaining ? remaining : units;
    if (fill === 0n) {
      continue;
    }
    allocations.push({
      isin,
      bidder: bid.bidder,
      units: fill,
      rate,
      auctionType: AuctionType.BUYBACK,
    });
    totalAllocated += fill;
    remaining -= fill;
  }

  if (allocations.length === 0) {
    throw new Error('no allocatable bids');
  }

  const clearingRate = allocations[0].rate; // lowest accepted price
  const allocationHash = buildAllocationHash(isin, AuctionType.BUYBACK, clearingRate, allocations);

  return {
    clearingRate,
    auctionType: AuctionType.BUYBACK,
    totalAllocated,
    allocations,
    allocationHash,
    computedAt: Date.now(),
  };
}

export function buildAllocationHash(
  isin: string,
  auctionType: AuctionType,
  clearingRate: bigint,
  allocations: Allocation[],
): string {
  const encoded = coder.encode(
    [
      'string',
      'uint8',
      'uint256',
      'tuple(address bidder, uint256 units, uint256 rate, uint8 auctionType)[]',
    ],
    [
      isin,
      auctionType,
      clearingRate,
      allocations.map((a) => [a.bidder, a.units, a.rate, auctionType]),
    ],
  );
  return keccak256(encoded);
}

export function formatAllocationResult(result: AllocationResult) {
  return {
    clearingRate: result.clearingRate.toString(),
    totalAllocated: result.totalAllocated.toString(),
    allocationHash: result.allocationHash,
    computedAt: result.computedAt,
    auctionType: auctionTypeToString(result.auctionType),
    allocations: result.allocations.map((a) => ({
      bidder: a.bidder,
      units: a.units.toString(),
      rate: a.rate.toString(),
      auctionType: auctionTypeToString(a.auctionType),
    })),
  };
}

export function formatAllocationTuple(tuple: AllocationTupleInput) {
  const unknownAuction = -1;
  const auctionTypeValue = ['bigint', 'string'].includes(typeof tuple.auctionType)
    ? Number(tuple.auctionType)
    : typeof tuple.auctionType === 'number'
      ? tuple.auctionType
      : unknownAuction;
  return {
    isin: tuple.isin,
    bidder: tuple.bidder,
    units: tuple.units ? parseBigInt(tuple.units, 'units').toString() : null,
    rate: tuple.rate ? parseBigInt(tuple.rate, 'rate').toString() : null,
    auctionType: auctionTypeToString(auctionTypeValue),
  };
}

function sortBidsByAuctionType(bids: UnsealedBid[], auctionType: AuctionType) {
  return [...bids].sort((a, b) =>
    compareBidPlaintextByAuctionType(
      a.plaintext.rate,
      a.plaintext.units,
      b.plaintext.rate,
      b.plaintext.units,
      auctionType,
    ),
  );
}

/**
 * Orders bids per spec: RATE/BUYBACK lowest first, PRICE highest first.
 * Ties on rate prefer larger units.
 */
function compareBidPlaintextByAuctionType(
  rateA: string,
  unitsA: string,
  rateB: string,
  unitsB: string,
  auctionType: AuctionType,
): number {
  const parsedRateA = parsePositiveBigInt(rateA, 'rate');
  const parsedRateB = parsePositiveBigInt(rateB, 'rate');

  const preferHigher = AUCTION_RATE_ORDER[auctionType] === 'higher';
  const better = preferHigher ? parsedRateB > parsedRateA : parsedRateA > parsedRateB;

  if (parsedRateA === parsedRateB) {
    const parsedUnitsA = parsePositiveBigInt(unitsA, 'units');
    const parsedUnitsB = parsePositiveBigInt(unitsB, 'units');
    return parsedUnitsB > parsedUnitsA ? 1 : parsedUnitsB < parsedUnitsA ? -1 : 0;
  }
  return better ? 1 : -1;
}
