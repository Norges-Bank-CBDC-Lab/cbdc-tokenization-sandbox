# Redeem with the final coupon — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-09 — Phase 2 done on `feature/redeem-with-final-coupon-api` (stacked on PR #275): `BondMatured` ingested, `matured` is terminal, redemption route removed
**Current phase:** Phase 3: UI
**Next action:** Phase 3 step 1 — final payout preview in `services/nb-ui/src/pages/PayCouponModal.jsx`

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline, ingestion-order check, characterization | Done | baseline `forge test`: 25 suites, 393 passed; `BondManager.t.sol` asserts `paymentPerBond == 42` (49 passed); ingestion order verified, see below (2026-09-09) | PR 1 |
| 1 — Contracts: closure in payCoupon, BondMatured, remove redeem | Done (PR #275 open) | `forge test`: 25 suites, 394 passed incl. closure, incomplete-holders, underfunded-closure, unsold-units, and fuzz cases; fmt and verify-mapping clean; ABI artifact refreshed (`BondMatured` present, `redeem` absent) (2026-09-09) | PR 1 |
| 2 — API: ingestion, status, route removal, OpenAPI | Done | `BondMatured` → `MATURED` history entry with totals and the `matured` transition (sets both flags); `bondStatus` terminal `matured`, `redeemed` dropped from `BondStatus`; redemption route, handler, and OpenAPI path removed; `REDEMPTION` op type kept as legacy; reducer order-independence test; nb-bond-api lint, format, build, 245 jest tests green (2026-09-09) | PR 2 |
| 3 — UI | Not started | | |
| 4 — Fresh local sandbox validation | Not started | | |
| 5 — Docs and archive | Not started | | |

## Deviations From the Plan

- Phase 1: the per-holder loop lives in `_payHolders` / `_payHolder` with `Period` and
  `PayoutTotals` memory structs. Keeping the loop inline in `payCoupon` hit solc's
  stack-too-deep limit even under via-IR (two attempts); the split is also easier to read.
- Phase 1: "unsold units on the manager" arise from a failed allocation (a bidder's cash leg
  fails at finalisation), not from an under-subscribed auction, which mints only the allocated
  total. The test forces the failure by removing the bidder from the WNOK allowlist. The
  known-issue wording ("partially allocated") is corrected in Phase 5.
- Phase 1: `Errors.AllCouponsPaid` keeps its name; it still guards a `payCoupon` on a closed
  bond, and `RedemptionIncomplete` still guards the zero-supply check.

## Verified So Far

- Ingestion applies a block batch as all manager events, then all token actions, inside one
  `db.transaction` (`services/nb-bond-api/src/ingestion.ts`), so ordering is per contract, not by
  global log index, and no reader sees a half-applied block. The bond-state reducer only sets
  flags, monotonic counts, and supply deltas, so `BondMatured` before or after the token burns
  projects the same final state — verified 2026-09-09.
- The final coupon only sets `isMatured`; principal is paid by a separate `redeem` that no UI
  page calls — verified in `BondManager.sol` and `services/nb-ui/src` on 2026-09-09.
- `BondDvP.settle` always runs the cash leg, so manager-held units must be burned by
  `BondManager` calling `BondToken.redeemFor` directly — verified in `BondDvP.sol` on 2026-09-09.

## Blocked / Waiting On

- Phase 4 needs an explicit go-ahead to delete and recreate the local sandbox.

## Follow-ups Found Along the Way

- A bond fully bought back before maturity ends as `staged` with zero supply in the projection
  (`compose-projection.ts` `bondStatus`); not changed by this plan.
- `REDEMPTION` stays in the audit-trail operation enum with no producer.

## Session Handoff

- The unpushed local branch `feature/coupon-page-scope-text` holds a Coupon payout page hint
  whose wording assumes the two-step model; it is superseded by Phase 3 step 2 and should not
  be pushed.
