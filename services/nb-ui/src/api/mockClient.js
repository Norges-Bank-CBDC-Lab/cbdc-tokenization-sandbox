/**
 * mockClient — in-memory implementation of the NB Bond API surface.
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
import { store } from './mockData.js';

const { bonds, auctions, helpers } = store;
const { now, days, randomHex, makeAuctionId, makeAddress } = helpers;

function delay() {
  const ms = AppConfig.MOCK_LATENCY_MS ?? 0;
  return new Promise((r) => setTimeout(r, ms));
}

function notFound(what) {
  const err = new Error(`${what} not found`);
  err.status = 404;
  throw err;
}

// ---------- bonds ----------------------------------------------------

async function listBonds() {
  await delay();
  return { bonds: bonds.map((b) => ({ ...b })) };
}

async function getBond(isin) {
  await delay();
  const b = bonds.find((x) => x.isin === isin);
  if (!b) notFound('Bond');
  return { ...b };
}

async function getBondHolders(isin) {
  await delay();
  return {
    isin,
    holders: [
      { isin, holder: makeAddress(), balance: '2500000' },
      { isin, holder: makeAddress(), balance: '1200000' },
      { isin, holder: makeAddress(), balance: '800000' },
      { isin, holder: makeAddress(), balance: '500000' },
    ],
  };
}

async function getBondHistory(isin) {
  await delay();
  return {
    isin,
    events: auctions
      .filter((a) => a.isin === isin)
      .map((a) => ({
        auctionId: a.auctionId,
        isin,
        type: 'AuctionCreated',
        block: 1_000_000 + Math.floor(Math.random() * 100_000),
        txHash: randomHex(32),
        payload: { auctionType: a.type, size: a.size },
      })),
    bondEvents: [],
  };
}

async function payCoupon(isin, body) {
  await delay();
  return {
    isin,
    txHash: randomHex(32),
    blockNumber: 1_500_000,
    status: 'submitted',
    holderCount: body?.holders?.length ?? 0,
  };
}

async function redeem(isin, body) {
  await delay();
  return {
    isin,
    txHash: randomHex(32),
    blockNumber: 1_500_001,
    status: 'submitted',
    holderCount: body?.holders?.length ?? 0,
  };
}

// ---------- auctions -------------------------------------------------

async function listAllAuctions() {
  await delay();
  return { auctions: auctions.map((a) => ({ ...a })) };
}

async function listAuctionsForBond(isin) {
  await delay();
  return { auctions: auctions.filter((a) => a.isin === isin).map((a) => ({ ...a })) };
}

async function createAuction(isin, body) {
  await delay();
  let bond = bonds.find((b) => b.isin === isin);
  if (!bond) {
    const maturityDuration = body.maturityDuration
      ? String(body.maturityDuration)
      : String(days(365 * 5));
    bond = {
      isin,
      maturityDuration,
      maturityDate: String(now() + Number(maturityDuration)),
      timeToMaturity: maturityDuration,
      couponDuration: String(days(365)),
      couponYield: '0',
      couponPaymentsTotal: '0',
      couponPaymentsMade: '0',
      couponPaymentsRemaining: '0',
      status: 'minting',
      totalSupply: '0',
    };
    bonds.unshift(bond);
  }

  const auctionId = makeAuctionId();
  const summary = {
    auctionId,
    isin,
    type: body.type,
    status: 'open',
    end: String(body.end),
    size: String(body.size),
    allocationHash: null,
    finalised: false,
    rejected: false,
    cancelled: false,
  };
  auctions.unshift(summary);

  return {
    auctionId,
    isin,
    type: body.type,
    status: 'open',
    end: String(body.end),
    size: String(body.size),
    maturityDuration: body.maturityDuration ? String(body.maturityDuration) : null,
    auctionPubKey: randomHex(33),
    bondAuction: makeAddress(),
    bondToken: makeAddress(),
    txHash: randomHex(32),
    blockNumber: 1_600_000 + Math.floor(Math.random() * 1000),
  };
}

async function getAuctionStatus(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  return {
    auctionId,
    isin: a.isin,
    status: a.status,
    metadata: {
      owner: makeAddress(),
      end: a.end,
      auctionPubKey: randomHex(33),
      bond: makeAddress(),
      offering: a.size,
      auctionType: a.type,
    },
    cached: {
      sealedCount: 12,
      unsealedCount: a.status === 'open' ? 0 : 12,
      allocationHash: a.allocationHash,
      finalised: a.finalised,
      rejected: a.rejected,
      cancelled: a.cancelled,
      auctionType: a.type,
    },
    allocations: [],
  };
}

async function getAuctionBids(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  const sealed = a.status === 'open';
  const bids = Array.from({ length: 8 }).map(() =>
    sealed
      ? { bidder: makeAddress(), ciphertext: randomHex(64), plaintextHash: randomHex(32) }
      : {
          bidder: makeAddress(),
          rate: String(350 + Math.floor(Math.random() * 200)),
          units: String(50_000 + Math.floor(Math.random() * 500_000)),
        },
  );
  return {
    auctionId,
    isin: a.isin,
    state: sealed ? 'sealed' : 'unsealed',
    bidCount: bids.length,
    bids,
    allocation: null,
    auctionType: a.type,
  };
}

async function getAuctionAllocations(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  const allocations = Array.from({ length: 5 }).map(() => ({
    bidder: makeAddress(),
    units: String(100_000 + Math.floor(Math.random() * 400_000)),
    rate: String(400 + Math.floor(Math.random() * 100)),
    auctionType: a.type,
  }));
  return {
    auctionId,
    isin: a.isin,
    allocation: {
      clearingRate: '425',
      totalAllocated: a.size,
      allocationHash: a.allocationHash || randomHex(32),
      auctionType: a.type,
      computedAt: Date.now(),
      allocations,
    },
    status: a.status,
    auctionType: a.type,
    finalised: a.finalised,
    rejected: a.rejected,
    cancelled: a.cancelled,
  };
}

async function closeAuction(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  a.status = 'closed';
  a.allocationHash = randomHex(32);
  return {
    auctionId,
    isin: a.isin,
    status: 'closed',
    txHash: randomHex(32),
    blockNumber: 1_700_000,
    bidCount: 8,
    bids: [],
    allocation: {
      clearingRate: '425',
      totalAllocated: a.size,
      allocationHash: a.allocationHash,
      auctionType: a.type,
      computedAt: Date.now(),
      allocations: [],
    },
    auctionType: a.type,
  };
}

async function reopenAuction(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  if (a.status !== 'closed') {
    const err = new Error(`Cannot reopen auction in status "${a.status}"`);
    err.status = 409;
    throw err;
  }
  a.status = 'open';
  a.allocationHash = null;
  return {
    auctionId,
    isin: a.isin,
    status: 'open',
    txHash: randomHex(32),
    blockNumber: 1_700_010,
  };
}

async function finaliseAuction(auctionId, body) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  if (body.approve) {
    a.status = 'finalised';
    a.finalised = true;
  } else {
    a.status = 'rejected';
    a.rejected = true;
  }
  return {
    auctionId,
    isin: a.isin,
    status: a.status,
    allocationHash: body.allocationHash,
    txHash: randomHex(32),
    blockNumber: 1_700_001,
  };
}

async function cancelAuction(auctionId) {
  await delay();
  const a = auctions.find((x) => x.auctionId === auctionId);
  if (!a) notFound('Auction');
  a.status = 'cancelled';
  a.cancelled = true;
  return {
    auctionId,
    isin: a.isin,
    status: 'cancelled',
    txHash: randomHex(32),
    blockNumber: 1_700_002,
  };
}

async function getHealth() {
  await delay();
  return {
    status: 'ok (mock)',
    bondManager: makeAddress(),
    bondAuction: makeAddress(),
    bondToken: makeAddress(),
    sealingPublicKey: randomHex(33),
  };
}

export const MockClient = {
  listBonds,
  getBond,
  getBondHolders,
  getBondHistory,
  payCoupon,
  redeem,
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
  getHealth,
};
