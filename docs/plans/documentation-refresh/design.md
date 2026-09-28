# Documentation refresh — Design

**Status:** Draft
**Created:** 2026-09-28
**Intent:** [`intent.md`](intent.md)
**Builds on:** ADR 0003, [ADR 0004](../../decisions/0004-settle-all-bond-cash-legs-in-wnok.md),
[ADR 0005](../../decisions/0005-redeem-principal-with-the-final-coupon.md), #225, #259, #276,
#278, #291, #292, #293, #294.

## Decision Summary

Fix each drifted document at the place that owns the fact, in five small documentation PRs
ordered by risk:

1. **Cloud wording and tooling names first.** They break publication rules; everything else is
   accuracy. The two `testMode` descriptions live in Zod contract modules, so the generated
   `openapi.json` is regenerated in the same PR.
2. **Plan housekeeping second**, after slice 1 has removed tooling names from the ERC-3643 plan,
   because archiving freezes it.
3. **Removed behaviour and known issues third.** Pure doc corrections, verified against code.
4. **NatSpec source links fourth**, fixed in the committed post-processing script rather than by
   hand, so every future regeneration produces resolvable links.
5. **License inventory and entrypoints last.**

The closed-loop settlement plan is **parked**, not refreshed: its Phase 1 design needs real design
work (all four cash legs now use the allowance path) that belongs to whoever schedules it. The
plan gets a dated drift note and keeps `Proposed` status.

## Current-State Evidence

Line numbers are from `development` at `db92409` (2026-09-28). All findings below are
**Verified** against the named file unless marked otherwise.

### D1 — Cloud wording outside the accepted surfaces

The self-check was run over all tracked files (the pattern is kept with the operator's local
tooling, not in the repository). Hits were classified as follows.

| Class | Files | Handling |
|---|---|---|
| Accepted: `entra` auth mode | `services/nb-bond-api/src/{app,auth,env-vars}.ts` (mode checks), `src/openapi/document.ts`, `src/contracts/live-events.ts`, nb-bond-api `README.md`/`DEVELOPMENT.md` auth sections, both Helm values files, `services/nb-ui/src/**` auth code and tests, nb-ui `README.md`/`AGENTS.md`/`DEVELOPMENT.md` auth sections, `services/nb-ui/package.json` and `THIRD_PARTY_LICENSES.md:108` (the MSAL package identifier) | Keep |
| Accepted by interpretation: docs describing the `entra` auth mode outside the two service folders | `docs/ARCHITECTURE.md:193,280-288,385-397`, `docs/diagrams/README.md:24`, `docs/diagrams/architecture/{system-context,nb-bond-api-components}.md`, `docs/diagrams/security/trust-boundaries.md`, `services/README.md:57`, `docs/plans/sandbox-fmi-wallet-plan.md:49`, `docs/DOCUMENTATION_INDEX.md:45,46,57` | Keep; listed for the operator to confirm |
| Accepted: existing `docs/AZURE_BOUNDARY.md` text and links to that path | `docs/AZURE_BOUNDARY.md`; links from nb-bond-api and nb-ui `DEVELOPMENT.md` | Keep the file and the link targets; the title is an operator question |
| Frozen records | 10 archived plans under `docs/plans/archive/`; no ADR or post-mortem hits | Report only |
| **To fix** | table below | Slice 1 |

| Location | What it says (described, not quoted) | Replacement direction |
|---|---|---|
| `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md:18` | Non-goal names the cloud platform and its managed Kubernetes runtime | "No infrastructure change: the plan runs on the existing sandbox runtime; deployment is the existing Foundry scripts against the Besu RPC." |
| same file `:227` | Boundary names the cloud platform, the IaC tool, and the managed Kubernetes runtime | "It requires no infrastructure change; the existing Besu runtime hosts it." |
| `services/nb-bond-api/DEVELOPMENT.md:507` | Auth-mode sync attributed to the GitOps controller | "A non-local deployment must keep `NB_BOND_API_AUTH_MODE` and the nb-ui `AUTH_MODE` in sync." |
| same file `:521-524` | SSE proxy requirements framed for the cloud platform | "Behind a non-local gateway, response buffering must be disabled, …"; keep the link to `docs/AZURE_BOUNDARY.md` |
| `services/nb-bond-api/README.md:147` | Env-var sync attributed to the GitOps controller | "The deployment must keep these in sync with the nb-ui `AUTH_MODE`; …" |
| `services/nb-bond-api/helm/values.local.example.yaml:75` | Same, as a values comment | "Non-local deployments MUST keep this in sync with nb-ui AUTH_MODE." |
| `services/nb-bond-api/src/env-vars.ts:71` (comment) and `:120` (startup error text) | Same | Comment: "A non-local deployment must keep this in sync …"; error: "Mode and config must be kept in sync by the deployment." No test asserts that text (`tests/env-vars.test.ts` matches the missing variable names only). |
| `services/nb-bond-api/src/auth.ts:10` | Same | "The deployment keeps the two in sync." |
| `services/nb-bond-api/src/contracts/bonds.ts:162`, `src/contracts/auctions.ts:206` | `testMode` parameter description says GitOps-managed deployments should ignore the flag | "Non-local deployments should ignore it." Flows into `openapi.json:229,403,791,871,946` → regenerate |
| `services/nb-ui/src/utils/debugSettings.js:18` | Same, as a JSDoc line | "Sandbox-only. Non-local deployments should ignore this flag." |
| `services/nb-ui/DEVELOPMENT.md:247-250` | SSE gateway requirements framed for the cloud platform's gateway | "A non-local gateway must forward Authorization, …" |
| `services/nb-ui/DEVELOPMENT.md:107`, `services/nb-ui/src/auth/entraAuth.js:2` | The identity provider's former product name in parentheses after "Microsoft Entra" | Drop the parenthetical; "Microsoft Entra ID" stays (auth-mode surface) |
| `docs/DOCUMENTATION_INDEX.md:16` | `AZURE_BOUNDARY.md` entry names the GitOps tool and platform in parentheses | "… reused from a non-local deployment." |
| `docs/DOCUMENTATION_INDEX.md:62` | SSE plan entry names cloud proxy constraints and says it was verified on a cloud-hosted deployment | "… and explicit non-local proxy constraints. Shipped via #224." (drop the verification clause) |
| `docs/KNOWN_ISSUES.md:97` | Entra renewal follow-up "owned by the cloud deployment work" | "until a non-local deployment running `entra` mode exercises the timed renewal." (**new**, not in the original findings) |

### D2 — Local tooling names in active docs

| Location | Handling |
|---|---|
| `docs/KNOWN_ISSUES.md:212` | "Warrants its own implementation plan under `docs/plans/` before implementation." |
| `docs/plans/erc-3643-incremental-adoption-plan.md:7,380,411` | Replace tooling references with the committed conventions they stand for: `docs/plans/README.md` for plan layout and archiving, `CONTRIBUTING.md` for PR workflow. Must happen **before** the file is archived in slice 2, since archived plans are frozen. |
| 13 archived plans | Frozen; report only |

### D3 — Plan tree

- **Verified.** `docs/plans/erc-3643-incremental-adoption-plan.md` status is "Superseded in
  direction by ADR 0002" but the file sits in the active `docs/plans/`. `docs/plans/README.md`
  says superseded plans move to `archive/`. References: `docs/DOCUMENTATION_INDEX.md:28` (active
  list), ADR 0002 lines 116 and 164 (plain text, frozen), the plan's own line 362.
- **Verified.** ADR 0004 and ADR 0005 carry `Plan:` lines naming `docs/plans/bond-cash-leg-wnok/`
  and `docs/plans/redeem-with-final-coupon/`; both folders are now under `archive/`. The pointers
  are plain text, so the link checker does not flag them. ADRs are frozen.
- Target: one convention line in `docs/plans/README.md`: "ADR plan pointers name the plan's
  original path; archived plans are found under `archive/` with the same name." This resolves
  all three ADR pointers without touching an ADR.

### D4 — Closed-loop settlement plan

| Finding | Evidence |
|---|---|
| Motivating tx evidence is from the chain reset by ADR 0003 (the transaction and block no longer exist; the chain id is still 2018, which makes it look current) | plan `:30`; `infra/besu/config/genesis.json` |
| Phase 1 changes only the issuance/buyback cash legs, but every bond cash leg now uses `BondDvP._settleCashLeg` → `transferFrom`: issuance (bidder pays), buyback, interim coupons, and the final coupon with principal (all paid from `GOV_RESERVE`) | `BondManager.sol:350-352,397-398,631-632`; `BondDvP.sol:97-98` |
| Decision D2 in the plan ("drop `TRANSFER_FROM_ROLE` on BondDvP") would break coupon and maturity settlement unless those legs also move to the authority path | same |
| Code references drifted: role grants are now `11_BondSetup.s.sol:51` and `:61`, not 54 and 64 | `contracts/script/norges-bank/11_BondSetup.s.sol` |
| Phase 6 is largely delivered: coupons and principal already settle in wNOK from the reserve, and maturity already burns through `BondDvP` → `redeemFor` (reverse DvP). What remains is the two-tier broker fan-out, which depends on Phase 3 | `BondDvP.sol:81,88`; `BondManager.sol:555,618-640` |
| Goal sentence and index entry still promise "two-tier coupon/redemption" as new work | plan `:9`; `docs/DOCUMENTATION_INDEX.md:25` |

Refreshing Phase 1 properly means redesigning the authority path for four legs and two payers,
which is design work with operator decisions attached. Nothing is scheduled. **Recommendation:
park.** Keep `Status: Proposed`, prefix it with "parked <merge date>, not scheduled", add a short
dated "Drift since authoring" block listing the rows above, fix the cloud wording (slice 1), and
update the index entry. Do not convert the single-file plan to a folder.

### D5 — 2026-07-15 plans

- **Verified.** `docs/plans/sandbox-fmi-wallet-plan.md:5` and
  `docs/plans/sandbox-entity-directory-and-name-service-plan.md:5` suggest `imp/…` branches; the
  repository convention is `feature/<kebab>` against `development`. Both are `Proposed` with no
  implementation since 2026-07-15.
- Fix the two branch lines. Keep or park is an operator decision; if parked, use the same status
  phrasing as D4.

### D6 — Removed behaviour still documented

| Location | Drift | Evidence | Correction |
|---|---|---|---|
| `docs/KNOWN_ISSUES.md:100-114` | Reopen-auction entry says the UI exposes "Reopen…" and the API client throws 501 | #225 removed it; `services/nb-ui/tests/auctionsApi.test.js:6` asserts `AuctionsApi.reopenAuction` is undefined | Replace with a short entry "Closed and finalised auctions cannot be reopened", keeping the existing bullet that a finalised auction is terminal and a bad outcome needs a fresh auction |
| `docs/ARCHITECTURE.md:157-160` | Failed-issuance units stay in `BondManager` "for explicit withdrawal" | `withdrawFailedIssuance` removed in #278; `BondManager.sol:555` burns unsold units at maturity | "…may leave unsold units on `BondManager`; they earn no coupon and the final `payCoupon` burns them without payment (ADR 0005)." |
| `contracts/docs/contracts-security.md:44` | `BOND_MANAGER_ROLE` can "recover failed issuance … and redeem bonds" | `BondManager.sol` role-gated functions: deploy, deploy-with-auction, extend, buyback, finalise, disable, close, cancel, `payCoupon` | "Can deploy bonds; open issuance, extension, and buyback auctions; close, cancel, and finalise them; disable unissued bonds; and pay coupons, where the final payment also pays principal and closes the bond." |
| `docs/diagrams/architecture/nb-bond-api-components.md:19` | Lifecycle handlers "create / disable / coupon / redeem" | Redeem route removed in #276; no redeem route in `app.ts` | "create / disable / coupon and closure" |
| `docs/diagrams/architecture/runtime-deployment.md:86-88` | NodePort and Kind mappings "reserve ports 443 and 8546" | #259; `infra/cluster/cluster-config.yaml` maps only 80 and 8545 | Delete that sentence; keep the WebSocket sentence |
| `services/nb-bond-api/DEVELOPMENT.md:362` | Lists `GET /v1/bonds/{isin}/holders` | No such route in `src/app.ts` | Replace with the projection-backed reads that exist (`GET /v1/bonds`, `/v1/bonds/{isin}`, `/v1/bonds/{isin}/history`, `/v1/auctions`) |
| `services/AGENTS.md:15`, `services/DEVELOPMENT.md:80-88` | `./bens-microservice.sh start` | No such script ever existed (`git grep` finds only these two lines); `services/blockscout/bens-microservice/README.md:12-17` says `blockscout.sh start` builds and deploys BENS | "BENS is built and deployed by `./blockscout.sh start`; there is no separate start command." |
| `services/AGENTS.md` Structure | Omits `services/nb-ui/` | directory exists with its own `AGENTS.md` | Add one line pointing at `services/nb-ui/AGENTS.md` |
| `docs/diagrams/operations/sandbox-startup-flow.md` | No "resume stopped node" step; contract deploy shown as unconditional | `sandbox.sh:175-178` (`startClusterNodes` when the cluster exists, #293); `contracts/contracts.sh:166` skips deploy when already deployed | Add a node after the registry check: "Cluster exists? start stopped node containers"; label contracts node "deploy unless already deployed on this chain" |
| `docs/DOCUMENTATION_INDEX.md:101` | "`docs/diagrams/operations/*.md`: Sandbox lifecycle and deployment flowcharts" | only `sandbox-startup-flow.md` exists | "Sandbox startup flowchart (`./sandbox.sh start`, including resume after `stop`)." |
| `services/nb-bond-api/README.md:13`, `services/nb-bond-api/DEVELOPMENT.md:140` | Link label `docs/openapi-v2-plan.md`; target is correct | target `docs/plans/archive/openapi-v2-plan.md` | Label = target path |
| `docs/diagrams/processes/bond-lifecycle.md:12,41,50-52` | Classifier shows "`everIssued AND totalSupply > 0`"; prose says a full pre-maturity buyback falls back to `staged` | #278 changed `bondStatus` to `everIssued && (supply > 0 || remaining coupon periods > 0)` (`compose-projection.ts:188-212`); the diagram was last touched in #276 | Update the decision node, the `AUCTIONING --> OUTSTANDING` label, and the prose: a fully bought-back bond stays `outstanding` while coupon periods remain; only a bond with no remaining periods and zero supply falls back to `staged` |

Handled by another plan (not here): `services/nb-ui/DEVELOPMENT.md:33` link label and the
`reopenAuction` references at `services/nb-ui/AGENTS.md:85` and `services/nb-ui/DEVELOPMENT.md:254`
belong to `nb-ui-correctness-and-hardening`.

### D7 — Known issues

| Item | Evidence | Handling |
|---|---|---|
| Resolved ingestion self-heal entry (`:138-149`) | Struck-through heading "— resolved" | Remove. The next entry (`:152`) opens with "Same root trigger as the ingestion bug above"; reword to "Triggered by a briefly unreachable Besu RPC." |
| Sample error text `version=6.16.0` (`:158`) | `ethers` pinned at 6.17.0 in `services/nb-bond-api/package.json:24` and both CLIs | Drop the version from the sample (`version=…`) so it cannot drift again |
| Blockscout returns `ens_domain_name: null` for names BENS resolves | Recorded only in `docs/plans/archive/blockscout-catchup-indexer/progress.md:35-39` (**Inferred** pre-existing there). 2026-09-28: `GET /api/v2/transactions` on the running sandbox returned `ens_domain_name: null` for every party (**Verified** null; BENS-side resolution not re-checked) | New entry; link the archived progress file |
| BENS returns `500` for the first seconds on a fresh `blockscout` namespace (`mapping` table not yet created) | same file `:40-41`; Phase 2 evidence there shows two `500`s | New entry, same link |
| Bond units transfer without any eligibility check | `ERC1410.transferByPartition` → `_transferByPartition` → `_move` checks only granularity and balances (`contracts/src/norges-bank/ERC1410/ERC1410.sol:178-296`); the coupon allowlist entry (`:331-343`) already names "an address that received units by transfer" | Add only if the operator defers the transfer eligibility rule proposed in `docs/plans/bond-coupon-maturity-correctness/`; otherwise that plan's own docs update covers it. Link the archived ERC-3643 incremental plan, which already analyses the gap |
| ~~Full pre-maturity buyback shows as `staged`~~ | **Dropped as a known issue**: since #278 such a bond stays `outstanding` while periods remain. The stale text is in the diagram and is fixed under D6 | — |

### D8 — NatSpec "Git Source" links

- **Verified.** All 32 contract pages under `contracts/docs/natspec/src/src/` link to
  `…/blob/e1ad13913c07…/src/<file>.sol`. Two faults: the path omits the `contracts/` prefix
  (`forge doc` runs with `contracts/` as project root), and `e1ad139` is a local pre-squash commit
  that is on no branch (`git branch -a --contains` is empty; it was squash-merged as `a35d5af`,
  #231), so GitHub cannot serve it.
- **Verified.** `check-markdown-links.py` ignores `http(s)` links (`IGNORED_PREFIXES`), which is
  why the 404s went unnoticed.
- **Verified (scratch run, 2026-09-28).** `forge doc` with a `[doc] path` value in `foundry.toml`
  still emitted `blob/<ref>/src/…`; Foundry has no setting that adds the subdirectory prefix.
- **Verified (scratch run).** Regenerating from current source and running `fix-links.py`
  differs from the committed tree only in the Git Source lines plus three pages:
  `src/README.md` (homepage copy of `contracts/README.md`, still saying "redemption flow"),
  `BondManager.md` (internal helpers and structs missing), and `IBondManager.md` (whitespace).
  The homepage's relative links are hand-fixed in the committed copy; `fix-links.py` does not
  rewrite them.
- Target: extend `contracts/docs/natspec/fix-links.py` to rewrite Git Source URLs into
  repository-relative links to `contracts/src/…` (checked by the link checker, correct at every
  commit, no branch assumption), and to rewrite the homepage's relative links. Then regenerate
  once and update the natspec `README.md` note that says links embed the commit hash.

### D9 — License inventory and entrypoints

| Location | Drift | Evidence | Correction |
|---|---|---|---|
| `THIRD_PARTY_LICENSES.md:29` | Snapshot "as of September 4, 2026" | Rows changed in #283, #291, #292 (last 2026-09-25) | Date of the slice's merge |
| `THIRD_PARTY_LICENSES.md:165` | Blockscout application "Pulled at deploy time" | `docs/KNOWN_ISSUES.md:243-266`; `./sandbox.sh build-images` source-builds backend and frontend | "Built locally from pinned upstream source tags (`./sandbox.sh build-images`); upstream no longer publishes release images" |
| Deployment-Time table | No `nginxinc/nginx-unprivileged` row | `common/images.yaml:55`; `services/nb-ui/Dockerfile:19`; listed in `docs/THIRD_PARTY_NOTES.md:47` | Add row: BSD-2-Clause, NB UI runtime stage. Also widen the Node.js row to "NB Bond API image and NB UI build stage" |
| `README.md:48-52` "AI Ready" list | Omits `services/nb-ui/AGENTS.md` | file exists | Add it |
| `CONTRIBUTING.md` | No NB UI checks; no repository checks | CI `nb-ui.yml` runs root `npm ci` then `format:check`, `lint`, `test`, `build` with `-w nb-ui`; `publication-hygiene.yml`, `license-inventory.yml` | Add an NB UI block and a "Repository checks" block mirroring CI. The existing NB Bond API block runs `npm ci` inside the package while CI installs once at the workspace root; aligning it with CI is recommended (**Needs verification** whether the in-package form still works) |
| `docs/DOCUMENTATION_INDEX.md:19` | ADR 0001 entry does not say superseded | ADR 0001 status line; `docs/decisions/README.md:33` | Append "Superseded by ADR 0003." |

`check-third-party-licenses.py` passes today because it checks manifests, not image pins; the
missing image row is manual drift.

### Frozen-record status lines (report only)

- `docs/plans/archive/blockscout-catchup-indexer/progress.md:5-6,15` and
  `docs/plans/archive/sandbox-stop-keeps-state/progress.md:5,18` still say the final PR phase is
  "In progress" while their `plan.md` status says Implemented. Recommendation: with operator
  approval, change only the `Current phase` and `Next action` header lines to
  "Complete — #294 merged" / "Complete — #293 merged" and "None", matching
  `archive/coupon-closure-review-fixes/progress.md`; leave the phase-log rows.
- 10 archived plans contain cloud wording and 13 name local tooling. They are frozen; the
  operator decides whether that history is accepted as is.

## Invariants

- Only documentation, comments, one generated OpenAPI file, generated NatSpec pages, and the
  NatSpec post-processing script change. No runtime behaviour, route, schema shape, or contract
  changes.
- ADR bodies, archived plan bodies, and post-mortems are not edited.
- Accepted `entra` surfaces keep their wording.
- Every new or edited relative link resolves; no new links into ADRs.

## Alternatives Considered

- **Link NatSpec sources to `blob/main/contracts/src/…` or `blob/development/…`** — resolves on
  GitHub but lags or leads the page it sits on, and the link checker ignores it. Rejected for
  relative links.
- **Hand-patch the 32 Git Source lines once** — fixes today, breaks on the next `forge doc`.
  Rejected.
- **Refresh the closed-loop plan now** — needs design decisions on four legs and two payers with
  no schedule behind them. Rejected for park-with-drift-note.
- **Edit ADR `Plan:` lines** — ADRs are frozen. Rejected for the plans README convention.
- **One large docs PR** — mixes a hard-rule fix with routine accuracy work and invites merge
  conflicts with the other plans. Rejected for five slices.

## Decisions

| Decision | Recommendation | Rationale | Operator action required |
|---|---|---|---|
| Closed-loop plan | Park with drift note, keep Proposed | Refresh is design work nobody scheduled | Confirm |
| Wallet and entity-directory plans | Fix branch lines; keep or park | No implementation since 2026-07-15 | Decide keep / park |
| Transfer eligibility known issue | Add only if the bond coupon and maturity plan defers its eligibility rule | Avoid an entry that one PR later becomes wrong | Decide with that plan |
| NatSpec links | Relative links rewritten by `fix-links.py`, one regeneration PR | Durable, checked by CI | None |
| Archived progress headers | Update the two header lines | Status-line-only change allowed | Explicit approval (frozen records) |
| `docs/AZURE_BOUNDARY.md` title | Leave as existing text | Rule accepts existing text | Operator may decide otherwise |
| Entra mentions in `docs/` outside the service folders | Accept as auth-mode descriptions | They describe the public `entra` surface | Confirm the interpretation |
| Frozen records with cloud wording or tooling names | Leave | Frozen-record rule | Confirm |

## Cross-Plan Boundaries

| Other plan (folder under `docs/plans/`) | Overlap | Rule |
|---|---|---|
| `nb-bond-api-hardening` | May edit `src/env-vars.ts`, `src/auth.ts`, `src/contracts/*.ts` and regenerate `openapi.json` | Whichever lands second rebases and reruns `regen:openapi`; slice 1 is small and should land first |
| `nb-ui-correctness-and-hardening` | Owns nb-ui `AGENTS.md`/`DEVELOPMENT.md`/`config.js` doc fixes | Slice 1 touches only the cloud-wording lines in nb-ui (`DEVELOPMENT.md:107,247-250`, `debugSettings.js:18`, `entraAuth.js:2`); everything else in nb-ui docs is theirs |
| `bond-coupon-maturity-correctness` | Contract changes regenerate NatSpec pages; may add a transfer eligibility rule; edits `docs/KNOWN_ISSUES.md` and contract docs | Land slice 4's `fix-links.py` change before or with that plan's NatSpec regeneration; transfer-eligibility entry decided jointly |
| `ingestion-projection-correctness` | May change `bondStatus` | If it lands first, the bond-lifecycle diagram fix follows its classifier, not the one quoted here |
| `sandbox-scripts-and-ci-hardening` | Owns README, Makefile, and script-comment fixes tied to its script changes; may touch `sandbox.sh start` | If it changes the start order, it updates `sandbox-startup-flow.md` itself; slice 3 adds only the resume step that exists today |

## Residual Risks

- The cloud-term self-check is manual; a future edit can reintroduce wording. A committed check
  would be a new CI surface and needs operator approval (listed as a follow-up).
- Deployment-time image rows remain hand-maintained for the same reason.
