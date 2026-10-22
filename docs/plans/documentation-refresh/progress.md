# Documentation refresh — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan folder written; findings re-verified against `development` at `db92409`
**Current phase:** Not started
**Next action:** Operator reviews `intent.md` and answers the decisions in `design.md` (closed-loop park, wallet and entity-directory keep or park, transfer-eligibility entry, archived progress headers); then run Phase 0 on a fresh `development` and open slice 1 as `feature/docs-neutral-deployment-wording`.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline | Not started | | |
| 1 — Cloud wording and tooling names | Not started | | |
| 2 — Plan housekeeping | Not started | | |
| 3 — Removed behaviour and known issues | Not started | | |
| 4 — NatSpec source links | Not started | | |
| 5 — License inventory and entrypoints | Not started | | |

## Deviations From the Plan

Corrections made to the review findings while writing the plan:

- **Full pre-maturity buyback shown as `staged` — dropped as a known issue.** Since #278,
  `bondStatus` keeps an issued bond `outstanding` while coupon periods remain
  (`services/nb-bond-api/src/projection/compose-projection.ts:188-212`). The stale statement is
  in `docs/diagrams/processes/bond-lifecycle.md`, last edited in #276; it is fixed there instead
  (Phase 3).
- **Startup flowchart path.** The flowchart is `docs/diagrams/operations/sandbox-startup-flow.md`;
  there is no `docs/operations/` folder.
- **NatSpec regeneration is not a full-tree churn today.** A scratch regeneration from current
  source differs only in the Git Source lines and three pages, so one regeneration PR is small.
- **`forge doc` cannot fix the path prefix.** A `[doc]` path setting did not change the
  generated `blob/<ref>/src/…` form, so the fix belongs in `fix-links.py`.
- **Line references moved** in the closed-loop plan evidence: role grants are at
  `11_BondSetup.s.sol:51,61`, not 54 and 64.
- **Added:** one more cloud-wording line (`docs/KNOWN_ISSUES.md:97`) and the parenthetical former
  product name in `services/nb-ui/DEVELOPMENT.md:107` and `services/nb-ui/src/auth/entraAuth.js:2`.
- **Added:** `docs/DOCUMENTATION_INDEX.md:62` also states where the SSE plan was verified; that
  clause goes too.

## Verified So Far

- Cloud-term self-check over tracked files classified into accepted `entra` surfaces, accepted
  `docs/AZURE_BOUNDARY.md` text, frozen records (10 archived plans; no ADR or post-mortem hits),
  and 15 to-fix rows (18 lines) listed in `design.md` — verified by `git grep` on 2026-09-28.
- Local tooling names: 1 in `docs/KNOWN_ISSUES.md`, 3 in the ERC-3643 incremental plan, 13
  archived plans — verified by `git grep` on 2026-09-28.
- `reopenAuction` removed (`services/nb-ui/tests/auctionsApi.test.js:6`); no
  `withdrawFailedIssuance` in `contracts/src`; no redeem or holders route in
  `services/nb-bond-api/src/app.ts`; Kind maps only ports 80 and 8545; no `bens-microservice.sh`
  in the tree — verified by reading source on 2026-09-28.
- `sandbox.sh:175-178` resumes stopped nodes; `contracts/contracts.sh:166` skips a repeat deploy
  — verified on 2026-09-28.
- Bond units move through `ERC1410._move` with no eligibility check — verified by reading
  `contracts/src/norges-bank/ERC1410/ERC1410.sol` on 2026-09-28.
- `ethers` is 6.17.0 in all three manifests and the lockfile — verified on 2026-09-28.
- Blockscout's `/api/v2/transactions` returned `ens_domain_name: null` for every party on the
  running local sandbox — verified 2026-09-28 (BENS-side resolution not re-checked).
- All 32 NatSpec Git Source links point at `e1ad139`, which is on no branch, and omit the
  `contracts/` prefix; the link checker skips `http(s)` links — verified on 2026-09-28.
- `check-third-party-licenses.py` passes; it does not inspect image pins — verified on
  2026-09-28.

## Blocked / Waiting On

- Transfer eligibility known-issue entry — waits on the operator's decision on the eligibility
  rule in `docs/plans/bond-coupon-maturity-correctness/`.
- Archived progress header lines — wait on explicit operator approval (frozen records).
- Keep or park the wallet and entity-directory plans — operator.

## Follow-ups Found Along the Way

- `ERC1410.transferByPartition` documents that 32-byte `data` selects the destination partition,
  but passes the source partition as destination —
  `contracts/src/norges-bank/ERC1410/ERC1410.sol:174-184` — contract behaviour, outside this plan;
  hand to the bond coupon and maturity correctness plan or a new one.
- The nb-bond-api "opaque 500s on RPC outage" known issue is still open (no mapping of
  `RpcUnavailableError` to `503` in the error middleware) — `docs/KNOWN_ISSUES.md:151-170` —
  candidate for the nb-bond-api hardening plan.
- No committed check catches cloud wording, tooling names, or missing image-inventory rows;
  adding one is a new CI surface and needs operator approval.
- `contracts/docs/contracts-security.md:47-48` describe "redemption flows"; accurate in substance
  (principal at maturity) but could say "maturity principal" for consistency with ADR 0005.

## Changes Since Planning (2026-09-28)

Changes merged after this plan was written (#300, #302, #304, #305). Effects
on this plan:

- Phase 1: the `testMode` descriptions in `services/nb-bond-api/src/contracts/{bonds,auctions}.ts`
  (and so `openapi.json`) and the `services/nb-ui/src/utils/debugSettings.js` header no longer
  name deployment tooling (#304). The remaining source hits are `src/env-vars.ts` and
  `src/auth.ts`; the `openapi.json` acceptance criterion no longer expects a diff.
- `BondOrderBook` documentation was removed with the contract (#302); the contract reference,
  topology note, and NatSpec pages changed, so re-baseline Phase 4 link counts.
- `contracts/docs/contracts-security.md` still lists "recover failed issuance" and "redeem bonds"
  for `BOND_MANAGER_ROLE`; Phase 3 still applies.
- Re-run the Phase 0 searches on current `development` before starting.

## Session Handoff

- Plan written read-only on 2026-09-28; no tracked file outside this folder was changed.
- The scratch NatSpec regeneration used a copy of `contracts/` outside the repository; nothing
  under `contracts/docs/` was modified.
- The other plan folders written on 2026-09-28 were not yet committed when this plan was
  written; re-check their final scope in Phase 0 step 7.
