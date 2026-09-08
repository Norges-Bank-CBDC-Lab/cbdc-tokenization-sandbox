# Bond cash leg in wNOK — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-08 — Phases 2 to 5 done on `feature/bond-cash-leg-wnok-api`; fresh-sandbox lifecycle run recorded
**Current phase:** All phases done; waiting on PR #272 to merge before PR 2
**Next action:** After PR #272 merges, rebase `feature/bond-cash-leg-wnok-api` onto `development`, rerun both package gates, open PR 2; archive this folder with `Status: Implemented` once PR 2 merges

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterization | Done | baseline `forge test`: 24 suites, 390 passed; after adding assertions `BondManager.t.sol`: 47 passed (2026-09-07) | PR 1 |
| 1 — BondManager cutover, deploy wiring, contract docs, ADR | Done (PR #272 open, all checks green) | `forge build`, `forge test`: 25 suites, 393 passed (3 new cases); verify-mapping check passed; `grep private-bank` on `BondManager.sol` empty; nb-bond-api lint, format, and 244 jest tests green with the refreshed ABI (2026-09-08) | PR 1 |
| 2 — API contract and revert decoding | Done | `govReserve {address, wnokBalance}` replaces `govSettlementBank`; `openapi.json` regenerated (one resource changed); coupon, redemption, and finalisation decode with the WNOK ABI and publish `bidders` + `central-bank`; nb-bond-api lint, format, build, 245 jest tests green (2026-09-08) | PR 2 |
| 3 — UI alignment | Done | Central Bank KPI shows the reserve's WNOK balance and address; coupon warning names the WNOK allowlist; nb-ui format, lint, build, 121 vitest tests green (2026-09-08) | PR 2 |
| 4 — Fresh local sandbox validation | Done | Fresh `./sandbox.sh start` on the feature branch; `GOV_RESERVE()` equals the fixture reserve, `WNOK()` the registered token, reserve→BondDvP allowance is max, reserve allowlisted; full lifecycle through the API with the balance trail below (2026-09-08) | PR 2 |
| 5 — Architecture docs, known issues, index | Done | `ARCHITECTURE.md`, both process diagrams, two known-issue entries rewritten, closed-loop plan Phase 6 note, ADR 0004 set to Accepted in the ADR index and documentation index; hygiene and link checks green (2026-09-08) | PR 2 |

## Deviations From the Plan

- Phase 4 drove the lifecycle through the NB Bond API's bidder routes instead of the reference
  bid CLI, and needed no `./sandbox.sh delete` because no sandbox for this repository existed.
- Phase 1: the `GovReserveAddressZero` constructor test lives in a second, tiny test contract
  at the end of `BondManager.t.sol`. A second `new BondManager` inside `BondManagerTest`
  makes solc 0.8.36 (via-IR) fail with "Tag too large for reserved space", so the large test
  contract cannot grow another deployment site. Same file, no new test file.
- Phase 1: the generated NatSpec pages for `BondManager` and `Errors` were patched by hand
  instead of running `forge doc`, which now rewrites every page (source-link commit hashes and
  link style) and would also emit pages for contracts not yet committed. A full regeneration is
  a separate, deliberate change.
- Phase 1: `Errors.InvalidGovTbd` was renamed to `Errors.GovReserveAddressZero` (its only
  consumer was the removed lookup); the plan allowed either.
- 2026-09-07 (before implementation): the operator widened Phase 2 to also push `bidders` and
  `central-bank` live changes from auction finalisation, a pre-existing gap for the issuance leg.

## Verified So Far

- Issuance already settles in wNOK to the reserve account; buyback, coupon, and redemption
  settle in the government TBD — verified by reading `BondManager.sol` on 2026-09-07.
- `BondDvP` and `Wnok` need no change for the outbound leg — verified against
  `BondDvP._settleCashLeg`, `Wnok.transferFrom`, and `BondDVP.t.sol` on 2026-09-07.
- Issuance debits the bidder and credits the reserve in wNOK, and coupon and redemption leave
  `wnok.totalSupply()` unchanged even on the TBD path — verified by the Phase 0 assertions on
  2026-09-07.
- After the cutover: coupon, buyback, and redemption move WNOK from the reserve to the holder
  with total supply unchanged; an underfunded reserve or a holder off the WNOK allowlist
  reverts the whole coupon with `SettlementFailure` and no balance change — verified by
  `forge test` on 2026-09-08.
- Chain events are consumed only by the API ingestion loop and Blockscout; ingestion reads
  manager, token, and auction logs and no event signature changes — verified in
  `services/nb-bond-api/src/ingestion.ts` and `contracts/contracts.sh` on 2026-09-07.
- The API degrades `govSettlementBank` to `null` when the manager call fails — verified in
  `services/nb-bond-api/src/app.ts` on 2026-09-07.

## Phase 4 Balance Trail (local sandbox, 2026-09-08)

Bond `NO0000000WNK`, 100 units at 1000 WNOK nominal, RATE auction cleared at 425 bps
(coupon per unit 42 after integer truncation), maturity 2 coupon periods of 60 s.

| Step | Reserve WNOK | Dealer A WNOK | Dealer B WNOK | WNOK supply | Bond supply |
|---|---|---|---|---|---|
| Baseline | 10 000 000 | 1 200 000 | 1 100 000 | 12 300 000 | 0 |
| Issuance (A 60 units, B 40 units) | 10 100 000 | 1 140 000 | 1 060 000 | 12 300 000 | 100 |
| Buyback (A sells 30 units at 98.00) | 10 070 600 | 1 169 400 | 1 060 000 | 12 300 000 | 70 |
| Coupon 1 (70 units × 42) | 10 067 660 | 1 170 660 | 1 061 680 | 12 300 000 | 70 |
| Coupon 2, bond matured | 10 064 720 | 1 171 920 | 1 063 360 | 12 300 000 | 70 |
| Redemption (70 units × 1000) | 9 994 720 | 1 201 920 | 1 103 360 | 12 300 000 | 0 |

Every cash movement is WNOK between the reserve and the dealers; WNOK supply never changes;
no TBD balance is involved. The Central Bank resource reported the reserve balance at each
step and the Banking page's TBD listing was unaffected.

## Blocked / Waiting On

- PR #272 merge (operator), then rebase and open PR 2.

## Follow-ups Found Along the Way

- `Tbd` government nomination (`govReserve`, `_mintFromGovReserve`) has no bond-stack consumer
  after this change — `contracts/src/private-bank/Tbd.sol` — decide whether the Banking page
  demo keeps it; record in `docs/KNOWN_ISSUES.md` if accepted.
- Test fixtures allowlist `BondManager` on wNOK with a stale comment while the deploy script
  does not — `contracts/test/norges-bank/BondManager.t.sol` setup — align once the
  treasury-held-units contract fix is decided.
- The redemption route maps an unknown nested revert (here `NotMatured` inside
  `SettlementFailure`) to a 500 with raw calldata, while the coupon route decodes it into a
  409 — `services/nb-bond-api/src/app.ts` redemption handler — pre-existing; give redemption
  the same `describeRevert` treatment.
- Time-gated calls (`payCoupon`, `redeem`) are gas-estimated against the latest block, whose
  timestamp only advances when a transaction is mined, so a coupon that is due by wall clock
  can still fail `CouponNotReady` until any transaction lands — sandbox chain behaviour
  already noted in ADR 0001's consequences; consider a note in the API's 409 detail or docs.
- Treasury-held units still deadlock coupon payout, now on the wNOK allowlist — existing entry
  in `docs/KNOWN_ISSUES.md`; contract-side fix (burn or skip self-held units) remains open.

## Session Handoff

- Slither did not run locally (arm64); the Contracts CI job runs it on the PR.
- `feature/bond-cash-leg-wnok-api` branches from `feature/bond-cash-leg-wnok` because PR #272
  was not yet merged; rebase onto `development` once it is.
- The new `getGovReserve` lives in `services/nb-bond-api/src/central-bank.ts` (a WNOK read),
  not in the TBD roster module the old lookup came from.
- The working tree on `development` carried unrelated uncommitted work when this plan was
  written: `ITbd` gained `mint`/`burn` declarations and an ERC-165 registration, and a new
  `contracts/src/settlement/` interbank-settlement set with its test. This plan does not touch
  those files; after Phase 1, `BondManager` no longer imports `ITbd`, so the two changes do not
  interact.
- No sandbox belonging to this repository was running when the plan was written; Phase 4 is
  the first runtime check.
