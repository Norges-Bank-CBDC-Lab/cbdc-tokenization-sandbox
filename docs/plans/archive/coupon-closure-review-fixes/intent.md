# Coupon closure review fixes — Intent

**Status:** Draft
**Created:** 2026-09-14
**Requested by:** sandbox operator

## Outcome

The bond closure shipped in ADR 0005 holds up under the edge cases a review of #272–#277 found:
the payout preview shows the amounts the chain will actually move, unsold units can never
become paid holdings, a bond bought back to zero supply can still be closed, a duplicated
holder cannot be paid twice, a bond whose only holder is the manager still advances its coupon
count in the projection, an API running against an older `BondManager` says so instead of
degrading silently, and the small cleanup items from the same review are done.

## Why This Change

A high-effort review of the merged wNOK cash-leg and maturity-closure work surfaced five
defects and five quality items (reported 2026-09-14). None affects the happy path the fresh
sandbox run proved, but each is reachable by an operator through normal use: an explicit
holder list, a failed allocation followed by `withdrawFailedIssuance`, a full buyback, or a
rate whose per-unit coupon truncates.

## Scope

### In Scope

1. Payout preview uses the contract's integer per-unit coupon and a BigInt reserve comparison.
2. `BondManager.withdrawFailedIssuance` removed: unsold units are burned at maturity by design
   and must never become paid holdings.
3. A bond with zero supply and remaining coupon periods can be closed: the coupon route sends an
   empty holder list when supply is zero, the projection keeps such a bond `outstanding` (not
   `staged`) until `BondMatured`, and the Coupon payout page lists it.
4. Duplicate holders rejected on-chain (`DuplicateHolder`) and in the request body.
5. A period-level `CouponPeriodPaid` event drives the projected coupon count, so the count
   advances even when no holder receives cash.
6. API health reports `BondManager` compatibility from a startup probe of `GOV_RESERVE()`.
7. `docs/KNOWN_ISSUES.md` regains a narrowed entry: every holder must be on the WNOK allowlist
   or the whole payout reverts.
8. `redemptionComplete` removed from the projected bond state (column left in place).
9. `Period` and `PayoutTotals` structs moved to `BondManager`'s types block.
10. Dealer accounts seeded again on the TBD Nordea allowlist, in the TBD setup script.
11. `HoldersBody` description no longer mentions redemption.

### Out of Scope

- Exposing computed payout amounts from the API composer (the UI mirrors the contract's
  integer rule instead; recorded as a possible follow-up).
- Deriving bond status purely from supply, authority settlement, ERC-3643 migration.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Modal amounts equal `CouponPaid` amounts (42 per unit at 425 bps) and the reserve warning only fires when `reserve < total` in integer WNOK | False warning, wrong preview | nb-ui tests assert 25.20 K NOK for 600 units and no warning at an exactly funded reserve |
| No public function moves manager-held units anywhere but to burn at maturity | Unsold units paid | `withdrawFailedIssuance` gone; existing unsold-units closure test |
| A zero-supply bond with remaining periods can be paid through the API and closes with `BondMatured(…, 0, 0, 0)` | Bought-back bond stuck | Foundry test with an empty holder list; API test that the route accepts an empty resolved set when supply is 0 |
| Holder list with a repeated address reverts on-chain and is rejected by validation | Double payment | Foundry `DuplicateHolder` test; Zod test |
| A manager-only bond's projected `payments.made` advances after an interim coupon | Stale queue | Ingestion/reducer test for `CouponPeriodPaid` |
| `/v1/health` exposes `contracts.bondManagerCompatible` and it is false against an ABI without `GOV_RESERVE()` | Silent skew | Health contract test |
| `forge test`, both package gates, hygiene and link checks pass | Regression | CI |

## Constraints

- sandbox-sized; public repo rules; no new dependencies
- `BondManager` ABI changes again (event added, function removed): fresh sandbox to observe live

## Open Questions

- None blocking.
