# Redeem with the final coupon — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-09 — plan folder and ADR 0005 drafted; no code changed
**Current phase:** Not started (plan awaiting operator approval)
**Next action:** Operator reviews `intent.md` and `design.md`; on approval, start Phase 0 on a `feature/` branch from `development`

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline, ingestion-order check, characterization | Not started | baseline `forge test`: 25 suites, 393 passed (2026-09-08) | |
| 1 — Contracts: closure in payCoupon, BondMatured, remove redeem | Not started | | |
| 2 — API: ingestion, status, route removal, OpenAPI | Not started | | |
| 3 — UI | Not started | | |
| 4 — Fresh local sandbox validation | Not started | | |
| 5 — Docs and archive | Not started | | |

## Deviations From the Plan

None yet.

## Verified So Far

- The final coupon only sets `isMatured`; principal is paid by a separate `redeem` that no UI
  page calls — verified in `BondManager.sol` and `services/nb-ui/src` on 2026-09-09.
- `BondDvP.settle` always runs the cash leg, so manager-held units must be burned by
  `BondManager` calling `BondToken.redeemFor` directly — verified in `BondDvP.sol` on 2026-09-09.

## Blocked / Waiting On

- Plan approval — sandbox operator.
- Phase 4 needs an explicit go-ahead to delete and recreate the local sandbox.

## Follow-ups Found Along the Way

- A bond fully bought back before maturity ends as `staged` with zero supply in the projection
  (`compose-projection.ts` `bondStatus`); not changed by this plan.
- `REDEMPTION` stays in the audit-trail operation enum with no producer.

## Session Handoff

- The unpushed local branch `feature/coupon-page-scope-text` holds a Coupon payout page hint
  whose wording assumes the two-step model; it is superseded by Phase 3 step 2 and should not
  be pushed.
