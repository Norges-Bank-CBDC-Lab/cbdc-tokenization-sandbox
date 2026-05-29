import { computeBuybackAllocation, computeUniformAllocation } from '../src/allocation';
import { AuctionType, UnsealedBid } from '../src/types';

const makeBid = (bidder: string, rate: string, units: string, bidIndex = 0): UnsealedBid => ({
  bidder,
  ciphertext: '0x',
  plaintextHash: '0x',
  plaintext: {
    isin: 'NO0000000000',
    bidder,
    nonce: '1',
    rate,
    units,
    salt: 'salt',
    bidderNonce: '1',
    bidderSig: '0x01',
  },
  ciphertextHash: '0x',
  bidIndex,
  usedWrap: 'auctioneer',
});

const addr = (n: number): string => '0x' + n.toString(16).padStart(40, '0');

describe('computeUniformAllocation', () => {
  it('allocates highest price bids first and applies uniform clearing rate', () => {
    const bids = [
      makeBid('0x0000000000000000000000000000000000000001', '110', '3'),
      makeBid('0x0000000000000000000000000000000000000002', '100', '6'),
      makeBid('0x0000000000000000000000000000000000000003', '90', '6'),
    ];

    const result = computeUniformAllocation('NO0000000000', AuctionType.PRICE, bids, 10n);

    expect(result.clearingRate).toBe(90n);
    expect(result.totalAllocated).toBe(10n);
    expect(result.allocations.map((a) => a.rate)).toEqual([90n, 90n, 90n]);
    expect(result.allocations.map((a) => a.units)).toEqual([3n, 6n, 1n]);
  });

  it('breaks ties by units for rate auctions', () => {
    const bids = [
      makeBid('0x0000000000000000000000000000000000000011', '100', '2'),
      makeBid('0x0000000000000000000000000000000000000012', '100', '3'),
    ];

    const result = computeUniformAllocation('NO0000000000', AuctionType.RATE, bids, 3n);

    expect(result.totalAllocated).toBe(3n);
    expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000012');
    expect(result.allocations[0].units).toBe(3n);
  });

  it('breaks ties by units for price auctions', () => {
    const bids = [
      makeBid('0x0000000000000000000000000000000000000013', '100', '2'),
      makeBid('0x0000000000000000000000000000000000000014', '100', '5'),
    ];

    const result = computeUniformAllocation('NO0000000000', AuctionType.PRICE, bids, 5n);

    expect(result.totalAllocated).toBe(5n);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000014');
    expect(result.allocations[0].units).toBe(5n);
  });

  it('rejects BUYBACK auction type', () => {
    expect(() => computeUniformAllocation('NO0000000000', AuctionType.BUYBACK, [], 1n)).toThrow(
      'use computeBuybackAllocation for BUYBACK auctions',
    );
  });

  it('rejects non-positive offering', () => {
    expect(() => computeUniformAllocation('NO0000000000', AuctionType.PRICE, [], 0n)).toThrow(
      'offering must be positive',
    );
  });
});

describe('computeBuybackAllocation', () => {
  it('allocates lowest price bids first', () => {
    const bids = [
      makeBid('0x0000000000000000000000000000000000000021', '95', '2'),
      makeBid('0x0000000000000000000000000000000000000022', '100', '3'),
      makeBid('0x0000000000000000000000000000000000000023', '90', '4'),
    ];

    const result = computeBuybackAllocation('NO0000000000', bids, 5n);

    expect(result.clearingRate).toBe(90n);
    expect(result.totalAllocated).toBe(5n);
    expect(result.allocations.map((a) => a.units)).toEqual([4n, 1n]);
  });

  it('breaks ties by units for buyback auctions', () => {
    const bids = [
      makeBid('0x0000000000000000000000000000000000000024', '90', '2'),
      makeBid('0x0000000000000000000000000000000000000025', '90', '4'),
    ];

    const result = computeBuybackAllocation('NO0000000000', bids, 4n);

    expect(result.totalAllocated).toBe(4n);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].bidder).toBe('0x0000000000000000000000000000000000000025');
    expect(result.allocations[0].units).toBe(4n);
  });

  it('rejects non-positive buyback size', () => {
    expect(() => computeBuybackAllocation('NO0000000000', [], 0n)).toThrow(
      'buyback size must be positive',
    );
  });
});

describe('computeUniformAllocation — winner subset (Design B finalisation)', () => {
  // Mirrors the real failing RATE auction PO9384674360: seven legitimate bids
  // plus one fat-finger 4500 bps / 1000-unit bid, offering 2000 units. The
  // bidIndex values match the on-chain sealed-bid order.
  const legitimate = [
    makeBid(addr(1), '325', '100', 0),
    makeBid(addr(2), '125', '50', 1),
    makeBid(addr(3), '425', '200', 2),
    makeBid(addr(4), '275', '90', 3),
    makeBid(addr(5), '348', '30', 4),
    makeBid(addr(7), '425', '600', 6),
    makeBid(addr(8), '374', '100', 7),
  ];
  const outlier = makeBid(addr(6), '4500', '1000', 5);
  const OFFERING = 2000n;

  it('clears at the marginal of the SELECTED bids, excluding the deselected outlier', () => {
    const result = computeUniformAllocation('NO0000000000', AuctionType.RATE, legitimate, OFFERING);
    expect(result.clearingRate).toBe(425n);
    expect(result.allocations.every((a) => a.rate === 425n)).toBe(true);
    expect(result.allocations.some((a) => a.bidder === addr(6))).toBe(false);
  });

  it('would clear at the outlier rate if the outlier were (wrongly) included', () => {
    const result = computeUniformAllocation(
      'NO0000000000',
      AuctionType.RATE,
      [...legitimate, outlier],
      OFFERING,
    );
    expect(result.clearingRate).toBe(4500n);
  });

  it("propagates each selected bid's on-chain bidIndex onto its allocation", () => {
    const result = computeUniformAllocation('NO0000000000', AuctionType.RATE, legitimate, OFFERING);
    const selectedIndexes = new Set(legitimate.map((b) => b.bidIndex));
    expect(result.allocations.length).toBeGreaterThan(0);
    expect(result.allocations.every((a) => typeof a.bidIndex === 'number')).toBe(true);
    expect(result.allocations.every((a) => selectedIndexes.has(a.bidIndex))).toBe(true);
  });

  it('keeps distinct bidIndex values for two bids from the same bidder', () => {
    const dup = addr(9);
    const bids = [makeBid(dup, '100', '3', 0), makeBid(dup, '200', '3', 1)];
    const result = computeUniformAllocation('NO0000000000', AuctionType.RATE, bids, 6n);
    expect([...result.allocations.map((a) => a.bidIndex)].sort()).toEqual([0, 1]);
  });
});
