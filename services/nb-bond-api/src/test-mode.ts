/**
 * Sandbox-only umbrella "test mode" flag. The operator UI flips this from
 * the top-bar toggle and propagates it as `?testMode=true` on every bond /
 * auction read as well as on close. Today it gates:
 *
 *  - composeBond / composeAuction unseal sealed bids on still-open
 *    auctions (`revealOpenBids` internally).
 *  - PATCH /v1/auctions/{id} (close) skips the end-time pre-check so the
 *    operator can attempt close before the bidding window expires. The
 *    on-chain contract still enforces `block.timestamp > metadata.end` and
 *    reverts with `InBidPhase()` if it is early.
 *
 * The flag is honoured only for operator callers (always in `none` mode, see
 * `isOperatorRequest`). Anyone else's flag is ignored rather than rejected, so
 * a stale browser setting never turns a read into a 403; they simply get the
 * sealed view and the normal close pre-check.
 *
 * Future test affordances should plumb through this same function so a
 * single toggle, and a single authorization rule, controls them all.
 */
import type { Request, Response } from 'express';

import { isOperatorRequest } from './auth';

export function parseTestMode(req: Request, res: Response): boolean {
  const raw = req.query.testMode;
  const requested = raw === 'true' || raw === '1';
  return requested && isOperatorRequest(res);
}
