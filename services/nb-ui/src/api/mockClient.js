/**
 * mockClient — in-memory implementation of the v2 bond API.
 *
 * Every method returns a Promise (with a small simulated latency) so call
 * sites are identical to the real client. Mutations write back to the
 * mockData store so the UI reflects them.
 *
 * Conformance: each method returns the exact response shape defined in
 * services/nb-bond-api/openapi.json. If you change a method here, change
 * the real backend too.
 */
import { AppConfig } from '../config.js';
import { helpers, store } from './mockData.js';

const { bonds } = store;
const { mockMd5, randomHex, makeAuction, makeBond } = helpers;

function delay() {
  const ms = AppConfig.MOCK_LATENCY_MS ?? 0;
  return new Promise((r) => setTimeout(r, ms));
}

function notFound(what) {
  const err = new Error(`${what} not found`);
  err.status = 404;
  throw err;
}

function findBond(isin) {
  return bonds.find((b) => b.isin === isin);
}

function findAuction(auctionId) {
  for (const b of bonds) {
    const a = b.auctions?.find((x) => x.id === auctionId);
    if (a) return { bond: b, auction: a };
  }
  return null;
}

function restampBond(bond) {
  bond.md5 = mockMd5();
  return bond;
}

function restampAuction(auction) {
  auction.md5 = mockMd5();
  return auction;
}

// #region Bonds ──────────────────────────────────────────────────────

async function listBonds() {
  await delay();
  return bonds.map((b) => ({ ...b }));
}

async function getBond(isin) {
  await delay();
  const b = findBond(isin);
  if (!b) notFound('Bond');
  return { ...b };
}

async function listBondHistory(isin, _opts = {}) {
  await delay();
  const b = findBond(isin);
  if (!b) return [];
  const events = (b.auctions ?? []).map((a) => ({
    isin,
    auctionId: a.id,
    type: a.type, // mock: re-use auction type as the create-event type
    block: 1_000_000 + Math.floor(Math.random() * 100_000),
    txHash: randomHex(32),
    payload: { size: a.size, status: a.status },
  }));
  return events.sort((x, y) => y.block - x.block);
}

async function payCoupon(isin, _body) {
  await delay();
  const b = findBond(isin);
  if (!b) notFound('Bond');
  // Bump payments-made for visual feedback.
  if (b.coupon?.payments) {
    const made = Number(b.coupon.payments.made ?? '0') + 1;
    const total = Number(b.coupon.payments.total ?? '0');
    b.coupon.payments.made = String(made);
    b.coupon.payments.remaining = String(Math.max(0, total - made));
  }
  return restampBond({ ...b });
}

async function redeem(isin, _body) {
  await delay();
  const b = findBond(isin);
  if (!b) notFound('Bond');
  b.status = 'redeemed';
  b.totalSupply = '0';
  return restampBond({ ...b });
}

// #endregion

// #region Auctions ───────────────────────────────────────────────────

async function listAuctions() {
  await delay();
  return bonds.flatMap((b) => (b.auctions ?? []).map((a) => ({ ...a })));
}

async function getAuction(auctionId) {
  await delay();
  const hit = findAuction(auctionId);
  if (!hit) notFound('Auction');
  return { ...hit.auction };
}

async function createAuction(isin, body) {
  await delay();
  let bond = findBond(isin);
  if (!bond) {
    bond = makeBond({
      isin,
      status: 'minting',
      totalSupply: '0',
      couponYieldBps: '0',
      paymentsTotal: 0,
      paymentsMade: 0,
      auctions: [],
    });
    bonds.unshift(bond);
  }
  const auction = makeAuction({
    isin,
    type: body.type,
    status: 'open',
    end: String(body.end),
    size: String(body.size),
    bidCount: 0,
  });
  bond.auctions = [auction, ...(bond.auctions ?? [])];
  return restampBond({ ...bond });
}

async function closeAuction(auctionId) {
  await delay();
  const hit = findAuction(auctionId);
  if (!hit) notFound('Auction');
  if (hit.auction.status !== 'open') {
    const err = new Error(`Cannot close auction in status "${hit.auction.status}"`);
    err.status = 409;
    throw err;
  }
  hit.auction.status = 'closed';
  hit.auction.bids = hit.auction.bids.map((b) => {
    if (b.state === 'unsealed') return b;
    return {
      bidder: b.bidder,
      state: 'unsealed',
      rate: String(350 + Math.floor(Math.random() * 200)),
      units: String(50_000 + Math.floor(Math.random() * 500_000)),
      md5: mockMd5(),
    };
  });
  if (!hit.auction.allocation) {
    hit.auction.allocation = {
      clearingRate: '425',
      totalAllocated: hit.auction.size,
      hash: randomHex(32),
      auctionType: hit.auction.type,
      computedAt: Date.now(),
      entries: hit.auction.bids.slice(0, 3).map((b) => ({
        bidder: b.bidder,
        units: b.units ?? '100000',
        rate: b.rate ?? '425',
      })),
      md5: mockMd5(),
    };
  }
  hit.auction.txs.close = { hash: randomHex(32), block: 1_700_000 };
  return restampAuction({ ...hit.auction });
}

async function cancelAuction(auctionId) {
  await delay();
  const hit = findAuction(auctionId);
  if (!hit) notFound('Auction');
  if (hit.auction.status === 'finalised' || hit.auction.status === 'cancelled') {
    const err = new Error(`Cannot cancel auction in status "${hit.auction.status}"`);
    err.status = 409;
    throw err;
  }
  hit.auction.status = 'cancelled';
  hit.auction.txs.cancel = { hash: randomHex(32), block: 1_700_002 };
  return restampAuction({ ...hit.auction });
}

async function reopenAuction(auctionId) {
  // Mock-only — see auctionsApi.reopenAuction docs.
  await delay();
  const hit = findAuction(auctionId);
  if (!hit) notFound('Auction');
  if (hit.auction.status !== 'closed') {
    const err = new Error(`Cannot reopen auction in status "${hit.auction.status}"`);
    err.status = 409;
    throw err;
  }
  hit.auction.status = 'open';
  hit.auction.allocation = null;
  hit.auction.txs.close = null;
  return restampAuction({ ...hit.auction });
}

async function finaliseAuction(auctionId, body) {
  await delay();
  const hit = findAuction(auctionId);
  if (!hit) notFound('Auction');
  hit.auction.status = body.approve ? 'finalised' : 'rejected';
  if (body.approve) {
    hit.auction.txs.finalise = { hash: randomHex(32), block: 1_700_001 };
  }
  return restampAuction({ ...hit.auction });
}

// #endregion

// #region Bidders (mock-only roster) ─────────────────────────────────

const mockBidders = [
  {
    address: '0xb18C3D01CfAE68D8014458248b6AFccCBbc2331f',
    name: 'Nordea',
    publicKey: '0x' + '02'.padEnd(66, 'a'),
    privateKey: '0x' + 'aa'.repeat(32),
    ethBalance: '0',
    wnokBalance: '1100000',
    createdAt: Date.now() - 86400_000,
  },
  {
    address: '0x8C7A8BE572bAddE00c3D3BdaF5bf11625738bb0D',
    name: 'DNB',
    publicKey: '0x' + '03'.padEnd(66, 'b'),
    privateKey: '0x' + 'bb'.repeat(32),
    ethBalance: '0',
    wnokBalance: '1200000',
    createdAt: Date.now() - 86400_000,
  },
  {
    address: '0x4774bE7da827F41FB97a5CACE0AB1D4eb43cb1C2',
    name: 'Alice.tbd',
    publicKey: '0x' + '02'.padEnd(66, 'c'),
    privateKey: '0x' + 'cc'.repeat(32),
    ethBalance: '0',
    wnokBalance: '0',
    createdAt: Date.now() - 86400_000,
  },
].map((b) => ({ ...b, md5: mockMd5() }));

async function listBidders() {
  await delay();
  return mockBidders.map((b) => ({ ...b }));
}

async function createBidder(body) {
  await delay();
  const existing = mockBidders.find((b) => b.name === body.name);
  if (existing) {
    const err = new Error(`bidder name "${body.name}" already exists`);
    err.status = 409;
    throw err;
  }
  const address = '0x' + randomHex(20).slice(2);
  const bidder = {
    address,
    name: body.name,
    publicKey: '0x' + '02'.padEnd(66, '0'),
    privateKey: body.privateKey ?? '0x' + 'dd'.repeat(32),
    ethBalance: '0',
    wnokBalance: '0',
    createdAt: Date.now(),
    md5: mockMd5(),
  };
  mockBidders.push(bidder);
  return { ...bidder };
}

async function deleteBidder(address) {
  await delay();
  const idx = mockBidders.findIndex((b) => b.address.toLowerCase() === address.toLowerCase());
  if (idx < 0) notFound('Bidder');
  mockBidders.splice(idx, 1);
  return null;
}

async function placeBidderBid(address, body) {
  await delay();
  const bidder = mockBidders.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (!bidder) notFound('Bidder');
  const hit = findAuction(body.auctionId);
  if (!hit) notFound('Auction');
  const sealed = {
    bidder: bidder.address,
    state: 'sealed',
    ciphertext: randomHex(64),
    plaintextHash: randomHex(32),
    md5: mockMd5(),
  };
  hit.auction.bids = [...(hit.auction.bids ?? []), sealed];
  return { ...sealed };
}

// #endregion

// #region Central Bank (mock-only) ───────────────────────────────────

let mockCentralBankAllowlist = [
  '0xb18C3D01CfAE68D8014458248b6AFccCBbc2331f', // Nordea
  '0x8C7A8BE572bAddE00c3D3BdaF5bf11625738bb0D', // DNB
];
let mockCbBalance = 0n;

async function getCentralBank() {
  await delay();
  return {
    address: '0xf4E18004902a34499bB6E5b23ff4CD99a864Dcd0',
    available: true,
    wnok: {
      contractAddress: '0x' + '11'.repeat(20),
      balance: mockCbBalance.toString(),
      allowlistSize: mockCentralBankAllowlist.length,
    },
    md5: mockMd5(),
  };
}

async function listWnokAllowlist() {
  await delay();
  return mockCentralBankAllowlist.map((address) => ({ address, md5: mockMd5() }));
}

async function addToWnokAllowlist(address) {
  await delay();
  if (!mockCentralBankAllowlist.some((a) => a.toLowerCase() === address.toLowerCase())) {
    mockCentralBankAllowlist = [...mockCentralBankAllowlist, address];
  }
  return { hash: randomHex(32), block: 1_700_010 };
}

async function removeFromWnokAllowlist(address) {
  await delay();
  mockCentralBankAllowlist = mockCentralBankAllowlist.filter(
    (a) => a.toLowerCase() !== address.toLowerCase(),
  );
  return { hash: randomHex(32), block: 1_700_011 };
}

async function mintWnok({ address, amount }) {
  await delay();
  const target = mockBidders.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (target) {
    target.wnokBalance = (BigInt(target.wnokBalance) + BigInt(amount)).toString();
    target.md5 = mockMd5();
  }
  return { hash: randomHex(32), block: 1_700_012 };
}

async function burnWnok({ address, amount }) {
  await delay();
  const target = mockBidders.find((b) => b.address.toLowerCase() === address.toLowerCase());
  if (target) {
    const next = BigInt(target.wnokBalance) - BigInt(amount);
    target.wnokBalance = (next < 0n ? 0n : next).toString();
    target.md5 = mockMd5();
  }
  return { hash: randomHex(32), block: 1_700_013 };
}

async function transferWnok({ to, amount }) {
  await delay();
  const target = mockBidders.find((b) => b.address.toLowerCase() === to.toLowerCase());
  if (target) {
    target.wnokBalance = (BigInt(target.wnokBalance) + BigInt(amount)).toString();
    target.md5 = mockMd5();
  }
  mockCbBalance = mockCbBalance >= BigInt(amount) ? mockCbBalance - BigInt(amount) : 0n;
  return { hash: randomHex(32), block: 1_700_014 };
}

// #endregion

export const MockClient = {
  listBonds,
  getBond,
  listBondHistory,
  payCoupon,
  redeem,
  listAuctions,
  getAuction,
  createAuction,
  closeAuction,
  cancelAuction,
  reopenAuction,
  finaliseAuction,
  // bidders
  listBidders,
  createBidder,
  deleteBidder,
  placeBidderBid,
  // central bank
  getCentralBank,
  listWnokAllowlist,
  addToWnokAllowlist,
  removeFromWnokAllowlist,
  mintWnok,
  burnWnok,
  transferWnok,
};
