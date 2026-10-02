# Documentation refresh — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `docs/` (index, known issues, architecture, diagrams, plans tree), `services/AGENTS.md`, `services/DEVELOPMENT.md`, `services/nb-bond-api/{README,DEVELOPMENT}.md`, `services/nb-bond-api/helm/values.local.example.yaml`, `services/nb-bond-api/src/{env-vars,auth}.ts`, `services/nb-bond-api/src/contracts/{bonds,auctions}.ts`, `services/nb-bond-api/openapi.json` (generated), cloud-wording lines in `services/nb-ui/`, `contracts/docs/contracts-security.md`, `contracts/docs/natspec/` (script and generated pages), `THIRD_PARTY_LICENSES.md`, `README.md`, `CONTRIBUTING.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline: rerun the searches, record counts                    -> no PR
Phase 1  Cloud wording + local tooling names (+ openapi.json regen)      -> PR 1
Phase 2  Plan housekeeping: archive, README convention, park, branches   -> PR 2
Phase 3  Removed behaviour, diagrams, known issues                       -> PR 3
Phase 4  NatSpec source links: script fix + one regeneration             -> PR 4
Phase 5  License inventory, README, CONTRIBUTING, ADR 0001 index entry   -> PR 5
```

Phase 1 goes first because it fixes a hard publication rule. Phase 2 depends on Phase 1 (the
ERC-3643 plan must lose its tooling names before archiving freezes it). Phases 3–5 are
independent of each other; each touches `docs/DOCUMENTATION_INDEX.md` on different lines, so
merge them one at a time and rebase the next on `development`.

## Phase 0: Baseline

### Goal

Confirm every finding in `design.md` still holds on the current `development` before editing.

### Steps

1. `git switch development && git pull --ff-only`.
2. Run the operator's cloud-term self-check over tracked files; classify every hit with the
   table in `design.md` §D1. Record counts per class in `progress.md`, never quoted matches.
3. `git grep -n` for the local tooling names outside `docs/plans/archive/` and `docs/decisions/`
   (the names themselves stay out of committed text).
4. `git grep -n -E "reopenAuction|withdrawFailedIssuance|bens-microservice\.sh|/holders|443 and 8546|openapi-v2-plan\.md\]"`
   outside frozen records.
5. `grep -c "Git Source" -r contracts/docs/natspec/src` and one sample link.
6. `python3 scripts/verification/check-third-party-licenses.py`,
   `python3 scripts/verification/check-public-repo-hygiene.py`,
   `python3 scripts/verification/check-markdown-links.py` (all should pass today).
7. Check which of the other 2026-09-28 plans have merged (see `design.md` "Cross-Plan
   Boundaries") and drop or adjust any item they already fixed.

### Verification Stop

- Every design row is either confirmed or marked as already fixed in `progress.md`.

### Exit Criteria

- [ ] Baseline counts recorded in `progress.md`.

## Phase 1: Cloud wording and local tooling names (PR 1)

### Goal

No active committed file names the cloud platform, its managed Kubernetes service, the GitOps
controller, the IaC tool, or local agent tooling, outside the accepted surfaces.

### Scope

Every "To fix" row of `design.md` §D1 and every active row of §D2.

### Steps

1. Docs: `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md:18,227`,
   `services/nb-bond-api/DEVELOPMENT.md:507,521-524`, `services/nb-bond-api/README.md:147`,
   `services/nb-ui/DEVELOPMENT.md:107,247-250`, `docs/DOCUMENTATION_INDEX.md:16,62`,
   `docs/KNOWN_ISSUES.md:97` — apply the replacement direction from the design table.
2. Values example: `services/nb-bond-api/helm/values.local.example.yaml:75`.
   `scripts/generate-local-sandbox-fixtures.mjs` reads the example as its template, so an
   existing local `values.local.yaml` keeps the old comment until it is regenerated. That file
   is gitignored and the comment has no runtime effect, so no regeneration is required.
3. Source comments and strings: `services/nb-bond-api/src/env-vars.ts:71,120`,
   `src/auth.ts:10`, `src/contracts/bonds.ts:162`, `src/contracts/auctions.ts:206`,
   `services/nb-ui/src/utils/debugSettings.js:18`, `services/nb-ui/src/auth/entraAuth.js:2`.
   Keep the two `testMode` descriptions identical to each other.
4. Regenerate the OpenAPI snapshot from the repository root:
   `npm run regen:openapi -w nb-bond-api`.
5. Tooling names: `docs/KNOWN_ISSUES.md:212`;
   `docs/plans/erc-3643-incremental-adoption-plan.md:7,380,411` (point at `docs/plans/README.md`
   and `CONTRIBUTING.md` instead).
6. Package gates, mirroring CI from the repository root: `npm ci`;
   `npm run lint -w nb-bond-api`, `npm run format:check -w nb-bond-api`, `npm test -w nb-bond-api`;
   `npm run format:check -w nb-ui`, `npm run lint -w nb-ui`, `npm test -w nb-ui`,
   `npm run build -w nb-ui`.
7. Hygiene and link checks.

### Verification Stop

- The self-check returns only accepted classes; counts recorded in `progress.md`.
- `git diff --stat services/nb-bond-api/openapi.json` shows only the five `testMode`
  description lines changed.
- No test asserts the changed error text (`tests/env-vars.test.ts` matches variable names only).
- All gates green.

### Failure Diagnosis / Fix Forward / Rollback

- `openapi.json` shows unrelated changes: the snapshot was stale before this PR (another PR
  changed a schema without regenerating). Stop, report it, and land the regeneration separately
  or with the operator's agreement; do not hide it in this PR.
- Prettier fails on a rewrapped comment: run the package `format` script, re-run the gate.
- Revert is a plain `git revert`; no runtime effect.

### Exit Criteria

- [ ] Every D1 "To fix" row and D2 active row resolved.
- [ ] `openapi.json` regenerated with only the description change.
- [ ] Package gates, hygiene, and link checks pass.

## Phase 2: Plan housekeeping (PR 2)

### Goal

The active plan tree contains only live plans with correct metadata, and ADR plan pointers
resolve by convention.

### Steps

1. `git mv docs/plans/erc-3643-incremental-adoption-plan.md docs/plans/archive/`; append
   "archived <merge date>" to its `Status:` line. Move its index entry from the active list
   (`docs/DOCUMENTATION_INDEX.md:28`) into the archive list with the new path. Fix any other
   reference found by `git grep erc-3643-incremental-adoption-plan` outside ADRs.
2. `docs/plans/README.md`: add under "Conventions": "ADR plan pointers name the plan's original
   path; archived plans are found under `archive/` with the same name."
3. Closed-loop plan (edit in place, do not convert): status prefix "Proposed — parked
   <merge date>, not scheduled"; add a dated "Drift since authoring" block under the status
   lines with the five rows of `design.md` §D4 (evidence from the pre-reset chain; all four cash
   legs now use `transferFrom`, so Phase 1 and decision D2 need redesign; line references moved to
   `11_BondSetup.s.sol:51,61`; Phase 6 largely delivered by ADR 0004/0005; refresh before
   implementing). Leave the phase bodies unchanged. Update the index entry (`:25`) to say parked
   and predating ADR 0003–0005.
4. `docs/plans/sandbox-fmi-wallet-plan.md:5` → `feature/sandbox-fmi-wallet`;
   `docs/plans/sandbox-entity-directory-and-name-service-plan.md:5` →
   `feature/entity-directory-service`. If the operator chooses to park them, apply the D4 status
   phrasing and index note.
5. Only with explicit operator approval: update the `Current phase` / `Next action` header lines
   of `docs/plans/archive/blockscout-catchup-indexer/progress.md` and
   `docs/plans/archive/sandbox-stop-keeps-state/progress.md` (design §"Frozen-record status
   lines"). Nothing else in those files.

### Verification Stop

- `ls docs/plans` lists only `README.md`, `archive/`, and plans with status Proposed / Approved /
  In progress (plus the 2026-09-28 folders once committed).
- Link check passes (the archived plan's internal relative links still resolve from its new
  depth; fix any that do not before archiving, since the file freezes after the move).

### Failure Diagnosis / Fix Forward / Rollback

- A relative link inside the moved plan breaks: fix it in the same commit as the move (the edit
  is part of archiving, not a later change to a frozen record).

### Exit Criteria

- [ ] Superseded plan archived and indexed as archived.
- [ ] Convention line present.
- [ ] Closed-loop plan parked with drift note; branch lines fixed.

## Phase 3: Removed behaviour, diagrams, and known issues (PR 3)

### Goal

No active doc describes removed behaviour; the known-issues list has no resolved entries and
contains the follow-ups that were only recorded in an archived plan.

### Steps

1. Apply every row of `design.md` §D6 except the ones owned by the nb-ui plan.
2. `docs/diagrams/operations/sandbox-startup-flow.md`: add the resume node between
   `registry` and `infraQ`, and relabel the contracts node. Keep Mermaid valid (render the file in
   a Mermaid previewer or on the PR's rich diff).
3. `docs/diagrams/processes/bond-lifecycle.md`: match `bondStatus` in
   `services/nb-bond-api/src/projection/compose-projection.ts` at the time of the PR (re-read it;
   the ingestion plan may have changed it).
4. `docs/KNOWN_ISSUES.md`: apply §D7 — remove the resolved entry and reword the next entry's
   opening; generalise the sample version; replace the reopen entry with the short terminal-auction
   entry; add "Blockscout does not show BENS names" and "BENS returns 500 briefly on a fresh
   Blockscout namespace", each linking
   [`docs/plans/archive/blockscout-catchup-indexer/progress.md`](../archive/blockscout-catchup-indexer/progress.md)
   with the observed evidence and "Planned follow-up: investigate" wording; add the transfer
   eligibility entry only per the operator's decision.
5. Hygiene and link checks.

### Verification Stop

- The Phase 0 step 4 grep returns only frozen records and nb-ui files owned by the nb-ui plan.
- Mermaid blocks in the two edited diagrams render.

### Failure Diagnosis / Fix Forward / Rollback

- A diagram fails to render: fix the syntax in the same PR; do not merge a broken diagram.

### Exit Criteria

- [ ] All D6 and D7 rows resolved or explicitly deferred with a reason in `progress.md`.

## Phase 4: NatSpec source links (PR 4)

### Goal

Every "Git Source" link in the committed NatSpec pages resolves at the commit it is viewed at,
and stays that way after future regenerations.

### Steps

1. Extend `contracts/docs/natspec/fix-links.py`:
   - rewrite any link whose label is `Git Source` and whose target matches
     `https://github.com/<owner>/<repo>/blob/<ref>/src/<path>` to a path relative to the page,
     pointing at `contracts/src/<path>`;
   - rewrite the relative links in the generated homepage (`src/README.md`, a copy of
     `contracts/README.md`) so they resolve from `contracts/docs/natspec/src/`;
   - keep the script idempotent and standard-library only.
2. From `contracts/`: `forge doc --out docs/natspec` then `python3 docs/natspec/fix-links.py`.
3. Review the diff: expected are the 32 Git Source lines, the homepage refresh, and the
   `BondManager` / `IBondManager` pages. Anything else is Foundry-version churn — keep it only if
   it is content, otherwise note it in `progress.md`.
4. Update `contracts/docs/natspec/README.md`: remove the note that links embed the commit hash;
   say `fix-links.py` makes source links repository-relative.
5. Link check (it now validates the 32 source links), hygiene check.

### Verification Stop

- `check-markdown-links.py` passes and the count of checked links rose by about 32.
- `grep -r "blob/" contracts/docs/natspec/src` returns nothing.
- Running `fix-links.py` a second time reports zero changed files.

### Failure Diagnosis / Fix Forward / Rollback

- `forge doc` output differs widely because of a Foundry version change: stop, record the
  version in `progress.md`, and ask the operator whether to accept the churn or hand-apply the
  link rewrite to the existing pages (the script change is useful either way).
- If a contract-changing plan is in flight, land this PR first and let that plan regenerate with
  the fixed script, or rebase and regenerate after it merges.

### Exit Criteria

- [ ] Script fixed; pages regenerated; links resolve; README note updated.

## Phase 5: License inventory and entrypoints (PR 5)

### Steps

1. `THIRD_PARTY_LICENSES.md`: add the `nginxinc/nginx-unprivileged` row (BSD-2-Clause, NB UI
   runtime stage, pinned in `common/images.yaml` under `nb_ui.nginx`); widen the Node.js row;
   reword the Blockscout application row; set the snapshot date to the merge date.
2. `README.md` "AI Ready": add `services/nb-ui/AGENTS.md: NB UI operator frontend guidance`.
3. `CONTRIBUTING.md`: add an "NB UI" block and a "Repository checks" block
   (`check-public-repo-hygiene.py`, `check-markdown-links.py`, `check-third-party-licenses.py`)
   mirroring CI; align the NB Bond API block with the root-workspace install that CI uses.
4. `docs/DOCUMENTATION_INDEX.md:19`: append "Superseded by ADR 0003."
5. All three verification scripts.

### Verification Stop

- Each image in `common/images.yaml` and `common/node-version.env` maps to a Deployment-Time row
  or a `docs/THIRD_PARTY_NOTES.md` entry.
- License, hygiene, and link checks pass.

### Exit Criteria

- [ ] Inventory complete for pinned images; entrypoints list every area guide and CI check.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| API/Zod contract | Description-only change leaks into schema shape | `openapi.json` diff limited to five strings; `npm test -w nb-bond-api` |
| API startup | Changed error text breaks env validation | `tests/env-vars.test.ts` (asserts variable names) |
| UI | Comment-only change | nb-ui format, lint, test, build |
| Docs | Broken relative links, including new NatSpec source links | `check-markdown-links.py` |
| Docs | Leaked identifiers or key-shaped strings | `check-public-repo-hygiene.py`; manual cloud-term self-check |
| Docs | Inventory rows vs manifests | `check-third-party-licenses.py` |
| Diagrams | Mermaid syntax after edits | Rendered preview of the two edited diagrams |
| Script | `fix-links.py` idempotent and complete | Second run changes zero files; no `blob/` left |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 `feature/docs-neutral-deployment-wording` | Publication rules hold in active files | Self-check counts; five-string `openapi.json` diff; package gates | Frozen records left as reported |
| 2 `feature/docs-plan-tree-housekeeping` | Plan tree reflects reality | `ls docs/plans`; link check | Archived progress headers only with approval |
| 3 `feature/docs-removed-behaviour-and-known-issues` | Docs match shipped behaviour | Grep of removed names; rendered diagrams | Transfer-eligibility entry pending decision |
| 4 `feature/natspec-relative-source-links` | Durable, checked source links | Link check count; idempotent script | None |
| 5 `feature/docs-license-inventory-and-entrypoints` | Inventory and entrypoints complete | License check; row review | None |

Each slice is a `feature/<kebab>` PR against `development`; branch, commit, and PR conventions
follow `CONTRIBUTING.md`.

## Migration, Rebuild, and Rollout

- No data, schema, chain, or image effect. The only generated artifacts are `openapi.json`
  (slice 1) and the NatSpec pages (slice 4). No sandbox restart is needed.

## Documentation and Public-Repo Hygiene

- Index updates: slice 1 (`:16`, `:62`), slice 2 (`:25`, `:28`), slice 3 (`:101`), slice 5
  (`:19`). Entries for the plan folders written on 2026-09-28 are added by the operator's commit
  of those folders, not by this plan.
- Committed text in every slice: no vendor, tooling, or cloud-deployment names; the self-check
  runs before each push.

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
python3 scripts/verification/check-third-party-licenses.py
```

## Out of Scope

- Frozen-record bodies; the `docs/AZURE_BOUNDARY.md` title (operator question).
- nb-ui doc fixes other than cloud wording; README and script-comment fixes tied to script
  changes; any contract, API, or UI behaviour change.
- A committed cloud-term or image-inventory check (new CI surface; follow-up).

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] Deferred items (transfer eligibility entry, archived headers, plan parking) are decided and
      recorded.
- [ ] Hygiene, link, and license checks pass on `development` after the last slice.
- [ ] PR bodies contain no private environment information.
