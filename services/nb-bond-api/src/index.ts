/**
 * nb-bond-api HTTP server.
 *
 * Routes the v2 endpoint catalog described in docs/plans/archive/openapi-v2-plan.md
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
import { getIngestionStatus } from './ingestion';
import { getBalancesByIsin, openDatabase } from './ingestion-db';
import { initSealingKeypair, type SealingKeypair } from './keys';
import { logger } from './logger';
import { parseBigInt } from './parsing';
import { computeBuybackAllocation, computeUniformAllocation } from './allocation';
import { AuctionType } from './types';
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
  mintWnok,
  removeFromAllowlist,
  transferWnokFromCb,
} from './central-bank';
import { withMd5 } from './http';
import { provider } from './chain';
import { tbdAbi } from './abi';
import {
  addTbdAllowlist,
  burnTbd,
  getGovSettlementBank,
  getTbdToken,
  listBanks,
  listTbdTokens,
  mintTbd,
  removeTbdAllowlist,
  setCreatedBanksDb,
  transferTbd,
} from './banking-tbd';
import { BankConflictError, BankValidationError, DvpUnavailableError, createBank } from './banks';
import { listRegisteredContracts } from './registry';

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

// The `banks` system-of-record table shares the same writable handle.
// Injecting it here lets the banking roster (banking-tbd.ts) merge the
// created banks into listings, the bank selector, and mutation signing.
setCreatedBanksDb(biddersDb);

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

// #endregion

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
    res.status(outcome.restarted ? 200 : 202).json(outcome);
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
    await bondManager.deployBond.staticCall(body.isin, maturitySeconds);
    await sendWithManagedNonce(async (nonce) =>
      bondManager.deployBond(body.isin, maturitySeconds, { nonce }),
    );

    const bond = await composeBond(historyDb, body.isin);
    if (!bond) throw notFound(`bond ${body.isin} not found after creation`);
    res.status(201).json(bond);
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

      await sendWithManagedNonce(async (nonce) => bondManager.disableBond(isin, { nonce }));

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

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
        await sendWithManagedNonce(async (nonce) => {
          return bondManager.payCoupon(isin, requested, { nonce });
        });
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

      const pubKey = sealingKeys.publicKey;
      const bondManager = await getBondManager();

      // Distinguish "first RATE for an unstaged bond" (one-shot
      // deployBondWithAuction) from "first RATE for a pre-staged bond"
      // (deployAuctionForBond after a prior POST /v1/bonds).
      let bondAlreadyStaged = false;
      if (auctionType === 'RATE') {
        try {
          const bondToken = await getBondToken();
          const partition = keccak256(toUtf8Bytes(isin));
          bondAlreadyStaged = await bondToken.activePartitions(partition);
        } catch (err) {
          logger.warn(`activePartitions read failed for ${isin}: ${(err as Error).message}`);
        }
      }

      // maturityDuration is required only for the legacy combined path
      // (RATE on a bond that doesn't exist yet). For RATE on a pre-staged
      // bond the partition already carries its maturity from deployBond.
      if (auctionType === 'RATE' && !bondAlreadyStaged && maturitySeconds === undefined) {
        throw badRequest('maturityDuration is required for RATE on a new bond');
      }

      // Solidity enum mapping (must match IBondAuction.AuctionType).
      const auctionTypeEnum = auctionType === 'RATE' ? 0 : auctionType === 'PRICE' ? 1 : 2;

      // Static-call validation first so revert reasons surface cleanly.
      if (auctionType === 'RATE' && !bondAlreadyStaged) {
        await bondManager.deployBondWithAuction.staticCall(
          isin,
          endSeconds,
          pubKey,
          sizeUnits,
          maturitySeconds!,
        );
      } else {
        await bondManager.deployAuctionForBond.staticCall(
          isin,
          endSeconds,
          pubKey,
          sizeUnits,
          auctionTypeEnum,
        );
      }

      await sendWithManagedNonce(async (nonce) => {
        if (auctionType === 'RATE' && !bondAlreadyStaged) {
          return bondManager.deployBondWithAuction(
            isin,
            endSeconds,
            pubKey,
            sizeUnits,
            maturitySeconds!,
            { nonce },
          );
        }
        return bondManager.deployAuctionForBond(
          isin,
          endSeconds,
          pubKey,
          sizeUnits,
          auctionTypeEnum,
          { nonce },
        );
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

      const sendClose = (extra: Record<string, unknown> = {}) =>
        sendWithManagedNonce(async (nonce) => {
          const manager = await getBondManager();
          return manager.closeAuction(isin, { nonce, ...extra });
        });
      try {
        await sendClose();
      } catch (err) {
        const manager = await getBondManager();
        const errorName = decodeCustomError(err, [
          bondAuctionContract.interface,
          manager.interface,
        ]);
        if (errorName === 'InBidPhase' && !testMode) {
          // Local Besu mints blocks only on transactions (genesis
          // createemptyblocks=false), so the latest block's timestamp lags
          // wall-clock and ethers' eth_estimateGas simulates the close against
          // a stale block -> a false InBidPhase revert before broadcast. The
          // precheck above already confirmed wall-clock > end, so retry once
          // with an explicit gasLimit to skip estimation; the mined block is
          // stamped at wall-clock > end and the contract accepts it. This stays
          // correct after a future QBFT/Besu upgrade: if regular block
          // production resumes, the first attempt's estimation succeeds and
          // this fallback never runs.
          await sendClose({ gasLimit: envVariables.NB_BOND_API_CLOSE_GAS_LIMIT });
        } else if (errorName === 'InBidPhase') {
          // testMode: a close was attempted before the on-chain end timestamp.
          throw conflict(
            'auction is still in its on-chain bidding window (block timestamp has not passed the' +
              ' end timestamp). Note the local Besu clock only advances when a transaction is mined.',
          );
        } else if (errorName) {
          throw conflict(`cannot close auction: ${errorName}`);
        } else {
          throw err;
        }
      }

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
      const { approve, winningBidIndexes, expectedClearingRate } = req.body as FinaliseBody;

      const auction = await composeAuction(historyDb, auctionId);
      if (!auction) throw notFound(`auction ${auctionId} not found`);
      if (auction.status === 'finalised') throw conflict('auction already finalised');
      if (auction.status === 'cancelled') throw conflict('auction cancelled');

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

      // ---- Approve path (Design B) --------------------------------------
      // The operator selects which sealed bids win, by on-chain bidIndex;
      // the server is the sole authority for the economic terms. We re-fetch
      // the sealed bids from chain, unseal them, recompute the uniform-price
      // allocation over ONLY the selected subset, cross-check the clearing
      // rate against what the operator confirmed, then submit. Unselected
      // bids never reach the chain.
      if (auction.status !== 'closed') {
        throw conflict('auction must be closed to finalise');
      }
      if (!winningBidIndexes || winningBidIndexes.length === 0) {
        throw badRequest(
          'winningBidIndexes is required and must be non-empty when approve is true',
        );
      }
      if (expectedClearingRate === undefined) {
        throw badRequest('expectedClearingRate is required when approve is true');
      }
      if (!auction.size) {
        throw conflict('auction has no offering size');
      }
      const offering = BigInt(auction.size);

      // Re-derive bidder signatures / nonces from chain (authoritative).
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
      const unsealedByIndex = new Map<number, ReturnType<typeof unsealBid>>();
      sealedBids.forEach((b, i) => unsealedByIndex.set(i, unsealBid(isin, b, i)));

      // Resolve the selection to unsealed bids; reject unknown / duplicate indexes.
      const seenIndexes = new Set<number>();
      const selectedBids = winningBidIndexes.map((idx) => {
        const match = unsealedByIndex.get(idx);
        if (!match) {
          throw badRequest(`unknown winning bidIndex ${idx}`);
        }
        if (seenIndexes.has(idx)) {
          throw badRequest(`duplicate winning bidIndex ${idx}`);
        }
        seenIndexes.add(idx);
        return match;
      });

      // Recompute the allocation over the selected subset only.
      const auctionTypeEnum =
        auction.type === 'RATE'
          ? AuctionType.RATE
          : auction.type === 'PRICE'
            ? AuctionType.PRICE
            : AuctionType.BUYBACK;
      const result =
        auctionTypeEnum === AuctionType.BUYBACK
          ? computeBuybackAllocation(isin, selectedBids, offering)
          : computeUniformAllocation(isin, auctionTypeEnum, selectedBids, offering);

      // Cross-check: the server-recomputed clearing rate must equal what the
      // operator confirmed, so the minted coupon can never silently diverge
      // from what the operator saw in the UI.
      if (result.clearingRate.toString() !== expectedClearingRate) {
        throw badRequest(
          `clearing-rate mismatch: server recomputed ${result.clearingRate.toString()} bps from the ` +
            `selected bids but the request expected ${expectedClearingRate} bps. No allocation was submitted.`,
        );
      }

      // Build the on-chain allocation payload + bidder proofs, pairing each
      // allocation to its bid by bidIndex (unambiguous for duplicate bidders).
      const allocPayload = result.allocations.map((a) => ({
        isin,
        bidder: a.bidder,
        units: a.units,
        rate: a.rate,
        auctionType: a.auctionType,
      }));
      const proofs = result.allocations.map((a) => {
        const match = unsealedByIndex.get(a.bidIndex);
        if (!match) {
          throw conflict(`missing unsealed bid for bidIndex ${a.bidIndex}`);
        }
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
      getGovSettlementBank().catch(() => null),
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

// #region Banking (TBD) ──────────────────────────────────────────────

// Banking (TBD) is open to both operator and tester roles so testers can
// exercise bank-money flows; Central Bank stays the only operator-locked
// surface. No-op in `none` mode; 403 for unrecognised tokens in `entra`.
app.use('/v1/banking', requireAnyRole(recognizedRoles));

app.get('/v1/banking/tbd', async (req, res, next) => {
  try {
    okResponse(req, res, await listTbdTokens());
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
    const token = await getTbdToken(address);
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
      listBanks().map((b) => withMd5(b)),
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
      record = await createBank(biddersDb, {
        name: body.name,
        privateKey: body.privateKey,
        enableWnokSettlement: body.enableWnokSettlement,
      });
    } catch (err) {
      if (err instanceof BankValidationError) {
        throw badRequest(err.message);
      }
      if (err instanceof BankConflictError) {
        throw conflict(err.message);
      }
      if (err instanceof DvpUnavailableError) {
        throw new HttpError(503, 'Service Unavailable', { detail: err.message });
      }
      // CentralBankNotConfiguredError / WnokUnavailableError → 503,
      // same availability signalling as the /v1/central-bank routes.
      mapCentralBankError(err);
      return;
    }
    okResponse(req, res, withMd5({ name: record.name, address: record.address }));
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
    const ref = await addTbdAllowlist(address, holder);
    if (!ref) throw notFound(`no TBD token registered at ${address}`);
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
    const ref = await removeTbdAllowlist(address, holder);
    if (!ref) throw notFound(`no TBD token registered at ${address}`);
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
      const ref = await mintTbd(address, body.address, amount);
      if (!ref) throw notFound(`no TBD token registered at ${address}`);
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
      const ref = await burnTbd(address, body.address, amount);
      if (!ref) throw notFound(`no TBD token registered at ${address}`);
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
      const ref = await transferTbd(address, body.to, amount);
      if (!ref) throw notFound(`no TBD token registered at ${address}`);
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

// Start ingestion in-process (background). The retry wrapper handles
// the case where Besu is briefly unreachable at boot (e.g. after a
// PC/Docker restart) — the loop self-heals once the chain comes back.
// The only "give up" path here is a module-load failure.
import('./ingestion')
  .then(({ startIngestionLoopWithRetry }) => startIngestionLoopWithRetry())
  .catch((err) => logger.error(`ingestion module load failed: ${(err as Error).message}`));
