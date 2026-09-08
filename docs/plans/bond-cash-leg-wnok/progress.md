# Bond cash leg in wNOK — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-07 — Phase 0 done: inbound-leg and wNOK-conservation assertions added to `BondManager.t.sol`, green against the unchanged contract
**Current phase:** Phase 1: BondManager cutover, deploy wiring, contract docs, ADR
**Next action:** Phase 1 step 1 — replace `_govTbd` with `_govReserve` in `contracts/src/norges-bank/BondManager.sol` on branch `feature/bond-cash-leg-wnok`

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterization | Done | baseline `forge test`: 24 suites, 390 passed; after adding assertions `BondManager.t.sol`: 47 passed (2026-09-07) | PR 1 |
| 1 — BondManager cutover, deploy wiring, contract docs, ADR | Not started | | |
| 2 — API contract and revert decoding | Not started | | |
| 3 — UI alignment | Not started | | |
| 4 — Fresh local sandbox validation | Not started | | |
| 5 — Architecture docs, known issues, index | Not started | | |

## Deviations From the Plan

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

- The working tree on `development` carried unrelated uncommitted work when this plan was
  written: `ITbd` gained `mint`/`burn` declarations and an ERC-165 registration, and a new
  `contracts/src/settlement/` interbank-settlement set with its test. This plan does not touch
  those files; after Phase 1, `BondManager` no longer imports `ITbd`, so the two changes do not
  interact.
- No sandbox belonging to this repository was running when the plan was written; Phase 4 is
  the first runtime check.
