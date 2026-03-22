import express from 'express';
import helmet from 'helmet';

import {
  buildAllocationHash,
  computeBuybackAllocation,
  computeUniformAllocation,
  formatAllocationResult,
  formatAllocationTuple,
  type AllocationTupleInput,
} from './allocation';
import { envVariables } from './env-vars';
import { getAuctionById, getAuctionsByIsin, upsertAuction } from './state';
import { SealingKeypair, initSealingKeypair } from './keys';
import { Allocation, AuctionStatus, AuctionType, SealedBid, UnsealedBid } from './types';
import { formatUnsealedBid, normalizeSealedBid, unsealBid } from './bid';
import { logger } from './logger';
import {
  getBondManager,
  getBondAuction,
  getBondAuctionAddress,
  getBondToken,
  sendWithManagedNonce,
  RegistryResolutionError,
  RpcUnavailableError,
} from './chain';
import { auctionTypeToString, toPlainObject } from './utils';
import { parseBigInt } from './parsing';
import {
  getAuctionEventsByIsin,
  getBalancesByIsin,
  getBondEventsByIsin,
  openDatabase,
} from './ingestion-db';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  AuctionsQuery,
  BidsQuery,
  CreateAuctionRequest,
  FinaliseRequest,
  PayCouponRequest,
  RedeemRequest,
  auctionIdParamSchema,
  auctionsQuerySchema,
  bidsQuerySchema,
  createAuctionRequestSchema,
  finaliseRequestSchema,
  isinParamSchema,
  openApiDocument,
  payCouponRequestSchema,
  redeemRequestSchema,
} from './schemas';
import { validateRequest } from './validation';

const sealingKeys: SealingKeypair = initSealingKeypair(envVariables.AUCTION_OWNER_SEAL_PK);

const app = express();
app.use(express.json());
app.use(helmet());

// Read-only connection for history lookups; ingestion writer will open in write mode.
const historyDb = openDatabase({ dbPath: envVariables.DB_PATH, readonly: true });

async function getActiveHoldersWithBalance(
  isin: string,
): Promise<{ holder: string; balance: string }[]> {
  const dbHolders = getBalancesByIsin(historyDb, isin);
  const bondToken = await getBondToken();
  const partition = keccak256(toUtf8Bytes(isin));

  const holders = await Promise.all(
    dbHolders.map(async (h) => {
      try {
        const onChain = await bondToken.balanceOfByPartition(partition, h.holder);
        return onChain > 0n ? { holder: h.holder, balance: onChain.toString() } : null;
      } catch (err) {
        logger.debug(`failed to fetch on-chain balance for ${h.holder}: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  return holders.filter((h): h is { holder: string; balance: string } => Boolean(h));
}

async function getActiveHolders(isin: string): Promise<string[]> {
  const withBalance = await getActiveHoldersWithBalance(isin);
  return withBalance.map((h) => h.holder);
}

function compareBidsByAuctionType(
  a: { rate: string; units: string },
  b: { rate: string; units: string },
  auctionType: AuctionType,
): number {
  const rateA = parseBigInt(a.rate, 'rate');
  const rateB = parseBigInt(b.rate, 'rate');
  const higherIsBetter = auctionType === AuctionType.PRICE;

  if (rateA === rateB) {
    const unitsA = parseBigInt(a.units, 'units');
    const unitsB = parseBigInt(b.units, 'units');
    return unitsB > unitsA ? 1 : unitsB < unitsA ? -1 : 0;
  }
  return higherIsBetter ? (rateB > rateA ? 1 : -1) : rateA > rateB ? 1 : -1;
}

function onChainStatusToApi(status: number): AuctionStatus {
  switch (status) {
    case 1:
      return 'open'; // BIDDING
    case 2:
      return 'closed'; // CLOSED
    case 3:
      return 'finalised'; // FINALISED
    case 4:
      return 'cancelled'; // ERROR / cancelled
    default:
      return 'open';
  }
}

async function hydrateAuctionFromChain(auctionId: string) {
  try {
    const bondAuctionContract = await getBondAuction();
    const [metadata, status, onChainAllocRaw] = await Promise.all([
      bondAuctionContract.getAuction(auctionId),
      bondAuctionContract.getAuctionStatus(auctionId),
      bondAuctionContract.getAllocations(auctionId).catch(() => []),
    ]);

    const isin = metadata.isin as string;
    const auctionType = Number(metadata.auctionType ?? AuctionType.PRICE) as AuctionType;
    const bondManager = await getBondManager();
    const sealed = await bondManager.getSealedBids(isin).catch(() => []);
    const sealedBids = (sealed as SealedBid[]).map(normalizeSealedBid);

    let allocationResult;
    const onChainAlloc = (onChainAllocRaw as AllocationTupleInput[]) ?? [];
    if (onChainAlloc.length > 0) {
      const parsed: Allocation[] = onChainAlloc.map((a) => ({
        isin: a.isin,
        bidder: a.bidder,
        units: parseBigInt(a.units?.toString?.() ?? '0', 'units'),
        rate: parseBigInt(a.rate?.toString?.() ?? '0', 'rate'),
        auctionType: Number(a.auctionType ?? auctionType) as AuctionType,
      }));
      const clearingRate = parsed[0].rate;
      const totalAllocated = parsed.reduce((sum, a) => sum + a.units, 0n);
      allocationResult = {
        clearingRate,
        totalAllocated,
        allocations: parsed,
        allocationHash: buildAllocationHash(isin, parsed[0].auctionType, clearingRate, parsed),
        auctionType: parsed[0].auctionType,
        computedAt: Date.now(),
      };
    }

    let unsealedBids: UnsealedBid[] | undefined;
    const offeringUnits = parseBigInt(metadata.offering?.toString?.() ?? '0', 'offering');
    if (sealedBids.length > 0 && offeringUnits > 0n) {
      try {
        const unsealed = sealedBids.map((bid, index) => unsealBid(isin, bid, index));
        unsealedBids = unsealed;
        if (!allocationResult) {
          allocationResult =
            auctionType === AuctionType.BUYBACK
              ? computeBuybackAllocation(isin, unsealed, offeringUnits)
              : computeUniformAllocation(isin, auctionType, unsealed, offeringUnits);
        }
      } catch (err) {
        logger.warn(`failed to unseal bids for ${auctionId}/${isin}: ${(err as Error).message}`);
      }
    }

    const finalised = Number(status) === 3; // FINALISED enum

    return upsertAuction(auctionId, {
      isin,
      auctionType,
      status: onChainStatusToApi(Number(status)),
      sealedBids: sealedBids.length ? sealedBids : undefined,
      unsealedBids,
      allocationResult,
      finalised,
      rejected: false,
      metadata: {
        end: parseBigInt(metadata.end?.toString?.() ?? '0', 'end'),
        offering: offeringUnits,
        auctionPubKey: metadata.auctionPubKey,
        bond: metadata.bond,
      },
    });
  } catch (err) {
    logger.warn(`hydrateAuctionFromChain failed for ${auctionId}: ${(err as Error).message}`);
    return undefined;
  }
}

app.get('/docs', (_req, res) => {
  res.json(openApiDocument);
});
app.get('/v1/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

const healthHandler = async (_req: express.Request, res: express.Response) => {
  try {
    const bondManager = await getBondManager();
    const bondAuctionAddress = await getBondAuctionAddress();
    const bondTokenAddress = await bondManager.BOND_TOKEN();
    res.json({
      status: 'ok',
      bondManager: bondManager.target.toString(),
      bondAuction: bondAuctionAddress,
      bondToken: bondTokenAddress,
      sealingPublicKey: sealingKeys.publicKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`health check failed: ${message}`);
    res.status(503).json({
      status: 'unavailable',
      error: message,
      registryAddress: envVariables.GLOBAL_REGISTRY_ADDRESS,
      bondManagerName: envVariables.BOND_MANAGER_CONTRACT_NAME,
    });
  }
};

app.get('/v1/health', healthHandler);
app.get('/health', healthHandler);

function stringToAuctionType(value: string): AuctionType {
  switch (value) {
    case 'RATE':
      return AuctionType.RATE;
    case 'PRICE':
      return AuctionType.PRICE;
    case 'BUYBACK':
      return AuctionType.BUYBACK;
    default:
      throw new Error(`unknown auction type ${value}`);
  }
}

async function ensureCached(auctionId: string) {
  const cached = getAuctionById(auctionId);
  if (cached) {
    return cached;
  }
  return hydrateAuctionFromChain(auctionId);
}

app.post(
  '/v1/bonds/:isin/auctions',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(createAuctionRequestSchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { type, end, size, maturityDuration } = req.body as CreateAuctionRequest;
      const auctionType = stringToAuctionType(type);

      let endSeconds: bigint;
      try {
        endSeconds = parseBigInt(end, 'end');
      } catch (err) {
        return res.status(400).json({ error: (err as Error).message });
      }
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (endSeconds <= nowSeconds) {
        return res.status(400).json({ error: 'end must be in the future' });
      }

      let sizeUnits: bigint;
      try {
        sizeUnits = parseBigInt(size, 'size');
      } catch (err) {
        return res.status(400).json({ error: (err as Error).message });
      }
      if (sizeUnits <= 0n) {
        return res.status(400).json({ error: 'size must be positive' });
      }

      let maturitySeconds: bigint | undefined;
      if (maturityDuration !== undefined) {
        try {
          maturitySeconds = parseBigInt(maturityDuration, 'maturityDuration');
        } catch (err) {
          return res.status(400).json({ error: (err as Error).message });
        }
        if (maturitySeconds <= 0n) {
          return res.status(400).json({ error: 'maturityDuration must be positive' });
        }
      }

      const bondAuctionContract = await getBondAuction();
      const auctionCount = await bondAuctionContract.isinToAuctionCount(isin).catch(() => 0n);
      if (auctionCount === 0n && auctionType !== AuctionType.RATE) {
        return res.status(400).json({ error: 'first auction for ISIN must be RATE' });
      }
      if (auctionCount > 0n && auctionType === AuctionType.RATE) {
        return res.status(400).json({ error: 'subsequent auctions cannot be RATE' });
      }
      if (auctionType === AuctionType.RATE && maturitySeconds === undefined) {
        return res.status(400).json({ error: 'maturityDuration is required for RATE' });
      }

      const pubKey = sealingKeys.publicKey;

      if (auctionType === AuctionType.RATE) {
        const bondManager = await getBondManager();
        await bondManager.deployBondWithAuction.staticCall(
          isin,
          endSeconds,
          pubKey,
          sizeUnits,
          maturitySeconds!,
        );
      } else if (auctionType === AuctionType.PRICE) {
        const bondManager = await getBondManager();
        await bondManager.extendBondWithAuction.staticCall(isin, endSeconds, pubKey, sizeUnits);
      } else {
        const bondManager = await getBondManager();
        await bondManager.buybackWithAuction.staticCall(isin, endSeconds, pubKey, sizeUnits);
      }

      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        if (auctionType === AuctionType.RATE) {
          const bondManager = await getBondManager();
          return bondManager.deployBondWithAuction(
            isin,
            endSeconds,
            pubKey,
            sizeUnits,
            maturitySeconds!,
            { nonce },
          );
        }
        if (auctionType === AuctionType.PRICE) {
          const bondManager = await getBondManager();
          return bondManager.extendBondWithAuction(isin, endSeconds, pubKey, sizeUnits, { nonce });
        }
        const bondManager = await getBondManager();
        return bondManager.buybackWithAuction(isin, endSeconds, pubKey, sizeUnits, { nonce });
      });

      const auctionId = await bondAuctionContract.getAuctionId(isin);
      const metadata = await bondAuctionContract.getAuction(auctionId);
      const bondManager = await getBondManager();
      const bondTokenAddress = await bondManager.BOND_TOKEN();
      const bondAuctionAddress = await getBondAuctionAddress();

      upsertAuction(auctionId, {
        isin,
        auctionType,
        status: 'open',
        metadata: {
          end: parseBigInt(metadata.end?.toString?.() ?? endSeconds.toString(), 'end'),
          offering: parseBigInt(metadata.offering?.toString?.() ?? sizeUnits.toString(), 'size'),
          auctionPubKey: metadata.auctionPubKey,
          bond: metadata.bond,
        },
      });

      res.json({
        auctionId,
        isin,
        type,
        status: 'open',
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        end: metadata.end?.toString?.() ?? endSeconds.toString(),
        size: metadata.offering?.toString?.() ?? sizeUnits.toString(),
        maturityDuration: maturitySeconds ? maturitySeconds.toString() : null,
        auctionPubKey: pubKey,
        bondAuction: bondAuctionAddress,
        bondToken: bondTokenAddress,
      });
    } catch (err) {
      next(err);
    }
  },
);

app.get(
  '/v1/bonds/:isin/auctions',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(auctionsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { status, type } = req.query as AuctionsQuery;

      try {
        const bondAuctionContract = await getBondAuction();
        const latestId = await bondAuctionContract.getAuctionId(isin);
        if (latestId) {
          await hydrateAuctionFromChain(latestId);
        }
      } catch (err) {
        logger.debug(`no on-chain auction found for ${isin}: ${(err as Error).message}`);
      }

      const auctions = getAuctionsByIsin(isin).filter((a) => {
        const typeMatches = type ? auctionTypeToString(a.auctionType ?? -1) === type : true;
        const statusMatches = status ? a.status === status : true;
        return typeMatches && statusMatches;
      });

      res.json({
        auctions: auctions.map((a) => ({
          auctionId: a.auctionId,
          isin: a.isin ?? isin,
          type: a.auctionType !== undefined ? auctionTypeToString(a.auctionType) : undefined,
          status: a.status,
          end: a.metadata?.end ? a.metadata.end.toString() : null,
          size: a.metadata?.offering ? a.metadata.offering.toString() : null,
          allocationHash: a.allocationResult?.allocationHash ?? null,
          finalised: a.finalised ?? false,
          rejected: a.rejected ?? false,
          cancelled: a.cancelled ?? false,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

app.get(
  '/v1/auctions/:auctionId',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const bondAuctionContract = await getBondAuction();
      const [metadata, onChainStatus, alloc] = await Promise.all([
        bondAuctionContract.getAuction(auctionId),
        bondAuctionContract.getAuctionStatus(auctionId),
        bondAuctionContract.getAllocations(auctionId).catch(() => []),
      ]);
      const status = onChainStatusToApi(Number(onChainStatus));
      let cache = await ensureCached(auctionId);
      if (status === 'open') {
        cache = (await hydrateAuctionFromChain(auctionId)) ?? cache;
      }
      const auctionType = Number(metadata.auctionType ?? AuctionType.PRICE);
      let maturityDuration: string | null = null;
      if (auctionType === AuctionType.RATE) {
        try {
          const bondToken = await getBondToken();
          const partition = keccak256(toUtf8Bytes(metadata.isin));
          const duration = await bondToken.maturityDuration(partition);
          maturityDuration = duration?.toString?.() ?? null;
        } catch (err) {
          logger.debug(
            `failed to fetch maturityDuration for ${metadata.isin}: ${(err as Error).message}`,
          );
        }
      }

      res.json({
        auctionId,
        isin: metadata.isin,
        status,
        metadata: {
          owner: metadata.owner,
          end: metadata.end?.toString?.() ?? null,
          auctionPubKey: metadata.auctionPubKey,
          bond: metadata.bond,
          offering: metadata.offering?.toString?.() ?? null,
          auctionType: auctionTypeToString(auctionType),
        },
        maturityDuration,
        cached: cache
          ? {
              sealedCount: cache.sealedBids?.length ?? 0,
              unsealedCount: cache.unsealedBids?.length ?? 0,
              allocationHash: cache.allocationResult?.allocationHash ?? null,
              finalised: cache.finalised ?? false,
              rejected: cache.rejected ?? false,
              cancelled: cache.cancelled ?? false,
              auctionType: cache.auctionType
                ? auctionTypeToString(cache.auctionType)
                : cache.allocationResult
                  ? auctionTypeToString(cache.allocationResult.auctionType)
                  : undefined,
            }
          : null,
        allocations: toPlainObject(
          (Array.isArray(alloc) ? (alloc as AllocationTupleInput[]) : []).map(
            formatAllocationTuple,
          ),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/auctions/:auctionId/close',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const bondAuctionContract = await getBondAuction();
      const metadata = await bondAuctionContract.getAuction(auctionId);
      const isin = metadata.isin as string;
      const auctionType = Number(metadata.auctionType ?? AuctionType.PRICE) as AuctionType;
      const offeringUnits = parseBigInt(metadata.offering?.toString?.() ?? '0', 'offering');

      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.closeAuction(isin, { nonce });
      });

      const bondManager = await getBondManager();
      const sealed = await bondManager.getSealedBids(isin);
      const sealedBids = (sealed as SealedBid[]).map(normalizeSealedBid);
      const unsealedBids = sealedBids.map((bid, index) => unsealBid(isin, bid, index));

      const allocationResult =
        auctionType === AuctionType.BUYBACK
          ? computeBuybackAllocation(isin, unsealedBids, offeringUnits)
          : computeUniformAllocation(isin, auctionType, unsealedBids, offeringUnits);

      upsertAuction(auctionId, {
        isin,
        auctionType,
        status: 'closed',
        sealedBids,
        unsealedBids,
        allocationResult,
        closedAt: Date.now(),
        rejected: false,
        finalised: false,
        cancelled: false,
      });

      res.json({
        auctionId,
        isin,
        status: 'closed',
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        bidCount: sealedBids.length,
        bids: unsealedBids
          .map(formatUnsealedBid)
          .sort((a, b) => compareBidsByAuctionType(a, b, auctionType)),
        allocation: formatAllocationResult(allocationResult),
        auctionType: auctionTypeToString(auctionType),
      });
    } catch (err) {
      next(err);
    }
  },
);

app.get(
  '/v1/auctions/:auctionId/bids',
  validateRequest(auctionIdParamSchema, 'params'),
  validateRequest(bidsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const { state } = req.query as BidsQuery;
      let cache = await ensureCached(auctionId);
      if (!cache) {
        return res.status(404).json({ error: 'auction not found' });
      }

      const targetState = state ?? 'unsealed';
      const shouldRefreshOpenBids = cache.status === 'open';
      if (shouldRefreshOpenBids || !cache.sealedBids) {
        cache = (await hydrateAuctionFromChain(auctionId)) ?? cache;
      }
      const auctionType =
        cache.auctionType ?? cache.allocationResult?.auctionType ?? AuctionType.PRICE;
      if (targetState === 'sealed') {
        if (!cache.sealedBids) {
          return res.status(404).json({ error: 'no sealed bids available' });
        }
        return res.json({
          auctionId,
          isin: cache.isin,
          state: 'sealed',
          bidCount: cache.sealedBids.length,
          bids: cache.sealedBids,
          allocation: cache.allocationResult
            ? formatAllocationResult(cache.allocationResult)
            : null,
          auctionType: auctionTypeToString(auctionType),
        });
      }

      if (!cache.unsealedBids) {
        return res.status(404).json({ error: 'no unsealed bids available' });
      }

      res.json({
        auctionId,
        isin: cache.isin,
        state: 'unsealed',
        bidCount: cache.unsealedBids.length,
        bids: cache.unsealedBids
          .map(formatUnsealedBid)
          .sort((a, b) => compareBidsByAuctionType(a, b, auctionType)),
        allocation: cache.allocationResult ? formatAllocationResult(cache.allocationResult) : null,
        auctionType: auctionTypeToString(auctionType),
      });
    } catch (err) {
      next(err);
    }
  },
);

app.get(
  '/v1/auctions/:auctionId/allocations',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      let cache = await ensureCached(auctionId);
      if (!cache?.allocationResult) {
        cache = await hydrateAuctionFromChain(auctionId);
      }
      if (!cache?.allocationResult) {
        return res.status(404).json({ error: 'no allocation result available' });
      }
      res.json({
        auctionId,
        isin: cache.isin,
        allocation: formatAllocationResult(cache.allocationResult),
        status: cache.status ?? 'closed',
        auctionType: auctionTypeToString(cache.allocationResult.auctionType),
        finalised: cache.finalised ?? false,
        rejected: cache.rejected ?? false,
        cancelled: cache.cancelled ?? false,
      });
    } catch (err) {
      next(err);
    }
  },
);

app.put(
  '/v1/auctions/:auctionId/finalisation',
  validateRequest(auctionIdParamSchema, 'params'),
  validateRequest(finaliseRequestSchema),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const { allocationHash, approve } = req.body as FinaliseRequest;

      let cache = await ensureCached(auctionId);
      if (!cache?.allocationResult) {
        cache = await hydrateAuctionFromChain(auctionId);
      }
      if (!cache?.allocationResult) {
        return res.status(409).json({ error: 'no allocation result available' });
      }
      if (cache.finalised) {
        return res.status(409).json({ error: 'auction already finalised' });
      }
      if (cache.cancelled) {
        return res.status(409).json({ error: 'auction cancelled' });
      }

      if (allocationHash.toLowerCase() !== cache.allocationResult.allocationHash.toLowerCase()) {
        return res.status(400).json({ error: 'allocationHash mismatch' });
      }

      const isin = cache.isin;
      if (!isin) {
        return res.status(400).json({ error: 'missing ISIN for auction' });
      }

      if (!approve) {
        upsertAuction(auctionId, { rejected: true, status: 'rejected' });
        return res.json({ auctionId, isin, status: 'rejected', allocationHash });
      }

      const allocPayload = cache.allocationResult.allocations.map((a) => ({
        isin: a.isin,
        bidder: a.bidder,
        units: a.units,
        rate: a.rate,
        auctionType: cache.allocationResult?.auctionType ?? cache.auctionType ?? AuctionType.PRICE,
      }));

      if (!cache.unsealedBids) {
        return res.status(409).json({ error: 'unsealed bids required for finalisation' });
      }

      const usedBidIndexes = new Set<number>();
      const proofs = allocPayload.map((allocation) => {
        const matchIndex = cache.unsealedBids?.findIndex(
          (bid) =>
            bid.bidder.toLowerCase() === allocation.bidder.toLowerCase() &&
            !usedBidIndexes.has(bid.bidIndex),
        );
        if (matchIndex === undefined || matchIndex < 0) {
          throw new Error(`missing unsealed bid for allocation bidder ${allocation.bidder}`);
        }
        const match = cache.unsealedBids![matchIndex];
        usedBidIndexes.add(match.bidIndex);
        if (!match) {
          throw new Error(`missing unsealed bid for allocation bidder ${allocation.bidder}`);
        }
        if (!match.plaintext.bidderSig) {
          throw new Error(`missing bidderSig for ${match.bidder}`);
        }
        return {
          bidIndex: BigInt(match.bidIndex),
          bidderNonce: BigInt(match.plaintext.bidderNonce),
          bidderSig: match.plaintext.bidderSig,
        };
      });

      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.finaliseAuction(isin, allocPayload, proofs, { nonce });
      });

      upsertAuction(auctionId, { finalised: true, rejected: false, status: 'finalised' });

      res.json({
        auctionId,
        isin,
        status: 'finalised',
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        allocation: formatAllocationResult(cache.allocationResult),
      });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/auctions/:auctionId/cancel',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      let cache = await ensureCached(auctionId);
      if (!cache) {
        return res.status(404).json({ error: 'auction not found' });
      }
      if (cache.cancelled) {
        return res.status(409).json({ error: 'auction already cancelled' });
      }
      if (cache.finalised) {
        return res.status(409).json({ error: 'auction already finalised' });
      }
      if (!cache.isin) {
        const bondAuctionContract = await getBondAuction();
        const metadata = await bondAuctionContract.getAuction(auctionId);
        cache = { ...cache, isin: metadata.isin };
      }
      if (!cache.isin) {
        return res.status(400).json({ error: 'missing ISIN for auction' });
      }
      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.cancelAuction(cache!.isin!, { nonce });
      });

      upsertAuction(auctionId, { status: 'cancelled', cancelled: true });

      res.json({
        auctionId,
        isin: cache.isin,
        status: 'cancelled',
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/bonds/:isin/coupon-payments',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(payCouponRequestSchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { holders } = req.body as PayCouponRequest;
      const targetHolders = holders && holders.length > 0 ? holders : await getActiveHolders(isin);
      if (!targetHolders.length) {
        return res.status(404).json({ error: 'no holders found for coupon payment' });
      }

      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.payCoupon(isin, targetHolders, { nonce });
      });

      res.json({
        isin,
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: 'submitted',
        holderCount: targetHolders.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/bonds/:isin/redemptions',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(redeemRequestSchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { holders } = req.body as RedeemRequest;
      const targetHolders = holders && holders.length > 0 ? holders : await getActiveHolders(isin);
      if (!targetHolders.length) {
        return res.status(404).json({ error: 'no holders found for redemption' });
      }

      const { tx, receipt } = await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.redeem(isin, targetHolders, { nonce });
      });

      res.json({
        isin,
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
        status: 'submitted',
        holderCount: targetHolders.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

app.get('/v1/bonds/:isin/history', validateRequest(isinParamSchema, 'params'), (req, res) => {
  const { isin } = req.params as { isin: string };
  const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 500);
  const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
  const events = getAuctionEventsByIsin(historyDb, isin, limit, offset).map((e) => ({
    auctionId: e.auction_id,
    isin: e.isin,
    type: e.type,
    block: e.block,
    txHash: e.tx_hash,
    payload: e.payload ? JSON.parse(e.payload) : null,
  }));
  const bondEvents = getBondEventsByIsin(historyDb, isin, limit, offset).map((b) => ({
    isin: b.isin,
    type: b.type,
    block: b.block,
    txHash: b.tx_hash,
    payload: b.payload ? JSON.parse(b.payload) : null,
  }));
  res.json({ isin, events, bondEvents });
});

app.get('/v1/bonds/:isin/holders', validateRequest(isinParamSchema, 'params'), async (req, res) => {
  const { isin } = req.params as { isin: string };
  const active = await getActiveHoldersWithBalance(isin);
  res.json({
    isin,
    holders: active.map((h) => ({ isin, holder: h.holder, balance: h.balance })),
  });
});

app.get('/v1/bonds/:isin', validateRequest(isinParamSchema, 'params'), async (req, res, next) => {
  try {
    const { isin } = req.params as { isin: string };
    const bondToken = await getBondToken();
    const partition = keccak256(toUtf8Bytes(isin));

    const maturityDurationRaw = await bondToken.maturityDuration(partition).catch(() => null);
    const couponDurationRaw = await bondToken.couponDuration(partition).catch(() => null);
    const couponYieldRaw = await bondToken.couponYield(partition).catch(() => null);
    const lastCouponPaymentRaw = await bondToken.lastCouponPayment(partition).catch(() => null);
    const couponPaymentCountRaw = await bondToken.couponPaymentCount(partition).catch(() => null);
    const isMaturedRaw = await bondToken.isMatured(partition).catch(() => null);
    const totalSupplyRaw = await bondToken.totalSupplyByPartition(partition).catch(() => null);
    const maturityDateRaw = await bondToken.maturityDate(partition).catch(() => null);
    const bondEvents = getBondEventsByIsin(historyDb, isin, 1000, 0);

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
    const balanceSum = getBalancesByIsin(historyDb, isin).reduce(
      (sum, b) => sum + BigInt(b.balance ?? '0'),
      0n,
    );
    let supplyResolved =
      totalSupply !== null
        ? balanceSum < totalSupply
          ? balanceSum
          : totalSupply
        : balanceSum !== null
          ? balanceSum
          : null;

    let couponPaymentsTotal: bigint | null = null;
    let couponPaymentsRemaining: bigint | null = null;
    if (maturityDuration && couponDuration && couponDuration > 0n) {
      couponPaymentsTotal = maturityDuration / couponDuration;
      if (couponPaymentCount !== null) {
        const remaining = couponPaymentsTotal - (couponPaymentCount ?? 0n);
        couponPaymentsRemaining = remaining >= 0n ? remaining : 0n;
      }
    }

    let timeToMaturity: bigint | null = null;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (maturityDate && maturityDate > 0n) {
      const diff = maturityDate > now ? maturityDate - now : 0n;
      timeToMaturity = diff;
    } else if (couponDuration && couponPaymentCount !== null && couponPaymentsTotal !== null) {
      const remainingIntervals = couponPaymentsTotal - (couponPaymentCount ?? 0n);
      const base = lastCouponPayment && lastCouponPayment > 0n ? lastCouponPayment : now;
      const estimated = base + remainingIntervals * couponDuration;
      timeToMaturity = estimated > now ? estimated - now : 0n;
    }

    const hasRedeemEvent = bondEvents.some((e) => e.type === 'REDEEMED');
    // If redemption was observed on-chain but totalSupply call failed (or local balances are stale),
    // force supplyResolved to 0 so status reflects redemption accurately.
    if (hasRedeemEvent && (totalSupply === null || supplyResolved === null)) {
      supplyResolved = 0n;
    }

    let status: 'minting' | 'maturing' | 'matured' | 'redeemed' | 'unknown' = 'unknown';
    if (isMatured || hasRedeemEvent) {
      status = supplyResolved === 0n ? 'redeemed' : 'matured';
    } else if (couponPaymentCount !== null && couponPaymentCount > 0n) {
      status = 'maturing';
    } else if (couponPaymentCount !== null) {
      status = 'minting';
    }

    res.json({
      isin,
      maturityDuration: maturityDuration?.toString() ?? null,
      maturityDate: maturityDate?.toString() ?? null,
      timeToMaturity: timeToMaturity?.toString() ?? null,
      couponDuration: couponDuration?.toString() ?? null,
      couponYield: couponYield?.toString() ?? null,
      couponPaymentsTotal: couponPaymentsTotal?.toString() ?? null,
      couponPaymentsMade: couponPaymentCount?.toString() ?? null,
      couponPaymentsRemaining: couponPaymentsRemaining?.toString() ?? null,
      status,
      totalSupply: supplyResolved !== null ? supplyResolved.toString() : null,
    });
  } catch (err) {
    next(err);
  }
});

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof RegistryResolutionError) {
      logger.warn(`registry lookup failed: ${err.message}`);
      res.status(503).json({
        status: 'unavailable',
        error: err.message,
        registryAddress: err.registryAddress,
        contractName: err.contractName,
      });
      return;
    }
    if (err instanceof RpcUnavailableError) {
      logger.warn(`rpc unavailable: ${err.message}`);
      res.status(503).json({
        status: 'unavailable',
        error: err.message,
        rpcUrl: err.rpcUrl,
      });
      return;
    }

    const errMeta = err as { status?: number; errors?: unknown };
    const status =
      typeof errMeta.status === 'number' && errMeta.status >= 400 && errMeta.status < 600
        ? errMeta.status
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    const details = errMeta.errors;
    logger.error(message);
    res.status(status).json(details ? { error: message, details } : { error: message });
  },
);

const port = envVariables.EXPRESS_PORT;
app.listen(port, () => {
  logger.info(`nb-bond-api listening on ${port}`);
});

// Start ingestion in-process
import('./ingestion')
  .then(({ startIngestionLoop }) => startIngestionLoop())
  .catch((err) => logger.warn(`failed to start ingestion loop: ${(err as Error).message}`));
