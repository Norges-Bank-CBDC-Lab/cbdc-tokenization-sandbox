import { Contract, JsonRpcProvider, Log, keccak256, toUtf8Bytes } from 'ethers';

import { bondManagerAbi, bondTokenAbi } from './abi';
import { envVariables } from './env-vars';
import { RpcUnavailableError, getBondManagerAddress } from './chain';
import { logger } from './logger';
import { type IngestionDatabase, openDatabase } from './ingestion-db';
import { type LiveResourceKey, publishLiveChange } from './live-events';
import { toPlainObject } from './utils';

type Checkpoint = { contract: string; last_block: number; last_tx_index: number };
type ParsedLog = { name?: string; args?: Record<string, unknown> };
type IssueAction = {
  kind: 'issue';
  isin: string;
  holder: string;
  delta: bigint;
  block: number;
  logIndex: number;
  txHash: string;
  partition: string;
};
type RedeemAction = {
  kind: 'redeem';
  isin: string;
  holder: string;
  delta: bigint;
  block: number;
  logIndex: number;
  txHash: string;
  partition: string;
};
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
type TokenAction = IssueAction | RedeemAction | TransferAction;

const provider = new JsonRpcProvider(envVariables.RPC_URL);

// Module-level runtime state for /v1/health. Lost on pod restart and
// rebuilt by the next tick — none of it is authoritative.
let loopRunning = false;
let lastTickAt: number | null = null;
let consecutiveFailures = 0;
let lastBlockProcessed: number | null = null;
let lastEventTxHash: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

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
    `SELECT contract, last_block as last_block, last_tx_index as last_tx_index FROM ingestion_state WHERE contract = ?`,
  );
  const row = stmt.get(contract) as Checkpoint | undefined;
  return row ?? { contract, last_block: envVariables.START_BLOCK, last_tx_index: 0 };
}

function saveCheckpoint(db: IngestionDatabase, checkpoint: Checkpoint) {
  const stmt = db.prepare(
    `INSERT INTO ingestion_state(contract, last_block, last_tx_index)
     VALUES (@contract, @last_block, @last_tx_index)
     ON CONFLICT(contract) DO UPDATE SET last_block=excluded.last_block, last_tx_index=excluded.last_tx_index`,
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
  },
) {
  const insertAuction = db.prepare(
    `INSERT OR IGNORE INTO auctions (auction_id, isin, type, created_block, created_tx) VALUES (?, ?, ?, ?, ?)`,
  );
  insertAuction.run(
    data.auctionId ?? '',
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
    data.txHash ?? '',
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
) {
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
    return;
  }
  const upsert = db.prepare(
    `INSERT INTO balances (isin, holder, balance) VALUES (?, ?, ?)
     ON CONFLICT(isin, holder) DO UPDATE SET balance=excluded.balance`,
  );
  upsert.run(data.isin ?? '', data.holder ?? '', next.toString());
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
  fromBlock: number,
  toBlock: number,
): Promise<{ latestTxHash: string | null; changedResources: Set<LiveResourceKey> }> {
  const managerAddress = bondManager.target.toString();
  const tokenAddress = bondToken.target.toString();

  const [managerLogs, tokenLogs] = await Promise.all([
    provider.getLogs({ address: managerAddress, fromBlock, toBlock }),
    provider.getLogs({ address: tokenAddress, fromBlock, toBlock }),
  ]);

  const parsedManager = decodeManagerEvents(managerLogs, bondManager);
  const parsedToken = decodeTokenEvents(tokenLogs, bondToken);
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

  // Resolve async data needed for token events (partition -> isin)
  const tokenActions = await Promise.all(
    parsedToken.map(async ({ log, parsed }) => {
      if (!parsed?.name) return null;
      const name = parsed.name;
      const args = (parsed.args ?? {}) as Record<string, unknown>;
      if (name === 'IsinMinted') {
        const isin = args.isin as string;
        const dst = (args.dst as string).toLowerCase();
        const value = BigInt(String(args.value));
        const partition = keccak256(toUtf8Bytes(isin));
        return {
          kind: 'issue' as const,
          isin,
          holder: dst,
          delta: value,
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          partition,
        } satisfies IssueAction;
      } else if (name === 'IsinRedeemed') {
        const isin = args.isin as string;
        const holder = (args.holder as string).toLowerCase();
        const value = BigInt(String(args.value));
        const partition = keccak256(toUtf8Bytes(isin));
        return {
          kind: 'redeem' as const,
          isin,
          holder,
          delta: -value,
          block: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? 0),
          txHash: log.transactionHash,
          partition,
        } satisfies RedeemAction;
      } else if (name === 'TransferByPartition') {
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
        });
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

    for (const action of tokenActions as Array<TokenAction | null>) {
      if (!action) continue;
      if (action.kind === 'transfer') {
        const { partition, from, to, value, block, logIndex, txHash } = action;
        const mappedIsin = getIsinForPartition(db, partition) ?? null;
        if (!mappedIsin) {
          logger.debug(`ingestion missing partition mapping for transfer; skipping ${partition}`);
          continue;
        }
        changedResources.add('bonds');
        // Both rows share (tx_hash, log_index) — the UNIQUE INDEX on
        // balance_events also includes `holder` so the debit/credit
        // pair stays distinct under replay.
        applyBalanceDelta(db, {
          isin: mappedIsin,
          holder: from,
          delta: -value,
          block,
          logIndex,
          txHash,
          kind: 'transfer',
        });
        applyBalanceDelta(db, {
          isin: mappedIsin,
          holder: to,
          delta: value,
          block,
          logIndex,
          txHash,
          kind: 'transfer',
        });
      } else {
        changedResources.add('bonds');
        if (action.partition) {
          upsertPartition(db, action.partition, action.isin, null, action.block);
        }
        applyBalanceDelta(db, {
          isin: action.isin,
          holder: action.holder,
          delta: action.delta,
          block: action.block,
          logIndex: action.logIndex,
          txHash: action.txHash,
          kind: action.kind,
        });
      }
    }
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
 * The local sandbox runs Clique PoA which produces blocks only on activity,
 * so the head sits at `nextBlock - 1 + 1 === nextBlock` for arbitrarily long
 * stretches. Skipping that case (an earlier bug) left ingestion perpetually
 * one block behind the head and silently lost any auction created during an
 * idle stretch.
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
  const db = openDatabase({ dbPath: envVariables.DB_PATH, readonly: false });
  const bondManagerAddress = await getBondManagerAddress();
  const bondManager = new Contract(bondManagerAddress, bondManagerAbi, provider);
  const bondToken = new Contract(await bondManager.BOND_TOKEN(), bondTokenAbi, provider);

  const checkpoint = loadCheckpoint(db, 'bond-manager');
  let nextBlock = checkpoint.last_block;

  logger.info(
    `ingestion starting at block ${nextBlock} (poll every ${envVariables.POLL_INTERVAL_MS}ms)`,
  );

  async function tick() {
    lastTickAt = Date.now();
    try {
      const latest = await provider.getBlockNumber();
      const window = computeIngestionWindow(nextBlock, latest);
      if (!window) {
        consecutiveFailures = 0;
        return;
      }
      const { from, to } = window;

      logger.debug(`ingestion processing blocks [${from}, ${to}]`);
      const { latestTxHash, changedResources } = await processBlockRange(
        db,
        bondManager,
        bondToken,
        from,
        to,
      );
      saveCheckpoint(db, { contract: 'bond-manager', last_block: to + 1, last_tx_index: 0 });
      nextBlock = to + 1;
      lastBlockProcessed = to;
      if (latestTxHash) lastEventTxHash = latestTxHash;
      consecutiveFailures = 0;
      logger.debug(`ingestion advanced checkpoint to block ${nextBlock}`);
      publishLiveChange(changedResources);
    } catch (err) {
      consecutiveFailures++;
      pushError(err);
      logger.warn(`ingestion tick failed: ${err as Error}`);
    }
  }

  // Backfill and poll
  await tick();
  intervalHandle = setInterval(tick, envVariables.POLL_INTERVAL_MS);
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
      } else {
        logger.warn(`ingestion boot failed; retrying in ${delay}ms: ${message}`);
      }
      await sleepFn(delay);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }
}
