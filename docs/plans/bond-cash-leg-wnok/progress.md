# Bond cash leg in wNOK — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-08 — Phases 2 and 3 done on `feature/bond-cash-leg-wnok-api` (stacked on PR #272): Central Bank resource exposes `govReserve`, payouts and finalisation push live changes, UI updated
**Current phase:** Phase 4: Fresh local sandbox validation (needs operator go-ahead to delete the local sandbox)
**Next action:** After PR #272 merges, rebase `feature/bond-cash-leg-wnok-api` onto `development`; run Phase 4 on a fresh sandbox; then Phase 5 docs and open PR 2

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterization | Done | baseline `forge test`: 24 suites, 390 passed; after adding assertions `BondManager.t.sol`: 47 passed (2026-09-07) | PR 1 |
| 1 — BondManager cutover, deploy wiring, contract docs, ADR | Done (PR #272 open, all checks green) | `forge build`, `forge test`: 25 suites, 393 passed (3 new cases); verify-mapping check passed; `grep private-bank` on `BondManager.sol` empty; nb-bond-api lint, format, and 244 jest tests green with the refreshed ABI (2026-09-08) | PR 1 |
| 2 — API contract and revert decoding | Done | `govReserve {address, wnokBalance}` replaces `govSettlementBank`; `openapi.json` regenerated (one resource changed); coupon, redemption, and finalisation decode with the WNOK ABI and publish `bidders` + `central-bank`; nb-bond-api lint, format, build, 245 jest tests green (2026-09-08) | PR 2 |
| 3 — UI alignment | Done | Central Bank KPI shows the reserve's WNOK balance and address; coupon warning names the WNOK allowlist; nb-ui format, lint, build, 121 vitest tests green (2026-09-08) | PR 2 |
| 4 — Fresh local sandbox validation | Not started | | |
| 5 — Architecture docs, known issues, index | Not started | | |

## Deviations From the Plan

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

## Blocked / Waiting On

- Phase 4 needs an explicit go-ahead to delete and recreate the local sandbox.

## Follow-ups Found Along the Way

- `Tbd` government nomination (`govReserve`, `_mintFromGovReserve`) has no bond-stack consumer
  after this change — `contracts/src/private-bank/Tbd.sol` — decide whether the Banking page
  demo keeps it; record in `docs/KNOWN_ISSUES.md` if accepted.
- Test fixtures allowlist `BondManager` on wNOK with a stale comment while the deploy script
  does not — `contracts/test/norges-bank/BondManager.t.sol` setup — align once the
  treasury-held-units contract fix is decided.
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
