/**
 * mockData — in-memory fixtures for the NB Bond Auction Service.
 *
 * Shapes mirror the OpenAPI components/schemas exactly so callers cannot
 * tell whether they're talking to the mock or the real backend.
 *
 * NOTE on ISIN format: real Norwegian ISINs are 12 chars (e.g. NO0012345678).
 * NOTE on BigIntString: always a decimal string, never a JS number.
 * NOTE on BpsString: percentage in bps (1e4 precision). 425 = 4.25%.
 */

export const now = () => Math.floor(Date.now() / 1000); // unix seconds
export const days = (n) => n * 86400;

export function randomHex(bytes) {
  const chars = '0123456789abcdef';
  let out = '0x';
  for (let i = 0; i < bytes * 2; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

export function makeAuctionId() {
  return randomHex(32);
}

export function makeAddress() {
  return randomHex(20);
}

export const bonds = [
  {
    isin: 'NO0012345678',
    maturityDuration: String(days(365 * 5)),
    maturityDate: String(now() + days(365 * 4)),
    timeToMaturity: String(days(365 * 4)),
    couponDuration: String(days(365)),
    couponYield: '425',
    couponPaymentsTotal: '5',
    couponPaymentsMade: '1',
    couponPaymentsRemaining: '4',
    status: 'maturing',
    totalSupply: '5000000000',
  },
  {
    isin: 'NO0098765432',
    maturityDuration: String(days(365 * 10)),
    maturityDate: String(now() + days(365 * 9)),
    timeToMaturity: String(days(365 * 9)),
    couponDuration: String(days(365)),
    couponYield: '385',
    couponPaymentsTotal: '10',
    couponPaymentsMade: '0',
    couponPaymentsRemaining: '10',
    status: 'minting',
    totalSupply: '2500000000',
  },
  {
    isin: 'NO0011223344',
    maturityDuration: String(days(365 * 3)),
    maturityDate: String(now() - days(30)),
    timeToMaturity: '0',
    couponDuration: String(days(365)),
    couponYield: '275',
    couponPaymentsTotal: '3',
    couponPaymentsMade: '3',
    couponPaymentsRemaining: '0',
    status: 'matured',
    totalSupply: '1000000000',
  },
];

export const auctions = [
  {
    auctionId: '0x' + 'a1'.repeat(32),
    isin: 'NO0012345678',
    type: 'RATE',
    status: 'finalised',
    end: String(now() - days(30)),
    size: '5000000',
    allocationHash: randomHex(32),
    finalised: true,
    rejected: false,
    cancelled: false,
  },
  {
    auctionId: '0x' + 'b2'.repeat(32),
    isin: 'NO0098765432',
    type: 'PRICE',
    status: 'open',
    end: String(now() + days(7)),
    size: '2500000',
    allocationHash: null,
    finalised: false,
    rejected: false,
    cancelled: false,
  },
];

export const helpers = { now, days, randomHex, makeAuctionId, makeAddress };
export const store = { bonds, auctions, helpers };
