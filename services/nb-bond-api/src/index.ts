/**
 * nb-bond-api HTTP server.
 *
 * Routes the v2 endpoint catalog described in docs/plans/openapi-v2-plan.md
 * §5. Each handler:
 *   - validates request params/body via Zod (validation.ts)
 *   - composes the bulky-tree response DTO via compose.ts
 *   - emits the response via okResponse() — ETag + 304 short-circuit + md5
 *   - throws HttpError() on failure, translated to RFC 7807 ProblemDetails
 *     by the error middleware
 *
 * Mutations always return the *updated parent* (Bond after coupon /
 * redeem / createAuction; Auction after close / cancel / finalise) so
 * the UI can atomically swap its cache.
 */
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { keccak256, toUtf8Bytes } from 'ethers';

import { authMiddleware } from './auth';
import {
  composeAllAuctions,
  composeAllBonds,
  composeAuction,
  composeBond,
  composeBondHistory,
} from './compose';
import { envVariables } from './env-vars';
import {
  HttpError,
  badRequest,
  conflict,
  notFound,
  okResponse,
  problemErrorMiddleware,
} from './http';
import {
  getBondAuction,
  getBondAuctionAddress,
  getBondManager,
  getBondToken,
  getWnok,
  getWnokAddress,
  sendWithManagedNonce,
} from './chain';
import { getBalancesByIsin, openDatabase } from './ingestion-db';
import { initSealingKeypair, type SealingKeypair } from './keys';
import { logger } from './logger';
import { parseBigInt } from './parsing';
import {
  type CloseAuctionBody,
  type CreateAuctionBody,
  type CreateBidderBody,
  type FinaliseBody,
  type HoldersBody,
  type SubmitBidBody,
  type WnokMintBurnBody,
  type WnokTransferBody,
  auctionIdParamSchema,
  bidderAddressParamSchema,
  closeAuctionBodySchema,
  createAuctionBodySchema,
  createBidderBodySchema,
  finaliseBodySchema,
  holdersBodySchema,
  isinParamSchema,
  openApiDocument,
  submitBidBodySchema,
  wnokMintBurnBodySchema,
  wnokTransferBodySchema,
} from './schemas';
import { validateRequest } from './validation';
import {
  BidderConflictError,
  BidderValidationError,
  createBidder,
  deleteBidder,
  getBidderByAddress,
  listBidders,
  seedFixtureBiddersIfEmpty,
} from './bidders';
import { BidderBidError, submitImpersonatedBid } from './bidder-bid';
import {
  CentralBankNotConfiguredError,
  WnokUnavailableError,
  addToAllowlist,
  burnWnok,
  getCbAddress,
  getCbWnokBalance,
  isCentralBankReady,
  listAllowlist,
  mintWnok,
  removeFromAllowlist,
  transferWnokFromCb,
} from './central-bank';
import { withMd5 } from './http';
import { provider } from './chain';

const sealingKeys: SealingKeypair = initSealingKeypair(envVariables.AUCTION_OWNER_SEAL_PK);

const corsAllowedOrigins = envVariables.CORS_ALLOWED_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const app = express();
app.use(express.json());
app.use(helmet());
app.use(
  cors({
    origin: corsAllowedOrigins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'If-None-Match'],
    exposedHeaders: ['ETag'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Global rate limit. Generous enough for the operator UI's polling
// cadence (every few seconds) but bounded — guards against runaway
// clients and satisfies the CodeQL `js/missing-rate-limiting` check
// on the auth-gated routes mounted below.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);

const historyDb = openDatabase({ dbPath: envVariables.DB_PATH, readonly: true });

// Bidders use their own writable handle. The `bidders` table is a
// system-of-record (not a chain projection) so seeding + mutation
// happen here, not via the ingestion loop. SQLite WAL mode serialises
// writes across this connection, the ingestion loop, and the read-only
// `historyDb`.
const biddersDb = openDatabase({ dbPath: envVariables.DB_PATH, readonly: false });
try {
  const seed = seedFixtureBiddersIfEmpty(biddersDb);
  logger.debug(`bidders seed: ${JSON.stringify(seed)}`);
} catch (err) {
  logger.warn(`bidders seed failed: ${(err as Error).message}`);
}

// #region Unauthenticated routes (mounted before authMiddleware) ─────

// OpenAPI doc is always public — it's the contract.
app.get('/docs', (_req, res) => {
  res.json(openApiDocument);
});
app.get('/v1/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

// Health intentionally bypasses auth (per OpenAPI security: []).
app.get('/v1/health', async (req, res, next) => {
  try {
    const bondManager = await getBondManager();
    const bondAuctionAddress = await getBondAuctionAddress();
    const bondTokenAddress = await bondManager.BOND_TOKEN();
    const wnokAddr = await getWnokAddress().catch(() => null);
    okResponse(req, res, {
      status: 'ok' as const,
      contracts: {
        bondManager: bondManager.target.toString(),
        bondAuction: bondAuctionAddress,
        bondToken: bondTokenAddress,
        wnok: wnokAddr,
      },
      sealingPubKey: sealingKeys.publicKey,
    });
  } catch (err) {
    next(err);
  }
});

// #endregion

// #region Auth gate ──────────────────────────────────────────────────

// Everything below this line goes through the auth middleware (no-op
// in `none` mode, JWT validation in `entra` mode).
app.use(authMiddleware);

// #endregion

// #region Bonds ──────────────────────────────────────────────────────

/**
 * Sandbox-only umbrella "test mode" flag. The operator UI flips this
 * from the top-bar toggle and propagates it on every bond / auction
 * read as well as on close / finalise. Today it gates:
 *
 *  - composeBond / composeAuction unseal sealed bids on still-open
 *    auctions (`revealOpenBids` internally).
 *  - PATCH /v1/auctions/{id} (close) skips the end-time pre-check so
 *    the operator can attempt close before the bidding window expires.
 *    The on-chain contract still enforces `block.timestamp >
 *    metadata.end` and will revert with `InBidPhase()` if it's early.
 *
 * Future test affordances should plumb through this same parameter so
 * a single toggle controls them all.
 */
function parseTestMode(req: express.Request): boolean {
  const raw = req.query.testMode;
  return raw === 'true' || raw === '1';
}

app.get('/v1/bonds', async (req, res, next) => {
  try {
    const bonds = await composeAllBonds(historyDb, {
      revealOpenBids: parseTestMode(req),
    });
    okResponse(req, res, bonds);
  } catch (err) {
    next(err);
  }
});

app.get('/v1/bonds/:isin', validateRequest(isinParamSchema, 'params'), async (req, res, next) => {
  try {
    const { isin } = req.params as { isin: string };
    const bond = await composeBond(historyDb, isin, {
      revealOpenBids: parseTestMode(req),
    });
    if (!bond) throw notFound(`bond ${isin} not found`);
    okResponse(req, res, bond);
  } catch (err) {
    next(err);
  }
});

app.get('/v1/bonds/:isin/history', validateRequest(isinParamSchema, 'params'), (req, res, next) => {
  try {
    const { isin } = req.params as { isin: string };
    const before = req.query.before ? Number(req.query.before) : null;
    const limit = req.query.limit ? Number(req.query.limit) : null;
    const events = composeBondHistory(historyDb, isin, { before, limit });
    okResponse(req, res, events);
  } catch (err) {
    next(err);
  }
});

app.post(
  '/v1/bonds/:isin/coupon-payments',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(holdersBodySchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { holders } = req.body as HoldersBody;
      const targetHolders = holders && holders.length > 0 ? holders : await getActiveHolders(isin);
      if (!targetHolders.length) {
        throw notFound('no holders found for coupon payment');
      }

      await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.payCoupon(isin, targetHolders, { nonce });
      });

      const bond = await composeBond(historyDb, isin);
      if (!bond) throw notFound(`bond ${isin} not found`);
      okResponse(req, res, bond);
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/bonds/:isin/redemptions',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(holdersBodySchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const { holders } = req.body as HoldersBody;
      const targetHolders = holders && holders.length > 0 ? holders : await getActiveHolders(isin);
      if (!targetHolders.length) {
        throw notFound('no holders found for redemption');
      }

      await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.redeem(isin, targetHolders, { nonce });
      });

      const bond = await composeBond(historyDb, isin);
      if (!bond) throw notFound(`bond ${isin} not found`);
      okResponse(req, res, bond);
    } catch (err) {
      next(err);
    }
  },
);

// #endregion

// #region Auction creation (under a bond) ────────────────────────────

app.post(
  '/v1/bonds/:isin/auctions',
  validateRequest(isinParamSchema, 'params'),
  validateRequest(createAuctionBodySchema),
  async (req, res, next) => {
    try {
      const { isin } = req.params as { isin: string };
      const body = req.body as CreateAuctionBody;
      const auctionType = body.type;

      let endSeconds: bigint;
      try {
        endSeconds = parseBigInt(body.end, 'end');
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (endSeconds <= nowSeconds) throw badRequest('end must be in the future');

      let sizeUnits: bigint;
      try {
        sizeUnits = parseBigInt(body.size, 'size');
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      if (sizeUnits <= 0n) throw badRequest('size must be positive');

      let maturitySeconds: bigint | undefined;
      if (body.maturityDuration !== null && body.maturityDuration !== undefined) {
        try {
          maturitySeconds = parseBigInt(body.maturityDuration, 'maturityDuration');
        } catch (err) {
          throw badRequest((err as Error).message);
        }
        if (maturitySeconds <= 0n) throw badRequest('maturityDuration must be positive');
      }

      const bondAuctionContract = await getBondAuction();
      const auctionCount = await bondAuctionContract.isinToAuctionCount(isin).catch(() => 0n);
      if (auctionCount === 0n && auctionType !== 'RATE') {
        throw badRequest('first auction for ISIN must be RATE');
      }
      if (auctionCount > 0n && auctionType === 'RATE') {
        throw badRequest('subsequent auctions cannot be RATE');
      }
      if (auctionType === 'RATE' && maturitySeconds === undefined) {
        throw badRequest('maturityDuration is required for RATE');
      }

      const pubKey = sealingKeys.publicKey;
      const bondManager = await getBondManager();

      // Static-call validation first so revert reasons surface cleanly.
      if (auctionType === 'RATE') {
        await bondManager.deployBondWithAuction.staticCall(
          isin,
          endSeconds,
          pubKey,
          sizeUnits,
          maturitySeconds!,
        );
      } else if (auctionType === 'PRICE') {
        await bondManager.extendBondWithAuction.staticCall(isin, endSeconds, pubKey, sizeUnits);
      } else {
        await bondManager.buybackWithAuction.staticCall(isin, endSeconds, pubKey, sizeUnits);
      }

      await sendWithManagedNonce(async (nonce) => {
        if (auctionType === 'RATE') {
          return bondManager.deployBondWithAuction(
            isin,
            endSeconds,
            pubKey,
            sizeUnits,
            maturitySeconds!,
            { nonce },
          );
        }
        if (auctionType === 'PRICE') {
          return bondManager.extendBondWithAuction(isin, endSeconds, pubKey, sizeUnits, { nonce });
        }
        return bondManager.buybackWithAuction(isin, endSeconds, pubKey, sizeUnits, { nonce });
      });

      const bond = await composeBond(historyDb, isin);
      if (!bond) throw notFound(`bond ${isin} not found after creation`);
      okResponse(req, res, bond);
    } catch (err) {
      next(err);
    }
  },
);

// #endregion

// #region Auctions ───────────────────────────────────────────────────

app.get('/v1/auctions', async (req, res, next) => {
  try {
    const auctions = await composeAllAuctions(historyDb, {
      revealOpenBids: parseTestMode(req),
    });
    okResponse(req, res, auctions);
  } catch (err) {
    next(err);
  }
});

app.get(
  '/v1/auctions/:auctionId',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const auction = await composeAuction(historyDb, auctionId, {
        revealOpenBids: parseTestMode(req),
      });
      if (!auction) throw notFound(`auction ${auctionId} not found`);
      okResponse(req, res, auction);
    } catch (err) {
      next(err);
    }
  },
);

app.patch(
  '/v1/auctions/:auctionId',
  validateRequest(auctionIdParamSchema, 'params'),
  validateRequest(closeAuctionBodySchema),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const body = req.body as CloseAuctionBody;
      if (body.status !== 'closed') throw badRequest('only status="closed" is supported today');

      // Resolve the auction's ISIN from chain — the manager's closeAuction
      // is keyed by ISIN, not auctionId.
      const bondAuctionContract = await getBondAuction();
      const metadata = await bondAuctionContract.getAuction(auctionId);
      const isin = metadata.isin as string;
      if (!isin) throw notFound(`auction ${auctionId} not found`);

      const currentStatus = Number(await bondAuctionContract.getAuctionStatus(auctionId));
      if (currentStatus === 2) throw conflict('auction already closed');
      if (currentStatus === 3) throw conflict('auction already finalised');
      if (currentStatus === 4) throw conflict('auction cancelled');

      // Pre-check the bidding window so we don't surface a raw revert.
      // BondAuction.closeAuction reverts with `InBidPhase()` (selector
      // 0xeec5b85e) when `block.timestamp <= metadata.end`. Skipped
      // when `?testMode=true` so the operator can attempt close before
      // the end timestamp — the on-chain contract still enforces the
      // window and the operator sees the revert directly.
      const testMode = parseTestMode(req);
      const endSeconds = BigInt(metadata.end?.toString?.() ?? '0');
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (!testMode && endSeconds > nowSeconds) {
        const secondsLeft = endSeconds - nowSeconds;
        throw conflict(
          `auction is still in BIDDING phase; the bidding window ends in ${secondsLeft.toString()}s` +
            ` (at unix ${endSeconds.toString()}). Close is only permitted after the end timestamp.` +
            ` Enable Test mode in the operator UI to attempt anyway — the on-chain contract will` +
            ` still revert with InBidPhase() until the window expires.`,
        );
      }

      await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.closeAuction(isin, { nonce });
      });

      const auction = await composeAuction(historyDb, auctionId);
      if (!auction) throw notFound(`auction ${auctionId} not found after close`);
      okResponse(req, res, auction);
    } catch (err) {
      next(err);
    }
  },
);

app.delete(
  '/v1/auctions/:auctionId',
  validateRequest(auctionIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };

      const bondAuctionContract = await getBondAuction();
      const metadata = await bondAuctionContract.getAuction(auctionId);
      const isin = metadata.isin as string;
      if (!isin) throw notFound(`auction ${auctionId} not found`);

      const currentStatus = Number(await bondAuctionContract.getAuctionStatus(auctionId));
      if (currentStatus === 3) throw conflict('auction already finalised');
      if (currentStatus === 4) throw conflict('auction already cancelled');

      await sendWithManagedNonce(async (nonce) => {
        const bondManager = await getBondManager();
        return bondManager.cancelAuction(isin, { nonce });
      });

      const auction = await composeAuction(historyDb, auctionId);
      if (!auction) throw notFound(`auction ${auctionId} not found after cancel`);
      okResponse(req, res, auction);
    } catch (err) {
      next(err);
    }
  },
);

app.put(
  '/v1/auctions/:auctionId/finalisation',
  validateRequest(auctionIdParamSchema, 'params'),
  validateRequest(finaliseBodySchema),
  async (req, res, next) => {
    try {
      const { auctionId } = req.params as { auctionId: string };
      const { allocationHash, approve } = req.body as FinaliseBody;

      const auction = await composeAuction(historyDb, auctionId);
      if (!auction) throw notFound(`auction ${auctionId} not found`);
      if (!auction.allocation) throw conflict('no allocation result available');
      if (auction.status === 'finalised') throw conflict('auction already finalised');
      if (auction.status === 'cancelled') throw conflict('auction cancelled');
      if (auction.allocation.hash.toLowerCase() !== allocationHash.toLowerCase()) {
        throw badRequest('allocationHash mismatch');
      }

      const isin = auction.isin;
      if (!approve) {
        // Reject path: no on-chain tx; just compose fresh state.
        // (Backend doesn't currently persist 'rejected' anywhere yet; tx
        //  is recorded once contract supports it. For now reflect via
        //  current chain status.)
        const refreshed = await composeAuction(historyDb, auctionId);
        if (!refreshed) throw notFound(`auction ${auctionId} not found after reject`);
        okResponse(req, res, refreshed);
        return;
      }

      // Approve path: rebuild allocation payload + proofs from the
      // composed unsealed bids and submit to BondManager.finaliseAuction.
      const allocPayload = auction.allocation.entries.map((entry) => ({
        isin,
        bidder: entry.bidder,
        units: BigInt(entry.units),
        rate: BigInt(entry.rate),
        auctionType: auction.type === 'RATE' ? 0 : auction.type === 'PRICE' ? 1 : 2,
      }));

      const unsealedFromCompose = auction.bids.filter((b) => b.state === 'unsealed');
      if (unsealedFromCompose.length === 0) {
        throw conflict('unsealed bids required for finalisation');
      }

      // Need the bidder signatures / bidderNonce — re-derive from chain.
      const { unsealBid, normalizeSealedBid } = await import('./bid');
      const bondManager = await getBondManager();
      const sealed = await bondManager.getSealedBids(isin);
      const sealedBids = (
        sealed as Array<{
          bidder: string;
          ciphertext: string;
          plaintextHash: string;
        }>
      ).map(normalizeSealedBid);
      const unsealedBids = sealedBids.map((b, i) => unsealBid(isin, b, i));

      const usedBidIndexes = new Set<number>();
      const proofs = allocPayload.map((allocation) => {
        const idx = unsealedBids.findIndex(
          (b) =>
            b.bidder.toLowerCase() === allocation.bidder.toLowerCase() &&
            !usedBidIndexes.has(b.bidIndex),
        );
        if (idx < 0) {
          throw conflict(`missing unsealed bid for allocation bidder ${allocation.bidder}`);
        }
        const match = unsealedBids[idx];
        usedBidIndexes.add(match.bidIndex);
        if (!match.plaintext.bidderSig) {
          throw conflict(`missing bidderSig for ${match.bidder}`);
        }
        return {
          bidIndex: BigInt(match.bidIndex),
          bidderNonce: BigInt(match.plaintext.bidderNonce),
          bidderSig: match.plaintext.bidderSig,
        };
      });

      await sendWithManagedNonce(async (nonce) => {
        return bondManager.finaliseAuction(isin, allocPayload, proofs, { nonce });
      });

      const refreshed = await composeAuction(historyDb, auctionId);
      if (!refreshed) throw notFound(`auction ${auctionId} not found after finalisation`);
      okResponse(req, res, refreshed);
    } catch (err) {
      next(err);
    }
  },
);

// #endregion

// #region Bidders ────────────────────────────────────────────────────

async function composeBidderDto(record: {
  address: string;
  name: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
}) {
  const [ethBalance, wnok] = await Promise.all([
    provider.getBalance(record.address).catch(() => 0n),
    getWnok().catch(() => null),
  ]);
  const wnokBalanceRaw = wnok
    ? await (wnok.balanceOf(record.address) as Promise<bigint>).catch(() => 0n)
    : 0n;
  return withMd5({
    address: record.address,
    name: record.name,
    publicKey: record.publicKey,
    privateKey: record.privateKey,
    ethBalance: ethBalance.toString(),
    wnokBalance: wnokBalanceRaw.toString(),
    createdAt: record.createdAt,
  });
}

app.get('/v1/bidders', async (req, res, next) => {
  try {
    const bidders = listBidders(biddersDb);
    const dtos = await Promise.all(bidders.map(composeBidderDto));
    okResponse(req, res, dtos);
  } catch (err) {
    next(err);
  }
});

app.post('/v1/bidders', validateRequest(createBidderBodySchema), async (req, res, next) => {
  try {
    const body = req.body as CreateBidderBody;
    let record;
    try {
      record = createBidder(biddersDb, { name: body.name, privateKey: body.privateKey });
    } catch (err) {
      if (err instanceof BidderValidationError) {
        throw badRequest(err.message);
      }
      if (err instanceof BidderConflictError) {
        throw conflict(err.message);
      }
      throw err;
    }
    const dto = await composeBidderDto(record);
    okResponse(req, res, dto);
  } catch (err) {
    next(err);
  }
});

app.delete(
  '/v1/bidders/:address',
  validateRequest(bidderAddressParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const { address } = req.params as { address: string };
      const existing = getBidderByAddress(biddersDb, address);
      if (!existing) throw notFound(`bidder ${address} not found`);

      const conflicts = await findOpenAuctionsWithBidsByBidder(existing.address);
      if (conflicts.length > 0) {
        throw new HttpError(409, 'Conflict', {
          detail: 'bidder has unrevealed bids on open auctions',
          errors: conflicts.map((auctionId) => ({
            field: 'address',
            message: `unrevealed bid on auction ${auctionId}`,
          })),
        });
      }

      const removed = deleteBidder(biddersDb, existing.address);
      if (!removed) throw notFound(`bidder ${address} not found`);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/bidders/:address/bids',
  validateRequest(bidderAddressParamSchema, 'params'),
  validateRequest(submitBidBodySchema),
  async (req, res, next) => {
    try {
      const { address } = req.params as { address: string };
      const body = req.body as SubmitBidBody;

      const bidder = getBidderByAddress(biddersDb, address);
      if (!bidder) throw notFound(`bidder ${address} not found`);

      let result;
      try {
        result = await submitImpersonatedBid({
          bidder,
          auctionId: body.auctionId,
          units: body.units,
          rate: body.rate,
        });
      } catch (err) {
        if (err instanceof BidderBidError) {
          if (err.code === 'AUCTION_NOT_FOUND') throw notFound(err.message);
          if (err.code === 'AUCTION_NOT_BIDDING' || err.code === 'BIDDING_WINDOW_CLOSED') {
            throw conflict(err.message);
          }
          // TX_FAILED / EVENT_NOT_FOUND → 500-equivalent (let the error middleware handle)
        }
        throw err;
      }

      const dto = withMd5({
        bidder: result.bidder,
        state: 'sealed' as const,
        ciphertext: result.ciphertext,
        plaintextHash: result.plaintextHash,
      });
      okResponse(req, res, dto);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Return the list of auction ids in `BIDDING` phase that currently
 * carry at least one sealed bid from `bidderAddress`. Used to block
 * delete-bidder while in-flight commitments exist.
 */
async function findOpenAuctionsWithBidsByBidder(bidderAddress: string): Promise<string[]> {
  try {
    const bondAuction = await getBondAuction();
    const all = await composeAllAuctions(historyDb);
    const conflicts: string[] = [];
    for (const a of all) {
      if (a.status !== 'open') continue;
      try {
        // BondAuction.getSealedBids takes the bytes32 auction id, not the ISIN.
        const sealed = (await bondAuction.getSealedBids(a.id)) as Array<{ bidder: string }>;
        if (sealed.some((b) => b.bidder.toLowerCase() === bidderAddress.toLowerCase())) {
          conflicts.push(a.id);
        }
      } catch (err) {
        logger.debug(
          `findOpenAuctionsWithBidsByBidder: getSealedBids failed for ${a.id}: ${(err as Error).message}`,
        );
      }
    }
    return conflicts;
  } catch (err) {
    logger.warn(
      `findOpenAuctionsWithBidsByBidder failed: ${(err as Error).message}; allowing delete`,
    );
    return [];
  }
}

// #endregion

// #region Central Bank ───────────────────────────────────────────────

function mapCentralBankError(err: unknown): never {
  if (err instanceof CentralBankNotConfiguredError) {
    throw new HttpError(503, 'Service Unavailable', { detail: err.message });
  }
  if (err instanceof WnokUnavailableError) {
    throw new HttpError(503, 'Service Unavailable', { detail: err.message });
  }
  throw err;
}

function toAllowlistEntry(address: string) {
  return withMd5({ address });
}

app.get('/v1/central-bank', async (req, res, next) => {
  try {
    const ready = await isCentralBankReady();
    if (!ready) {
      okResponse(
        req,
        res,
        withMd5({
          address: envVariables.CENTRAL_BANK_PK
            ? getCbAddress()
            : '0x0000000000000000000000000000000000000000',
          available: false,
          wnok: null,
        }),
      );
      return;
    }
    const wnokAddr = await getWnokAddress();
    if (!wnokAddr) {
      okResponse(
        req,
        res,
        withMd5({
          address: getCbAddress(),
          available: false,
          wnok: null,
        }),
      );
      return;
    }
    const [balance, allowlist] = await Promise.all([
      getCbWnokBalance().catch(() => 0n),
      listAllowlist().catch(() => [] as string[]),
    ]);
    okResponse(
      req,
      res,
      withMd5({
        address: getCbAddress(),
        available: true,
        wnok: {
          contractAddress: wnokAddr,
          balance: balance.toString(),
          allowlistSize: allowlist.length,
        },
      }),
    );
  } catch (err) {
    next(err);
  }
});

app.get('/v1/central-bank/allowlist', async (req, res, next) => {
  try {
    const addresses = await listAllowlist();
    okResponse(req, res, addresses.map(toAllowlistEntry));
  } catch (err) {
    try {
      mapCentralBankError(err);
    } catch (mapped) {
      next(mapped);
    }
  }
});

app.put('/v1/central-bank/allowlist/:address', async (req, res, next) => {
  try {
    const { address } = req.params as { address: string };
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw badRequest('address must be a valid EVM address');
    }
    let ref;
    try {
      ref = await addToAllowlist(address);
    } catch (err) {
      mapCentralBankError(err);
      return;
    }
    okResponse(req, res, ref);
  } catch (err) {
    next(err);
  }
});

app.delete('/v1/central-bank/allowlist/:address', async (req, res, next) => {
  try {
    const { address } = req.params as { address: string };
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw badRequest('address must be a valid EVM address');
    }
    let ref;
    try {
      ref = await removeFromAllowlist(address);
    } catch (err) {
      mapCentralBankError(err);
      return;
    }
    okResponse(req, res, ref);
  } catch (err) {
    next(err);
  }
});

app.post(
  '/v1/central-bank/wnok/mint',
  validateRequest(wnokMintBurnBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as WnokMintBurnBody;
      let amount: bigint;
      try {
        amount = BigInt(body.amount);
      } catch {
        throw badRequest('amount must be a decimal uint256 string');
      }
      if (amount <= 0n) throw badRequest('amount must be positive');
      let ref;
      try {
        ref = await mintWnok(body.address, amount);
      } catch (err) {
        mapCentralBankError(err);
        return;
      }
      okResponse(req, res, ref);
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/central-bank/wnok/burn',
  validateRequest(wnokMintBurnBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as WnokMintBurnBody;
      let amount: bigint;
      try {
        amount = BigInt(body.amount);
      } catch {
        throw badRequest('amount must be a decimal uint256 string');
      }
      if (amount <= 0n) throw badRequest('amount must be positive');
      let ref;
      try {
        ref = await burnWnok(body.address, amount);
      } catch (err) {
        mapCentralBankError(err);
        return;
      }
      okResponse(req, res, ref);
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/v1/central-bank/wnok/transfer',
  validateRequest(wnokTransferBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as WnokTransferBody;
      let amount: bigint;
      try {
        amount = BigInt(body.amount);
      } catch {
        throw badRequest('amount must be a decimal uint256 string');
      }
      if (amount <= 0n) throw badRequest('amount must be positive');
      let ref;
      try {
        ref = await transferWnokFromCb(body.to, amount);
      } catch (err) {
        mapCentralBankError(err);
        return;
      }
      okResponse(req, res, ref);
    } catch (err) {
      next(err);
    }
  },
);

// #endregion

// #region Holder lookup (internal helper) ────────────────────────────

async function getActiveHolders(isin: string): Promise<string[]> {
  const dbHolders = getBalancesByIsin(historyDb, isin);
  let bondToken;
  try {
    bondToken = await getBondToken();
  } catch {
    return dbHolders.map((h) => h.holder);
  }
  const partition = keccak256(toUtf8Bytes(isin));
  const active = await Promise.all(
    dbHolders.map(async (h) => {
      try {
        const onChain = await bondToken.balanceOfByPartition(partition, h.holder);
        return onChain > 0n ? h.holder : null;
      } catch {
        return null;
      }
    }),
  );
  return active.filter((h): h is string => h !== null);
}

// #endregion

// #region Error middleware ───────────────────────────────────────────

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof HttpError) {
    problemErrorMiddleware(err, req, res, next);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`unhandled: ${message}`);
  problemErrorMiddleware(err, req, res, next);
});

// #endregion

const port = envVariables.EXPRESS_PORT;
app.listen(port, () => {
  logger.info(`nb-bond-api listening on ${port}`);
});

// Start ingestion in-process (background).
import('./ingestion')
  .then(({ startIngestionLoop }) => startIngestionLoop())
  .catch((err) => logger.warn(`failed to start ingestion loop: ${(err as Error).message}`));
