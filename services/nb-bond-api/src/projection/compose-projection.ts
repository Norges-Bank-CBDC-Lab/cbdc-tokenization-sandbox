import {
  buildAllocationHash,
  computeBuybackAllocation,
  computeUniformAllocation,
} from '../allocation';
import { normalizeSealedBid, unsealBid } from '../bid';
import { withMd5 } from '../http';
import { parseBigInt } from '../parsing';
import type {
  Allocation,
  Auction,
  AuctionStatus,
  AuctionType,
  Bid,
  Bond,
  BondStatus,
  HolderBalance,
  TxRef,
} from '../schemas';
import { AuctionType as NumericAuctionType } from '../types';
import type { ProjectionContextRow } from '../ingestion-db';
import type { AuctionSnapshot, BondSnapshot } from './snapshots';

function auctionStatus(value: string): AuctionStatus {
  if (value === 'open' || value === 'closed' || value === 'finalised' || value === 'cancelled') {
    return value;
  }
  throw new Error(`unsupported projected auction status: ${value}`);
}

function auctionType(value: string | null): AuctionType {
  if (value === 'RATE' || value === 'PRICE' || value === 'BUYBACK') return value;
  throw new Error(`unsupported projected auction type: ${String(value)}`);
}

function numericAuctionType(value: AuctionType): NumericAuctionType {
  return value === 'RATE'
    ? NumericAuctionType.RATE
    : value === 'BUYBACK'
      ? NumericAuctionType.BUYBACK
      : NumericAuctionType.PRICE;
}

function txs(snapshot: AuctionSnapshot): Auction['txs'] {
  let close: TxRef | null = null;
  let finalise: TxRef | null = null;
  let cancel: TxRef | null = null;
  for (const event of snapshot.events) {
    const ref = { hash: event.tx_hash, block: event.block };
    if (event.type === 'CLOSED') close = ref;
    else if (event.type === 'FINALISED') finalise = ref;
    else if (event.type === 'CANCELLED') cancel = ref;
  }
  return {
    create: snapshot.row.created_tx
      ? { hash: snapshot.row.created_tx, block: snapshot.row.created_block }
      : { hash: '0x', block: null },
    close,
    finalise,
    cancel,
  };
}

function sealedBid(row: AuctionSnapshot['bids'][number]): Bid {
  return withMd5({
    bidder: row.bidder,
    state: 'sealed' as const,
    bidIndex: row.bid_index,
    ciphertext: row.ciphertext,
    plaintextHash: row.plaintext_hash,
  });
}

function activeUnsealedBids(snapshot: AuctionSnapshot) {
  return snapshot.bids
    .filter((row) => row.cancelled === 0)
    .map((row) =>
      unsealBid(
        snapshot.row.isin,
        normalizeSealedBid({
          bidder: row.bidder,
          ciphertext: row.ciphertext,
          plaintextHash: row.plaintext_hash,
        }),
        row.bid_index,
      ),
    );
}

function unsealedBid(raw: ReturnType<typeof unsealBid>): Bid {
  return withMd5({
    bidder: raw.bidder,
    state: 'unsealed' as const,
    bidIndex: raw.bidIndex,
    rate: parseBigInt(raw.plaintext.rate, 'rate').toString(),
    units: parseBigInt(raw.plaintext.units, 'units').toString(),
  });
}

function allocationFromSnapshot(
  snapshot: AuctionSnapshot,
  type: AuctionType,
  unsealed: ReturnType<typeof activeUnsealedBids> | null,
): Allocation | null {
  if (snapshot.allocations.length > 0) {
    const entries = snapshot.allocations.map((row) => ({
      bidder: row.bidder,
      units: BigInt(row.units),
      rate: BigInt(row.rate),
    }));
    const clearingRate = entries[0].rate;
    const totalAllocated = entries.reduce((sum, entry) => sum + entry.units, 0n);
    return withMd5({
      clearingRate: clearingRate.toString(),
      totalAllocated: totalAllocated.toString(),
      hash: buildAllocationHash(snapshot.row.isin, numericAuctionType(type), clearingRate, entries),
      auctionType: type,
      computedAt: snapshot.row.finalised_at ?? 0,
      entries: entries.map((entry) => ({
        bidder: entry.bidder,
        units: entry.units.toString(),
        rate: entry.rate.toString(),
      })),
    });
  }

  if (snapshot.row.status !== 'closed' || !unsealed || !snapshot.row.offering) return null;
  const offering = BigInt(snapshot.row.offering);
  if (offering <= 0n || unsealed.length === 0) return null;
  const result =
    type === 'BUYBACK'
      ? computeBuybackAllocation(snapshot.row.isin, unsealed, offering)
      : computeUniformAllocation(snapshot.row.isin, numericAuctionType(type), unsealed, offering);
  return withMd5({
    clearingRate: result.clearingRate.toString(),
    totalAllocated: result.totalAllocated.toString(),
    hash: result.allocationHash,
    auctionType: type,
    computedAt: snapshot.row.closed_at ?? Number(BigInt(snapshot.row.end ?? '0') * 1000n),
    entries: result.allocations.map((entry) => ({
      bidder: entry.bidder,
      units: entry.units.toString(),
      rate: entry.rate.toString(),
    })),
  });
}

export function composeProjectedAuction(
  snapshot: AuctionSnapshot,
  context: ProjectionContextRow,
  options: { revealOpenBids?: boolean } = {},
): Auction {
  const status = auctionStatus(snapshot.row.status);
  const type = auctionType(snapshot.row.type);
  let unsealed: ReturnType<typeof activeUnsealedBids> | null = null;
  if (status !== 'open' || options.revealOpenBids) {
    try {
      unsealed = activeUnsealedBids(snapshot);
    } catch {
      unsealed = null;
    }
  }
  const bids = unsealed
    ? unsealed.map(unsealedBid)
    : snapshot.bids.filter((row) => row.cancelled === 0).map(sealedBid);

  return withMd5({
    id: snapshot.row.auction_id,
    isin: snapshot.row.isin,
    type,
    status,
    end: snapshot.row.end,
    size: snapshot.row.offering,
    maturityDuration: type === 'RATE' ? snapshot.maturityDuration : null,
    owner: snapshot.row.owner ?? '0x',
    sealingPubKey: snapshot.row.auction_pub_key ?? '0x',
    contracts: { auction: context.auction_address, token: context.token_address },
    bids,
    allocation: allocationFromSnapshot(snapshot, type, unsealed),
    txs: txs(snapshot),
  });
}

function holder(row: BondSnapshot['balances'][number]): HolderBalance {
  return withMd5({ holder: row.holder, balance: row.balance });
}

function bondStatus(snapshot: BondSnapshot): BondStatus {
  const state = snapshot.state;
  const supply = BigInt(state.total_supply);
  if (state.ever_issued && state.redemption_complete && supply === 0n) return 'redeemed';
  if (state.is_matured) return 'matured';

  const latestAuction = snapshot.auctions[snapshot.auctions.length - 1]?.row;
  if (latestAuction?.status === 'open' || latestAuction?.status === 'closed') return 'auctioning';
  if (state.ever_issued && supply > 0n) return 'outstanding';
  return 'staged';
}

export function composeProjectedBond(snapshot: BondSnapshot): Bond {
  const state = snapshot.state;
  const maturityDuration =
    state.maturity_duration === null ? null : BigInt(state.maturity_duration);
  const maturityDate = state.maturity_date === null ? null : BigInt(state.maturity_date);
  const couponDuration = state.coupon_duration === null ? null : BigInt(state.coupon_duration);
  const couponYield = state.coupon_yield === null ? null : BigInt(state.coupon_yield);
  const lastCouponPayment =
    state.last_coupon_payment === null ? null : BigInt(state.last_coupon_payment);
  const couponPaymentCount = BigInt(state.coupon_payment_count);
  const durationScalar = BigInt(snapshot.context.duration_scalar);
  const checkpointTime =
    snapshot.checkpoint.blockTimestamp === null ? null : BigInt(snapshot.checkpoint.blockTimestamp);

  const totalPayments =
    maturityDuration !== null && couponDuration !== null && couponDuration > 0n
      ? maturityDuration / couponDuration
      : null;
  const remainingPayments =
    totalPayments === null
      ? null
      : totalPayments > couponPaymentCount
        ? totalPayments - couponPaymentCount
        : 0n;
  const nextPayment =
    lastCouponPayment !== null && couponDuration !== null
      ? lastCouponPayment + couponDuration
      : null;
  const payable =
    checkpointTime !== null &&
    nextPayment !== null &&
    remainingPayments !== null &&
    remainingPayments > 0n &&
    checkpointTime >= nextPayment;
  const remainingMaturity =
    maturityDate !== null && checkpointTime !== null && maturityDate > checkpointTime
      ? maturityDate - checkpointTime
      : maturityDate === null
        ? null
        : 0n;
  const years = (value: bigint | null) =>
    value === null || durationScalar === 0n ? null : (value / durationScalar).toString();

  return withMd5({
    isin: state.isin,
    status: bondStatus(snapshot),
    disabled: Boolean(state.disabled),
    totalSupply: state.total_supply,
    contracts: {
      token: snapshot.context.token_address,
      auction: snapshot.context.auction_address,
      manager: snapshot.context.manager_address,
    },
    maturity:
      maturityDuration !== null || maturityDate !== null
        ? {
            duration: maturityDuration?.toString() ?? null,
            durationYears: years(maturityDuration),
            date: maturityDate?.toString() ?? null,
            remaining: remainingMaturity?.toString() ?? null,
            remainingYears: years(remainingMaturity),
          }
        : null,
    coupon:
      couponDuration !== null || couponYield !== null || totalPayments !== null
        ? {
            duration: couponDuration?.toString() ?? null,
            durationYears: years(couponDuration),
            rateBps: couponYield?.toString() ?? null,
            lastPaymentAt: lastCouponPayment?.toString() ?? null,
            nextPaymentDue: nextPayment?.toString() ?? null,
            payable,
            payments: {
              total: totalPayments?.toString() ?? null,
              made: couponPaymentCount.toString(),
              remaining: remainingPayments?.toString() ?? null,
            },
          }
        : null,
    holders: snapshot.balances.map(holder),
    auctions: snapshot.auctions.map((auction) =>
      composeProjectedAuction(auction, snapshot.context),
    ),
  });
}
