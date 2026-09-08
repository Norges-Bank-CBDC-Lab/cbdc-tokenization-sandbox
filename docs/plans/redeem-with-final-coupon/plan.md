# Redeem with the final coupon — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-09
**Scope:** `contracts/src/norges-bank/BondManager.sol`, `contracts/src/norges-bank/interfaces/IBondManager.sol`, `contracts/src/common/Errors.sol`, contract tests and docs; `services/nb-bond-api` (ingestion, bond-state reducer, composer status, `contracts/bonds.ts`, `contracts/operations.ts`, `app.ts`, `openapi.json`, ABI artifact, tests); `services/nb-ui` (`PayCouponModal.jsx`, `CouponPayoutPage.jsx`, `BondsPage.jsx`, `BondDetailPage.jsx`, `bondsApi.js`, tests); `docs/` (architecture, lifecycle and coupon diagrams, known issues, index), ADR 0005
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline, ingestion-order check, characterization tests
Phase 1  Contracts: closure in payCoupon, BondMatured, remove redeem     -> PR 1
Phase 2  API: ingestion, projection status, route removal, OpenAPI      -> PR 2
Phase 3  UI: final payout preview, page texts, filters                  -> PR 2
Phase 4  Fresh local sandbox: full and partial allocation to maturity   -> evidence in PR 2
Phase 5  Docs, known issues, diagrams, index; archive                   -> PR 2
```

Phase 1 alone is not operator-safe: after it, the API's `redeem` route targets a function that
no longer exists and the projection never reaches a terminal status, because `AllCouponsPaid`
is gone. PR 1 therefore ships the contract change with the refreshed ABI artifact only, and PR 2
must follow before the sandbox is redeployed from `development`. Record that in PR 1's body.

## Phase 0: Baseline and Characterization

### Goal

Pin current amounts and confirm the projection tolerates all closure events landing in one
block.

### Scope

- `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`
- `services/nb-bond-api/src/ingestion.ts`, `projection/bond-state.ts`, existing projection tests

### Steps

1. Record the baseline: `forge test` (25 suites, 393 tests on 2026-09-08) and both package
   gates.
2. Read the ingestion apply loop and confirm whether manager and token logs from one block are
   applied in `logIndex` order across contracts. Write the answer into `progress.md`. If they are
   not, note that the reducer must stay order-independent for `coupon-paid`, `supply-delta`, and
   the new `matured` transition (it is today: flags and monotonic counts).
3. In the existing coupon tests, assert the exact interim coupon amount per holder
   (`balance × 42` at 425 bps) so Phase 1 cannot change interim behaviour unnoticed.

### Verification Stop

- Tests green; the ordering finding is recorded.

### Exit Criteria

- [ ] Interim coupon amounts are asserted explicitly.
- [ ] Ingestion ordering is documented as verified or as order-independent.

## Phase 1: Close the bond in the final `payCoupon`

### Goal

One transaction pays the final coupon plus principal, burns all units, and emits `BondMatured`.

### Scope

- `contracts/src/norges-bank/interfaces/IBondManager.sol`, `contracts/src/norges-bank/BondManager.sol`,
  `contracts/src/common/Errors.sol`
- `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`
- `contracts/docs/contracts-reference.md`, `contracts/docs/contracts-security.md`,
  `contracts/docs/bond-lifecycle-walkthrough.md`, the two affected NatSpec pages
- `services/nb-bond-api/src/abi/BondManager.json` (artifact only)
- `docs/decisions/0005-redeem-principal-with-the-final-coupon.md` (status to Accepted on merge)

### Steps

1. `IBondManager`: add `BondMatured(string indexed isin, uint256 paymentCount, uint256
   principalPaid, uint256 couponPaid, uint256 unsoldBurned)`; remove `AllCouponsPaid` and
   `BondRedemptionComplete`.
2. `BondManager.payCoupon` per `design.md`: compute `finalPeriod`; if final, `setMatured`
   first; loop holders skipping `address(this)` into `unsold`; final period settles
   `Operation.Redeem` with `cashAmount = balance × (UNIT_NOMINAL + paymentPerBond)` and emits
   `CouponPaid` plus `BondRedeemed`; interim period unchanged; coverage check counts `unsold`;
   after `updateCouponPayment`, on the final period burn `unsold` through
   `BOND_TOKEN.redeemFor(address(this), …)`, require zero supply (`RedemptionIncomplete`), emit
   `BondMatured`.
3. Delete `redeem`. Remove `Errors.AllCouponsPaid` only if unused afterwards (it still guards a
   call on an already-closed bond; rename to `BondAlreadyMatured` if kept).
4. Tests, sized like their neighbours: final payout amounts for two holders (coupon plus
   principal, supply zero, `BondMatured` totals); partial allocation (bid 60 of 100 units):
   interim coupon pays 60 units only, final payout burns 40 unsold units with no reserve
   movement; underfunded reserve on the final period reverts with no balance change and no
   supply change; `BondMatured` emitted once; calling `payCoupon` again reverts. Replace
   `test_Redeem*` and the redeem fuzz with the closure equivalents; keep the `NotMatured`
   token test.
5. `forge fmt`, `forge build`, `forge test`, verify-mapping check. Slither runs in CI.
6. Contract docs: the walkthrough's step 6 (redeem) folds into step 5; reference and security
   notes describe the closure and the unsold-unit rule; hand-patch the `BondManager` and
   `IBondManager` NatSpec pages.
7. Copy the regenerated ABI into the API artifact.

### Verification Stop

- `forge test` green with the new cases; `grep -n "function redeem(" BondManager.sol` empty.

### Failure Diagnosis / Fix Forward / Rollback

- `NotMatured` inside a `SettlementFailure` on the final period: `setMatured` runs after the
  loop; move it before.
- `CouponPaymentBalanceMismatch` with a partial allocation: `unsold` not counted in coverage.
- Revert of the PR; no chain state affected until Phase 4.

### Exit Criteria

- [ ] Final `payCoupon` pays principal, burns all units, emits `BondMatured`.
- [ ] Partial allocation reaches maturity with unsold units burned and never paid.
- [ ] `BondManager.redeem` and the two old events are gone; ABI artifact refreshed.

## Phase 2: API ingestion, status, and route removal

### Scope

- `services/nb-bond-api/src/ingestion.ts`, `projection/bond-state.ts`, `projection/compose-projection.ts`,
  `contracts/bonds.ts`, `contracts/operations.ts`, `app.ts`, `openapi.json`, tests

### Steps

1. Ingestion: handle `BondMatured` → bond event `MATURED` with the totals payload and a
   reducer transition that sets both `is_matured` and `redemption_complete`; drop the
   `AllCouponsPaid` and `BondRedemptionComplete` branches.
2. `bondStatus`: return `matured` when `is_matured` (supply will be zero); remove `redeemed`
   from the `BondStatus` enum and the composer.
3. Remove the `/v1/bonds/{isin}/redemptions` path, its handler, and `getActiveHolders` use
   there; mark `REDEMPTION` in the operation-type enum as legacy. Update the `payCoupon`
   summary. Regenerate `openapi.json`.
4. Tests: reducer transition; composer status; ingestion of a block containing `CouponPaid`,
   `BondRedeemed`, and `BondMatured` in both orders; OpenAPI contract test for the removed path.
5. Package gate.

### Exit Criteria

- [ ] A closure block projects to `matured` with zero supply and a `MATURED` history entry.
- [ ] No redemption route in code or `openapi.json`.

## Phase 3: UI

### Scope

- `services/nb-ui/src/pages/PayCouponModal.jsx`, `CouponPayoutPage.jsx`, `BondsPage.jsx`,
  `BondDetailPage.jsx`, `src/api/bondsApi.js`, tests

### Steps

1. `PayCouponModal`: when `coupon.payments.remaining == 1`, title the action "Pay final coupon
   and redeem", show per holder coupon, principal, and total, list unsold manager-held units as
   "burned, no payment", and show the grand total against `govReserve.wnokBalance` from the
   Central Bank resource with a warning when short. Remove the treasury-held-units failure
   warning (it no longer fails).
2. `CouponPayoutPage`: header hint stating the page lists bonds with issued supply, not
   disabled, with a coupon schedule, and that the final payout closes the bond; empty-state
   text to match (supersedes the unpushed `feature/coupon-page-scope-text` wording).
3. `BondsPage`: drop the `redeemed` filter option; `BondDetailPage`: tooltips describe closure
   at the final coupon. Remove `BondsApi.redeem`.
4. Tests for the final-payout preview (amounts, burn line, warning) and the page texts.
5. Package gate.

### Exit Criteria

- [ ] The final payout preview shows coupon plus principal and the burn line.
- [ ] No UI text describes a separate redemption.

## Phase 4: Fresh local sandbox validation

### Steps

1. With the operator's go-ahead, `./sandbox.sh delete` then `start` (the registry may need
   `./infra/infra.sh registry-start` first).
2. Bond A, fully allocated (two dealers, 100 units, two coupon periods): interim coupon, then
   final payout; assert per dealer `+coupon` then `+coupon + principal`, reserve down by the
   same, wNOK supply unchanged, bond status `matured`, supply zero, history has one `MATURED`
   entry, the Coupon payout page no longer lists it.
3. Bond B, partially allocated (one dealer bids 60 of 100 units): interim coupon pays 60 units
   only and succeeds without allowlisting the manager; final payout burns 40 unsold units with
   no reserve movement for them.
4. Time-gated calls: mine a fresh block before each coupon (a zero-value transaction), since
   gas estimation reads the latest block's timestamp.
5. Record both balance trails in `progress.md`.

### Exit Criteria

- [ ] Both bonds close in one transaction each with the expected balances.

## Phase 5: Documentation and archive

### Steps

1. `docs/diagrams/processes/bond-lifecycle.md`: `OUTSTANDING → MATURED: final coupon + principal
   paid, all units burned`; remove the `REDEEMED` state and the "full-buyback edge case" note
   only if it is resolved (it is not; keep it).
2. `docs/diagrams/processes/coupon-redemption-sequence.md`: one loop; rename to keep the file
   path (links) but retitle "Coupon and maturity".
3. `docs/ARCHITECTURE.md` bond lifecycle bullets; `contracts/README.md` lifecycle line.
4. `docs/KNOWN_ISSUES.md`: close "Partially allocated bonds deadlock coupon payment and
   redemption"; add the full-buyback status follow-up if the operator accepts it.
5. Closed-loop plan Phase 6: extend the note (maturity closure now exists; its "reverse DvP"
   is this).
6. ADR 0005 to Accepted; indexes; archive this folder with `Status: Implemented` after PR 2.

### Verification Stop

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Contract unit | Final payout = coupon + principal, supply zero, `BondMatured` once | `BondManager.t.sol` closure tests |
| Contract unit | Interim coupon amount unchanged | Phase 0 explicit amount assertions |
| Contract unit | Unsold units: no coupon, burned at maturity, no cash | partial-allocation test |
| Contract unit | Underfunded reserve at closure reverts whole tx | underfunded final-period test |
| Contract unit | Second `payCoupon` after closure reverts | already-matured test |
| Contract integration | Full lifecycle without a separate redeem | `BondLifecycle.t.sol` |
| Projection | `BondMatured` → `matured`, zero supply, `MATURED` history; order-independent | reducer and ingestion tests |
| API/Zod contract | Redemption path removed; `BondStatus` enum | `openapi-contract.test.ts` |
| UI | Final payout preview, burn line, reserve warning, page texts | vitest |
| Local runtime | Fully and partially allocated bonds close | Phase 4 trails |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 | Contracts close the bond in the final coupon; ADR 0005; ABI artifact | `forge test`, Slither in CI | API/UI lag until slice 2; do not redeploy the sandbox from `development` in between |
| 2 | API and UI follow; docs; sandbox evidence; archive | package gates; Phase 4 trails; hygiene checks | none |

## Migration, Rebuild, and Rollout

- Data/schema version effect: bond history gains `MATURED`; `BondStatus` loses `redeemed`;
  `openapi.json` loses one path. The projection is rebuilt on a fresh sandbox.
- Local rebuild/restart path: fresh sandbox after PR 2.
- Compatibility window: none needed locally; do not deploy PR 1 alone.
- Non-local deployment note: redeploy `BondManager`; consumers of `AllCouponsPaid`,
  `BondRedemptionComplete`, or the redemption route must switch to `BondMatured`.
- Rollback: revert PRs before a redeploy; after, redeploy from `development`.

## Out of Scope

- Authority settlement, burning unsold units at finalisation, full-buyback status, early
  redemption, ERC-3643 migration.

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] No temporary compatibility path remains.
- [ ] `forge test`, both package gates, and the public-repo checks pass.
- [ ] Documentation matches the implemented behaviour.
- [ ] PR evidence contains no private environment information.
