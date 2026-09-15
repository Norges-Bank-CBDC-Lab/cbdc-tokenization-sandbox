# Redeem with the final coupon — Intent

**Status:** Draft
**Created:** 2026-09-09
**Requested by:** sandbox operator

## Outcome

A bond closes on its maturity date in one operator action. The final coupon payment pays each
holder the last coupon plus the principal in wNOK, burns every unit, and emits a single
`BondMatured` event that records the closure. There is no separate redemption step, no
"matured but still held" state, and a partially allocated bond no longer deadlocks: units the
manager never sold earn no coupon and are burned at maturity without cash.

## Why This Change

Today maturity and redemption are two steps. The final `payCoupon` only flips
`BondToken.isMatured`; principal is paid by a separate `BondManager.redeem` call that burns the
units. Between the two, holders own units that are owed principal, which is not how a bond
behaves at maturity. The second step is also unreachable from the operator UI: the API client
has a `redeem` function that no page calls, so through the UI a bond can mature but never
close. The Coupon payout page keeps such a bond listed with zero coupons remaining, which
confused the operator while validating the wNOK cash-leg change.

The same model keeps the treasury-held-units deadlock alive: a bond that was not fully
allocated cannot pay any coupon because the manager holds unsold units and is not on the wNOK
allowlist (`docs/KNOWN_ISSUES.md`). Unsold units are owed nothing, so the right behaviour is
to skip them on coupons and burn them at maturity.

## Scope

### In Scope

- `BondManager.payCoupon`: on the final coupon period, settle coupon plus principal per holder
  through `BondDvP` with the `Redeem` operation, burn manager-held units without cash, require
  zero supply, and emit `BondMatured`. On interim periods, skip manager-held units.
- Remove `BondManager.redeem`, the `BondRedemptionComplete` and `AllCouponsPaid` events, and
  the API route `POST /v1/bonds/{isin}/redemptions` with its unused UI client function.
- NB Bond API: ingest `BondMatured`; the bond-state reducer and status derivation treat maturity
  as the terminal state; regenerate the OpenAPI document.
- NB UI: the pay-coupon confirmation shows the final payout as coupon plus principal per holder
  and the unsold units to be burned, and warns when the reserve's wNOK balance cannot cover it;
  the Coupon payout page explains which bonds it lists; Bonds page filter and Bond detail
  tooltips follow the new lifecycle.
- Tests at contract, API, and UI level; a fresh-sandbox run covering a fully and a partially
  allocated bond; docs, diagrams, known issues, and ADR 0005.

### Out of Scope

- Authority-based settlement of the cash leg (closed-loop plan Phase 1); the reserve allowance
  stays.
- Early redemption or call features; buyback auctions are unchanged.
- Burning unsold units at finalisation (the other option in the known issue); this plan burns
  them at maturity, which needs no change to finalisation or `withdrawFailedIssuance`.
- Any change to `BondToken`'s partition model beyond what the closure needs (ADR 0002 migration
  is separate).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| The final `payCoupon` pays every holder `balance × (nominal + coupon per unit)` in wNOK, burns their units, and leaves partition supply at zero | Principal never paid, or paid twice | Foundry tests on balances and supply; sandbox balance trail |
| Interim coupons are unchanged in amount and behaviour for real holders | Regression in the periodic leg | Existing coupon tests still pass with the same expected amounts |
| Manager-held units receive no coupon and are burned at maturity without any wNOK movement | Treasury deadlock; paying coupon on unsold units | Foundry test with a partial allocation reaching maturity; known-issue entry closed |
| One `BondMatured(isin, …)` event per closed bond carrying the totals, ingested into the projection and visible in bond history | Nothing to hook later processing on | Foundry event assertion; API history shows a `MATURED` entry |
| A reserve that cannot cover coupon plus principal reverts the whole final payout with no partial movement | Silent partial closure | Foundry underfunded test; API 409 detail |
| No route, client, or contract entry point performs a separate redemption | Two ways to close a bond drift apart | `openapi.json` has no `redeem` operation; `BondManager` has no `redeem`; grep in the PR checklist |
| Bond status reaches `matured` with zero supply in one block and the Coupon payout page drops the bond | Stale "matured but held" state | API bond resource after the final payout; UI test |
| A bond closed before this change is not representable and needs no migration | Hidden migration | Fresh sandbox deploy is the rollout; stated in the plan |

## Constraints

- sandbox-sized; local-first; portable to a non-local deployment only when the cost is small
- public repo: no secrets, private identifiers, or home-directory paths
- dependencies and licences need the approvals in root `AGENTS.md`; this plan adds none
- `BondManager` redeploys; the local sandbox is recreated (fresh chain) or the API projection
  reset

## Open Questions

- None blocking. Decisions with recommendations are in `design.md`.
