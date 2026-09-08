# Bond cash leg in wNOK — Implementation Plan

**Status:** In progress
**Created:** 2026-09-07
**Scope:** `contracts/src/norges-bank/BondManager.sol`, `contracts/script/norges-bank/10_Bond.s.sol`, `contracts/script/norges-bank/11_BondSetup.s.sol`, `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`, `services/nb-bond-api` (ABI, Central Bank resource, revert decoding), `services/nb-ui` (Central Bank page, pay-coupon modal), contract and architecture docs, `docs/KNOWN_ISSUES.md`, ADR 0004
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline and characterization (tests only)
Phase 1  BondManager cutover, deploy wiring, contract docs, ADR      -> PR 1
Phase 2  API contract and revert decoding                            -> PR 2
Phase 3  UI alignment                                                -> PR 2
Phase 4  Fresh local sandbox validation                              -> evidence in PR 2
Phase 5  Architecture docs, known issues, index                      -> PR 2
```

Phase 1 is independently shippable: the API tolerates a missing `GOV_TBD()` (the Central Bank
KPI degrades to a dash) and no other service call touches the removed surface.

## Phase 0: Baseline and Characterization

### Goal

Pin the behaviours that must not change and make the token cutover observable.

### Scope

- `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`

### Steps

1. Record the baseline: `forge test` on `development` (390 tests green on 2026-09-07).
2. In `test_FinaliseAuction_Rate` and `test_FinaliseAuction_Price`, add assertions that the
   bidder's wNOK decreases and the reserve account's wNOK increases by `units × nominal`
   (or the discounted amount). These pass today and prove the inbound leg is untouched later.
3. Add a conservation helper used by the payout tests: `wnok.totalSupply()` before and after.

### Verification Stop

- `forge test --match-path 'test/norges-bank/BondManager.t.sol'` green with the new assertions.

### Failure Diagnosis / Fix Forward / Rollback

- A failing new assertion here means the evidence in `design.md` is wrong; stop and re-read
  `_settleIssuance` before touching the contract.

### Exit Criteria

- [ ] Inbound-leg assertions exist and pass against the unchanged contract.

## Phase 1: BondManager settles every cash leg in wNOK

### Goal

Remove the government TBD from the bond stack and pay buyback, coupon, and redemption in wNOK
from the reserve account.

### Scope

- `contracts/src/norges-bank/BondManager.sol`
- `contracts/src/common/Errors.sol` (only if a new zero-address error is needed and
  `InvalidGovTbd` has no other consumer)
- `contracts/script/norges-bank/10_Bond.s.sol`, `contracts/script/norges-bank/11_BondSetup.s.sol`
- `contracts/test/norges-bank/BondManager.t.sol`, `contracts/test/integration/BondLifecycle.t.sol`
- `contracts/docs/contracts-reference.md`, `contracts/docs/contracts-security.md`,
  `contracts/docs/bond-lifecycle-walkthrough.md`, `contracts/README.md`
- `docs/decisions/0004-settle-all-bond-cash-legs-in-wnok.md` (status to Accepted on merge)

### Steps

1. `BondManager.sol`: replace the `_govTbd` constructor parameter with `_govReserve`; add
   `address public immutable GOV_RESERVE`; delete `GOV_TBD`, `_GOV_RESERVE`, and the `ITbd`
   import; revert on a zero reserve address.
2. Point the three outbound legs at `cashToken: WNOK, cashFrom: GOV_RESERVE`; point issuance
   at `cashTo: GOV_RESERVE`. Rename `tbdAmount` to `wnokAmount`; update NatSpec that mentions
   TBD or "government nominated".
3. `10_Bond.s.sol`: pass the reserve address derived from `PK_GOV_RESERVE`; remove the
   `TBD_NORDEA_CONTRACT_NAME` lookup and the `Tbd` import if unused.
4. `11_BondSetup.s.sol`: remove the government-TBD imports, dealer allowlisting on the TBD,
   and the TBD approval; add the reserve account's wNOK approval of `BondDvP`. Keep the
   `TRANSFER_FROM_ROLE` grant and dealer approvals.
5. Tests: drop `Tbd` from both fixtures (deploy, allowlist, mint, approvals); construct the
   manager with the reserve address; the reserve already holds wNOK in both fixtures. Move
   every `govTbd.balanceOf` assertion to `wnok.balanceOf`. In
   `test_FinaliseAuction_Buyback_DvpFailure` remove the reserve's wNOK allowance instead of the
   TBD allowance.
6. New tests in `BondManager.t.sol`, sized like their neighbours:
   - `test_PayCoupon_ConservesWnokSupply` and `test_Redeem_ConservesWnokSupply`;
   - `test_PayCoupon_RevertIf_ReserveUnderfunded` (burn the reserve down below the due amount
     with `BURNER_ROLE`, expect `SettlementFailure(Cash, …)` and unchanged holder balances);
   - `test_PayCoupon_RevertIf_HolderNotOnWnokAllowlist` (remove one holder from the wNOK
     allowlist, expect `SettlementFailure(Cash, AllowlistViolation)`);
   - `test_Constructor_RevertIf_GovReserveZero`.
7. Run `forge fmt`, `forge build`, `forge test`, and `./slither.sh`; confirm
   `contracts/check-verify-latest-mapping.sh` needs no change (no new deployable contract).
8. Update the four contract docs: the cash leg is wNOK from the reserve account; the deploy list
   no longer includes a government-side `Tbd`; `TRANSFER_FROM_ROLE` and the reserve allowance
   are the outbound-leg permissions.
9. Copy the regenerated `BondManager` ABI from `contracts/out/BondManager.sol/BondManager.json`
   into `services/nb-bond-api/src/abi/BondManager.json` (same PR, so the API artifact never
   lags the contract; the API code change follows in Phase 2).

### Verification Stop

- `forge test` green, including the new cases; `grep -rn "private-bank" contracts/src/norges-bank/BondManager.sol` returns nothing.
- Slither reports no new findings against `BondManager`.

### Failure Diagnosis / Fix Forward / Rollback

- `AllowlistViolation` on a payout test: the holder or reserve is not on the wNOK allowlist in
  the fixture; fix the fixture, not the contract.
- `ERC20InsufficientAllowance` on a payout test: the reserve approval of `BondDvP` is missing
  in the fixture (mirrors step 4).
- Rollback is a revert of the PR; no chain state is affected until Phase 4.

### Exit Criteria

- [ ] `BondManager` has no `private-bank` import and no `GOV_TBD`.
- [ ] All payout assertions are on wNOK; conservation, underfunded, and allowlist cases pass.
- [ ] Deploy scripts compile and no longer reference the government TBD.
- [ ] Contract docs describe the wNOK reserve leg.

## Phase 2: API contract and revert decoding

### Goal

Expose the reserve account instead of a settlement bank and decode wNOK reverts.

### Scope

- `services/nb-bond-api/src/banking-tbd.ts` (`getGovSettlementBank` and the service binding),
  `src/contracts/central-bank.ts`, `src/app.ts` (Central Bank route, coupon and redemption
  routes), `src/features/auctions/service.ts` (finalisation: ABI swap and live-change push), `src/openapi/document.ts` description text,
  `openapi.json`, tests under `services/nb-bond-api/tests/`

### Steps

1. Replace `getGovSettlementBank` with `getGovReserve`: read `BondManager.GOV_RESERVE()` and
   `Wnok.balanceOf` for it; move it out of the TBD roster module if that module no longer
   needs it.
2. Update the `CentralBank` Zod schema: remove `govSettlementBank`, add
   `govReserve: { address, wnokBalance } | null`, following the repository's API conventions
   for the resource; regenerate `openapi.json`.
3. Swap `tbdAbi` for `wnokAbi` in the coupon, redemption, and finalisation revert-decoding
   interfaces. Keep `tbdAbi` where the banking routes use it.
4. Reword the coupon treasury hint to name the wNOK allowlist and the Central Bank page
   workaround.
5. Add `changedResources: ['bidders', 'central-bank']` to the coupon, redemption, and auction
   finalisation operation recordings so dealer wNOK balances and the reserve balance refresh
   live after every cash movement (chain ingestion only marks `bonds` and `auctions` for these
   events; finalisation already moved bidder wNOK before this plan and never pushed those
   resources, so the fix covers issuance and buyback as well). No ingestion, projection, or
   live-event-protocol change is needed: ingestion reads `BondManager`, `BondToken`, and
   `BondAuction` logs only and no event signature changes.
6. Update the tests that assert the Central Bank payload and the custom-error hint text.
7. Run the package gate (format, lint, test) exactly as CI does.

### Verification Stop

- Package gate green; `openapi.json` diff shows only the Central Bank field change.
- Coupon, redemption, and finalisation tests assert the published live-change resources include `bidders` and `central-bank`.

### Failure Diagnosis / Fix Forward / Rollback

- If `GOV_RESERVE()` is absent at runtime (contracts not yet redeployed), the route already
  degrades to `null`; confirm the test for the unreachable case still passes.

### Exit Criteria

- [ ] `govSettlementBank` is gone from schema, route, and openapi.
- [ ] No route decodes coupon or redemption reverts with the TBD ABI.

## Phase 3: UI alignment

### Goal

Show the reserve account and correct the coupon warning.

### Scope

- `services/nb-ui/src/pages/CentralBankPage.jsx`, `services/nb-ui/src/pages/PayCouponModal.jsx`,
  the Central Bank API client and its tests

### Steps

1. Replace the "Government bank" KPI with "Government reserve": address (mono, shortened as
   elsewhere on the page) and wNOK balance; sub-label "Pays coupon, buyback, redemption".
2. Reword the treasury-held warning in the pay-coupon modal to the wNOK allowlist and the
   Central Bank page workaround.
3. Run the package gate (format, lint, test, build).

### Verification Stop

- Package gate green; the Central Bank page test covers the new field and the `null` case.

### Exit Criteria

- [ ] No UI text refers to a government TBD in the bond flow.

## Phase 4: Fresh local sandbox validation

### Goal

Prove the deploy wiring end to end on this repo's local stack.

### Scope

- Local Kind sandbox only; no repository file changes expected.

### Steps

1. With the operator's go-ahead, `./sandbox.sh delete` then `./sandbox.sh start` (destructive
   to local chain state; required because the contracts start path skips deployment when the
   registry marker exists).
2. `cast call <BondManager> "GOV_RESERVE()(address)"` equals the fixture reserve address;
   `cast call <Wnok> "allowance(address,address)(uint256)" <reserve> <BondDvP>` is max.
3. From the UI: create a bond with a RATE auction, submit two dealer bids with the reference
   CLI, finalise, warp is not available on Besu so use a small `DURATION_SCALAR` (the fixture
   default is 60 seconds), pay one coupon, run a buyback auction, pay the remaining coupons,
   redeem.
4. After each payout: dealer wNOK rises by the expected amount, reserve wNOK falls by the same
   amount, `Wnok.totalSupply` unchanged; the Central Bank page reserve balance matches.
5. Confirm the Banking page still lists the fixture TBDs and is unaffected.

### Verification Stop

- Screenshots or `cast` output for steps 2 and 4 attached to the PR (no keys, no addresses
  beyond the local fixtures).

### Failure Diagnosis / Fix Forward / Rollback

- Coupon 409 with `AllowlistViolation` naming the reserve or a dealer: `07_WnokSetup` or
  `11_BondSetup` allowlisting regressed.
- Coupon 409 with `ERC20InsufficientAllowance`: the reserve approval in `11_BondSetup` did not
  broadcast.
- Rollback: `./sandbox.sh delete` and start from `development`.

### Exit Criteria

- [ ] Full lifecycle completes on a fresh sandbox with wNOK-only cash movements.

## Phase 5: Architecture docs, known issues, index

### Goal

Make the committed documentation describe the shipped behaviour.

### Scope

- `docs/ARCHITECTURE.md`, `docs/diagrams/processes/coupon-redemption-sequence.md`,
  `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/decisions/README.md`,
  `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md` (one relationship note)

### Steps

1. Sequence diagram: participant "Government-nominated TBD" becomes "Wnok"; the note says cash
   is wNOK from the reserve account.
2. `ARCHITECTURE.md`: `Wnok` is the cash token for every bond cash leg; `BondManager` holds the
   reserve account; the Central Bank page shows it.
3. `KNOWN_ISSUES.md`: rewrite the `GOV_TBD` entry as "reserve account is immutable" with the
   narrowed follow-up; reword the treasury-held entry to the wNOK allowlist and the Central
   Bank page workaround; add the `Tbd` government-nomination follow-up if the operator accepts it.
4. Add one line under the closed-loop plan's Phase 6 noting that coupon and redemption already
   settle in wNOK, so its two-tier path starts from a single token.
5. Documentation index and ADR index entries; ADR 0004 status to Accepted; move this folder to
   `docs/plans/archive/` when the second PR merges and set `Status: Implemented`.

### Verification Stop

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

### Exit Criteria

- [ ] No committed doc says coupons are paid in TBD.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Contract unit | Outbound legs pay wNOK from the reserve | `BondManager.t.sol` coupon, buyback, redeem assertions on `wnok.balanceOf` |
| Contract unit | No minting on payout | conservation tests on `wnok.totalSupply()` |
| Contract unit | Underfunded reserve reverts whole coupon | `test_PayCoupon_RevertIf_ReserveUnderfunded` |
| Contract unit | Holder off the wNOK allowlist | `test_PayCoupon_RevertIf_HolderNotOnWnokAllowlist` |
| Contract unit | Buyback cash-leg failure still graceful | existing `test_FinaliseAuction_Buyback_DvpFailure` on wNOK allowance |
| Contract unit | Inbound leg unchanged | Phase 0 assertions |
| Contract integration | Full lifecycle in one token | `BondLifecycle.t.sol` |
| Static | No `private-bank` dependency in the bond stack | grep in the PR checklist; Slither |
| API/Zod contract | Central Bank resource shape and `null` fallback | API tests; `openapi.json` diff |
| API | Coupon 409 hint names wNOK | `custom-errors.test.ts` |
| API | Every cash movement pushes `bidders` and `central-bank` live changes | coupon, redemption, and finalisation route tests |
| Ingestion | No event or projection change needed | existing ingestion tests unchanged; ABI diff limited to the constructor and `GOV_RESERVE` getter |
| UI | Reserve KPI and coupon warning | page tests |
| Local runtime | Deploy wiring and funding | Phase 4 `cast` calls and lifecycle run |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 | Bond stack settles in wNOK; government TBD removed from contracts, scripts, contract docs; ADR 0004; API ABI artifact refreshed | `forge test` with new cases; Slither | Central Bank KPI shows a dash until slice 2 |
| 2 | API and UI expose the reserve account; architecture docs and known issues updated; fresh-sandbox evidence | package gates; Phase 4 evidence; hygiene and link checks | Archive this plan folder |

Branch naming, commit conventions, and CI reproduction follow the repository PR workflow.

## Migration, Rebuild, and Rollout

- Data/schema version effect: none in the API projection; `openapi.json` changes one resource.
- Local rebuild/restart path: fresh sandbox (`delete` then `start`); the API rebuilds and the
  UI rebuilds through the normal service start.
- Compatibility window: between slice 1 and slice 2 the Central Bank KPI is empty; nothing
  else changes for the operator.
- Non-local deployment note: any separate deployment must supply a reserve address at
  `BondManager` deploy time and fund it with wNOK; the government-TBD wiring is no longer read.
- Rollback or fix-forward boundary: before Phase 4 a PR revert is sufficient; after a fresh
  sandbox deploy, roll back by redeploying from `development` on a fresh sandbox.

## Documentation and Public-Repo Hygiene

- Docs and indexes to update: listed per phase above.
- Architecture/known-issue updates: Phase 5.
- Third-party/license inventory impact: none (no dependency, image, or pin change).
- Public-safe configuration examples only; fixture keys referenced by env-var name.

Verification:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

## Out of Scope

- Authority settlement (closed-loop plan Phase 1), mutable reserve designation, treasury-held
  unit handling, `Tbd` changes, ERC-3643 migration, interbank settlement contracts.

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] No temporary compatibility path remains.
- [ ] `forge test`, both package gates, and the public-repo checks pass.
- [ ] Documentation matches the implemented behaviour.
- [ ] PR evidence contains no private environment information.
