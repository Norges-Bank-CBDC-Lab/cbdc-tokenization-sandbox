# Bond coupon and maturity correctness — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `contracts/src/norges-bank/BondManager.sol`, `BondAuction.sol`, `BondToken.sol`,
`ERC1410/ERC1410.sol`, `contracts/src/common/Errors.sol`, `contracts/script/norges-bank/10_Bond.s.sol`,
contract tests and docs (reference, security, walkthrough, hand-patched NatSpec pages);
`services/nb-bond-api` (auction pre-check, coupon route ordering, ABI artifacts, tests, `DEVELOPMENT.md`);
`services/nb-ui` (`domain/coupon.js`, `PayCouponModal.jsx`, `CreateAuctionModal.jsx`, `utils/format.js`, tests);
`docs/KNOWN_ISSUES.md`, `docs/diagrams/processes/auction-lifecycle.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline, scratch reproductions, per-holder gas                       -> evidence only
Phase 1  Coupon per holding (S3) + UI preview helper                            -> PR 1
Phase 2  Auction-type rule from enabled state; BondNotEnabled (S4)             -> PR 2
Phase 3  Matured guards, final coupon vs in-flight auction, BUYBACK cancel (S5) -> PR 2
Phase 4  Holder eligibility on transfer + sorted holders (S6, needs D6)         -> PR 3
Phase 5  Cleanups in touched code (comments, createPartition, error, DECIMALS)  -> PR 4 (or folded, see slices)
Phase 6  Fresh local sandbox run                                                -> evidence in the last PR
Phase 7  Docs, known issues, index, archive                                     -> each PR + final
```

Correctness of amounts (Phase 1) goes first because it is independent and every later test
that pays a coupon asserts amounts. Phases 2 and 3 share one PR: both change which auctions may
be scheduled, both change the API pre-check and the UI picker, and Phase 3's final-coupon rule
depends on Phase 3's BUYBACK-cancel fix. Phase 4 waits for decision D6.

Every contract PR changes behaviour without changing event signatures, so the API and projection
keep working against either contract version; still, do not redeploy the local sandbox from
`development` between PRs unless the PR's own API and UI changes are in (each slice below
carries them).

### Working rules for every contract phase

- `BondManagerTest` is close to the via-IR assembly tag limit: new cases go into
  `contracts/test/norges-bank/BondManagerLifecycle.t.sol` (`BondManagerLifecycleTest is Test,
  AuctionHelper`) with its own `setUp`, modelled on `BondManagerTest.setUp` and
  `BondLifecycle.t.sol`. Only amount expectations change inside `BondManager.t.sol`.
- `payCoupon` is close to solc's stack limit: if a change triggers stack-too-deep, move logic
  into a helper that takes and returns memory structs (`Period`, `PayoutTotals` pattern) rather
  than reshuffling locals.
- Do not run `forge doc` to refresh `contracts/docs/natspec/`: it regenerates every page.
  Hand-patch only the pages of the contracts whose NatSpec changed.
- Slither runs in CI (Contracts CI); read its report on the PR, and record any accepted finding in
  `contracts/docs/contracts-security.md`.
- After every contract change: `forge fmt`, `forge build`, `forge test`, and
  `./contracts/check-verify-latest-mapping.sh`; copy the changed ABIs from `contracts/out/` into
  `services/nb-bond-api/src/abi/` in the same PR.

## Phase 0: Baseline and Scratch Reproductions

### Goal

Prove each finding on the current code and measure per-holder gas, without committing anything.

### Scope

- Scratch Foundry tests kept outside the committed tree (for example a local, uncommitted file
  under `contracts/test/` deleted afterwards, or a gitignored scratch folder).

### Steps

1. Record the baseline: `forge test` (24 suites, 390 tests on 2026-09-28), `npm run` package
   gates for `services/nb-bond-api` and `services/nb-ui`.
2. Scratch reproductions, each asserting today's (wrong) outcome:
   - 60 units at 425 bps → `CouponPaid` 2 520;
   - RATE cancelled → a second RATE reverts `AuctionTypeMustBePrice`; a PRICE auction then
     finalises; `payCoupon` reverts `Panic(0x12)`; `disableBond` reverts `BondHasFinalisedAuction`;
   - deploy → cancel RATE → `disableBond` → `deployBond` → RATE reverts `AuctionTypeMustBePrice`;
   - PRICE auction scheduled before the final coupon, final coupon paid, PRICE finalised → units in
     a matured partition, next `payCoupon` reverts `AllCouponsPaid`;
   - fully issued bond, BUYBACK scheduled, `cancelAuction` reverts `ReductionBelowSupply`.
3. Gas: pay one interim and one final coupon to 1, 50, and 200 holders; record gas per holder and
   the quadratic share of the duplicate check. Derive the holder count that fits in the local
   60 000 000 block gas limit with a safety margin.
4. Write results into `progress.md` "Verified So Far"; delete the scratch files.

### Verification Stop

- Each reproduction behaves as `design.md` describes; if one does not, stop and correct the
  design before Phase 1.

### Exit Criteria

- [ ] Five reproductions recorded with their revert data.
- [ ] Per-holder gas and a holder-count estimate recorded.
- [ ] No committed change.

## Phase 1: Coupon per Holding (S3)

### Goal

Every holder receives `floor(balance × UNIT_NOMINAL × yield / 10000)`; the preview agrees.

### Scope

- `contracts/src/norges-bank/BondManager.sol` (`Period`, `payCoupon`, `_payHolder`)
- `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`,
  new `contracts/test/norges-bank/BondManagerLifecycle.t.sol`
- `services/nb-ui/src/domain/coupon.js` (new), `src/pages/PayCouponModal.jsx`,
  `src/utils/format.js`, `tests/CouponPayoutPage.test.jsx`
- `contracts/docs/contracts-reference.md` (coupon amount rule), BondManager NatSpec page

### Steps

1. `Period.paymentPerBond` → `Period.couponYield`; `payCoupon` passes `couponYield`; `_payHolder`
   computes `(_balance * UNIT_NOMINAL * _p.couponYield) / PERCENTAGE_PRECISION`. Rewrite the
   comment above it with the worked example (60 units at 425 bps: 60 × 1000 × 425 / 10000 =
   2 550).
2. Update expectations in `BondManager.t.sol`: `test_PayCoupon` (1 000 units → 42 500, was 42 000),
   `test_PayCoupon_EmitsCouponPeriodPaid`, `test_PayCoupon_MultipleHolders`, both fuzz tests, the
   final-period tests; replace the `paymentPerBond` helpers with a per-holding helper
   `_coupon(balance)` mirroring the contract formula. Same in `BondLifecycle.t.sol`
   (`_paymentPerBond`).
3. New `BondManagerLifecycleTest` (fixture: WNOK, BondAuction, BondToken, BondDvP, BondManager,
   two bidders, reserve) with:
   - `test_PayCoupon_PaysPerHoldingNotTruncatedPerUnit`: 60 and 40 units at 425 bps → 2 550 and
     1 700; `CouponPeriodPaid(…, 2, 4 250)`;
   - `test_PayCoupon_RoundsDownPerHolding`: yield 333 bps, holdings 4 and 7 → 133 and 233
     (total 366, unrounded 366.3; the old per-unit rule paid 132 and 231);
   - `testFuzz_PayCoupon_MatchesReferenceFormula(uint16 units, uint16 yieldBps)`: bounded
     inputs, a RATE auction at `yieldBps`, one interim coupon; assert the paid amount equals the
     formula and the reserve delta equals it.
   A clearing rate other than 425 needs its own RATE finalisation in the fixture; keep that in a
   helper `_issue(units, rateBps)`.
4. UI: create `src/domain/coupon.js` exporting `UNIT_NOMINAL = 1000n`, `BPS = 10000n`,
   `couponForHolding(balance, rateBps)`, `principalForHolding(balance)`; `PayCouponModal.jsx`
   uses them (header comment updated to the per-holding rule); `format.js` `formatNok` uses
   `UNIT_NOMINAL`. Update `CouponPayoutPage.test.jsx`: 600 units → "25.50 K NOK", 400 →
   "17.00 K NOK", total "42.50 K NOK"; the manager-held case to match; add one case at
   333 bps (7 units preview 233 NOK; the old rule showed 231).
5. Contract docs: coupon amount rule in `contracts/docs/contracts-reference.md`; hand-patch the
   `BondManager` NatSpec page.
6. Gates: `forge fmt && forge build && forge test`; nb-ui format, lint, test, build. No ABI
   change in this phase (only an internal struct); confirm with a diff of
   `contracts/out/BondManager.sol/BondManager.json` ABI against `services/nb-bond-api/src/abi/BondManager.json`.

### Verification Stop

- New and updated tests green; the UI test shows 25.50 K NOK for 600 units.

### Failure Diagnosis / Fix Forward / Rollback

- Stack-too-deep after renaming: the field swap should not add locals; if it appears, move the
  coupon-detail read into `_loadPeriod` (design.md).
- A fuzz failure at extreme inputs: bound `units` by the offering and `yieldBps` to 1–10 000;
  zero-coupon holdings (tiny holding, tiny yield) are valid and pay 0.
- Rollback: revert the PR; no chain state changes until Phase 6.

### Exit Criteria

- [ ] Contract pays per holding; totals equal sums of per-holder amounts.
- [ ] UI preview uses `domain/coupon.js` and matches the contract for 425 and 333 bps.
- [ ] ABI unchanged.

## Phase 2: Auction-Type Rule From Enabled State (S4)

### Goal

RATE is schedulable exactly while a bond is staged; PRICE and BUYBACK exactly while it is
enabled; `payCoupon` on a non-enabled bond fails with a named error.

### Scope

- `BondManager._deployAuctionForBond`, `payCoupon`; `BondAuction.createAuction`; `Errors.sol`
- `contracts/test/norges-bank/BondAuction.t.sol`, `BondManagerLifecycle.t.sol`
- `services/nb-bond-api/src/features/auctions/service.ts`, `tests/auction-service.test.ts`
- `services/nb-ui/src/pages/CreateAuctionModal.jsx` and its tests
- ABI artifacts `BondManager.json`, `BondAuction.json`

### Steps

1. `Errors.sol`: add `BondNotEnabled(string isin)`.
2. `BondManager._deployAuctionForBond`: after the existence check,
   `bool enabled = BOND_TOKEN.couponDuration(partition) != 0;` then RATE on an enabled bond →
   `AuctionTypeMustBePrice()`; PRICE or BUYBACK on a non-enabled bond →
   `FirstAuctionMustBeRate()`. Keep the checks before `extendPartitionOffering` and
   `createAuction`. Update the `deployAuctionForBond` NatSpec.
3. `BondManager.payCoupon`: `if (couponDuration == 0) revert Errors.BondNotEnabled(_isin);`
   before `maturityDuration / couponDuration`.
4. `BondAuction.createAuction`: keep the `previousCount == 0` RATE check and
   `PreviousAuctionActive`; remove the `AuctionTypeMustBePrice` branch; NatSpec says lifecycle
   type sequencing belongs to the admin. Adjust `BondAuction.t.sol` if a test relied on the
   removed branch (none found on 2026-09-28; `test_CreateAuction_RevertIf_FirstAuctionNotRate`
   stays valid).
5. Tests in `BondManagerLifecycleTest`:
   - `test_RateAuction_AfterCancelledRate_Succeeds` (schedule, cancel, schedule RATE, finalise,
     coupon parameters set);
   - `test_RateAuction_AfterDisableAndReuse_Succeeds` (the path `test_DisableBond_AllowsIsinReuse`
     never exercised);
   - `test_PriceAuction_RevertIf_NotEnabled` (after a cancelled RATE) and the BUYBACK equivalent;
   - `test_RateAuction_RevertIf_AlreadyEnabled`;
   - `test_PayCoupon_RevertIf_NotEnabled` (staged bond; `BondNotEnabled`, not a panic).
6. API: in `features/auctions/service.ts` replace the two `isinToAuctionCount` checks with reads
   of `BondToken.couponDuration(partition)` (and `isMatured`, used in Phase 3), mirroring the
   existing `activePartitions` read and its `DependencyUnavailableError`; update the messages and
   `tests/auction-service.test.ts` (count-based fixtures become coupon-state fixtures).
7. UI: `CreateAuctionModal.jsx` derives `enabled` from `selectedBond.coupon?.rateBps != null`;
   `pickIsin` picks RATE for a non-enabled bond and PRICE otherwise; hints reworded; update its
   tests.
8. Docs: `contracts/docs/contracts-reference.md` auction rule (line 178);
   `services/nb-bond-api/DEVELOPMENT.md` lines 188, 276, 326; `docs/diagrams/processes/auction-lifecycle.md`
   type-constraint flowchart ("Bond enabled?" instead of "First auction for ISIN?"); NatSpec pages
   for `BondManager`, `BondAuction`, `Errors`.
9. Refresh ABI artifacts; gates for all three packages.

### Verification Stop

- The cancel-then-RATE and reuse-then-RATE reproductions from Phase 0 now succeed; PRICE before
  enablement reverts with `FirstAuctionMustBeRate`.

### Failure Diagnosis / Fix Forward / Rollback

- A RATE auction scheduled via `deployBondWithAuction` reverts: the enabled read must use the
  partition created in the same call; `_deployBond` runs first, so `couponDuration` is 0 — check
  the call order.
- API test drift: the service mocks `isinToAuctionCount`; replace the mock rather than keeping
  both reads.
- Rollback: revert the PR before Phase 6.

### Exit Criteria

- [ ] Count no longer decides the auction type anywhere (contract, API, UI).
- [ ] `payCoupon` on a staged bond reverts `BondNotEnabled`.
- [ ] Auction IDs unchanged in shape (`isinToAuctionCount` untouched).

## Phase 3: Matured Bonds Stay Closed (S5)

### Goal

No unit can enter a matured partition, and the final coupon cannot race an auction.

### Scope

- `BondManager._deployAuctionForBond`, `payCoupon`, `cancelAuction`; `BondToken.mintByIsin`,
  `_updatePartitionOffering`; `Errors.sol`
- `BondManagerLifecycle.t.sol`, `contracts/test/norges-bank/BondToken.t.sol`,
  `contracts/test/invariant/BondToken.invariant.t.sol`
- `services/nb-bond-api/src/features/auctions/service.ts`; `services/nb-ui/src/pages/PayCouponModal.jsx`,
  `CreateAuctionModal.jsx`, tests
- ABI artifacts `BondManager.json`, `BondToken.json`

### Steps

1. `Errors.sol`: add `AuctionInFlight(string isin)`, `BondAlreadyMatured(string isin)`,
   `PartitionMatured(string isin)`.
2. `BondManager.cancelAuction`: read `BOND_AUCTION.getAuction(auctionId).auctionType`; call
   `reducePartitionOffering` only for RATE and PRICE; emit `BondAuctionCancelled` with
   `offeringReduced = 0` for BUYBACK (event unchanged; the value becomes truthful).
3. `BondManager._deployAuctionForBond`: `if (BOND_TOKEN.isMatured(partition)) revert
   Errors.BondAlreadyMatured(_isin);` before the type checks.
4. `BondManager.payCoupon`: after `finalPeriod` is known,
   `if (finalPeriod && bondActive[_isin]) revert Errors.AuctionInFlight(_isin);`.
5. `BondToken.mintByIsin` and `_updatePartitionOffering` (increase path only): revert
   `PartitionMatured(isin)` when `isMatured[partition]`.
6. Tests in `BondManagerLifecycleTest`:
   - `test_CancelBuyback_OnFullyIssuedBond_LeavesOfferingUnchanged`;
   - `test_PayCoupon_FinalPeriod_RevertIf_AuctionInFlight` then succeeds after the PRICE auction
     is finalised (units included in the closure) and, separately, after it is cancelled;
   - `test_PayCoupon_InterimPeriod_AllowedWithAuctionInFlight`;
   - `test_DeployAuction_RevertIf_Matured` for PRICE and BUYBACK.
   In `BondToken.t.sol`: `test_MintByIsin_RevertIf_Matured`, `test_ExtendOffering_RevertIf_Matured`.
   Invariant handler: `mintToHolder` and `extendOffering` return early when matured, and add
   `invariant_MaturedPartitionSupplyNeverGrows` (track supply at the moment `markMatured` runs).
7. API: the auction pre-check adds "bond has matured" from `isMatured(partition)`; confirm the
   409 detail for `AuctionInFlight` decodes through the `BondManager` interface on the coupon
   route; if `PartitionMatured` ever surfaces raw, add the `BondToken` interface to that
   `describeRevert` call.
8. UI: `PayCouponModal` on the final period with an `open` or `closed` auction in `bond.auctions`
   shows "Finalise or cancel the open auction before the final payment" and disables Confirm;
   `CreateAuctionModal` offers no type for a `matured` bond. Tests for both.
9. Docs: `contracts/docs/contracts-security.md` coupon-and-maturity section (ordering rule,
   matured guard); `contracts/docs/bond-lifecycle-walkthrough.md` step 5 (no auction in flight
   at the final coupon); NatSpec pages for `BondManager`, `BondToken`, `Errors`.
10. Refresh ABI artifacts; gates for all three packages.

### Verification Stop

- The matured-mint and buyback-cancel reproductions from Phase 0 now revert or succeed as
  designed.

### Failure Diagnosis / Fix Forward / Rollback

- `payCoupon` stack-too-deep: move the checks into `_loadPeriod` (design.md).
- Existing tests that finalise a PRICE auction after all coupons: none expected; if one exists,
  it encoded the bug — rewrite it to schedule before maturity.
- Rollback: revert the PR before Phase 6.

### Exit Criteria

- [ ] No path mints into or schedules an auction on a matured bond.
- [ ] The final coupon refuses while an auction is in flight; interim coupons do not.
- [ ] Cancelling a BUYBACK leaves the offering unchanged.

## Phase 4: Holder Eligibility and Sorted Holders (S6)

Requires decision D6. If the operator declines D6, implement only steps 5–7 (sorted holders)
and keep the known issue unchanged.

### Goal

Bond units can only reach addresses that can receive wNOK; the holder check is linear.

### Scope

- `ERC1410/ERC1410.sol` (hook), `BondToken.sol` (constructor, override, view), `IBondToken.sol`
  (`HOLDER_ALLOWLIST()`), `BondManager._payHolders`, `Errors.sol`
- `contracts/script/norges-bank/10_Bond.s.sol`
- Every test that constructs `BondToken` (seven existing files: `BondToken.t.sol`,
  `BondManager.t.sol`, `BondAuction.t.sol`, `BondDVP.t.sol`, `BondOrderBook.t.sol`,
  `BondLifecycle.t.sol`, the invariant test; plus the new `BondManagerLifecycle.t.sol`)
- `services/nb-bond-api/src/app.ts` coupon route, tests; ABI artifacts `BondToken.json`,
  `BondManager.json`
- `docs/KNOWN_ISSUES.md`

### Steps

1. `ERC1410Minimal._transferByPartition`: call
   `_beforeTransferByPartition(fromPartition, toPartition, from, to, value)` (internal virtual,
   empty) after the zero-recipient check and before `_move`.
2. `BondToken`: constructor `(string _name, string _symbol, address _holderAllowlist)`; revert on
   zero; store `address public immutable HOLDER_ALLOWLIST`; override the hook to require
   `Allowlist(HOLDER_ALLOWLIST).allowlistQuery(to)`, else
   `AllowlistViolation("BondToken", to, "recipient not on WNOK allowlist")`. Add
   `HOLDER_ALLOWLIST()` to `IBondToken`.
3. `10_Bond.s.sol`: pass the wNOK address the script already resolves (line 38). Check that
   every sandbox holder (dealers, seeded bidders) is on the wNOK allowlist in
   `07_WnokSetup.s.sol`; it must already be true for issuance cash legs.
4. Tests: update every constructor call site (pass a `Wnok` where one exists, otherwise a
   small allowlist deployed in `setUp`); `BondToken.t.sol` gains
   `test_TransferByPartition_RevertIf_RecipientNotAllowlisted` and the operator variant;
   `BondManagerLifecycleTest` gains `test_Issuance_ToNonAllowlistedBidder_FailsAtSecurityLeg`
   (allocation failure, units stay on the manager, reason `Security`); `BondOrderBook.t.sol`
   allowlists its buyers.
5. `Errors.sol`: add `HoldersNotSorted(string isin, address previous, address current)`.
   `_payHolders`: replace the nested loop with the ascending check (`DuplicateHolder` when equal,
   `HoldersNotSorted` when lower).
6. Existing duplicate-holder tests keep their `DuplicateHolder` expectation (sort their inputs so
   the duplicate is adjacent); add `test_PayCoupon_RevertIf_HoldersNotSorted`; tests that pass
   two holders pass them in ascending order.
7. API coupon route: sort `requested` ascending (lower-case string compare) before
   `payCoupon`; test that an unsorted body and the default holder set both reach the contract
   sorted. Update the `HoldersBody` description to say order is irrelevant.
8. Health (optional, if one line): probe `BondToken.HOLDER_ALLOWLIST()` alongside `GOV_RESERVE()`.
9. `docs/KNOWN_ISSUES.md`: narrow "Every bond holder must be on the WNOK allowlist…" to holders
   removed from the allowlist after receiving units; the transfer path is closed.
   `contracts/docs/contracts-security.md`: transfer eligibility and its interim status under
   ADR 0002. `contracts/docs/contracts-versioning.md` is unchanged (constructor changes are
   deployment-internal).
10. Refresh ABI artifacts; gates for all three packages.

### Verification Stop

- `forge test` green with the new cases; the Phase 0 gas measurement repeated for 200 holders
  shows the duplicate-check share gone.

### Failure Diagnosis / Fix Forward / Rollback

- Issuance allocation failures reported as `Security` instead of `Cash` for non-allowlisted
  bidders: expected (the security leg runs first); update any test asserting `Cash` for that
  case.
- Order-book tests fail with seller failures: their buyers are not allowlisted; allowlist them.
- Rollback: revert the PR before Phase 6; if already redeployed, redeploy from the prior
  `development` commit.

### Exit Criteria

- [ ] Transfers to non-allowlisted recipients revert; all lifecycle suites pass.
- [ ] Holder list check is linear; the API always sends a sorted list.
- [ ] Known issue narrowed.

## Phase 5: Cleanups in Touched Code

### Goal

Leave the touched files accurate and consistent.

### Steps

1. `BondToken.redeemFor`: replace the "mock DVP … REDEEM_EOA" NatSpec line and the inline comment
   with the actual flow.
2. `BondToken.createPartition`: remove the `activePartitions` and zero-maturity checks that
   `_createPartition` repeats; keep `_partitionIsin` assignment before `_createPartition` so its
   `DuplicatePartition` names the ISIN. Existing revert tests must stay green unchanged.
3. `Errors.sol`: add `SettlementNotConfirmed(address holder)`; `_settleHolderPayout` uses it
   instead of `SettlementFailure(Unknown, "coupon settle returned false")`.
4. `ERC1410Minimal.DECIMALS = 0`; update the NatSpec of `decimals()`.
5. Hand-patch NatSpec pages for `BondToken`, `BondManager`, `Errors`, `ERC1410Minimal`.
6. Gates; refresh ABI artifacts if `Errors` usage changed the `BondManager` ABI.

### Verification Stop

- `forge test` green; `grep -n "REDEEM_EOA\|mock DVP" contracts/src` empty.

### Exit Criteria

- [ ] No stale comment, duplicated check, or string revert in the touched paths.

## Phase 6: Fresh Local Sandbox Run

### Steps

1. With the operator's go-ahead (D12): `./infra/infra.sh registry-start` if needed,
   `./sandbox.sh delete`, then `./sandbox.sh start` on the branch of the last contract PR.
2. `/v1/health` reports contracts reachable (and `HOLDER_ALLOWLIST` compatible under D6).
3. Bond A (two dealers, 60 and 40 units, 425 bps, two periods): interim coupon pays 2 550 and
   1 700 wNOK; the reserve drops by 4 250; schedule a PRICE auction, attempt the final coupon
   (409 `AuctionInFlight`), finalise the PRICE auction, pay the final coupon; `BondMatured`
   totals equal the sums; bond `matured`, supply 0; scheduling another auction returns 400/409.
4. Bond B: schedule and cancel a RATE auction, schedule a RATE auction again, clear it, pay a
   coupon. Disable a staged bond C after a cancelled RATE auction, re-create the ISIN, schedule
   RATE successfully.
5. Bond D (under D6): try to transfer units from a dealer to a non-allowlisted address with
   `cast send` → reverts `AllowlistViolation`.
6. Mine a fresh block before each time-gated call (gas estimation reads the latest block time).
7. Record the balance trails in `progress.md`.

### Exit Criteria

- [ ] Every step above observed; trails recorded; no private environment data in the record.

## Phase 7: Documentation and Archive

Each PR carries the docs for its phase (listed above). After the last PR:

1. `docs/DOCUMENTATION_INDEX.md`: add this folder when the plan is first committed; update the
   entry when archived.
2. `docs/ARCHITECTURE.md` bond lifecycle bullets: auction-type rule and matured guard, if they
   describe either.
3. Move the folder to `docs/plans/archive/` with `Status: Implemented` after the last PR merges.
4. Run the public-repo checks below.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Contract unit | Coupon per holding at 425 and 333 bps; totals = sums | `BondManagerLifecycleTest` S3 cases; updated `BondManager.t.sol` expectations |
| Contract fuzz | Paid amount equals reference formula for any units/yield | `testFuzz_PayCoupon_MatchesReferenceFormula` |
| Contract unit | RATE after cancelled RATE and after reuse; PRICE/BUYBACK refused before enablement; RATE refused after | S4 cases |
| Contract unit | `payCoupon` on staged bond → `BondNotEnabled` | S4 case |
| Contract unit | Auction on matured bond refused; mint/extend on matured partition refused | S5 cases, `BondToken.t.sol` |
| Contract unit | Final coupon refused with auction in flight; interim allowed | S5 cases |
| Contract unit | BUYBACK cancel on fully issued bond succeeds, offering unchanged | S5 case |
| Contract invariant | Matured partition supply never grows | `BondToken.invariant.t.sol` |
| Contract unit | Transfer to non-allowlisted recipient reverts (holder and operator paths); issuance to such a bidder fails at the security leg | S6 cases |
| Contract unit | Holder list must be strictly ascending; duplicates still named | S6 cases |
| Contract integration | Full lifecycle with corrected amounts | `BondLifecycle.t.sol` |
| API | Auction pre-check follows enabled/matured state; coupon route sorts holders | `auction-service.test.ts`, coupon route test |
| API | ABI artifacts decode new errors | route tests with mocked reverts |
| UI | Preview amounts (425 and 333 bps), final-coupon block with open auction, auction-type picker | `CouponPayoutPage.test.jsx`, `CreateAuctionModal` tests |
| Local runtime | End-to-end trails | Phase 6 |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 `feature/coupon-per-holding` | Correct coupon amounts on-chain and in the preview | Foundry S3 cases; nb-ui test | No ABI change; safe to deploy alone |
| 2 `feature/bond-lifecycle-guards` | Auction-type rule from enabled state; matured guards; final coupon vs auction; BUYBACK cancel; API pre-check and UI picker | Foundry S4/S5 cases; API and UI tests | Carries its own API/UI changes; safe to deploy alone |
| 3 `feature/bond-holder-eligibility` | Transfer eligibility; sorted holders; API sorting; known issue narrowed | Foundry S6 cases; API route test | Needs D6; constructor change, so redeploy only with the API ABI refresh in the same PR |
| 4 `feature/bond-contract-cleanups` | Comments, `createPartition`, custom error, `DECIMALS` | `forge test` | May be folded into slice 2 or 3 if the reviewer prefers fewer PRs; Phase 6 evidence goes into the last slice |

Each slice is a `feature/<kebab>` branch with a PR against `development`; branch naming,
commit conventions, and the CI gates follow the repository PR workflow.

## Migration, Rebuild, and Rollout

- Data/schema version effect: none in the API database; projection unchanged; no OpenAPI
  change.
- Local rebuild/restart path: fresh sandbox after the last contract slice (D12). Earlier slices
  can be exercised with `forge test` only.
- Compatibility window: none needed locally; do not redeploy from `development` with a contract
  slice merged but its API/UI changes missing (each slice carries them).
- Non-local deployment note: redeploy the bond contracts (`BondToken`, `BondAuction`,
  `BondManager`) together; any consumer of `BondToken`'s constructor or of the holder order in
  `payCoupon` must follow; event consumers are unaffected.
- Rollback or fix-forward boundary: revert PRs before a redeploy; after, redeploy from the prior
  `development` commit.

## Documentation and Public-Repo Hygiene

- Docs and indexes to update: `contracts/docs/contracts-reference.md`,
  `contracts/docs/contracts-security.md`, `contracts/docs/bond-lifecycle-walkthrough.md`,
  hand-patched NatSpec pages (`BondManager`, `BondAuction`, `BondToken`, `ERC1410Minimal`,
  `IBondToken`, `Errors`), `services/nb-bond-api/DEVELOPMENT.md`,
  `docs/diagrams/processes/auction-lifecycle.md`, `docs/DOCUMENTATION_INDEX.md`.
- Architecture/known-issue updates: `docs/KNOWN_ISSUES.md` allowlist entry narrowed (Phase 4);
  new follow-ups from `progress.md` added only when the operator accepts them.
- Third-party/license inventory impact: none (no dependency or image change).
- ADR: if the operator accepts the recommendation in D1 (and optionally D6), author the ADR in
  the first slice that implements it and link it from `design.md`.

Verification:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

## Out of Scope

- The separate hardening change.
- Coupon pagination, empty-period collapse for bought-back bonds, schedule drift on late
  payments, `BondAllocationFailed` reason type, event `isin` indexing, wNOK sub-units, ERC-3643.

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] No temporary compatibility path remains.
- [ ] `forge test`, both package gates, and the public-repo checks pass.
- [ ] Documentation matches the implemented behaviour.
- [ ] PR evidence contains no private environment information.
