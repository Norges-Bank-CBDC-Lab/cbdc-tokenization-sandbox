# Redeem with the final coupon — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-09 — all phases done on `feature/redeem-with-final-coupon-api`; fresh-sandbox evidence recorded
**Current phase:** Complete — #275 and #276 merged; folder archived 2026-09-09
**Next action:** None; follow-ups are listed below

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline, ingestion-order check, characterization | Done | baseline `forge test`: 25 suites, 393 passed; `BondManager.t.sol` asserts `paymentPerBond == 42` (49 passed); ingestion order verified, see below (2026-09-09) | PR 1 |
| 1 — Contracts: closure in payCoupon, BondMatured, remove redeem | Done (PR #275 open) | `forge test`: 25 suites, 394 passed incl. closure, incomplete-holders, underfunded-closure, unsold-units, and fuzz cases; fmt and verify-mapping clean; ABI artifact refreshed (`BondMatured` present, `redeem` absent) (2026-09-09) | PR 1 |
| 2 — API: ingestion, status, route removal, OpenAPI | Done | `BondMatured` → `MATURED` history entry with totals and the `matured` transition (sets both flags); `bondStatus` terminal `matured`, `redeemed` dropped from `BondStatus`; redemption route, handler, and OpenAPI path removed; `REDEMPTION` op type kept as legacy; reducer order-independence test; nb-bond-api lint, format, build, 245 jest tests green (2026-09-09) | PR 2 |
| 3 — UI | Done | Pay-coupon modal: final period shows coupon, principal, and total per holder, unsold manager-held units as burned without payment, and a reserve-shortfall warning from the Central Bank resource; payout page hint and empty state; Bonds filter drops `redeemed`; Bond detail tooltips; `BondsApi.redeem` and the `redeemed` badge style removed; nb-ui format, lint, build, 123 vitest tests green (2026-09-09) | PR 2 |
| 4 — Fresh local sandbox validation | Done | `./sandbox.sh delete` + `start` on the feature branch; two bonds closed by their final coupon with the balance trails below; `MATURED` history entries carry the totals; the closed bonds report `matured` with zero supply (2026-09-09) | PR 2 |
| 5 — Docs | Done | coupon/maturity sequence diagram rewritten; lifecycle classifier and state diagram drop `redeemed`; architecture, diagrams index, contracts README, API DEVELOPMENT scenario 6.4 and route list updated; treasury-held-units known issue removed (resolved by construction); closed-loop plan Phase 6 note extended; stale treasury hint removed from the coupon route; hygiene and link checks green (2026-09-09). ADR status flip and archive follow PR 2's merge | PR 2 |

## Deviations From the Plan

- Phase 4: the unsold-units bond was produced by a roster bidder with no WNOK and no allowlist
  entry (failed cash leg at finalisation), which is how unsold units actually arise; the plan's
  "partially allocated" wording meant this case.
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

## Phase 4 Balance Trails (fresh local sandbox, 2026-09-09)

Both bonds: 100 units offered at 1000 WNOK nominal, RATE auction cleared at 425 bps (42 WNOK
coupon per unit per period), maturity 2 periods of 60 s.

**Bond A `NO0000000MAT`, fully allocated (dealer A 60 units, dealer B 40 units).**

| Step | Reserve | Dealer A | Dealer B | WNOK supply | Bond supply |
|---|---|---|---|---|---|
| Baseline | 10 000 000 | 1 200 000 | 1 100 000 | 12 300 000 | 0 |
| Issuance | 10 100 000 | 1 140 000 | 1 060 000 | 12 300 000 | 100 |
| Coupon 1 | 10 095 800 | 1 142 520 | 1 061 680 | 12 300 000 | 100 |
| Final coupon (closes) | 9 991 600 | 1 205 040 | 1 103 360 | 12 300 000 | 0 |

Final block: `COUPON_PAID` and `REDEEMED` per holder, then `MATURED {paymentCount 2,
principalPaid 100000, couponPaid 4200, unsoldBurned 0}`; status `matured`, no holders.

**Bond B `NO0000000UNS`, failed allocation (dealer A 60 units paid; dealer C's cash leg failed,
40 units stayed on the manager).**

| Step | Reserve | Dealer A | Manager units | WNOK supply | Bond supply |
|---|---|---|---|---|---|
| Baseline | 9 991 600 | 1 205 040 | 0 | 12 300 000 | 0 |
| Issuance | 10 051 600 | 1 145 040 | 40 | 12 300 000 | 100 |
| Coupon 1 (60 units only) | 10 049 080 | 1 147 560 | 40 | 12 300 000 | 100 |
| Final coupon (closes) | 9 986 560 | 1 210 080 | 0 | 12 300 000 | 0 |

The manager was never allowlisted on WNOK and never received cash; the coupon route succeeded
without the old workaround. Final block: `MATURED {paymentCount 2, principalPaid 60000,
couponPaid 2520, unsoldBurned 40}`. WNOK total supply never changed in either run.

## Blocked / Waiting On

- Nothing.

## Follow-ups Found Along the Way

- A bond fully bought back before maturity ends as `staged` with zero supply in the projection
  (`compose-projection.ts` `bondStatus`); not changed by this plan.
- `REDEMPTION` stays in the audit-trail operation enum with no producer.

## Session Handoff

- The unpushed local branch `feature/coupon-page-scope-text` holds a Coupon payout page hint
  whose wording assumes the two-step model; it is superseded by Phase 3 step 2 and should not
  be pushed.
