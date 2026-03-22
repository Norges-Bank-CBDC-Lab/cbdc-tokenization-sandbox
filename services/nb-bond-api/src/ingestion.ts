import { Contract, JsonRpcProvider, Log, keccak256, toUtf8Bytes } from 'ethers';

import { bondManagerAbi, bondTokenAbi } from './abi';
import { envVariables } from './env-vars';
import { getBondManagerAddress } from './chain';
import { logger } from './logger';
import { type IngestionDatabase, openDatabase } from './ingestion-db';
import { toPlainObject } from './utils';

type Checkpoint = { contract: string; last_block: number; last_tx_index: number };
type ParsedLog = { name?: string; args?: Record<string, unknown> };
type IssueAction = {
  kind: 'issue';
  isin: string;
  holder: string;
  delta: bigint;
  block: number;
  txHash: string;
  partition: string;
};
type RedeemAction = {
  kind: 'redeem';
  isin: string;
  holder: string;
  delta: bigint;
  block: number;
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
  txHash: string;
};
type TokenAction = IssueAction | RedeemAction | TransferAction;

const provider = new JsonRpcProvider(envVariables.RPC_URL);

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

function upsertAuctionEvent(
  db: IngestionDatabase,
  data: {
    auctionId: string;
    isin: string;
    type: string;
    block: number;
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

  const insertEvent = db.prepare(
    `INSERT INTO auction_events (auction_id, isin, type, block, tx_hash, payload) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run(
    data.auctionId ?? '',
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
    data.txHash ?? '',
    JSON.stringify(toPlainObject(data.payload ?? {})),
  );
}

function applyBalanceDelta(
  db: IngestionDatabase,
  data: {
    isin: string;
    holder: string;
    delta: bigint;
    block: number;
    txHash: string;
    kind: string;
  },
) {
  const getBalance = db.prepare(`SELECT balance FROM balances WHERE isin = ? AND holder = ?`);
  const row = getBalance.get(data.isin ?? '', data.holder ?? '') as { balance: string } | undefined;
  const current = BigInt(row?.balance ?? '0');
  const next = current + data.delta;
  const upsert = db.prepare(
    `INSERT INTO balances (isin, holder, balance) VALUES (?, ?, ?)
     ON CONFLICT(isin, holder) DO UPDATE SET balance=excluded.balance`,
  );
  upsert.run(data.isin ?? '', data.holder ?? '', next.toString());

  const insertEvent = db.prepare(
    `INSERT INTO balance_events (isin, holder, delta, balance_after, block, tx_hash, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run(
    data.isin ?? '',
    data.holder ?? '',
    data.delta.toString(),
    next.toString(),
    Number(data.block ?? 0),
    data.txHash ?? '',
    data.kind ?? '',
  );
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

function insertBondEvent(
  db: IngestionDatabase,
  data: { isin: string; type: string; block: number; txHash: string; payload?: unknown },
) {
  const stmt = db.prepare(
    `INSERT INTO bond_events (isin, type, block, tx_hash, payload) VALUES (?, ?, ?, ?, ?)`,
  );
  stmt.run(
    data.isin ?? '',
    data.type ?? '',
    Number(data.block ?? 0),
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
) {
  const managerAddress = bondManager.target.toString();
  const tokenAddress = bondToken.target.toString();

  const [managerLogs, tokenLogs] = await Promise.all([
    provider.getLogs({ address: managerAddress, fromBlock, toBlock }),
    provider.getLogs({ address: tokenAddress, fromBlock, toBlock }),
  ]);

  const parsedManager = decodeManagerEvents(managerLogs, bondManager);
  const parsedToken = decodeTokenEvents(tokenLogs, bondToken);

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
      } else if (name === 'BondAuctionClosed') {
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'CLOSED',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      } else if (name === 'BondAuctionFinalised') {
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'FINALISED',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      } else if (name === 'BondAuctionCancelled') {
        const auctionId = args.id as string;
        const isin = args.isin as string;
        upsertAuctionEvent(db, {
          auctionId,
          isin,
          type: 'CANCELLED',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      } else if (name === 'CouponPaid') {
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'COUPON_PAID',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {
            holder: args.holder,
            paymentAmount: args.paymentAmount?.toString?.() ?? args.paymentAmount,
            paymentNumber: args.paymentNumber?.toString?.() ?? args.paymentNumber,
          },
        });
      } else if (name === 'AllCouponsPaid') {
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'COUPON_COMPLETE',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {},
        });
      } else if (name === 'BondRedeemed') {
        const isin = resolveIsin(db, args.isin, resolvedPartitions);
        insertBondEvent(db, {
          isin: isin ?? '',
          type: 'REDEEMED',
          block: Number(log.blockNumber ?? 0),
          txHash: log.transactionHash,
          payload: {
            holder: args.holder,
            value: args.value?.toString?.() ?? args.value,
            wnokAmount: args.wnokAmount?.toString?.() ?? args.wnokAmount,
          },
        });
      }
    }

    for (const action of tokenActions as Array<TokenAction | null>) {
      if (!action) continue;
      if (action.kind === 'transfer') {
        const { partition, from, to, value, block, txHash } = action;
        const mappedIsin = getIsinForPartition(db, partition) ?? null;
        if (!mappedIsin) {
          logger.debug(`ingestion missing partition mapping for transfer; skipping ${partition}`);
          continue;
        }
        applyBalanceDelta(db, {
          isin: mappedIsin,
          holder: from,
          delta: -value,
          block,
          txHash,
          kind: 'transfer',
        });
        applyBalanceDelta(db, {
          isin: mappedIsin,
          holder: to,
          delta: value,
          block,
          txHash,
          kind: 'transfer',
        });
      } else {
        if (action.partition) {
          upsertPartition(db, action.partition, action.isin, null, action.block);
        }
        applyBalanceDelta(db, {
          isin: action.isin,
          holder: action.holder,
          delta: action.delta,
          block: action.block,
          txHash: action.txHash,
          kind: action.kind,
        });
      }
    }
  });

  tx();
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
    try {
      const latest = await provider.getBlockNumber();
      const from = nextBlock;
      const to = Math.min(latest, from + 500); // small batches
      if (to < from) {
        return;
      }
      if (to === from) {
        return;
      }

      logger.debug(`ingestion processing blocks [${from}, ${to}]`);
      await processBlockRange(db, bondManager, bondToken, from, to);
      saveCheckpoint(db, { contract: 'bond-manager', last_block: to + 1, last_tx_index: 0 });
      nextBlock = to + 1;
      logger.debug(`ingestion advanced checkpoint to block ${nextBlock}`);
    } catch (err) {
      logger.warn(`ingestion tick failed: ${err as Error}`);
    }
  }

  // Backfill and poll
  await tick();
  setInterval(tick, envVariables.POLL_INTERVAL_MS);
}
