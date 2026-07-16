import { Contract, JsonRpcProvider, Log, keccak256, toUtf8Bytes } from 'ethers';

import { bondAuctionAbi, bondManagerAbi, bondTokenAbi } from './abi';
import { envVariables } from './env-vars';
import { RpcUnavailableError, getBondManagerAddress } from './chain';
import { logger } from './logger';
import {
  bindChainIdentity,
  ChainIdentityMismatchError,
  type IngestionDatabase,
  openDatabase,
} from './ingestion-db';
import { type LiveResourceKey, publishLiveChange } from './live-events';
import { reducePartitionTransfer, ZERO_ADDRESS } from './projection/balance-reducer';
import {
  type BondProjectionEvent,
  type BondState,
  emptyBondState,
  reduceBondState,
} from './projection/bond-state';
import { toPlainObject } from './utils';

type Checkpoint = {
  contract: string;
  last_block: number;
  last_tx_index: number;
  block_timestamp: number | null;
};
type ParsedLog = { name?: string; args?: Record<string, unknown> };
type TransferAction = {
  kind: 'transfer';
  partition: string;
  from: string;
  to: string;
  value: bigint;
  block: number;
  logIndex: number;
  txHash: string;
};

const provider = new JsonRpcProvider(envVariables.RPC_URL);

// Module-level runtime state for /v1/health. Lost on pod restart and
// rebuilt by the next tick — none of it is authoritative.
let loopRunning = false;
let lastTickAt: number | null = null;
let consecutiveFailures = 0;
let lastBlockProcessed: number | null = null;
let lastEventTxHash: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let projectionAdvancer: ((targetBlock?: number) => Promise<boolean>) | null = null;
let ingestionQueue = Promise.resolve();

const RECENT_ERRORS_MAX = 10;
let recentErrors: RecentIngestionError[] = [];

export type RecentIngestionError = {
  ts: number;
  message: string;
  code: string | null;
};

export type IngestionStatus = {
  loopRunning: boolean;
  lastTickAt: number | null;
  consecutiveFailures: number;
  lastBlockProcessed: number | null;
  lastEventTxHash: string | null;
  pollIntervalMs: number;
  recentErrors: RecentIngestionError[];
};

function pushError(err: unknown): void {
  const e = err as { message?: unknown; code?: unknown; name?: unknown };
  const message = typeof e?.message === 'string' ? e.message : String(err);
  const codeRaw =
    typeof e?.code === 'string' ? e.code : typeof e?.name === 'string' ? e.name : null;
  recentErrors = [{ ts: Date.now(), message, code: codeRaw }, ...recentErrors].slice(
    0,
    RECENT_ERRORS_MAX,
  );
}

export function getIngestionStatus(): IngestionStatus {
  return {
    loopRunning,
    lastTickAt,
    consecutiveFailures,
    lastBlockProcessed,
    lastEventTxHash,
    pollIntervalMs: envVariables.POLL_INTERVAL_MS,
    recentErrors: [...recentErrors],
  };
}

/**
 * Tear down the running ingestion interval so a fresh one can take
 * over. Safe to call when the loop never started (e.g. mid-retry
 * during boot) — leaves `consecutiveFailures` / `recentErrors` intact
 * because they're informational, not loop-state.
 *
 * `loopRunning` flips to false so a concurrent /v1/health poll sees
 * the transient state and the operator UI shows `down` briefly.
 */
export function stopIngestionLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  projectionAdvancer = null;
  loopRunning = false;
}

/**
 * Test seam — admin.test.ts forces specific module state to validate
 * the reset path without spinning up a real loop. Not part of the
 * runtime API.
 */
export function __resetIngestionStateForTests(): void {
  stopIngestionLoop();
  lastTickAt = null;
  consecutiveFailures = 0;
  lastBlockProcessed = null;
  lastEventTxHash = null;
  recentErrors = [];
}

/** Test seam — exposes pushError() so tests can verify ring-buffer behaviour. */
export function __pushIngestionErrorForTests(err: unknown): void {
  pushError(err);
}

function loadCheckpoint(db: IngestionDatabase, contract: string): Checkpoint {
  const stmt = db.prepare(
    `SELECT contract, last_block, last_tx_index, block_timestamp
     FROM ingestion_state WHERE contract = ?`,
  );
  const row = stmt.get(contract) as Checkpoint | undefined;
  return (
    row ?? {
      contract,
      last_block: envVariables.START_BLOCK,
      last_tx_index: 0,
      block_timestamp: null,
    }
  );
}

function saveCheckpoint(db: IngestionDatabase, checkpoint: Checkpoint) {
  const stmt = db.prepare(
    `INSERT INTO ingestion_state(contract, last_block, last_tx_index, block_timestamp)
     VALUES (@contract, @last_block, @last_tx_index, @block_timestamp)
     ON CONFLICT(contract) DO UPDATE SET
       last_block=excluded.last_block,
       last_tx_index=excluded.last_tx_index,
       block_timestamp=excluded.block_timestamp`,
  );
  stmt.run(checkpoint);
}

function decodeManagerEvents(logs: Log[], bondManager: Contract) {
  const iface = bondManager.interface;
  return logs
    .map((log) => {
      try {
        const parsed = iface.parseLog(log);
        return { log, parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { log: Log; parsed: ParsedLog }[];
}

function decodeTokenEvents(logs: Log[], bondToken: Contract) {
  const iface = bondToken.interface;
  return logs
    .map((log) => {
      try {
        const parsed = iface.parseLog(log);
        return { log, parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { log: Log; parsed: ParsedLog }[];
}

function projectedAuctionType(value: unknown): 'RATE' | 'PRICE' | 'BUYBACK' {
  const numeric = Number(value ?? 1);
  return numeric === 0 ? 'RATE' : numeric === 2 ? 'BUYBACK' : 'PRICE';
}

// Exported for direct unit-test coverage of idempotency behaviour
// (tests/ingestion-idempotency.test.ts). Not part of the runtime
// API consumed by other modules.
export function upsertAuctionEvent(
  db: IngestionDatabase,
  data: {
    auctionId: string;
    isin: string;
    type: string;
    block: number;
    logIndex: number;
    txHash: string;
    payload: unknown;
    bond?: string | null;
  },
) {
  const insertAuction = db.prepare(
    `INSERT INTO auctions (auction_id, isin, type, created_block, created_tx, bond)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(auction_id) DO UPDATE SET
       isin=excluded.isin,
       type=COALESCE(auctions.type, excluded.type),
       bond=COALESCE(auctions.bond, excluded.bond)`,
  );
  insertAuction.run(
    data.auctionId ?? '',
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
    data.txHash ?? '',
    data.bond ?? null,
  );

  // `INSERT OR IGNORE` paired with the UNIQUE INDEX on
  // (tx_hash, log_index) makes re-processing the same chain log a
  // no-op.
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO auction_events (auction_id, isin, type, block, log_index, tx_hash, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run(
    data.auctionId ?? '',
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
    Number(data.logIndex ?? 0),
    data.txHash ?? '',
    JSON.stringify(toPlainObject(data.payload ?? {})),
  );
}

export function upsertAuctionMetadata(
  db: IngestionDatabase,
  data: {
    auctionId: string;
    isin: string;
    owner: string;
    end: bigint;
    offering: bigint;
    auctionPubKey: string;
    auctionType: string;
    block: number;
    txHash: string;
  },
): void {
  db.prepare(
    `INSERT INTO auctions (
      auction_id, isin, type, created_block, created_tx, owner, end,
      offering, auction_pub_key, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    ON CONFLICT(auction_id) DO UPDATE SET
      isin=excluded.isin, type=excluded.type,
      created_block=COALESCE(auctions.created_block, excluded.created_block),
      created_tx=COALESCE(auctions.created_tx, excluded.created_tx),
      owner=excluded.owner, end=excluded.end, offering=excluded.offering,
      auction_pub_key=excluded.auction_pub_key`,
  ).run(
    data.auctionId,
    data.isin,
    data.auctionType,
    data.block,
    data.txHash,
    data.owner.toLowerCase(),
    data.end.toString(),
    data.offering.toString(),
    data.auctionPubKey,
  );
}

export function upsertAuctionBid(
  db: IngestionDatabase,
  data: {
    auctionId: string;
    bidIndex: number;
    bidder: string;
    ciphertext: string;
    plaintextHash: string;
    block: number;
    logIndex: number;
  },
): void {
  db.prepare(
    `INSERT INTO auction_bids (
      auction_id, bid_index, bidder, ciphertext, plaintext_hash,
      cancelled, source_block, source_log_index
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(auction_id, bid_index) DO UPDATE SET
      bidder=excluded.bidder, ciphertext=excluded.ciphertext,
      plaintext_hash=excluded.plaintext_hash,
      source_block=excluded.source_block, source_log_index=excluded.source_log_index`,
  ).run(
    data.auctionId,
    data.bidIndex,
    data.bidder.toLowerCase(),
    data.ciphertext,
    data.plaintextHash,
    data.block,
    data.logIndex,
  );
}

export function cancelAuctionBid(
  db: IngestionDatabase,
  auctionId: string,
  bidder: string,
  plaintextHash: string,
): void {
  db.prepare(
    `UPDATE auction_bids SET cancelled = 1
     WHERE auction_id = ? AND LOWER(bidder) = LOWER(?) AND plaintext_hash = ?`,
  ).run(auctionId, bidder, plaintextHash);
}

export function setAuctionStatus(
  db: IngestionDatabase,
  auctionId: string,
  status: 'open' | 'closed' | 'finalised' | 'cancelled',
  sourceTimestamp: number | null = null,
): void {
  db.prepare(
    `UPDATE auctions SET
       status = ?,
       closed_at = CASE WHEN ? = 'closed' THEN COALESCE(?, closed_at) ELSE closed_at END,
       finalised_at = CASE WHEN ? = 'finalised' THEN COALESCE(?, finalised_at) ELSE finalised_at END
     WHERE auction_id = ?`,
  ).run(status, status, sourceTimestamp, status, sourceTimestamp, auctionId);
}

export function replaceAuctionAllocations(
  db: IngestionDatabase,
  auctionId: string,
  sourceBlock: number,
  allocations: Array<{ bidder: string; units: bigint; rate: bigint; auctionType: string }>,
): void {
  db.prepare(`DELETE FROM auction_allocations WHERE auction_id = ?`).run(auctionId);
  const insert = db.prepare(
    `INSERT INTO auction_allocations (
      auction_id, position, bidder, units, rate, auction_type, source_block
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  allocations.forEach((allocation, position) => {
    insert.run(
      auctionId,
      position,
      allocation.bidder.toLowerCase(),
      allocation.units.toString(),
      allocation.rate.toString(),
      allocation.auctionType,
      sourceBlock,
    );
  });
}

// Exported for direct unit-test coverage of idempotency behaviour.
export function applyBalanceDelta(
  db: IngestionDatabase,
  data: {
    isin: string;
    holder: string;
    delta: bigint;
    block: number;
    logIndex: number;
    txHash: string;
    kind: string;
  },
): boolean {
  if (data.holder.toLowerCase() === ZERO_ADDRESS) return false;

  // The balance projection is idempotent because we INSERT OR IGNORE
  // the event row first and only mutate `balances` if the event row
  // was actually written. Without this guard a replay would
  // double-apply the delta.
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO balance_events (isin, holder, delta, balance_after, block, log_index, tx_hash, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // We need balance_after before the row is committed; compute it
  // from current state and apply the delta only if the dedup write
  // succeeds.
  const getBalance = db.prepare(`SELECT balance FROM balances WHERE isin = ? AND holder = ?`);
  const row = getBalance.get(data.isin ?? '', data.holder ?? '') as { balance: string } | undefined;
  const current = BigInt(row?.balance ?? '0');
  const next = current + data.delta;
  const result = insertEvent.run(
    data.isin ?? '',
    data.holder ?? '',
    data.delta.toString(),
    next.toString(),
    Number(data.block ?? 0),
    Number(data.logIndex ?? 0),
    data.txHash ?? '',
    data.kind ?? '',
  );
  const wrote = Number(result?.changes ?? 0) > 0;
  if (!wrote) {
    // Duplicate (tx_hash, log_index, holder) — already applied. Skip
    // the balance mutation to keep the projection consistent under
    // replay.
    return false;
  }
  const upsert = db.prepare(
    `INSERT INTO balances (isin, holder, balance) VALUES (?, ?, ?)
     ON CONFLICT(isin, holder) DO UPDATE SET balance=excluded.balance`,
  );
  upsert.run(data.isin ?? '', data.holder ?? '', next.toString());
  return true;
}

function loadBondState(db: IngestionDatabase, isin: string, partition: string): BondState {
  const row = db.prepare(`SELECT * FROM bond_state WHERE isin = ?`).get(isin) as
    Record<string, unknown> | undefined;
  if (!row) return emptyBondState(isin, partition);
  return {
    isin: String(row.isin),
    partition: String(row.partition),
    bondAddress: row.bond_address === null ? null : String(row.bond_address),
    disabled: Boolean(row.disabled),
    maturityDuration: row.maturity_duration === null ? null : String(row.maturity_duration),
    maturityDate: row.maturity_date === null ? null : String(row.maturity_date),
    couponDuration: row.coupon_duration === null ? null : String(row.coupon_duration),
    couponYield: row.coupon_yield === null ? null : String(row.coupon_yield),
    lastCouponPayment: row.last_coupon_payment === null ? null : String(row.last_coupon_payment),
    couponPaymentCount: String(row.coupon_payment_count),
    isMatured: Boolean(row.is_matured),
    totalSupply: String(row.total_supply),
    offering: String(row.offering),
    everIssued: Boolean(row.ever_issued),
    redemptionComplete: Boolean(row.redemption_complete),
    updatedBlock: Number(row.updated_block),
    updatedLogIndex: Number(row.updated_log_index),
  };
}

function saveBondState(db: IngestionDatabase, state: BondState): void {
  db.prepare(
    `INSERT INTO bond_state (
      isin, partition, bond_address, disabled, maturity_duration, maturity_date,
      coupon_duration, coupon_yield, last_coupon_payment, coupon_payment_count,
      is_matured, total_supply, offering, ever_issued, redemption_complete,
      updated_block, updated_log_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(isin) DO UPDATE SET
      partition=excluded.partition, bond_address=excluded.bond_address,
      disabled=excluded.disabled, maturity_duration=excluded.maturity_duration,
      maturity_date=excluded.maturity_date, coupon_duration=excluded.coupon_duration,
      coupon_yield=excluded.coupon_yield, last_coupon_payment=excluded.last_coupon_payment,
      coupon_payment_count=excluded.coupon_payment_count, is_matured=excluded.is_matured,
      total_supply=excluded.total_supply, offering=excluded.offering,
      ever_issued=excluded.ever_issued, redemption_complete=excluded.redemption_complete,
      updated_block=excluded.updated_block, updated_log_index=excluded.updated_log_index`,
  ).run(
    state.isin,
    state.partition,
    state.bondAddress,
    state.disabled ? 1 : 0,
    state.maturityDuration,
    state.maturityDate,
    state.couponDuration,
    state.couponYield,
    state.lastCouponPayment,
    state.couponPaymentCount,
    state.isMatured ? 1 : 0,
    state.totalSupply,
    state.offering,
    state.everIssued ? 1 : 0,
    state.redemptionComplete ? 1 : 0,
    state.updatedBlock,
    state.updatedLogIndex,
  );
}

function applyBondStateEvent(
  db: IngestionDatabase,
  isin: string,
  event: BondProjectionEvent,
  block: number,
  logIndex: number,
): void {
  const partition = keccak256(toUtf8Bytes(isin));
  const current = loadBondState(db, isin, partition);
  saveBondState(db, reduceBondState(current, event, { block, logIndex }));
}

function upsertPartition(
  db: IngestionDatabase,
  partition: string,
  isin: string,
  bond: string | null,
  block: number | null,
) {
  const insert = db.prepare(
    `INSERT INTO partitions (partition, isin, bond, created_block)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(partition) DO UPDATE SET isin=excluded.isin, bond=COALESCE(partitions.bond, excluded.bond), created_block=COALESCE(partitions.created_block, excluded.created_block)`,
  );
  insert.run(partition.toLowerCase(), isin, bond ?? null, block ?? null);
}

function getIsinForPartition(db: IngestionDatabase, partition: string): string | null {
  const stmt = db.prepare(`SELECT isin FROM partitions WHERE partition = ?`);
  const row = stmt.get(partition.toLowerCase()) as { isin: string } | undefined;
  return row?.isin ?? null;
}

function setPartitionDisabled(db: IngestionDatabase, isin: string, disabled: boolean): void {
  const partition = keccak256(toUtf8Bytes(isin));
  const stmt = db.prepare(`UPDATE partitions SET disabled = ? WHERE partition = ?`);
  stmt.run(disabled ? 1 : 0, partition.toLowerCase());
}

// Exported for direct unit-test coverage of idempotency behaviour.
export function insertBondEvent(
  db: IngestionDatabase,
  data: {
    isin: string;
    type: string;
    block: number;
    logIndex: number;
    txHash: string;
    payload?: unknown;
  },
) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO bond_events (isin, type, block, log_index, tx_hash, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
    Number(data.logIndex ?? 0),
    data.txHash ?? '',
    JSON.stringify(toPlainObject(data.payload ?? {})),
  );
}

function resolveIsin(
  db: IngestionDatabase,
  raw: unknown,
  resolvedPartitions?: Record<string, string | null>,
): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'object' && raw !== null && 'hash' in raw) {
    const hash = (raw as { hash?: unknown }).hash;
    if (typeof hash !== 'string') {
      return null;
    }
    const partitionHash = hash.toLowerCase();
    return (
      resolvedPartitions?.[partitionHash] ?? getIsinForPartition(db, partitionHash) ?? partitionHash
    );
  }
  return null;
}

function extractPartition(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && 'hash' in raw) {
    const hash = (raw as { hash?: unknown }).hash;
    if (typeof hash === 'string') {
      return hash.toLowerCase();
    }
  }
  return null;
}

async function processBlockRange(
  db: IngestionDatabase,
  bondManager: Contract,
  bondToken: Contract,
  bondAuction: Contract,
  fromBlock: number,
  toBlock: number,
  nextCheckpoint: Checkpoint,
): Promise<{ latestTxHash: string | null; changedResources: Set<LiveResourceKey> }> {
  const managerAddress = bondManager.target.toString();
  const tokenAddress = bondToken.target.toString();
  const auctionAddress = bondAuction.target.toString();

  const [managerLogs, tokenLogs, auctionLogs] = await Promise.all([
    provider.getLogs({ address: managerAddress, fromBlock, toBlock }),
    provider.getLogs({ address: tokenAddress, fromBlock, toBlock }),
    provider.getLogs({ address: auctionAddress, fromBlock, toBlock }),
  ]);

  const parsedManager = decodeManagerEvents(managerLogs, bondManager);
  const parsedToken = decodeTokenEvents(tokenLogs, bondToken);
  const parsedAuction = decodeTokenEvents(auctionLogs, bondAuction);
  const changedResources = new Set<LiveResourceKey>();

  // Resolve partition hashes seen in manager events back to ISINs to keep bond status accurate
  const partitionsNeedingResolution = new Set<string>();
  for (const entry of parsedManager) {
    const maybePartition = extractPartition(entry?.parsed?.args?.isin);
    if (maybePartition) partitionsNeedingResolution.add(maybePartition);
  }
  const resolvedPartitions: Record<string, string | null> = {};
  for (const partition of partitionsNeedingResolution) {
    const existing = getIsinForPartition(db, partition);
    if (existing) {
      resolvedPartitions[partition] = existing;
      continue;
    }
    const onChain = await bondToken.partitionToIsin(partition).catch(() => null);
    resolvedPartitions[partition] = onChain ?? null;
  }

  // TransferByPartition is the sole balance movement source. Mint/redeem also
  // emit high-level IsinMinted/IsinRedeemed events, so reducing those here
  // would apply the same state transition twice.
  const tokenPartitionMappings = parsedToken.flatMap(({ log, parsed }) => {
    const isin = parsed?.args?.isin;
    if (typeof isin !== 'string' || isin.length === 0) return [];
    return [
      {
        partition: keccak256(toUtf8Bytes(isin)),
        isin,
        block: Number(log.blockNumber ?? 0),
      },
    ];
  });
  const tokenActions = parsedToken.map(({ log, parsed }) => {
    if (!parsed?.name) return null;
    const name = parsed.name;
    const args = (parsed.args ?? {}) as Record<string, unknown>;
    if (name === 'TransferByPartition') {
      const partition = args.fromPartition as string;
      const from = (args.from as string).toLowerCase();
      const to = (args.to as string).toLowerCase();
      const value = BigInt(String(args.value));
      return {
        kind: 'transfer' as const,
        partition,
        from,
        to,
        value,
        block: Number(log.blockNumber ?? 0),
        logIndex: Number(log.index ?? 0),
        txHash: log.transactionHash,
      } satisfies TransferAction;
    }
    return null;
  });

  const timestampBlocks = new Set<number>();
  for (const { log, parsed } of [...parsedManager, ...parsedToken, ...parsedAuction]) {
    if (
      parsed?.name === 'CouponPaid' ||
      parsed?.name === 'IsinEnabled' ||
      parsed?.name === 'BondAuctionClosed' ||
      parsed?.name === 'BondAuctionFinalised' ||
      parsed?.name === 'AuctionFinalized'
    ) {
      timestampBlocks.add(Number(log.blockNumber ?? 0));
    }
  }
  const blockTimestamps = new Map<number, bigint>();
  const finalAllocations = new Map<
    string,
    Array<{ bidder: string; units: bigint; rate: bigint; auctionType: string }>
  >();
  for (const { log, parsed } of parsedAuction) {
    if (parsed?.name !== 'AuctionFinalized') continue;
    const args = (parsed.args ?? {}) as Record<string, unknown>;
    const auctionId = String(args.id);
    const block = Number(log.blockNumber ?? 0);
    const rows = (await bondAuction.getAllocations(auctionId, { blockTag: block })) as Array<{
      bidder: string;
      units: bigint;
      rate: bigint;
      auctionType: bigint | number;
    }>;
    finalAllocations.set(
      auctionId,
      rows.map((row) => ({
        bidder: row.bidder,
        units: BigInt(row.units.toString()),
        rate: BigInt(row.rate.toString()),
        auctionType: projectedAuctionType(row.auctionType),
      })),
    );
  }
  await Promise.all(
    [...timestampBlocks].map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      if (!block) throw new Error(`missing source block ${blockNumber} during projection replay`);
      blockTimestamps.set(blockNumber, BigInt(block.timestamp));
    }),
  );

  const tx = db.transaction(() => {
    logger.debug(
      `ingestion decoded ${parsedManager.length} manager logs and ${tokenActions.filter(Boolean).length} token logs for blocks [${fromBlock}, ${toBlock}]`,
    );
    // Persist any newly resolved partition -> ISIN mappings before events that depend on them
    for (const [partition, isin] of Object.entries(resolvedPartitions)) {
      if (isin) {
        upsertPartition(db, partition, isin, null, null);
      }
    }
    // High-level token events still provide useful partition identity facts;
    // only their duplicate balance arithmetic is ignored.
    for (const mapping of tokenPartitionMappings) {
      upsertPartition(db, mapping.partition, mapping.isin, null, mapping.block);
    }
    for (const entry of parsedManager) {
      if (!entry?.parsed?.name) continue;
      const { log, parsed } = entry;
      const name = parsed.name;
      const args = (parsed.args ?? {}) as Record<string, unknown>;
      if (
        name === 'BondAuctionInitialised' ||
        name === 'BondExtensionAuctionInitialised' ||
        name === 'BondBuybackAuctionInitialised'
      ) {
        changedResources.add('auctions');
        changedResources.add('bonds');
        const auctionId = args.id as string;
        const isin = args.isin as string;
        const type =
          name === 'BondAuctionInitialised'
            ? 'RATE'
            : name === 'BondExtensionAuctionInitialised'
              ? 'PRICE'
              : 'BUYBACK';
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type,
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
          bond: args.bondAddress?.toString?.() ?? null,
        });
        setAuctionStatus(db, auctionId, 'open');
        const partition = keccak256(toUtf8Bytes(isin));
        upsertPartition(
          db,
          partition,
          isin,
          args.bondAddress?.toString?.() ?? null,
          Number(log.blockNumber ?? 0),
        );
        // Defensive: a disabled bond re-created via deployBondWithAuction
        // should reappear in the default listing.
        setPartitionDisabled(db, isin, false);
      } else if (name === 'BondAuctionClosed') {
        changedResources.add('auctions');
        changedResources.add('bonds');
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'CLOSED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
        setAuctionStatus(
          db,
          auctionId,
          'closed',
          Number((blockTimestamps.get(Number(log.blockNumber ?? 0)) ?? 0n) * 1000n),
        );
      } else if (name === 'BondAuctionFinalised') {
        changedResources.add('auctions');
        changedResources.add('bonds');
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'FINALISED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
        setAuctionStatus(
          db,
          auctionId,
          'finalised',
          Number((blockTimestamps.get(Number(log.blockNumber ?? 0)) ?? 0n) * 1000n),
        );
      } else if (name === 'BondAuctionCancelled') {
        changedResources.add('auctions');
        changedResources.add('bonds');
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'CANCELLED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
        setAuctionStatus(db, auctionId, 'cancelled');
      } else if (name === 'CouponPaid') {
        changedResources.add('bonds');
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'COUPON_PAID',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {
            holder: args.holder,
            paymentAmount: args.paymentAmount?.toString?.() ?? args.paymentAmount,
            paymentNumber: args.paymentNumber?.toString?.() ?? args.paymentNumber,
          },
        });
        if (isin) {
          const block = Number(log.blockNumber ?? 0);
          applyBondStateEvent(
            db,
            isin,
            {
              type: 'coupon-paid',
              paymentNumber: BigInt(String(args.paymentNumber)),
              blockTimestamp: blockTimestamps.get(block) ?? 0n,
            },
            block,
            Number(log.index ?? 0),
          );
        }
      } else if (name === 'AllCouponsPaid') {
        changedResources.add('bonds');
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'COUPON_COMPLETE',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
        if (isin) {
          applyBondStateEvent(
            db,
            isin,
            { type: 'matured' },
            Number(log.blockNumber ?? 0),
            Number(log.index ?? 0),
          );
        }
      } else if (name === 'BondIssuanceComplete') {
        changedResources.add('bonds');
        const isin = args.isin as string;
        applyBondStateEvent(
          db,
          isin,
          { type: 'issuance-complete' },
          Number(log.blockNumber ?? 0),
          Number(log.index ?? 0),
        );
        insertBondEvent(db, {
          isin,
          type: 'ISSUANCE_COMPLETE',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: { total: args.total?.toString?.() ?? args.total },
        });
      } else if (name === 'BondRedeemed') {
        changedResources.add('bonds');
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'REDEEMED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {
            holder: args.holder,
            value: args.value?.toString?.() ?? args.value,
            wnokAmount: args.wnokAmount?.toString?.() ?? args.wnokAmount,
          },
        });
      } else if (name === 'BondRedemptionComplete') {
        changedResources.add('bonds');
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        if (isin) {
          applyBondStateEvent(
            db,
            isin,
            { type: 'redemption-complete' },
            Number(log.blockNumber ?? 0),
            Number(log.index ?? 0),
          );
        }
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'REDEMPTION_COMPLETE',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      } else if (name === 'BondCreated') {
        changedResources.add('bonds');
        // Pre-staged bond (no auction yet). Upsert the partition row so the
        // bond shows up in /v1/bonds before any auction is scheduled.
        const isin = args.isin as string;
        const partition = keccak256(toUtf8Bytes(isin));
        upsertPartition(
          db,
          partition,
          isin,
          args.bondAddress?.toString?.() ?? null,
          Number(log.blockNumber ?? 0),
        );
        // Re-create after a prior disable must clear the disabled flag so
        // the bond reappears in the default GET /v1/bonds listing.
        setPartitionDisabled(db, isin, false);
        applyBondStateEvent(
          db,
          isin,
          {
            type: 'created',
            partition,
            bondAddress: args.bondAddress?.toString?.() ?? null,
            maturityDuration: BigInt(String(args.maturityDurationSeconds)),
          },
          Number(log.blockNumber ?? 0),
          Number(log.index ?? 0),
        );
        insertBondEvent(db, {
          isin,
          type: 'BOND_CREATED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {
            bondAddress: args.bondAddress?.toString?.() ?? null,
            maturityDurationSeconds: args.maturityDurationSeconds?.toString?.() ?? null,
          },
        });
      } else if (name === 'BondDisabled') {
        changedResources.add('bonds');
        const isin = args.isin as string;
        setPartitionDisabled(db, isin, true);
        applyBondStateEvent(
          db,
          isin,
          { type: 'disabled', disabled: true },
          Number(log.blockNumber ?? 0),
          Number(log.index ?? 0),
        );
        insertBondEvent(db, {
          isin,
          type: 'BOND_DISABLED',
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      }
    }

    for (const entry of parsedAuction) {
      if (!entry?.parsed?.name) continue;
      const { log, parsed } = entry;
      if (
        parsed.name === 'AuctionCreated' ||
        parsed.name === 'BidSubmitted' ||
        parsed.name === 'BidCancelled' ||
        parsed.name === 'AuctionFinalized'
      ) {
        changedResources.add('auctions');
        changedResources.add('bonds');
      }
      const args = (parsed.args ?? {}) as Record<string, unknown>;
      const auctionId = String(args.id ?? '');
      const block = Number(log.blockNumber ?? 0);
      const logIndex = Number(log.index ?? 0);

      if (parsed.name === 'AuctionCreated') {
        upsertAuctionMetadata(db, {
          auctionId,
          isin: String(args.isin),
          owner: String(args.admin),
          end: BigInt(String(args.end)),
          offering: BigInt(String(args.offering)),
          auctionPubKey: String(args.auctionPubKey),
          auctionType: projectedAuctionType(args.auctionType),
          block,
          txHash: log.transactionHash,
        });
      } else if (parsed.name === 'BidSubmitted') {
        upsertAuctionBid(db, {
          auctionId,
          bidIndex: Number(args.index),
          bidder: String(args.bidder),
          ciphertext: String(args.ciphertext),
          plaintextHash: String(args.plaintextHash),
          block,
          logIndex,
        });
      } else if (parsed.name === 'BidCancelled') {
        cancelAuctionBid(db, auctionId, String(args.bidder), String(args.plaintextHash));
      } else if (parsed.name === 'AuctionFinalized') {
        replaceAuctionAllocations(db, auctionId, block, finalAllocations.get(auctionId) ?? []);
      }
    }

    for (const entry of parsedToken) {
      if (!entry?.parsed?.name) continue;
      const { log, parsed } = entry;
      const args = (parsed.args ?? {}) as Record<string, unknown>;
      const isin = typeof args.isin === 'string' ? args.isin : null;
      if (!isin) continue;
      const block = Number(log.blockNumber ?? 0);
      const logIndex = Number(log.index ?? 0);

      if (parsed.name === 'IsinIssued') {
        applyBondStateEvent(
          db,
          isin,
          { type: 'issued', offering: BigInt(String(args.offering)) },
          block,
          logIndex,
        );
      } else if (parsed.name === 'IsinEnabled') {
        applyBondStateEvent(
          db,
          isin,
          {
            type: 'enabled',
            couponDuration: BigInt(String(args.couponDuration)),
            couponYield: BigInt(String(args.couponYield)),
            blockTimestamp: blockTimestamps.get(block) ?? 0n,
          },
          block,
          logIndex,
        );
      } else if (parsed.name === 'IsinExtended' || parsed.name === 'IsinReduced') {
        applyBondStateEvent(
          db,
          isin,
          { type: 'offering-changed', offering: BigInt(String(args.newOffering)) },
          block,
          logIndex,
        );
      } else if (parsed.name === 'IsinDisabled') {
        applyBondStateEvent(db, isin, { type: 'disabled', disabled: true }, block, logIndex);
      }
    }

    for (const action of tokenActions) {
      if (!action) continue;
      const { partition, from, to, value, block, logIndex, txHash } = action;
      const mappedIsin = getIsinForPartition(db, partition) ?? null;
      if (!mappedIsin) {
        logger.debug(`ingestion missing partition mapping for transfer; skipping ${partition}`);
        continue;
      }
      changedResources.add('bonds');
      for (const delta of reducePartitionTransfer({ from, to, value })) {
        const wrote = applyBalanceDelta(db, {
          isin: mappedIsin,
          holder: delta.holder,
          delta: delta.delta,
          block,
          logIndex,
          txHash,
          kind: delta.kind,
        });
        if (wrote && delta.kind !== 'transfer') {
          applyBondStateEvent(
            db,
            mappedIsin,
            { type: 'supply-delta', delta: delta.delta },
            block,
            logIndex,
          );
        }
      }
    }
    saveCheckpoint(db, nextCheckpoint);
  });

  tx();

  // The most recent log across both decoded sets — block, then logIndex
  // — picks one deterministic "latest" hash so the health endpoint can
  // show "what did we last ingest?".
  type Located = { blockNumber: number | null; index: number | null; txHash: string };
  const located: Located[] = [
    ...parsedManager.map((e) => ({
      blockNumber: e.log.blockNumber ?? null,
      index: e.log.index ?? null,
      txHash: e.log.transactionHash,
    })),
    ...parsedToken.map((e) => ({
      blockNumber: e.log.blockNumber ?? null,
      index: e.log.index ?? null,
      txHash: e.log.transactionHash,
    })),
    ...parsedAuction.map((e) => ({
      blockNumber: e.log.blockNumber ?? null,
      index: e.log.index ?? null,
      txHash: e.log.transactionHash,
    })),
  ];
  let latest: Located | null = null;
  for (const entry of located) {
    if (entry.blockNumber === null || entry.index === null) continue;
    if (
      !latest ||
      entry.blockNumber > (latest.blockNumber ?? -1) ||
      (entry.blockNumber === latest.blockNumber && entry.index > (latest.index ?? -1))
    ) {
      latest = entry;
    }
  }
  return { latestTxHash: latest?.txHash ?? null, changedResources };
}

/**
 * Compute the [from, to] block range an ingestion tick should process.
 *
 * `nextBlock` is the next block to process (== last processed + 1). `latest`
 * is the chain head. Returns null when the chain hasn't produced anything new
 * since the previous tick.
 *
 * Important: we DO process the single-block case where `latest === nextBlock`.
 * Skipping that case (an earlier bug) left ingestion one block behind the head
 * and could silently lose an auction at the current head. This remains a
 * protocol-independent boundary condition even though the QBFT sandbox creates
 * an idle empty block every five minutes.
 */
export function computeIngestionWindow(
  nextBlock: number,
  latest: number,
  batchSize = 500,
): { from: number; to: number } | null {
  if (latest < nextBlock) {
    return null;
  }
  return { from: nextBlock, to: Math.min(latest, nextBlock + batchSize) };
}

export async function startIngestionLoop() {
  const [network, genesisBlock] = await Promise.all([provider.getNetwork(), provider.getBlock(0)]);
  if (!genesisBlock?.hash) {
    throw new RpcUnavailableError('RPC did not return genesis block 0', envVariables.RPC_URL);
  }
  const db = openDatabase({ dbPath: envVariables.DB_PATH, readonly: false });
  bindChainIdentity(db, {
    chainId: network.chainId.toString(),
    genesisHash: genesisBlock.hash,
  });
  const bondManagerAddress = await getBondManagerAddress();
  const bondManager = new Contract(bondManagerAddress, bondManagerAbi, provider);
  const bondToken = new Contract(await bondManager.BOND_TOKEN(), bondTokenAbi, provider);
  const bondAuction = new Contract(await bondManager.BOND_AUCTION(), bondAuctionAbi, provider);
  const durationScalar = await bondManager.DURATION_SCALAR();
  db.prepare(
    `INSERT INTO projection_context (
      id, manager_address, token_address, auction_address, duration_scalar
    ) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      manager_address=excluded.manager_address,
      token_address=excluded.token_address,
      auction_address=excluded.auction_address,
      duration_scalar=excluded.duration_scalar`,
  ).run(
    bondManager.target.toString().toLowerCase(),
    bondToken.target.toString().toLowerCase(),
    bondAuction.target.toString().toLowerCase(),
    durationScalar.toString(),
  );

  const checkpoint = loadCheckpoint(db, 'bond-manager');
  let nextBlock = checkpoint.last_block;
  lastBlockProcessed = Math.max(envVariables.START_BLOCK - 1, nextBlock - 1);

  logger.info(
    `ingestion starting at block ${nextBlock} (poll every ${envVariables.POLL_INTERVAL_MS}ms)`,
  );

  async function processTo(targetBlock?: number): Promise<boolean> {
    lastTickAt = Date.now();
    try {
      const latest = targetBlock ?? (await provider.getBlockNumber());
      while (true) {
        const window = computeIngestionWindow(nextBlock, latest);
        if (!window) break;
        const { from, to } = window;

        logger.debug(`ingestion processing blocks [${from}, ${to}]`);
        const checkpointBlock = await provider.getBlock(to);
        if (!checkpointBlock) throw new Error(`missing checkpoint block ${to}`);
        const { latestTxHash, changedResources } = await processBlockRange(
          db,
          bondManager,
          bondToken,
          bondAuction,
          from,
          to,
          {
            contract: 'bond-manager',
            last_block: to + 1,
            last_tx_index: 0,
            block_timestamp: checkpointBlock.timestamp,
          },
        );
        nextBlock = to + 1;
        lastBlockProcessed = to;
        if (latestTxHash) lastEventTxHash = latestTxHash;
        logger.debug(`ingestion advanced checkpoint to block ${nextBlock}`);
        publishLiveChange(changedResources);
      }
      consecutiveFailures = 0;
      return targetBlock === undefined || (lastBlockProcessed ?? -1) >= targetBlock;
    } catch (err) {
      consecutiveFailures++;
      pushError(err);
      logger.warn(`ingestion tick failed: ${err as Error}`);
      return false;
    }
  }

  // Background polling and request-triggered catch-up share one queue. This
  // prevents concurrent SQLite projection writes while still allowing a mined
  // mutation to advance immediately instead of waiting for the next interval.
  const enqueue = (targetBlock?: number): Promise<boolean> => {
    const work = ingestionQueue.then(() => processTo(targetBlock));
    ingestionQueue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  };
  projectionAdvancer = enqueue;

  // Backfill and poll
  await enqueue();
  intervalHandle = setInterval(() => void enqueue(), envVariables.POLL_INTERVAL_MS);
  loopRunning = true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type IngestionWaitOptions = {
  timeoutMs?: number;
  pollMs?: number;
  getStatus?: () => Pick<IngestionStatus, 'lastBlockProcessed'>;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Wait until the projection has processed a mined transaction's block.
 *
 * This is deliberately bounded and returns false on timeout. A transaction
 * has already committed by the time this helper is called, so turning a slow
 * projection into an HTTP error would invite a caller to retry the mutation
 * and potentially submit it twice.
 */
export async function waitForIngestionBlock(
  targetBlock: number,
  options: IngestionWaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? envVariables.POLL_INTERVAL_MS * 2 + 1000;
  const pollMs = options.pollMs ?? 50;
  const status = options.getStatus ?? getIngestionStatus;
  const sleepFn = options.sleepFn ?? sleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    const processed = status().lastBlockProcessed;
    if (processed !== null && processed >= targetBlock) return true;
    if (now() >= deadline) return false;
    await sleepFn(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}

export type ProjectionAdvanceOptions = {
  timeoutMs?: number;
  advance?: ((targetBlock?: number) => Promise<boolean>) | null;
};

/**
 * Actively advance the shared projection through a mined mutation's block.
 *
 * The timeout bounds only the HTTP request wait; queued ingestion is not
 * cancelled and may complete after this returns false. Callers must represent
 * that outcome as an accepted/pending mutation, never as a failed transaction.
 */
export async function advanceProjectionTo(
  targetBlock: number,
  options: ProjectionAdvanceOptions = {},
): Promise<boolean> {
  if ((lastBlockProcessed ?? -1) >= targetBlock) return true;
  const advance = options.advance === undefined ? projectionAdvancer : options.advance;
  if (!advance) return false;

  const timeoutMs = options.timeoutMs ?? envVariables.POLL_INTERVAL_MS * 2 + 1000;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<false>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([advance(targetBlock), timedOut]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export type RetryOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  // Test seam — defaults to the real startIngestionLoop.
  start?: () => Promise<void>;
  // Test seam — defaults to the real setTimeout sleep.
  sleepFn?: (ms: number) => Promise<void>;
};

/**
 * Wrap `startIngestionLoop()` in retry-with-backoff so the API self-heals
 * when Besu is briefly unreachable at boot (PC/Docker restart). The inner
 * `tick()` already tolerates failures — the failure mode this guards
 * against is the setup before `tick()` (registry lookup, BOND_TOKEN read)
 * throwing during the first call.
 *
 * Retries forever. The only "give up" path is a module-load failure,
 * handled in index.ts.
 */
export async function startIngestionLoopWithRetry(options: RetryOptions = {}): Promise<void> {
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const factor = options.factor ?? 2;
  const start = options.start ?? startIngestionLoop;
  const sleepFn = options.sleepFn ?? sleep;

  let delay = initialDelayMs;
  for (;;) {
    try {
      await start();
      return;
    } catch (err) {
      pushError(err);
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof RpcUnavailableError) {
        logger.info(`ingestion boot: RPC not ready yet — retrying in ${delay}ms (${message})`);
      } else if (err instanceof ChainIdentityMismatchError) {
        throw err;
      } else {
        logger.warn(`ingestion boot failed; retrying in ${delay}ms: ${message}`);
      }
      await sleepFn(delay);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }
}
