/**
 * mockData — in-memory fixtures for the v2 bond API.
 *
 * Shapes mirror the OpenAPI components/schemas exactly so callers cannot
 * tell whether they're talking to the mock or the real backend.
 *
 * Resource tree: Bond → auctions[] → bids[] + allocation + holders[].
 * Each cacheable DTO carries an `md5` (any non-empty string works for
 * mock — the real server computes it from canonical JSON).
 *
 * ISIN format: 12 chars Norwegian (e.g. NO0012345678).
 * BigIntString: always a decimal string, never a JS number.
 * Bps: bps with 1e4 precision (425 = 4.25%).
 */

export const now = () => Math.floor(Date.now() / 1000); // unix seconds
export const days = (n) => n * 86400;

export function randomHex(bytes) {
  const chars = '0123456789abcdef';
  let out = '0x';
  for (let i = 0; i < bytes * 2; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

export const makeAuctionId = () => randomHex(32);
export const makeAddress = () => randomHex(20);

let mockMd5Counter = 0;
export function mockMd5() {
  // Mock md5 — opaque to the UI, used for cache-key equality. A monotonic
  // counter is good enough; the real backend hashes canonical JSON.
  mockMd5Counter += 1;
  return `mockmd5-${mockMd5Counter.toString(16).padStart(8, '0')}`;
}

function makeTxRef() {
  return { hash: randomHex(32), block: 1_500_000 + Math.floor(Math.random() * 100_000) };
}

function makeContracts() {
  return { token: makeAddress(), auction: makeAddress(), manager: makeAddress() };
}

function makeHolder(balance) {
  return { holder: makeAddress(), balance, md5: mockMd5() };
}

function makeSealedBid() {
  return {
    bidder: makeAddress(),
    state: 'sealed',
    ciphertext: randomHex(64),
    plaintextHash: randomHex(32),
    md5: mockMd5(),
  };
}

function makeUnsealedBid() {
  return {
    bidder: makeAddress(),
    state: 'unsealed',
    rate: String(350 + Math.floor(Math.random() * 200)),
    units: String(50_000 + Math.floor(Math.random() * 500_000)),
    md5: mockMd5(),
  };
}

function makeAllocation(size, auctionType) {
  const entries = Array.from({ length: 5 }, () => ({
    bidder: makeAddress(),
    units: String(100_000 + Math.floor(Math.random() * 400_000)),
    rate: String(400 + Math.floor(Math.random() * 100)),
  }));
  return {
    clearingRate: '425',
    totalAllocated: size,
    hash: randomHex(32),
    auctionType,
    computedAt: Date.now(),
    entries,
    md5: mockMd5(),
  };
}

function makeAuction({ isin, type, status, end, size, bidCount = 8, finalisedAllocation = false }) {
  const isOpen = status === 'open';
  const bids = Array.from({ length: bidCount }, () =>
    isOpen ? makeSealedBid() : makeUnsealedBid(),
  );
  const allocation =
    !isOpen && bidCount > 0 ? makeAllocation(size, type) : null;
  return {
    id: makeAuctionId(),
    isin,
    type,
    status,
    end,
    size,
    maturityDuration: type === 'RATE' ? String(days(365 * 5)) : null,
    owner: makeAddress(),
    sealingPubKey: randomHex(33),
    contracts: { auction: makeAddress(), token: makeAddress() },
    bids,
    allocation: finalisedAllocation ? allocation : (status === 'closed' ? allocation : allocation),
    txs: {
      create: makeTxRef(),
      close: status !== 'open' ? makeTxRef() : null,
      finalise: status === 'finalised' ? makeTxRef() : null,
      cancel: status === 'cancelled' ? makeTxRef() : null,
    },
    md5: mockMd5(),
  };
}

function makeBond(opts) {
  const { isin, status, totalSupply, couponYieldBps, paymentsMade, paymentsTotal, auctions } = opts;
  const couponDuration = String(days(365));
  return {
    isin,
    status,
    totalSupply,
    contracts: makeContracts(),
    maturity: {
      duration: String(days(365 * 5)),
      date: String(now() + days(365 * 4)),
      remaining: String(days(365 * 4)),
    },
    coupon: {
      duration: couponDuration,
      yieldBps: couponYieldBps,
      payments: {
        total: String(paymentsTotal),
        made: String(paymentsMade),
        remaining: String(Math.max(0, paymentsTotal - paymentsMade)),
      },
    },
    holders: [
      makeHolder('2500000'),
      makeHolder('1200000'),
      makeHolder('800000'),
      makeHolder('500000'),
    ],
    auctions,
    md5: mockMd5(),
  };
}

export const bonds = [
  makeBond({
    isin: 'NO0012345678',
    status: 'maturing',
    totalSupply: '5000000000',
    couponYieldBps: '425',
    paymentsTotal: 5,
    paymentsMade: 1,
    auctions: [
      makeAuction({
        isin: 'NO0012345678',
        type: 'RATE',
        status: 'finalised',
        end: String(now() - days(30)),
        size: '5000000',
        bidCount: 8,
        finalisedAllocation: true,
      }),
    ],
  }),
  makeBond({
    isin: 'NO0098765432',
    status: 'minting',
    totalSupply: '2500000000',
    couponYieldBps: '385',
    paymentsTotal: 10,
    paymentsMade: 0,
    auctions: [
      makeAuction({
        isin: 'NO0098765432',
        type: 'PRICE',
        status: 'open',
        end: String(now() + days(7)),
        size: '2500000',
        bidCount: 6,
      }),
    ],
  }),
  makeBond({
    isin: 'NO0011223344',
    status: 'matured',
    totalSupply: '1000000000',
    couponYieldBps: '275',
    paymentsTotal: 3,
    paymentsMade: 3,
    auctions: [],
  }),
];

export const helpers = {
  now,
  days,
  randomHex,
  makeAuctionId,
  makeAddress,
  mockMd5,
  makeAuction,
  makeBond,
};

export const store = { bonds, helpers };
