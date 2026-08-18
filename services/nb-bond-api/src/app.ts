/**
 * nb-bond-api Express application.
 *
 * Routes the /v1 HTTP API whose original design is recorded in
 * docs/plans/archive/openapi-v2-plan.md
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
import { Interface, keccak256, toUtf8Bytes } from 'ethers';

import { resetProjectionAndRestart, restartIngestionLoop } from './admin';
import { authMiddleware, operatorRoles, recognizedRoles, requireAnyRole } from './auth';
import {
  composeAllAuctions,
  composeAllBonds,
  composeAuction,
  composeBond,
  composeBondHistory,
} from './compose';
import { envVariables } from './env-vars';
import { computeLag, deriveStatus, sanitiseRpcUrl } from './health';
import {
  HttpError,
  badRequest,
  conflict,
  notFound,
  okResponse,
  problemErrorMiddleware,
  serviceUnavailable,
  successResponse,
} from './http';
import {
  decodeCustomError,
  describeRevert,
  getBondAuction,
  getBondAuctionAddress,
  getBondManager,
  getBondToken,
  getWnok,
  getWnokAddress,
  sendWithManagedNonce,
} from './chain';
import { advanceProjectionTo, getIngestionStatus } from './ingestion';
import {
  getBalancesByIsin,
  getProjectionCheckpoint,
  openDatabase,
  type IngestionDatabase,
} from './ingestion-db';
import { initSealingKeypair, type SealingKeypair } from './keys';
import { listOperationAttempts, toOperationAttemptDto, withOperationRecording } from './operations';
import { liveEvents, publishLiveChange } from './live-events';
import { logger } from './logger';
import { parseBigInt } from './parsing';
import {
  type CloseAuctionBody,
  type CreateAuctionBody,
  type CreateBankBody,
  type CreateBidderBody,
  type CreateBondBody,
  type FinaliseBody,
  type HoldersBody,
  type SubmitBidBody,
  type TbdMintBurnBody,
  type TbdTransferBody,
  type WnokMintBurnBody,
  type WnokTransferBody,
  auctionIdParamSchema,
  bidderAddressParamSchema,
  closeAuctionBodySchema,
  createAuctionBodySchema,
  createBankBodySchema,
  createBidderBodySchema,
  createBondBodySchema,
  finaliseBodySchema,
  holdersBodySchema,
  isinParamSchema,
  openApiDocument,
  submitBidBodySchema,
  tbdMintBurnBodySchema,
  tbdTransferBodySchema,
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
  reconcileFixtureBidderOverrides,
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
  getWnokTotalSupply,
  isCentralBankReady,
  listAllowlist,
  listAllowlistWithBalances,
  mintWnok,
  removeFromAllowlist,
  transferWnokFromCb,
} from './central-bank';
import { withMd5 } from './http';
import { provider } from './chain';
import { tbdAbi, wnokAbi } from './abi';
import { createBankingService } from './banking-tbd';
import { BankConflictError, BankValidationError, DvpUnavailableError, createBank } from './banks';
import { listRegisteredContracts } from './registry';
import { createAuctionService } from './features/auctions/service';
import { MutationAcceptedError, type MutationResource } from './application-errors';

export interface AppDependencies {
  historyDb?: IngestionDatabase;
  biddersDb?: IngestionDatabase;
}

/** Construct the HTTP application without binding a port or starting ingestion. */
export function createApp(dependencies: AppDependencies = {}): express.Express {
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
      exposedHeaders: ['ETag', 'X-Projection-Block'],
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

  const historyDb =
    dependencies.historyDb ?? openDatabase({ dbPath: envVariables.DB_PATH, readonly: true });

  // Bidders use their own writable handle. The `bidders` table is a
  // system-of-record (not a chain projection) so seeding + mutation
  // happen here, not via the ingestion loop. SQLite WAL mode serialises
  // writes across this connection, the ingestion loop, and the read-only
  // `historyDb`.
  const biddersDb =
    dependencies.biddersDb ?? openDatabase({ dbPath: envVariables.DB_PATH, readonly: false });
  try {
    const seed = seedFixtureBiddersIfEmpty(biddersDb);
    logger.debug(`bidders seed: ${JSON.stringify(seed)}`);
    // Seeding is only-if-empty, so apply any fixture-role env overrides to
    // rows seeded before the override was set.
    const reconciled = reconcileFixtureBidderOverrides(biddersDb);
    logger.debug(`bidders override reconcile: ${JSON.stringify(reconciled)}`);
  } catch (err) {
    logger.warn(`bidders seed failed: ${(err as Error).message}`);
  }

  // Banking operations are explicitly bound to the preserved banks table;
  // no process-wide mutable database handle is used.
  const banking = createBankingService(biddersDb);
  const awaitMutationProjection = async (
    sent: { tx: { hash: string }; receipt: { blockNumber: number } | null },
    resource: MutationResource,
  ) => {
    const blockNumber = sent.receipt?.blockNumber ?? null;
    const caughtUp = blockNumber !== null && (await advanceProjectionTo(blockNumber));
    if (caughtUp) return;

    logger.warn(
      `projection did not reach block ${String(blockNumber)} for ${resource.type} ${resource.id} ` +
        'before the bounded response wait expired',
    );
    throw new MutationAcceptedError({
      transactionHash: sent.tx.hash,
      blockNumber,
      resource,
    });
  };
  const auctionService = createAuctionService({
    historyDb,
    operationsDb: biddersDb,
    sealingPublicKey: sealingKeys.publicKey,
    awaitProjection: awaitMutationProjection,
  });

  // #region Unauthenticated routes (mounted before authMiddleware) ─────

  // OpenAPI doc is always public — it's the contract.
  app.get('/docs', (_req, res) => {
    res.json(openApiDocument);
  });
  app.get('/v1/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  // Health intentionally bypasses auth (per OpenAPI security: []).
  // Must never 5xx — the operator's UI poll depends on a consistent
  // shape regardless of chain reachability. Each chain read is wrapped
  // individually so a Besu outage surfaces as `status: 'down'` with
  // nulls/zeros, not as an upstream error.
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  app.get('/v1/health', async (req, res, next) => {
    try {
      // Chain probe drives both `chain` and any contract reads that fail.
      let head: number | null = null;
      let chainId: number | null = null;
      let headReachable = true;
      try {
        head = await provider.getBlockNumber();
        const net = await provider.getNetwork();
        chainId = Number(net.chainId);
      } catch {
        headReachable = false;
      }

      let bondManagerAddress = ZERO_ADDR;
      let bondAuctionAddress = ZERO_ADDR;
      let bondTokenAddress = ZERO_ADDR;
      let wnokAddr: string | null = null;
      try {
        const bondManager = await getBondManager();
        bondManagerAddress = bondManager.target.toString();
        bondAuctionAddress = await getBondAuctionAddress();
        bondTokenAddress = await bondManager.BOND_TOKEN();
        wnokAddr = await getWnokAddress().catch(() => null);
      } catch {
        // Chain unreachable at boot — contract addresses unknown. The
        // status derivation handles this via headReachable=false.
      }

      const ingestion = getIngestionStatus();
      const chain = { chainId, head, headReachable };
      const status = deriveStatus(chain, ingestion);
      const lag = computeLag(chain, ingestion);

      okResponse(req, res, {
        status,
        contracts: {
          bondManager: bondManagerAddress,
          bondAuction: bondAuctionAddress,
          bondToken: bondTokenAddress,
          wnok: wnokAddr,
        },
        sealingPubKey: sealingKeys.publicKey,
        chain: {
          rpcUrl: sanitiseRpcUrl(envVariables.RPC_URL),
          chainId,
          head,
          headReachable,
        },
        ingestion: {
          loopRunning: ingestion.loopRunning,
          lastBlockProcessed: ingestion.lastBlockProcessed,
          lag,
          pollIntervalMs: ingestion.pollIntervalMs,
          lastTickAt: ingestion.lastTickAt,
          lastEventTxHash: ingestion.lastEventTxHash,
          consecutiveFailures: ingestion.consecutiveFailures,
          recentErrors: ingestion.recentErrors,
        },
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

  // Baseline authorization: in `entra` mode every authenticated route requires
  // at least one recognised role (operator or tester). A valid token carrying
  // no recognised role is rejected — the server mirror of the nb-ui access gate.
  // No-op in `none` mode.
  app.use(requireAnyRole(recognizedRoles));

  // Every bond/auction response is composed from one stored checkpoint.
  // Keep the checkpoint outside the DTO/md5 while exposing it to callers and
  // browser diagnostics, including on 304 responses.
  app.use(['/v1/bonds', '/v1/auctions'], (_req, res, next) => {
    const checkpoint = getProjectionCheckpoint(historyDb);
    if (checkpoint) res.setHeader('X-Projection-Block', String(checkpoint.asOfBlock));
    next();
  });

  // #endregion

  // Resource invalidation stream for the authenticated UI. Frames contain only
  // coarse resource keys; clients fetch the actual data through the normal API.
  app.get('/v1/events', (req, res) => {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const unsubscribe = liveEvents.subscribe((frame) => {
      res.write(frame);
    });
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  // #region Admin ──────────────────────────────────────────────────────

  // Admin operations are operator-only. This prefix guard covers every
  // /v1/admin route below. No-op in `none` mode; 403 for non-operator tokens
  // in `entra` mode.
  app.use('/v1/admin', requireAnyRole(operatorRoles));

  /**
   * Restart the in-process ingestion loop. With `?fromBlock=0`, also
   * drops the projection so the loop rebuilds from `START_BLOCK`.
   * Bidder roster is preserved. See services/nb-bond-api/src/admin.ts.
   *
   * 200 when the loop confirmed running within the 5s timeout, 202 when
   * it's still coming up (e.g. chain still unreachable and the retry
   * helper is backing off). The operator UI polls /v1/health to track
   * post-restart readiness either way.
   */
  app.post('/v1/admin/restart-ingestion', async (req, res, next) => {
    try {
      const fromBlock = req.query.fromBlock;
      const isReset = fromBlock === '0';
      const outcome = isReset ? await resetProjectionAndRestart() : await restartIngestionLoop();
      successResponse(req, res, outcome, { status: outcome.restarted ? 200 : 202 });
    } catch (err) {
      next(err);
    }
  });

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
      const includeDisabled =
        req.query.includeDisabled === 'true' || req.query.includeDisabled === '1';
      const bonds = await composeAllBonds(historyDb, {
        revealOpenBids: parseTestMode(req),
        includeDisabled,
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

  // Pre-stage a bond without scheduling an auction. The first auction is
  // scheduled separately via POST /v1/bonds/{isin}/auctions.
  app.post('/v1/bonds', validateRequest(createBondBodySchema), async (req, res, next) => {
    try {
      const body = req.body as CreateBondBody;

      let maturitySeconds: bigint;
      try {
        maturitySeconds = parseBigInt(body.maturityDuration, 'maturityDuration');
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      if (maturitySeconds <= 0n) throw badRequest('maturityDuration must be positive');

      const bondManager = await getBondManager();
      const sent = await withOperationRecording(
        {
          db: biddersDb,
          opType: 'BOND_CREATE',
          target: body.isin,
          detail: { maturityDuration: body.maturityDuration },
          interfaces: [bondManager.interface],
          txHashOf: (sent) => sent.tx.hash,
        },
        async () => {
          await bondManager.deployBond.staticCall(body.isin, maturitySeconds);
          return sendWithManagedNonce(async (nonce) =>
            bondManager.deployBond(body.isin, maturitySeconds, { nonce }),
          );
        },
      );
      await awaitMutationProjection(sent, { type: 'bond', id: body.isin });

      const bond = await composeBond(historyDb, body.isin);
      if (!bond) throw notFound(`bond ${body.isin} not found after creation`);
      successResponse(req, res, bond, { status: 201 });
    } catch (err) {
      next(err);
    }
  });

  // Soft-delete a bond. Requires no minted supply, no in-flight auction,
  // and no FINALISED auction in history. Idempotent: 204 even if already
  // disabled (the contract's BondAlreadyDisabled is the no-op signal).
  app.delete(
    '/v1/bonds/:isin',
    validateRequest(isinParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const { isin } = req.params as { isin: string };
        const bondManager = await getBondManager();

        try {
          await bondManager.disableBond.staticCall(isin);
        } catch (err) {
          // Decode the custom-error selector via the relevant contract
          // interfaces. Ethers v6 puts revert bytes in `err.data` but the
          // top-level message says "(unknown custom error)" — disable-path
          // reverts can originate in BondManager itself (BondHasFinalisedAuction)
          // or bubble up from BondToken (BondAlreadyDisabled / BondNotEmpty).
          const bondToken = await getBondToken();
          const errorName = decodeCustomError(err, [bondManager.interface, bondToken.interface]);

          // Idempotent disable: the contract's BondAlreadyDisabled means
          // "no work to do" — return 204 instead of 409.
          if (errorName === 'BondAlreadyDisabled') {
            res.status(204).end();
            return;
          }

          // Map known gate failures to a structured 409.
          const errors: { field: string; message: string }[] = [];
          if (errorName === 'IncorrectBondState') {
            errors.push({
              field: 'bondActive',
              message: 'bond has an in-flight auction; cancel it before disabling',
            });
          } else if (errorName === 'BondNotEmpty') {
            errors.push({
              field: 'totalSupply',
              message: 'bond has minted units; cannot be disabled',
            });
          } else if (errorName === 'BondHasFinalisedAuction') {
            errors.push({
              field: 'auctions',
              message: 'bond has a FINALISED auction in history; cannot be disabled',
            });
          }
          if (errors.length > 0) {
            throw new HttpError(409, 'Bond cannot be disabled', {
              detail: `bond ${isin} does not meet disable gates`,
              errors,
            });
          }
          // Unknown revert — surface it via the default error handler.
          throw err;
        }

        await withOperationRecording(
          {
            db: biddersDb,
            opType: 'BOND_DISABLE',
            target: isin,
            interfaces: [bondManager.interface],
            txHashOf: (sent) => sent.tx.hash,
          },
          () => sendWithManagedNonce(async (nonce) => bondManager.disableBond(isin, { nonce })),
        );

        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  app.get(
    '/v1/bonds/:isin/history',
    validateRequest(isinParamSchema, 'params'),
    (req, res, next) => {
      try {
        const { isin } = req.params as { isin: string };
        const before = req.query.before ? Number(req.query.before) : null;
        const limit = req.query.limit ? Number(req.query.limit) : null;
        const events = composeBondHistory(historyDb, isin, { before, limit });
        okResponse(req, res, events);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/v1/bonds/:isin/coupon-payments',
    // Operator-only — pays the coupon cash leg from the government
    // reserve. The rest of /v1/bonds stays tester-accessible; no-op in
    // `none` mode, 403 for non-operator roles in entra mode.
    requireAnyRole(operatorRoles),
    validateRequest(isinParamSchema, 'params'),
    validateRequest(holdersBodySchema),
    async (req, res, next) => {
      try {
        const { isin } = req.params as { isin: string };
        const { holders } = req.body as HoldersBody;
        const requested = holders && holders.length > 0 ? holders : await getActiveHolders(isin);
        if (!requested.length) {
          throw notFound('no holders found for coupon payment');
        }

        // BondManager.payCoupon requires the holder set to cover the ENTIRE
        // partition supply (CouponPaymentBalanceMismatch otherwise), so
        // treasury-held units — the unsold remainder the BondManager itself
        // keeps after a partial allocation — cannot be excluded here. When
        // present they deadlock the payout on-chain: the government TBD's
        // allowlist (correctly) refuses the manager contract, unless the
        // operator explicitly allowlists it. See docs/KNOWN_ISSUES.md.
        const bondManager = await getBondManager();
        const managerAddress = bondManager.target.toString().toLowerCase();

        try {
          const sent = await withOperationRecording(
            {
              db: biddersDb,
              opType: 'COUPON_PAYMENT',
              target: isin,
              detail: { holders: requested.length },
              interfaces: [bondManager.interface, new Interface(tbdAbi)],
              txHashOf: (sent) => sent.tx.hash,
            },
            () =>
              sendWithManagedNonce(async (nonce) => {
                return bondManager.payCoupon(isin, requested, { nonce });
              }),
          );
          await awaitMutationProjection(sent, { type: 'bond', id: isin });
        } catch (err) {
          // Surface on-chain reverts readably; settlement failures wrap the
          // refusing token's own error in their lowLevelData bytes.
          const description = describeRevert(err, [bondManager.interface, new Interface(tbdAbi)]);
          if (description) {
            const treasuryHint =
              description.includes('AllowlistViolation') &&
              description.toLowerCase().includes(managerAddress)
                ? ' — the BondManager holds unsold units from a partial allocation and is not ' +
                  'allowlisted on the government settlement TBD; see docs/KNOWN_ISSUES.md for ' +
                  'the workaround and the planned contract-side fix'
                : '';
            throw conflict(`coupon payment reverted on-chain: ${description}${treasuryHint}`);
          }
          throw err;
        }

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
        const targetHolders =
          holders && holders.length > 0 ? holders : await getActiveHolders(isin);
        if (!targetHolders.length) {
          throw notFound('no holders found for redemption');
        }

        const bondManager = await getBondManager();
        const sent = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'REDEMPTION',
            target: isin,
            detail: { holders: targetHolders.length },
            interfaces: [bondManager.interface, new Interface(tbdAbi)],
            txHashOf: (sent) => sent.tx.hash,
          },
          () =>
            sendWithManagedNonce(async (nonce) => {
              return bondManager.redeem(isin, targetHolders, { nonce });
            }),
        );
        await awaitMutationProjection(sent, { type: 'bond', id: isin });

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
        const bond = await auctionService.create(isin, body);
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
        const auction = await auctionService.close(auctionId, parseTestMode(req));
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
        const auction = await auctionService.cancel(auctionId);
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
        const body = req.body as FinaliseBody;
        const auction = await auctionService.finalise(auctionId, body);
        okResponse(req, res, auction);
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
      publishLiveChange(['bidders']);
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
        publishLiveChange(['bidders']);
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
          result = await withOperationRecording(
            {
              db: biddersDb,
              opType: 'BID_SUBMISSION',
              target: body.auctionId,
              detail: { bidder: address },
              txHashOf: (r) => r.txHash ?? null,
              changedResources: ['auctions', 'bonds'],
            },
            () =>
              submitImpersonatedBid({
                bidder,
                auctionId: body.auctionId,
                units: body.units,
                rate: body.rate,
              }),
          );
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
          logger.warn(
            `findOpenAuctionsWithBidsByBidder: getSealedBids failed for ${a.id}: ${(err as Error).message}`,
          );
          throw serviceUnavailable('Unable to verify outstanding bidder commitments.');
        }
      }
      return conflicts;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.warn(
        `findOpenAuctionsWithBidsByBidder failed: ${(err as Error).message}; blocking delete`,
      );
      throw serviceUnavailable('Unable to verify outstanding bidder commitments.');
    }
  }

  // #endregion

  // #region Central Bank ───────────────────────────────────────────────

  function mapCentralBankError(err: unknown): never {
    if (err instanceof CentralBankNotConfiguredError) {
      throw serviceUnavailable('Central-bank operations are temporarily unavailable.');
    }
    if (err instanceof WnokUnavailableError) {
      throw serviceUnavailable('Central-bank operations are temporarily unavailable.');
    }
    throw err;
  }

  function toAllowlistEntry(entry: { address: string; wnokBalance: string | null }) {
    return withMd5(entry);
  }

  // Central Bank is operator-only. This single prefix guard covers every
  // /v1/central-bank route below. No-op in `none` mode; 403 for non-operator
  // tokens in `entra` mode.
  app.get('/v1/registry', async (req, res, next) => {
    try {
      const contracts = await listRegisteredContracts();
      okResponse(req, res, contracts);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/operations', (req, res, next) => {
    try {
      const raw = req.query.limit ? Number(req.query.limit) : NaN;
      const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 1000) : 200;
      const rows = listOperationAttempts(historyDb, limit);
      okResponse(req, res, rows.map(toOperationAttemptDto));
    } catch (err) {
      next(err);
    }
  });

  app.use('/v1/central-bank', requireAnyRole(operatorRoles));

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
            govSettlementBank: null,
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
            govSettlementBank: null,
          }),
        );
        return;
      }
      const [balance, allowlist, totalSupply, govSettlementBank] = await Promise.all([
        getCbWnokBalance().catch(() => 0n),
        listAllowlist().catch(() => [] as string[]),
        getWnokTotalSupply().catch(() => 0n),
        banking.getGovSettlementBank().catch(() => null),
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
            totalSupply: totalSupply.toString(),
            allowlistSize: allowlist.length,
          },
          govSettlementBank,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/central-bank/allowlist', async (req, res, next) => {
    try {
      const entries = await listAllowlistWithBalances();
      okResponse(req, res, entries.map(toAllowlistEntry));
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
        ref = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'WNOK_ALLOWLIST_ADD',
            target: address,
            interfaces: [new Interface(wnokAbi)],
            txHashOf: (r) => r.hash,
            changedResources: ['central-bank', 'bidders', 'banking'],
          },
          () => addToAllowlist(address),
        );
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
        ref = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'WNOK_ALLOWLIST_REMOVE',
            target: address,
            interfaces: [new Interface(wnokAbi)],
            txHashOf: (r) => r.hash,
            changedResources: ['central-bank', 'bidders', 'banking'],
          },
          () => removeFromAllowlist(address),
        );
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
          ref = await withOperationRecording(
            {
              db: biddersDb,
              opType: 'WNOK_MINT',
              target: body.address,
              detail: { amount: body.amount },
              interfaces: [new Interface(wnokAbi)],
              txHashOf: (r) => r.hash,
              changedResources: ['central-bank', 'bidders', 'banking'],
            },
            () => mintWnok(body.address, amount),
          );
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
          ref = await withOperationRecording(
            {
              db: biddersDb,
              opType: 'WNOK_BURN',
              target: body.address,
              detail: { amount: body.amount },
              interfaces: [new Interface(wnokAbi)],
              txHashOf: (r) => r.hash,
              changedResources: ['central-bank', 'bidders', 'banking'],
            },
            () => burnWnok(body.address, amount),
          );
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
          ref = await withOperationRecording(
            {
              db: biddersDb,
              opType: 'WNOK_TRANSFER',
              target: body.to,
              detail: { amount: body.amount },
              interfaces: [new Interface(wnokAbi)],
              txHashOf: (r) => r.hash,
              changedResources: ['central-bank', 'bidders', 'banking'],
            },
            () => transferWnokFromCb(body.to, amount),
          );
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

  // #region Banking (TBD) ──────────────────────────────────────────────

  // Banking (TBD) is open to both operator and tester roles so testers can
  // exercise bank-money flows; Central Bank stays the only operator-locked
  // surface. No-op in `none` mode; 403 for unrecognised tokens in `entra`.
  app.use('/v1/banking', requireAnyRole(recognizedRoles));

  app.get('/v1/banking/tbd', async (req, res, next) => {
    try {
      okResponse(req, res, await banking.listTbdTokens());
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/banking/tbd/:address', async (req, res, next) => {
    try {
      const { address } = req.params as { address: string };
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw badRequest('address must be a valid EVM address');
      }
      const token = await banking.getTbdToken(address);
      if (!token) throw notFound(`no TBD token registered at ${address}`);
      okResponse(req, res, token);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/banking/banks', async (req, res, next) => {
    try {
      okResponse(
        req,
        res,
        (await banking.listBanks()).map((b) => withMd5(b)),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/banking/banks', validateRequest(createBankBodySchema), async (req, res, next) => {
    try {
      const body = req.body as CreateBankBody;
      let record;
      try {
        // BANK_CREATE spans several transactions (TBD deploy, registry
        // entry, optional WNOK allowlisting) — recorded without a single
        // tx hash; the bank address lands in the row via detail.
        record = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'BANK_CREATE',
            target: body.name,
            detail: { enableWnokSettlement: body.enableWnokSettlement ?? false },
            txHashOf: () => null,
            changedResources: ['banking', 'registry', 'central-bank'],
          },
          () =>
            createBank(biddersDb, {
              name: body.name,
              privateKey: body.privateKey,
              enableWnokSettlement: body.enableWnokSettlement,
            }),
        );
      } catch (err) {
        if (err instanceof BankValidationError) {
          throw badRequest(err.message);
        }
        if (err instanceof BankConflictError) {
          throw conflict(err.message);
        }
        if (err instanceof DvpUnavailableError) {
          throw serviceUnavailable('Bank creation dependencies are temporarily unavailable.');
        }
        // CentralBankNotConfiguredError / WnokUnavailableError → 503,
        // same availability signalling as the /v1/central-bank routes.
        mapCentralBankError(err);
        return;
      }
      // A just-created bank's key deployed its own TBD, so it can always act.
      okResponse(
        req,
        res,
        withMd5({ name: record.name, address: record.address, actAsAvailable: true }),
      );
    } catch (err) {
      next(err);
    }
  });

  app.put('/v1/banking/tbd/:address/allowlist/:holder', async (req, res, next) => {
    try {
      const { address, holder } = req.params as { address: string; holder: string };
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !/^0x[a-fA-F0-9]{40}$/.test(holder)) {
        throw badRequest('address and holder must be valid EVM addresses');
      }
      const ref = await withOperationRecording(
        {
          db: biddersDb,
          opType: 'TBD_ALLOWLIST_ADD',
          target: address,
          detail: { holder },
          interfaces: [new Interface(tbdAbi)],
          txHashOf: (r) => r?.hash ?? null,
          changedResources: ['banking', 'central-bank', 'bidders'],
        },
        async () => {
          const sent = await banking.addTbdAllowlist(address, holder);
          if (!sent) throw notFound(`no TBD token registered at ${address}`);
          return sent;
        },
      );
      okResponse(req, res, ref);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/banking/tbd/:address/allowlist/:holder', async (req, res, next) => {
    try {
      const { address, holder } = req.params as { address: string; holder: string };
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !/^0x[a-fA-F0-9]{40}$/.test(holder)) {
        throw badRequest('address and holder must be valid EVM addresses');
      }
      const ref = await withOperationRecording(
        {
          db: biddersDb,
          opType: 'TBD_ALLOWLIST_REMOVE',
          target: address,
          detail: { holder },
          interfaces: [new Interface(tbdAbi)],
          txHashOf: (r) => r?.hash ?? null,
          changedResources: ['banking', 'central-bank', 'bidders'],
        },
        async () => {
          const sent = await banking.removeTbdAllowlist(address, holder);
          if (!sent) throw notFound(`no TBD token registered at ${address}`);
          return sent;
        },
      );
      okResponse(req, res, ref);
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/v1/banking/tbd/:address/mint',
    validateRequest(tbdMintBurnBodySchema),
    async (req, res, next) => {
      try {
        const { address } = req.params as { address: string };
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          throw badRequest('address must be a valid EVM address');
        }
        const body = req.body as TbdMintBurnBody;
        let amount: bigint;
        try {
          amount = BigInt(body.amount);
        } catch {
          throw badRequest('amount must be a decimal uint256 string');
        }
        if (amount <= 0n) throw badRequest('amount must be positive');
        const ref = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'TBD_MINT',
            target: address,
            detail: { to: body.address, amount: body.amount },
            interfaces: [new Interface(tbdAbi)],
            txHashOf: (r) => r?.hash ?? null,
            changedResources: ['banking', 'central-bank', 'bidders'],
          },
          async () => {
            const sent = await banking.mintTbd(address, body.address, amount);
            if (!sent) throw notFound(`no TBD token registered at ${address}`);
            return sent;
          },
        );
        okResponse(req, res, ref);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/v1/banking/tbd/:address/burn',
    validateRequest(tbdMintBurnBodySchema),
    async (req, res, next) => {
      try {
        const { address } = req.params as { address: string };
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          throw badRequest('address must be a valid EVM address');
        }
        const body = req.body as TbdMintBurnBody;
        let amount: bigint;
        try {
          amount = BigInt(body.amount);
        } catch {
          throw badRequest('amount must be a decimal uint256 string');
        }
        if (amount <= 0n) throw badRequest('amount must be positive');
        const ref = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'TBD_BURN',
            target: address,
            detail: { from: body.address, amount: body.amount },
            interfaces: [new Interface(tbdAbi)],
            txHashOf: (r) => r?.hash ?? null,
            changedResources: ['banking', 'central-bank', 'bidders'],
          },
          async () => {
            const sent = await banking.burnTbd(address, body.address, amount);
            if (!sent) throw notFound(`no TBD token registered at ${address}`);
            return sent;
          },
        );
        okResponse(req, res, ref);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    '/v1/banking/tbd/:address/transfer',
    validateRequest(tbdTransferBodySchema),
    async (req, res, next) => {
      try {
        const { address } = req.params as { address: string };
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          throw badRequest('address must be a valid EVM address');
        }
        const body = req.body as TbdTransferBody;
        let amount: bigint;
        try {
          amount = BigInt(body.amount);
        } catch {
          throw badRequest('amount must be a decimal uint256 string');
        }
        if (amount <= 0n) throw badRequest('amount must be positive');
        const ref = await withOperationRecording(
          {
            db: biddersDb,
            opType: 'TBD_TRANSFER',
            target: address,
            detail: { to: body.to, amount: body.amount },
            interfaces: [new Interface(tbdAbi)],
            txHashOf: (r) => r?.hash ?? null,
            changedResources: ['banking', 'central-bank', 'bidders'],
          },
          async () => {
            const sent = await banking.transferTbd(address, body.to, amount);
            if (!sent) throw notFound(`no TBD token registered at ${address}`);
            return sent;
          },
        );
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

  app.use(
    (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err instanceof HttpError) {
        problemErrorMiddleware(err, req, res, next);
        return;
      }
      const diagnostic = err instanceof Error ? (err.stack ?? err.message) : String(err);
      logger.error(`unhandled ${req.method} ${req.originalUrl}: ${diagnostic}`);
      problemErrorMiddleware(err, req, res, next);
    },
  );

  // #endregion

  return app;
}
