/**
 * DTO composers.
 *
 * Build the v2 Bond / Auction / Bid / Allocation / HolderBalance /
 * HistoryEvent DTOs from chain reads + the ingestion DB. Each
 * cacheable DTO is stamped with its own `md5` (computed over its
 * content excluding the md5 field itself) so the UI can do subtree
 * diffing without re-hashing client-side.
 *
 * See docs/plans/openapi-v2-plan.md §3, §4.
 */
import { keccak256, toUtf8Bytes } from 'ethers';

import {
  buildAllocationHash,
  computeBuybackAllocation,
  computeUniformAllocation,
} from './allocation';
import { getBondAuction, getBondAuctionAddress, getBondManager, getBondToken } from './chain';
import { withMd5 } from './http';
import {
  type AuctionEventRow,
  type AuctionRow,
  type IngestionDatabase,
  getAuctionEventsByIsin,
  getAuctionEventsById,
  getAuctionRowById,
  getBalancesByIsin,
  getBondEventsByIsin,
  listAllAuctions as listAuctionRows,
  listAllBonds as listBondRows,
  listAuctionRowsByIsin,
} from './ingestion-db';
import { normalizeSealedBid, unsealBid } from './bid';
import { logger } from './logger';
import { parseBigInt } from './parsing';
import type {
  Allocation,
  AllocationEntry,
  Auction,
  AuctionStatus,
  AuctionType,
  Bid,
  Bond,
  BondStatus,
  HistoryEvent,
  HolderBalance,
  TxRef,
} from './schemas';
import { auctionTypeToString } from './utils';

type TxRefT = TxRef;

// #region On-chain enum mapping ──────────────────────────────────────

function onChainStatusToApi(status: number): AuctionStatus {
  switch (status) {
    case 1:
      return 'open';
    case 2:
      return 'closed';
    case 3:
      return 'finalised';
    case 4:
      return 'cancelled';
    default:
      return 'open';
  }
}

function onChainAuctionTypeToApi(value: number | bigint | undefined): AuctionType {
  const n = Number(value ?? 1);
  switch (n) {
    case 0:
      return 'RATE';
    case 1:
      return 'PRICE';
    case 2:
      return 'BUYBACK';
    default:
      return 'PRICE';
  }
}

function numericAuctionType(value: AuctionType): 0 | 1 | 2 {
  switch (value) {
    case 'RATE':
      return 0;
    case 'PRICE':
      return 1;
    case 'BUYBACK':
      return 2;
  }
}

// #endregion

// #region Bid composers ──────────────────────────────────────────────

function composeSealedBid(raw: { bidder: string; ciphertext: string; plaintextHash: string }): Bid {
  return withMd5({
    bidder: raw.bidder,
    state: 'sealed' as const,
    ciphertext: raw.ciphertext,
    plaintextHash: raw.plaintextHash,
  });
}

function composeUnsealedBid(raw: { bidder: string; rate: bigint; units: bigint }): Bid {
  return withMd5({
    bidder: raw.bidder,
    state: 'unsealed' as const,
    rate: raw.rate.toString(),
    units: raw.units.toString(),
  });
}

// #endregion

// #region Allocation composer ────────────────────────────────────────

function composeAllocationEntry(raw: {
  bidder: string;
  units: bigint;
  rate: bigint;
}): AllocationEntry {
  return {
    bidder: raw.bidder,
    units: raw.units.toString(),
    rate: raw.rate.toString(),
  };
}

function composeAllocation(input: {
  clearingRate: bigint;
  totalAllocated: bigint;
  hash: string;
  auctionType: AuctionType;
  computedAt: number;
  entries: Array<{ bidder: string; units: bigint; rate: bigint }>;
}): Allocation {
  return withMd5({
    clearingRate: input.clearingRate.toString(),
    totalAllocated: input.totalAllocated.toString(),
    hash: input.hash,
    auctionType: input.auctionType,
    computedAt: input.computedAt,
    entries: input.entries.map(composeAllocationEntry),
  });
}

// #endregion

// #region Holder composer ────────────────────────────────────────────

function composeHolderBalance(holder: string, balance: string): HolderBalance {
  return withMd5({ holder, balance });
}

async function composeHolders(db: IngestionDatabase, isin: string): Promise<HolderBalance[]> {
  const dbHolders = getBalancesByIsin(db, isin);
  let bondToken;
  try {
    bondToken = await getBondToken();
  } catch (err) {
    logger.debug(`composeHolders: bondToken unavailable: ${(err as Error).message}`);
    // Fall back to DB-only balances.
    return dbHolders.map((h) => composeHolderBalance(h.holder, h.balance));
  }
  const partition = keccak256(toUtf8Bytes(isin));

  const out = await Promise.all(
    dbHolders.map(async (h) => {
      try {
        const onChain = await bondToken.balanceOfByPartition(partition, h.holder);
        return onChain > 0n ? composeHolderBalance(h.holder, onChain.toString()) : null;
      } catch (err) {
        logger.debug(
          `composeHolders: balanceOfByPartition failed for ${h.holder}: ${(err as Error).message}`,
        );
        return null;
      }
    }),
  );

  return out.filter((h): h is HolderBalance => h !== null);
}

// #endregion

// #region Auction tx history ─────────────────────────────────────────

function buildAuctionTxs(row: AuctionRow | null, events: AuctionEventRow[]): Auction['txs'] {
  let close: TxRefT | null = null;
  let finalise: TxRefT | null = null;
  let cancel: TxRefT | null = null;
  for (const e of events) {
    const ref: TxRefT = { hash: e.tx_hash, block: e.block };
    if (e.type === 'CLOSED') close = ref;
    else if (e.type === 'FINALISED') finalise = ref;
    else if (e.type === 'CANCELLED') cancel = ref;
  }
  const create: TxRefT = row?.created_tx
    ? { hash: row.created_tx, block: row.created_block ?? null }
    : // Auction exists on-chain but pre-dated the ingestion start; surface a
      // placeholder rather than failing the DTO. UI treats this as "tx unknown".
      { hash: '0x', block: null };
  return { create, close, finalise, cancel };
}

// #endregion

// #region Auction composer ───────────────────────────────────────────

interface AuctionChainState {
  metadata: {
    isin: string;
    owner: string;
    end: bigint | null;
    offering: bigint | null;
    auctionPubKey: string;
    bond: string;
    auctionType: AuctionType;
  };
  status: AuctionStatus;
  sealedBids: ReturnType<typeof normalizeSealedBid>[];
  unsealedBids: ReturnType<typeof unsealBid>[] | null;
  onChainAllocations: Array<{
    bidder: string;
    units: bigint;
    rate: bigint;
    isin: string;
    auctionType: AuctionType;
  }>;
}

async function fetchAuctionChainState(auctionId: string): Promise<AuctionChainState | null> {
  try {
    const bondAuction = await getBondAuction();
    const [metaRaw, statusRaw, allocRaw] = await Promise.all([
      bondAuction.getAuction(auctionId),
      bondAuction.getAuctionStatus(auctionId),
      bondAuction.getAllocations(auctionId).catch(() => []),
    ]);

    const isin = metaRaw.isin as string;
    const auctionType = onChainAuctionTypeToApi(metaRaw.auctionType);

    const bondManager = await getBondManager();
    const sealed = await bondManager.getSealedBids(isin).catch(() => []);
    const sealedBids = (
      sealed as Array<{ bidder: string; ciphertext: string; plaintextHash: string }>
    ).map(normalizeSealedBid);

    const offering = parseBigInt(metaRaw.offering?.toString?.() ?? '0', 'offering');
    let unsealedBids: ReturnType<typeof unsealBid>[] | null = null;
    if (sealedBids.length > 0 && offering > 0n) {
      try {
        unsealedBids = sealedBids.map((b, i) => unsealBid(isin, b, i));
      } catch (err) {
        logger.debug(
          `fetchAuctionChainState: unseal failed for ${auctionId}: ${(err as Error).message}`,
        );
      }
    }

    const onChainAllocations = (
      allocRaw as Array<{
        bidder: string;
        units?: bigint | string;
        rate?: bigint | string;
        isin?: string;
        auctionType?: number | bigint;
      }>
    ).map((a) => ({
      bidder: a.bidder,
      units: parseBigInt(a.units?.toString?.() ?? '0', 'units'),
      rate: parseBigInt(a.rate?.toString?.() ?? '0', 'rate'),
      isin: a.isin ?? isin,
      auctionType: onChainAuctionTypeToApi(a.auctionType ?? numericAuctionType(auctionType)),
    }));

    return {
      metadata: {
        isin,
        owner: metaRaw.owner as string,
        end: metaRaw.end ? parseBigInt(metaRaw.end.toString(), 'end') : null,
        offering: metaRaw.offering ? offering : null,
        auctionPubKey: metaRaw.auctionPubKey as string,
        bond: metaRaw.bond as string,
        auctionType,
      },
      status: onChainStatusToApi(Number(statusRaw)),
      sealedBids,
      unsealedBids,
      onChainAllocations,
    };
  } catch (err) {
    logger.warn(`fetchAuctionChainState failed for ${auctionId}: ${(err as Error).message}`);
    return null;
  }
}

export interface ComposeOptions {
  /**
   * Reveal sealed bid contents on auctions still in `open` (BIDDING) phase.
   *
   * Default `false` — bids on open auctions render as sealed (ciphertext +
   * plaintext hash only), matching the sealed-bid auction model. The
   * operator UI flips this to `true` via a debug toggle that appends
   * `?revealOpenBids=true` on bonds/auctions GETs when a sandbox operator
   * wants to inspect plaintext during BIDDING (purely informational —
   * does not change anything on chain). Closed / finalised / cancelled
   * auctions always render unsealed regardless of this flag.
   */
  revealOpenBids?: boolean;
}

export async function composeAuction(
  db: IngestionDatabase,
  auctionId: string,
  opts: ComposeOptions = {},
): Promise<Auction | null> {
  const chain = await fetchAuctionChainState(auctionId);
  if (!chain) return null;

  const { metadata, status, sealedBids, unsealedBids, onChainAllocations } = chain;
  const row = getAuctionRowById(db, auctionId);
  const events = getAuctionEventsById(db, auctionId, 500, 0);

  // Bids: only reveal plaintext after the bidding window has closed, OR
  // when the caller explicitly requests it via `revealOpenBids` (operator
  // debug toggle). During BIDDING the operator UI shows sealed view to
  // match the sealed-bid auction model.
  const allowReveal = status !== 'open' || opts.revealOpenBids === true;
  const bidsOut: Bid[] =
    allowReveal && unsealedBids
      ? unsealedBids.map((b) =>
          composeUnsealedBid({
            bidder: b.bidder,
            rate: parseBigInt(b.plaintext.rate, 'rate'),
            units: parseBigInt(b.plaintext.units, 'units'),
          }),
        )
      : sealedBids.map((b) =>
          composeSealedBid({
            bidder: b.bidder,
            ciphertext: b.ciphertext,
            plaintextHash: b.plaintextHash,
          }),
        );

  // Allocation: on-chain takes precedence; fall back to a fresh local
  // computation if we have unsealed bids and an offering but no on-chain
  // result yet.
  let allocation: Allocation | null = null;
  if (onChainAllocations.length > 0) {
    const clearingRate = onChainAllocations[0].rate;
    const totalAllocated = onChainAllocations.reduce((s, a) => s + a.units, 0n);
    const hash = buildAllocationHash(
      metadata.isin,
      numericAuctionType(metadata.auctionType),
      clearingRate,
      onChainAllocations.map((a) => ({
        bidder: a.bidder,
        units: a.units,
        rate: a.rate,
        isin: a.isin,
        auctionType: numericAuctionType(a.auctionType),
      })),
    );
    allocation = composeAllocation({
      clearingRate,
      totalAllocated,
      hash,
      auctionType: metadata.auctionType,
      computedAt: Date.now(),
      entries: onChainAllocations.map((a) => ({
        bidder: a.bidder,
        units: a.units,
        rate: a.rate,
      })),
    });
  } else if (unsealedBids && metadata.offering && metadata.offering > 0n) {
    try {
      const result =
        metadata.auctionType === 'BUYBACK'
          ? computeBuybackAllocation(metadata.isin, unsealedBids, metadata.offering)
          : computeUniformAllocation(
              metadata.isin,
              numericAuctionType(metadata.auctionType),
              unsealedBids,
              metadata.offering,
            );
      allocation = composeAllocation({
        clearingRate: result.clearingRate,
        totalAllocated: result.totalAllocated,
        hash: result.allocationHash,
        auctionType: auctionTypeToString(result.auctionType) as AuctionType,
        computedAt: result.computedAt,
        entries: result.allocations.map((a) => ({
          bidder: a.bidder,
          units: a.units,
          rate: a.rate,
        })),
      });
    } catch (err) {
      logger.debug(
        `composeAuction: local allocation failed for ${auctionId}: ${(err as Error).message}`,
      );
    }
  }

  // Resolve maturityDuration for RATE auctions from the token contract.
  let maturityDuration: string | null = null;
  if (metadata.auctionType === 'RATE') {
    try {
      const bondToken = await getBondToken();
      const partition = keccak256(toUtf8Bytes(metadata.isin));
      const duration = await bondToken.maturityDuration(partition);
      maturityDuration = duration?.toString?.() ?? null;
    } catch (err) {
      logger.debug(
        `composeAuction: maturityDuration unavailable for ${metadata.isin}: ${(err as Error).message}`,
      );
    }
  }

  const bondAuctionAddress = await getBondAuctionAddress().catch(() => '0x');
  const bondManager = await getBondManager().catch(() => null);
  const bondTokenAddress = bondManager ? await bondManager.BOND_TOKEN().catch(() => '0x') : '0x';

  return withMd5({
    id: auctionId,
    isin: metadata.isin,
    type: metadata.auctionType,
    status,
    end: metadata.end ? metadata.end.toString() : null,
    size: metadata.offering ? metadata.offering.toString() : null,
    maturityDuration,
    owner: metadata.owner,
    sealingPubKey: metadata.auctionPubKey,
    contracts: { auction: bondAuctionAddress, token: bondTokenAddress },
    bids: bidsOut,
    allocation,
    txs: buildAuctionTxs(row, events),
  });
}

// #endregion

// #region Bond composer ──────────────────────────────────────────────

function deriveBondStatus(opts: {
  isMatured: boolean;
  hasRedeemEvent: boolean;
  resolvedSupply: bigint | null;
  couponPaymentCount: bigint | null;
}): BondStatus {
  if (opts.isMatured || opts.hasRedeemEvent) {
    return opts.resolvedSupply === 0n ? 'redeemed' : 'matured';
  }
  if (opts.couponPaymentCount !== null && opts.couponPaymentCount > 0n) return 'maturing';
  if (opts.couponPaymentCount !== null) return 'minting';
  return 'unknown';
}

export async function composeBond(
  db: IngestionDatabase,
  isin: string,
  opts: ComposeOptions = {},
): Promise<Bond | null> {
  let bondToken;
  let bondManager;
  let bondAuctionAddress: string;
  try {
    bondToken = await getBondToken();
    bondManager = await getBondManager();
    bondAuctionAddress = await getBondAuctionAddress();
  } catch (err) {
    logger.warn(`composeBond: contracts unavailable for ${isin}: ${(err as Error).message}`);
    return null;
  }

  const partition = keccak256(toUtf8Bytes(isin));

  const [
    maturityDurationRaw,
    couponDurationRaw,
    couponYieldRaw,
    lastCouponPaymentRaw,
    couponPaymentCountRaw,
    isMaturedRaw,
    totalSupplyRaw,
    maturityDateRaw,
    bondTokenAddress,
  ] = await Promise.all([
    bondToken.maturityDuration(partition).catch(() => null),
    bondToken.couponDuration(partition).catch(() => null),
    bondToken.couponYield(partition).catch(() => null),
    bondToken.lastCouponPayment(partition).catch(() => null),
    bondToken.couponPaymentCount(partition).catch(() => null),
    bondToken.isMatured(partition).catch(() => null),
    bondToken.totalSupplyByPartition(partition).catch(() => null),
    bondToken.maturityDate(partition).catch(() => null),
    bondManager.BOND_TOKEN().catch(() => '0x'),
  ]);

  const bondEvents = getBondEventsByIsin(db, isin, 1000, 0);
  const hasRedeemEvent = bondEvents.some((e) => e.type === 'REDEEMED');

  const maturityDuration = maturityDurationRaw ? BigInt(maturityDurationRaw.toString()) : null;
  const couponDuration = couponDurationRaw ? BigInt(couponDurationRaw.toString()) : null;
  const couponYield = couponYieldRaw ? BigInt(couponYieldRaw.toString()) : null;
  const lastCouponPayment = lastCouponPaymentRaw ? BigInt(lastCouponPaymentRaw.toString()) : null;
  const couponPaymentCount = couponPaymentCountRaw
    ? BigInt(couponPaymentCountRaw.toString())
    : null;
  const maturityDate = maturityDateRaw ? BigInt(maturityDateRaw.toString()) : null;
  const totalSupply = totalSupplyRaw ? BigInt(totalSupplyRaw.toString()) : null;
  const isMatured = Boolean(isMaturedRaw);

  const balanceSum = getBalancesByIsin(db, isin).reduce(
    (sum, b) => sum + BigInt(b.balance ?? '0'),
    0n,
  );
  let resolvedSupply =
    totalSupply !== null ? (balanceSum < totalSupply ? balanceSum : totalSupply) : balanceSum;

  // If the chain says totalSupply is unknown but we observed a redemption,
  // the bond is fully redeemed.
  if (hasRedeemEvent && totalSupply === null) {
    resolvedSupply = 0n;
  }

  let couponPaymentsTotal: bigint | null = null;
  let couponPaymentsRemaining: bigint | null = null;
  if (maturityDuration && couponDuration && couponDuration > 0n) {
    couponPaymentsTotal = maturityDuration / couponDuration;
    if (couponPaymentCount !== null) {
      const remaining = couponPaymentsTotal - couponPaymentCount;
      couponPaymentsRemaining = remaining >= 0n ? remaining : 0n;
    }
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let timeToMaturity: bigint | null = null;
  if (maturityDate && maturityDate > 0n) {
    timeToMaturity = maturityDate > nowSec ? maturityDate - nowSec : 0n;
  } else if (couponDuration && couponPaymentCount !== null && couponPaymentsTotal !== null) {
    const remainingIntervals = couponPaymentsTotal - couponPaymentCount;
    const base = lastCouponPayment && lastCouponPayment > 0n ? lastCouponPayment : nowSec;
    const estimated = base + remainingIntervals * couponDuration;
    timeToMaturity = estimated > nowSec ? estimated - nowSec : 0n;
  }

  const status = deriveBondStatus({
    isMatured,
    hasRedeemEvent,
    resolvedSupply,
    couponPaymentCount,
  });

  // Auctions for this bond, in chronological order.
  const auctionRows = listAuctionRowsByIsin(db, isin);
  const auctions = (
    await Promise.all(auctionRows.map((r) => composeAuction(db, r.auction_id, opts)))
  ).filter((a): a is Auction => a !== null);

  const holders = await composeHolders(db, isin);

  return withMd5({
    isin,
    status,
    totalSupply: resolvedSupply !== null ? resolvedSupply.toString() : null,
    contracts: {
      token: bondTokenAddress,
      auction: bondAuctionAddress,
      manager: bondManager.target.toString(),
    },
    maturity:
      maturityDuration !== null || maturityDate !== null || timeToMaturity !== null
        ? {
            duration: maturityDuration ? maturityDuration.toString() : null,
            date: maturityDate ? maturityDate.toString() : null,
            remaining: timeToMaturity ? timeToMaturity.toString() : null,
          }
        : null,
    coupon:
      couponDuration !== null || couponYield !== null || couponPaymentsTotal !== null
        ? {
            duration: couponDuration ? couponDuration.toString() : null,
            yieldBps: couponYield ? couponYield.toString() : null,
            payments: {
              total: couponPaymentsTotal ? couponPaymentsTotal.toString() : null,
              made: couponPaymentCount !== null ? couponPaymentCount.toString() : null,
              remaining: couponPaymentsRemaining ? couponPaymentsRemaining.toString() : null,
            },
          }
        : null,
    holders,
    auctions,
  });
}

// #endregion

// #region Multi-resource composers ───────────────────────────────────

export async function composeAllBonds(
  db: IngestionDatabase,
  opts: ComposeOptions = {},
): Promise<Bond[]> {
  const rows = listBondRows(db);
  const bonds = await Promise.all(rows.map((r) => composeBond(db, r.isin, opts)));
  return bonds.filter((b): b is Bond => b !== null);
}

export async function composeAllAuctions(
  db: IngestionDatabase,
  opts: ComposeOptions = {},
): Promise<Auction[]> {
  const rows = listAuctionRows(db);
  const auctions = await Promise.all(rows.map((r) => composeAuction(db, r.auction_id, opts)));
  return auctions.filter((a): a is Auction => a !== null);
}

// #endregion

// #region History composer ───────────────────────────────────────────

export function composeBondHistory(
  db: IngestionDatabase,
  isin: string,
  opts: { before?: number | null; limit?: number | null } = {},
): HistoryEvent[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  // before-block filtering: fetch a generous window and slice. Sandbox
  // scale tolerates this; a proper cursor scan is left for later.
  const fetchLimit = limit * 4;
  const auctionEvents = getAuctionEventsByIsin(db, isin, fetchLimit, 0);
  const bondEvents = getBondEventsByIsin(db, isin, fetchLimit, 0);

  const merged: HistoryEvent[] = [
    ...auctionEvents.map((e) => ({
      isin: e.isin,
      auctionId: e.auction_id,
      type: e.type,
      block: e.block,
      txHash: e.tx_hash,
      payload: safeJson(e.payload),
    })),
    ...bondEvents.map((e) => ({
      isin: e.isin,
      auctionId: null,
      type: e.type,
      block: e.block,
      txHash: e.tx_hash,
      payload: safeJson(e.payload),
    })),
  ]
    .filter((e) => (opts.before != null ? e.block < opts.before : true))
    .sort((a, b) => b.block - a.block);

  return merged.slice(0, limit);
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// #endregion
