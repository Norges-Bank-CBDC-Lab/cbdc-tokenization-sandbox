import {
  type AuctionAllocationRow,
  type AuctionBidRow,
  type AuctionEventRow,
  type AuctionRow,
  type BalanceRow,
  type BondStateRow,
  type IngestionDatabase,
  type ProjectionContextRow,
  getAuctionAllocations,
  getAuctionBids,
  getAuctionEventsById,
  getAuctionRowById,
  getBalancesByIsin,
  getBondEventsByIsin,
  getBondStateByIsin,
  getProjectionCheckpoint,
  getProjectionContext,
  listAllAuctions,
  listAllBonds,
  listAuctionRowsByIsin,
} from '../ingestion-db';

export type ProjectionCheckpoint = {
  asOfBlock: number;
  blockTimestamp: number | null;
};

export type AuctionSnapshot = {
  row: AuctionRow;
  events: AuctionEventRow[];
  bids: AuctionBidRow[];
  allocations: AuctionAllocationRow[];
  maturityDuration: string | null;
};

export type BondSnapshot = {
  state: BondStateRow;
  balances: BalanceRow[];
  events: ReturnType<typeof getBondEventsByIsin>;
  auctions: AuctionSnapshot[];
  context: ProjectionContextRow;
  checkpoint: ProjectionCheckpoint;
};

function loadAuction(db: IngestionDatabase, row: AuctionRow): AuctionSnapshot {
  return {
    row,
    events: getAuctionEventsById(db, row.auction_id, 500, 0),
    bids: getAuctionBids(db, row.auction_id),
    allocations: getAuctionAllocations(db, row.auction_id),
    maturityDuration: getBondStateByIsin(db, row.isin)?.maturity_duration ?? null,
  };
}

function runRead<T>(db: IngestionDatabase, read: () => T): T {
  return db.transaction(read)();
}

export function loadAuctionSnapshot(
  db: IngestionDatabase,
  auctionId: string,
): {
  auction: AuctionSnapshot;
  context: ProjectionContextRow;
  checkpoint: ProjectionCheckpoint;
} | null {
  return runRead(db, () => {
    const row = getAuctionRowById(db, auctionId);
    const context = getProjectionContext(db);
    const checkpoint = getProjectionCheckpoint(db);
    if (!row || !context || !checkpoint) return null;
    return { auction: loadAuction(db, row), context, checkpoint };
  });
}

export function loadBondSnapshot(db: IngestionDatabase, isin: string): BondSnapshot | null {
  return runRead(db, () => {
    const state = getBondStateByIsin(db, isin);
    const context = getProjectionContext(db);
    const checkpoint = getProjectionCheckpoint(db);
    if (!state || !context || !checkpoint) return null;
    return {
      state,
      balances: getBalancesByIsin(db, isin),
      events: getBondEventsByIsin(db, isin, 1000, 0),
      auctions: listAuctionRowsByIsin(db, isin).map((row) => loadAuction(db, row)),
      context,
      checkpoint,
    };
  });
}

export function loadAllBondSnapshots(
  db: IngestionDatabase,
  options: { includeDisabled?: boolean } = {},
): BondSnapshot[] {
  return runRead(db, () => {
    const context = getProjectionContext(db);
    const checkpoint = getProjectionCheckpoint(db);
    if (!context || !checkpoint) return [];
    return listAllBonds(db, options).flatMap((row) => {
      const state = getBondStateByIsin(db, row.isin);
      if (!state) return [];
      return [
        {
          state,
          balances: getBalancesByIsin(db, row.isin),
          events: getBondEventsByIsin(db, row.isin, 1000, 0),
          auctions: listAuctionRowsByIsin(db, row.isin).map((auction) => loadAuction(db, auction)),
          context,
          checkpoint,
        },
      ];
    });
  });
}

export function loadAllAuctionSnapshots(db: IngestionDatabase): {
  auctions: AuctionSnapshot[];
  context: ProjectionContextRow;
  checkpoint: ProjectionCheckpoint;
} | null {
  return runRead(db, () => {
    const context = getProjectionContext(db);
    const checkpoint = getProjectionCheckpoint(db);
    if (!context || !checkpoint) return null;
    return {
      auctions: listAllAuctions(db).map((row) => loadAuction(db, row)),
      context,
      checkpoint,
    };
  });
}
