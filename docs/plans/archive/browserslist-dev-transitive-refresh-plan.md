# Browserslist Dev-Transitive Refresh — Implementation Plan

**Status:** Implemented — shipped via #263
**Created:** 2026-09-04
**Scope:** `package-lock.json` only (six development-scoped transitive entries under `nb-bond-api`'s Babel toolchain)
**Builds on:** Dependabot rollup #262; the override and lockfile-transplant discipline recorded in `docs/KNOWN_ISSUES.md` and `dependency-security-pin-refresh-plan.md` in this directory

## Decision Summary

Clear Dependabot alert #76 (GHSA-73wf-gq98-2v4g, `browserslist` `<= 4.28.6`, uncaught crash / prototype write in `normalizeStats` from an untrusted `browserslist-stats.json`) with an in-range, lockfile-only refresh of `browserslist` `4.28.2 → 4.28.8` (the current 4.28.x patch; the advisory requires `>= 4.28.7`). No manifest changes: every declared range already admits the patched version, so no `overrides` entry, no `THIRD_PARTY_LICENSES.md` row, and no new dependency. Because the patched line raises the minimum of five sibling packages, those move with it (`caniuse-lite`, `node-releases`, `electron-to-chromium`, `baseline-browser-mapping`, and `update-browserslist-db`, which 4.28.8 requires at `^1.3.0`). Produce the lockfile with an incremental lockfile-only update, then gate it with the structural lockfile diff and an override audit at every lockfile path, as recorded for previous refreshes. Land as one PR to `development`; no release is needed because nothing on a runtime path changes.

## Why This Change

GitHub opened alert #76 on the default branch right after #262 merged. The vulnerable package is only reachable through `@babel/core` / `@babel/preset-env`, which `nb-bond-api` uses to transpile its jest suite, so the exposure is local and CI tooling rather than the API runtime. The alert still holds the repository's alert count above zero and the fix is a version already permitted by every dependent's range, so the cost of clearing it now is a six-entry lockfile diff.

## Scope

### In Scope

- `package-lock.json`: `node_modules/browserslist` `4.28.2 → 4.28.8` and the five sibling packages it now requires.
- Structural-diff and override-audit evidence in the PR body.
- Archiving this plan in the same PR once implemented.

### Out of Scope

- Any `package.json` change. `browserslist` is not a direct dependency of any workspace.
- Babel majors (deferred separately in `docs/KNOWN_ISSUES.md`).
- A release or image rebuild.

## Current-State Evidence

### Repository Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| Verified: `browserslist` is `4.28.2`, development scope, single hoisted path | `package-lock.json` entry `node_modules/browserslist` (`"dev": true`) | One entry to change; no nested copies to chase |
| Verified: only dependents are `@babel/helper-compilation-targets` (via `@babel/core` 7.29.7) and `core-js-compat` (via `@babel/preset-env` 7.29.5), both under `nb-bond-api` devDependencies | `npm ls browserslist` | No runtime path; `nb-ui` does not pull it |
| Verified: every declared range on `browserslist` in the lockfile admits 4.28.7 (`^4.24.0`, `^4.28.1`, `>= 4.21.0`) | `package-lock.json` dependency ranges | No override is needed; this is an in-range refresh |
| Verified: 4.28.7 requires `caniuse-lite ^1.0.30001806`, `node-releases ^2.0.51`, `electron-to-chromium ^1.5.393`, `baseline-browser-mapping ^2.10.44`; 4.28.8 (current patch) additionally requires `update-browserslist-db ^1.3.0`; the lockfile holds `1.0.30001793`, `2.0.44`, `1.5.360`, `2.10.31`, `1.2.3` | registry metadata for `browserslist@4.28.2` / `@4.28.7` / `@4.28.8` vs lockfile entries | Five sibling packages must move in the same change or `npm ci` reports an invalid tree |
| Verified: the patched line (`4.28.7`, `4.28.8`) is published under MIT, same as the current entry | registry metadata | No license inventory impact |
| Verified: the root `overrides` block pins `ws 8.21.0`, `undici 8.10.1`, `js-yaml 4.3.1`, `qs 6.16.0` and two scoped `brace-expansion` pins | root `package.json` after #262 | The override audit must show these unchanged at every lockfile path |
| Verified: incremental lockfile-only installs have un-applied overrides before | `docs/KNOWN_ISSUES.md`, first section; observed again during #262 | The structural diff is the gate, not the install command |

### Runtime Evidence

- Not applicable. Nothing here touches the Kind cluster, Helm values, Besu, or a served image.

### Existing Test Coverage and Gaps

- The `nb-bond-api` jest suite (244 tests) runs through Babel and therefore exercises `browserslist` on every test run; that is the behavioral proof.
- No test reads a `browserslist-stats.json`; the vulnerable code path is not exercised by the repository, which is why the exposure is limited to tooling.

## Significant Findings

| Priority | Finding | Why it matters | Plan response |
|---|---|---|---|
| Important | The patched `browserslist` is not a one-entry change: it lifts five sibling packages | A naive single-entry edit leaves the lockfile internally inconsistent and `npm ci` fails | Move the six entries together and prove it with `npm ci` |
| Follow-up | Dependabot alerts on development-only transitives keep recurring with every data-package advisory | Each one costs a lockfile PR | None here; the recorded procedure keeps the cost to minutes |

## Invariants

- Every root `overrides` pin resolves to exactly the pinned version at every lockfile path after the change.
- `package.json` files are byte-identical before and after.
- The structural lockfile diff contains only `browserslist` and the five sibling packages it requires.
- `npm ci` completes without an out-of-sync or invalid-tree error.

## Target Architecture

Not applicable beyond the dependency graph: the change is a version refresh of leaf data packages in the development toolchain. No ownership, contract, or consistency boundary moves.

### Security and Deployment Boundary

- No secret, route, image, or configuration is involved.
- Nothing in the API or UI runtime image changes, so no rebuild or non-local rollout is needed.

## Decisions

| Decision | Recommendation | Rationale | Operator action required |
|---|---|---|---|
| Fix mechanism | In-range lockfile refresh to the current 4.28.x patch, no `overrides` entry | Every dependent range admits the patched line; an override would only add a floor to maintain | None |
| Sibling packages | Move the five sibling packages with `browserslist` | 4.28.8 requires them; four are data tables and `update-browserslist-db` is a CLI helper with no API surface in this repo | None |
| Lockfile production | Incremental lockfile-only `npm update` targeted at the packages, then structural diff + override audit; fall back to a scratch full resolve with transplant only if the diff shows drift | No override changes this time, so the incremental route is expected to be exact; the gate catches the known drift failure mode either way | None |
| Release | None | Development-scoped only | None |

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural diff lists exactly six `CHANGED` entries and nothing else | Silent override un-application or collateral churn | Parsed-lockfile diff output quoted in the PR |
| Override audit shows `ws`, `undici`, `js-yaml`, `qs`, `brace-expansion` unchanged at every path | Regression of previously cleared alerts | Audit output quoted in the PR |
| `npm ci` clean and `npm ls browserslist` shows 4.28.8 with no `invalid` | Internally inconsistent lockfile | Install log |
| `nb-bond-api` and `nb-ui` gates green at baseline counts | Toolchain regression from data-package bumps | jest 244, vitest 121, both builds |
| Alert #76 leaves the open state on `development` after merge | The change did not actually satisfy the advisory range | GitHub alert state after the default-branch scan |

## Plan Order

```text
Phase 0  Baseline
Phase 1  Lockfile refresh with structural gate
Phase 2  Cross-layer proof and PR
```

## Phase 0: Baseline

### Steps

1. Confirm `development` is at or after #262 and the current versions match the evidence table.
2. Keep a copy of the pristine lockfile outside the tree for the structural diff.

### Exit Criteria

- [x] Pristine lockfile captured; versions match the table.

## Phase 1: Lockfile refresh with structural gate

### Steps

1. From a clean checkout of `development`, run a lockfile-only incremental update targeted at `browserslist`, `caniuse-lite`, `node-releases`, `electron-to-chromium`, `baseline-browser-mapping` (npm pulls `update-browserslist-db` with them because 4.28.8 requires `^1.3.0`).
2. Run the structural diff (parse both lockfiles; list ADDED / REMOVED / CHANGED paths) and the override audit.
3. If the diff shows anything beyond the six entries, discard the candidate, produce a scratch full resolve, and transplant only the six entries onto the pristine lockfile.
4. `npm ci` from the candidate; `npm ls browserslist` shows 4.28.8 at every path with no `invalid`.

### Failure Diagnosis / Fix Forward / Rollback

- Unexpected entries in the diff: the incremental install re-resolved something else; use the transplant route.
- `npm ci` reports an invalid tree: a sibling range was missed; compare the candidate's `node_modules/browserslist` dependencies against the entries present.
- Rollback: `git checkout -- package-lock.json`.

### Exit Criteria

- [x] Structural diff = exactly the six entries.
- [x] Override audit unchanged.
- [x] Clean `npm ci`.

## Phase 2: Cross-layer proof and PR

### Steps

1. `services/nb-bond-api`: lint, format:check, test, build.
2. `services/nb-ui`: format:check, lint, test, build (lockfile changes trigger both workflows).
3. Hygiene, markdown-link, license-inventory, and node-version checks.
4. Move this plan to `docs/plans/archive/` with the implementing PR recorded, update `docs/DOCUMENTATION_INDEX.md`, and open one PR to `development` quoting the diff and audit output.
5. After merge, confirm alert #76 closes on the default-branch scan.

### Exit Criteria

- [x] All gates green at baseline counts.
- [ ] PR merged; alert #76 closed (confirmed after the default-branch scan).

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Lockfile integrity | Exactly-intended churn; overrides intact | structural diff + override audit + `npm ci` |
| Dev toolchain (`nb-bond-api`) | Babel target resolution with refreshed data tables | jest suite via `npm test` |
| Dev toolchain (`nb-ui`) | Vite/vitest unaffected by hoisted data packages | vitest + build |
| Public repo | Hygiene, links, inventory, node pin | the four verification scripts |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 | Alert #76 cleared; lockfile consistent; plan archived | diff + audit + gates | none |

## Migration, Rebuild, and Rollout

- Data/schema version effect: none.
- Local rebuild/restart path: none; `npm ci` refreshes installs.
- Compatibility window: none.
- Rollback or fix-forward boundary: revert the single PR.

## Documentation and Public-Repo Hygiene

- Docs and indexes to update: archive this plan; one line in `docs/DOCUMENTATION_INDEX.md`.
- Architecture/known-issue updates: none.
- Third-party/license inventory impact: none (transitive, same license).

Verification:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
python3 scripts/verification/check-third-party-licenses.py
```

## Residual Risks

- Data-package advisories will recur; the recorded procedure keeps each one to a short lockfile PR.
- Dependabot may take one scan cycle after merge to reflect the resolved state.

## Done Criteria

- [x] Every acceptance criterion has evidence.
- [x] Relevant tests and public-repo checks pass.
- [x] Documentation matches the implemented behavior.
- [x] PR evidence contains no private environment information.

## Implementation Evidence (2026-09-04, #263)

Structural diff of `package-lock.json` against the pristine `development` lockfile:

```text
CHANGED node_modules/baseline-browser-mapping 2.10.31 -> 2.11.21
CHANGED node_modules/browserslist 4.28.2 -> 4.28.8
CHANGED node_modules/caniuse-lite 1.0.30001793 -> 1.0.30001810
CHANGED node_modules/electron-to-chromium 1.5.360 -> 1.5.422
CHANGED node_modules/node-releases 2.0.44 -> 2.0.54
CHANGED node_modules/update-browserslist-db 1.2.3 -> 1.3.2
-- 0 added, 0 removed, 6 changed
```

Override audit at every lockfile path: `ws` 8.21.0, `undici` 8.10.1, `js-yaml` 4.3.1, `qs` 6.16.0, scoped `brace-expansion` 1.1.18 / 5.0.9 / 2.1.4, all unchanged. `npm ci` clean; jest 244/244, vitest 121/121, both builds green; inventory, hygiene, link and node-version checks pass.
