# Documentation refresh — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-10-27 — Phase 1 merged as #325; Phase 2 implemented on `feature/docs-plan-housekeeping`
**Current phase:** Phase 2: Plan housekeeping (awaiting PR and merge)
**Next action:** After slice 2 merges, branch slice 3 (removed behaviour, diagrams, known
issues) from a fresh `development`; slices 3–5 are independent, merge them one at a time. Still open in `design.md` "Decisions": the three confirm-only rows
(`docs/AZURE_BOUNDARY.md` title, `entra` mentions outside the service folders, frozen records
with cloud wording or tooling names).

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline | Done (2026-10-27) | re-run on `c5b93c4`; see "Phase 0 Baseline (2026-10-27)" | — |
| 1 — Cloud wording and tooling names | Done (merged 2026-10-27) | self-check leaves only accepted classes; `openapi.json` unchanged by `regen:openapi`; nb-bond-api lint, format, 293 tests; nb-ui format, lint, 139 tests, build; CI green on a fresh `npm ci` | #325 |
| 2 — Plan housekeeping | Done locally (2026-10-27) | `ls docs/plans` lists only `README.md`, `archive/`, and Proposed plans; link check passes after the move; ERC-3643 plan's relative links rewritten for its new depth | pending |
| 3 — Removed behaviour and known issues | Not started | | |
| 4 — NatSpec source links | Not started | | |
| 5 — License inventory and entrypoints | Not started | | |

## Deviations From the Plan

- 2026-10-27, Phase 2: the closed-loop role grants moved again after planning (#302 changed
  `11_BondSetup.s.sol`); the drift note cites the current `:57` (`SETTLE_ROLE`) and `:67`
  (`TRANSFER_FROM_ROLE`), not the `:51,61` in `design.md` §D4.
- 2026-10-27, Phase 2: the "archived" and "parked" dates use the slice 2 commit date
  (2026-10-27) rather than the merge date, so the commit stays self-contained.
- 2026-10-27, Phase 1: the `testMode` description rows (`src/contracts/{bonds,auctions}.ts`,
  `openapi.json`) and the `services/nb-ui/src/utils/debugSettings.js` row were already fixed by
  #304, so slice 1 does not touch them and `regen:openapi` produces no diff.
- 2026-10-27, Phase 1: added `docs/plans/erc-3643-incremental-adoption-plan.md:80` (a
  non-goal naming a deployment tooling approach), found by the Phase 0 baseline. It is fixed in slice 1
  because slice 2 archives that plan.
- 2026-10-27, Phase 1: the ERC-3643 plan's tooling references now point at `CONTRIBUTING.md`
  (lines 7 and 380) and `docs/plans/README.md` (line 411).
- 2026-10-27, operator decisions on the `design.md` "Decisions" table:
  - Closed-loop settlement plan: park it, as recommended (Phase 2 step 3).
  - Wallet and entity-directory plans: park both. Phase 2 step 4 applies the D4 status phrasing
    and index note to them as well as fixing their branch lines.
  - Transfer-eligibility known issue: parked. No `docs/KNOWN_ISSUES.md` entry is added in this
    plan; the eligibility gap stays with `docs/plans/bond-coupon-maturity-correctness/`.
  - Archived progress headers: approved. Phase 2 step 5 changes only the `Current phase` and
    `Next action` lines of the two archived `progress.md` files.

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

## Phase 0 Baseline (2026-10-27)

Re-run on `development` at `c5b93c4`. None of the other 2026-09-28 plans has started, so step 7
removes nothing. Line references below are the current ones.

- **D1 cloud wording:** 13 of the 15 "To fix" rows still apply; the two #304 rows are fixed
  (see Deviations). One new row, the ERC-3643 plan `:80`. Frozen records: 10 archived plans; no
  ADR or post-mortem. Moved lines: nb-bond-api `DEVELOPMENT.md` 507 → 528 and 521–524 → 542,
  nb-bond-api `README.md` 147 → 150, nb-ui `DEVELOPMENT.md` 107 → 110 and 247–250 → 267,
  `docs/DOCUMENTATION_INDEX.md` 62 → 72, `docs/KNOWN_ISSUES.md` 97 → 139.
- **D2 tooling names:** unchanged counts: 1 in `docs/KNOWN_ISSUES.md` (now `:254`), 3 in the
  ERC-3643 plan (`:7,380,411`), 13 archived plans.
- **D3–D5 plan tree:** hold. The ERC-3643 plan is still in the active folder; both `imp/…`
  branch lines are still present.
- **D6 removed behaviour:** all 12 rows hold. Moved lines: `docs/KNOWN_ISSUES.md` reopen entry
  100–114 → 142–150, `docs/ARCHITECTURE.md` 157–160 → 159, `contracts/docs/contracts-security.md`
  44 → 45, `services/DEVELOPMENT.md` 80–88 → 87, `docs/DOCUMENTATION_INDEX.md` 101 → 111.
- **D7 known issues:** hold. Resolved ingestion entry now `:180` (next entry `:194`), sample
  `version=6.16.0` now `:200`; `ethers` is 6.17.0 in all three manifests. Neither BENS entry
  exists. The live sandbox's `/api/v2/transactions` returned no ENS name for any party of 50
  transactions (BENS-side resolution still not re-checked).
- **D8 NatSpec:** 30 Git Source links (32 before #302 removed two pages), all still at
  `e1ad139` without the `contracts/` prefix.
- **D9 licences and entrypoints:** hold. The snapshot date is still September 4 although
  #307 and #313–#315 changed rows since; the Blockscout application row is now `:164`.
- **Checks:** `check-third-party-licenses.py`, `check-public-repo-hygiene.py`, and
  `check-markdown-links.py` pass.
- **New for later phases:** `docs/AZURE_BOUNDARY.md:212` names the reopen-auction known issue by
  its heading, which Phase 3 replaces (operator decision, since that file keeps its established
  scope). The `nb-ui-correctness-and-hardening` verification grep (`plan.md:545`) includes the
  nginx tag that #323 already removed.

## Blocked / Waiting On

- The three confirm-only rows in `design.md` "Decisions" — operator.

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
- 2026-10-27: Phase 0 re-run and Phase 1 merged as #325. The package gates ran against the existing workspace
  `node_modules` rather than a fresh `npm ci`; CI's `npm ci` run is the confirming gate.
- 2026-10-27: Phase 2 committed on `feature/docs-plan-housekeeping` (local commit, not yet
  pushed). The ERC-3643 plan is archived and frozen; the parked plans keep `Proposed` status.
