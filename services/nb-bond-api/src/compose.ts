/**
 * Projection-backed HTTP DTO composition.
 *
 * Every Bond/Auction tree is loaded synchronously from one SQLite read
 * transaction, then mapped to the public contract without request-path RPC
 * calls. Besu remains authoritative; ingestion owns the deterministic,
 * disposable projection used here.
 */
import { DependencyUnavailableError } from './application-errors';
import {
  type IngestionDatabase,
  getAuctionEventsByIsin,
  getAuctionRowById,
  getBondEventsByIsin,
  listAllAuctions,
  listAllBonds,
} from './ingestion-db';
import { composeProjectedAuction, composeProjectedBond } from './projection/compose-projection';
import {
  loadAllAuctionSnapshots,
  loadAllBondSnapshots,
  loadAuctionSnapshot,
  loadBondSnapshot,
} from './projection/snapshots';
import type { Auction, Bond, HistoryEvent } from './schemas';

export interface ComposeOptions {
  /** Reveal projected sealed bid contents during BIDDING for sandbox debugging. */
  revealOpenBids?: boolean;
  /** Include soft-deleted bonds in the collection response. */
  includeDisabled?: boolean;
}

export async function composeAuction(
  db: IngestionDatabase,
  auctionId: string,
  options: ComposeOptions = {},
): Promise<Auction | null> {
  const projected = loadAuctionSnapshot(db, auctionId);
  if (projected) {
    return composeProjectedAuction(projected.auction, projected.context, {
      revealOpenBids: options.revealOpenBids,
    });
  }
  if (getAuctionRowById(db, auctionId)) {
    throw new DependencyUnavailableError(
      'projection',
      `auction ${auctionId}`,
      new Error('required auction projection context or checkpoint is missing'),
    );
  }
  return null;
}

export async function composeBond(
  db: IngestionDatabase,
  isin: string,
  _options: ComposeOptions = {},
): Promise<Bond | null> {
  const projected = loadBondSnapshot(db, isin);
  if (projected) return composeProjectedBond(projected);
  const bondExists = listAllBonds(db, { includeDisabled: true }).some((row) => row.isin === isin);
  if (bondExists) {
    throw new DependencyUnavailableError(
      'projection',
      `bond ${isin}`,
      new Error('required bond projection context or checkpoint is missing'),
    );
  }
  return null;
}

export async function composeAllBonds(
  db: IngestionDatabase,
  options: ComposeOptions = {},
): Promise<Bond[]> {
  const snapshots = loadAllBondSnapshots(db, { includeDisabled: options.includeDisabled });
  const expected = listAllBonds(db, { includeDisabled: options.includeDisabled });
  if (snapshots.length !== expected.length) {
    throw new DependencyUnavailableError(
      'projection',
      'bonds',
      new Error('one or more bond snapshots are incomplete'),
    );
  }
  return snapshots.map(composeProjectedBond);
}

export async function composeAllAuctions(
  db: IngestionDatabase,
  options: ComposeOptions = {},
): Promise<Auction[]> {
  const projected = loadAllAuctionSnapshots(db);
  const expected = listAllAuctions(db);
  if (!projected) {
    if (expected.length === 0) return [];
    throw new DependencyUnavailableError(
      'projection',
      'auctions',
      new Error('auction projection context or checkpoint is missing'),
    );
  }
  if (projected.auctions.length !== expected.length) {
    throw new DependencyUnavailableError(
      'projection',
      'auctions',
      new Error('one or more auction snapshots are incomplete'),
    );
  }
  return projected.auctions.map((auction) =>
    composeProjectedAuction(auction, projected.context, {
      revealOpenBids: options.revealOpenBids,
    }),
  );
}

export function composeBondHistory(
  db: IngestionDatabase,
  isin: string,
  options: { before?: number | null; limit?: number | null } = {},
): HistoryEvent[] {
  const limit = Math.min(options.limit ?? 100, 500);
  const fetchLimit = limit * 4;
  const auctionEvents = getAuctionEventsByIsin(db, isin, fetchLimit, 0);
  const bondEvents = getBondEventsByIsin(db, isin, fetchLimit, 0);

  const merged: HistoryEvent[] = [
    ...auctionEvents.map((event) => ({
      isin: event.isin,
      auctionId: event.auction_id,
      type: event.type,
      block: event.block,
      txHash: event.tx_hash,
      payload: safeJson(event.payload),
    })),
    ...bondEvents.map((event) => ({
      isin: event.isin,
      auctionId: null,
      type: event.type,
      block: event.block,
      txHash: event.tx_hash,
      payload: safeJson(event.payload),
    })),
  ]
    .filter((event) => (options.before != null ? event.block < options.before : true))
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
