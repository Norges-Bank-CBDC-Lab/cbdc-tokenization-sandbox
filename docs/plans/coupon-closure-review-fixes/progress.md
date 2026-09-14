# Coupon closure review fixes — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-14 — Phases 1–4 implemented on `feature/coupon-closure-review-fixes`
**Current phase:** Done except the optional fresh-sandbox check (Phase 5)
**Next action:** Open the PR; run Phase 5 on a fresh sandbox if the operator wants live evidence

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Contracts | Done | `withdrawFailedIssuance` and `NoFailedIssuance` removed; `DuplicateHolder` scan; `CouponPeriodPaid` after `updateCouponPayment`; structs in the types block; TBD Nordea seeds the two dealer EOAs; new tests for duplicate-with-omission, period event, empty-holder closure of a bought-back bond; `forge test` 25 suites, 395 passed; ABI artifact refreshed (2026-09-14) | PR |
| 2 — API | Done | coupon route accepts an empty holder set when projected supply is 0; `HoldersBody` rejects duplicates; `CouponPeriodPaid` → `COUPON_PERIOD_PAID` history + `coupon-paid` transition; `bondStatus` keeps issued bonds with remaining periods `outstanding`; `redemptionComplete` dropped from state, reducer, and row mapping (column retained); `/v1/health` `contracts.bondManagerCompatible`; `openapi.json` regenerated; 248 jest tests (2026-09-14) | PR |
| 3 — UI | Done | modal amounts in BigInt WNOK with the contract's per-unit truncation (`Fmt.formatWnok`), reserve compared as BigInt, bought-back-bond copy; payout queue lists issued bonds with remaining periods; tests assert 25.20 K NOK for 600 units, no warning at an exactly funded reserve, zero-supply bond listed; 125 vitest tests (2026-09-14) | PR |
| 4 — Docs | Done | known-issue entry for the allowlist requirement; contract reference and auction-sequence note; NatSpec pages for `BondManager`, `IBondManager`, `Errors`; documentation index (2026-09-14) | PR |
| 5 — Fresh sandbox | Not started (optional) | | |

## Deviations From the Plan

- The health probe runs per `/v1/health` request rather than once at startup: simpler, and health is polled at low cadence.
- No ingestion-level test for `CouponPeriodPaid`; it maps onto the existing `coupon-paid` reducer transition, which is tested, and the event branch mirrors the `CouponPaid` branch.

## Verified So Far

- Review findings verified against source and the live sandbox on 2026-09-14 (see the PR body).

## Follow-ups Found Along the Way

- Exposing computed payout amounts from the composer would remove the UI's mirrored contract
  math.
