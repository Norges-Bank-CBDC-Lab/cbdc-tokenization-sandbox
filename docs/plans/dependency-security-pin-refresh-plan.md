# Dependency Security Pin Refresh — Implementation Plan

**Status:** Proposed
**Created:** 2026-08-12
**Scope:** root `package.json` (`overrides` block), `package-lock.json`, patch release v0.7.1
**Builds on:** v0.7.0 release (PR #246); Dependabot rollups #243/#244; the override pin discipline established for `ws`/`undici`/`js-yaml`

## Decision Summary

Fix all 14 open Dependabot alerts in one lockfile operation: bump the four stale root `overrides` security pins (js-yaml `4.2.0 → 4.3.1`, undici `7.28.0 → 7.29.0`, brace-expansion `1.1.13 → 1.1.18` under `minimatch@3.1.5` and `5.0.6 → 5.0.9` under `minimatch@10.2.5`) and refresh three in-range transitives (ip-address `10.2.0 → ≥10.3.1`, body-parser `2.2.2 → ≥2.3.0`, glob-nested brace-expansion `2.1.0 → ≥2.1.2`) via a scratch full-resolve with a surgical transplant onto the pristine lockfile. npm does not reliably re-apply changed overrides to an existing lockfile, and incremental installs have been observed to silently *un-apply* existing overrides, so the transplant-and-verify procedure is mandatory, with a structural lockfile diff as the gate. Land as one PR to `development`, confirm the alerts resolve, then cut patch release v0.7.1 because two fixes are on the API's runtime path.

## Why This Change

GitHub reports 14 open Dependabot alerts, all against `package-lock.json`. Ten are held open by this repo's own `overrides` security floors: pins that once forced patched versions now hold versions below the currently patched ones. Four alerts are on the runtime path of `nb-bond-api`: the high-severity ip-address flaw sits directly under `express-rate-limit`, where IP misclassification (leading-zero octets, IPv4-mapped IPv6) is the kind of defect that can weaken rate-limit keying. The dev-scope alerts (undici via jsdom, js-yaml and brace-expansion via lint/test tooling) are parser/expansion DoS issues in local tooling — low practical exposure, but they dominate the alert count and are cleared by the same operation.

## Scope

### In Scope

- Root `overrides` values for js-yaml, undici, and both scoped brace-expansion pins.
- Lockfile entries for the seven affected package paths (all locations).
- Verification that no other lockfile entry changes.
- Patch release v0.7.1 after merge.

### Out of Scope

- The `ws: 8.21.0` override (no open advisory; untouched).
- js-yaml 5.x (a major line above what the advisory requires; staying on 4.x).
- Any workspace `dependencies`/`devDependencies` change — no direct dependency declares these packages.
- New packages of any kind (none required; approval rules not triggered).

## Current-State Evidence

All items **Verified** on 2026-08-12 against the repo at v0.7.0 and the GitHub alerts API unless labeled otherwise.

### Alert-to-pin mapping

| Alerts | Package | In lockfile now | Patched at | Held back by |
|---|---|---|---|---|
| #55, #74 (high) | js-yaml | 4.2.0 (hoisted, dev) | 4.3.1 | root override `js-yaml: 4.2.0` |
| #64–#68 (1 high, 4 med) | undici | 7.28.0 (hoisted, dev; via jsdom 29.1.1) | 7.29.0 | root override `undici: 7.28.0` |
| #56 (high) | brace-expansion 1.x | 1.1.13 ×3 paths | 1.1.16 | scoped override under `minimatch@3.1.5` |
| #53 (high) | brace-expansion 5.x | 5.0.6 (hoisted) | 5.0.7 | scoped override under `minimatch@10.2.5` |
| #71 (high) | brace-expansion 2.x | 2.1.0 (under `glob`) | 2.1.2 | nothing — plain transitive; minimatch declares `^2.0.2` |
| #61, #62 (med), #69 (high) | ip-address | 10.2.0 (**runtime**) | 10.3.1 | nothing — `express-rate-limit` declares `^10.2.0` |
| #54 (low) | body-parser | 2.2.2 (**runtime**) | 2.3.0 | nothing — `express@5.2.1` declares `^2.2.1` |

### Repository Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| Overrides are the single source for these pins; no workspace declares the packages directly | root `package.json` is the only manifest matching js-yaml/undici/brace-expansion | Fix is confined to the overrides block + lockfile |
| Incremental `npm install` un-applies overrides on this lockfile | observed during the #243 rollup: js-yaml drifted 4.2.0→4.3.1 and a nested un-overridden js-yaml 3.x subtree appeared without any related manifest change | A plain `npm install` after editing overrides is NOT trustworthy; transplant procedure required, structural diff as gate |
| Latest in-line versions | npm registry: undici 7.29.0 is newest 7.x; brace-expansion 1.1.18 / 5.0.9 newest in line; js-yaml 4.3.1 newest 4.x (5.2.3 exists, out of scope) | Targets double as both patched and current, minimizing re-touch |
| `THIRD_PARTY_LICENSES.md` tracks direct workspace dependencies only; none of the seven packages appear | inventory grep; `check-third-party-licenses.py` validates manifests | No inventory edit expected; checker run still required |
| Both workspace gates green at v0.7.0 | jest 230/230 (35 suites), vitest 119/119 (25 files), both builds | Clean baseline for detecting regressions from the refresh |

### Runtime Evidence

- **Verified:** `nb-bond-api` runtime chain `express-rate-limit@8.6.2 → ip-address@10.2.0` and `express@5.2.1 → body-parser@2.2.2` (from the lockfile and `npm ls`).
- **Needs verification (Phase 0):** whether the jest suite exercises rate-limit IP keying specifically; if not, the ip-address bump relies on the library's own semver contract plus the full API suite.

## Significant Findings

| Priority | Finding | Why it matters | Plan response |
|---|---|---|---|
| Important | Override floors go stale silently: pins set as security floors now hold vulnerable versions, and nothing in CI flags this | The same failure mode will recur on the next advisory wave | Record a maintenance note in `docs/KNOWN_ISSUES.md` (Phase 3): treat every Dependabot alert on an overridden package as an override-bump task, never a plain `npm update` |
| Important | Incremental npm installs can silently un-apply overrides | A future well-meaning `npm install` can reintroduce vulnerable or unpinned versions without any manifest change | Structural lockfile diff (parse both lockfiles, compare entry sets) is the verification gate in this plan and the recorded procedure for future bumps |

## Invariants

- The `ws: 8.21.0` override and every direct workspace dependency remain byte-identical.
- After the operation, every lockfile path resolving js-yaml, undici, or brace-expansion holds a version at or above the patched version for its line.
- The structural lockfile diff contains exactly the intended package paths — nothing else.
- Frozen records (`docs/decisions/`, `docs/plans/archive/`) are untouched.

## Decisions

| Decision | Recommendation | Rationale | Operator action required |
|---|---|---|---|
| js-yaml target | 4.3.1, not 5.x | Advisory patched at 4.3.1; a major jump is out of scope for a security refresh | None |
| brace-expansion targets | 1.1.18 and 5.0.9 (latest in line) rather than first-patched 1.1.16/5.0.7 | Same effort, fewer future re-touches; both within the override scopes | None |
| One PR, not two | Single lockfile surgery covering overrides + in-range refreshes | The transplant already produces all target entries from one full-resolve; splitting doubles the risky operation | None |
| Patch release v0.7.1 after merge | Yes | ip-address (high) and body-parser sit in the deployed API image; dev-only alerts alone would not justify a release | Approval to cut the release |

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| All 14 alerts show resolved on the default branch after merge | The visible problem | `gh api .../dependabot/alerts?state=open` returns none for these packages |
| Structural lockfile diff = exactly the intended entries | Silent override un-application / collateral churn (observed failure mode) | Parsed-lockfile comparison script output in PR evidence |
| `npm ci` clean from the committed lockfile | Lockfile/manifest inconsistency from hand-transplant | Fresh install log |
| jest and vitest suites green at baseline counts; both builds green | Behavior change from ip-address parsing fixes or undici/jsdom changes | Gate output |
| License inventory checker passes with no inventory edit | Accidental inventory drift | Checker output |
| v0.7.1: `main` and `development` at the same SHA, tag + release published | Release hygiene, deployability of the runtime fixes | Branch SHAs, release URL |

## Plan Order

```text
Phase 0  Baseline capture and rate-limit test reconnaissance
Phase 1  Override bump + lockfile transplant + structural verification
Phase 2  Cross-layer proof (gates, hygiene, license checker)
Phase 3  PR to development, alert resolution confirmation, KNOWN_ISSUES note
Phase 4  Patch release v0.7.1 and rollout note
```

## Phase 0: Baseline

### Goal

Freeze the before-state so every later claim is checkable.

### Steps

1. Snapshot the open-alert list (numbers, packages, ranges) and the pristine lockfile.
2. Confirm both workspace gates are green at HEAD (jest 230/230, vitest 119/119, builds).
3. Locate rate-limit coverage in `services/nb-bond-api/tests/` (`rg -l 'rate.?limit'`); note whether IP keying is exercised.

### Exit Criteria

- [ ] Alert snapshot and pristine lockfile stored outside the tree (not committed).
- [ ] Gates green on unmodified HEAD.

## Phase 1: Pin refresh via full-resolve transplant

### Goal

Produce a lockfile where all seven target packages are at patched versions and nothing else changed.

### Steps

1. Edit root `package.json` overrides: `js-yaml: "4.3.1"`, `undici: "7.29.0"`, `minimatch@3.1.5 → brace-expansion: "1.1.18"`, `minimatch@10.2.5 → brace-expansion: "5.0.9"`.
2. In a scratch directory, copy the root and workspace manifests, delete the lockfile copy, and run `npm install --package-lock-only` for a clean full resolve (overrides apply correctly on full resolve).
3. Transplant from the scratch lockfile onto the pristine lockfile only the entries for: every js-yaml, undici, and brace-expansion path; `node_modules/ip-address`; `node_modules/body-parser`; plus any sub-entries those bring (e.g. removed nested duplicates). Keep every other entry byte-identical.
4. Run the structural diff (parse both lockfiles, list ADDED/REMOVED/CHANGED paths). The set must match the transplant list exactly.
5. `npm ci` from the result; then assert resolved versions: js-yaml 4.3.1 at every path, undici 7.29.0, brace-expansion ≥1.1.16 / ≥2.1.2 / ≥5.0.7 per line, ip-address ≥10.3.1, body-parser ≥2.3.0 (`npm ls <pkg>` per package).

### Failure Diagnosis / Fix Forward / Rollback

- Structural diff shows unexpected entries → discard the candidate lockfile, restore pristine, re-transplant; never hand-edit around a surprise entry without understanding which resolve produced it.
- `npm ci` fails on sync errors → the transplant missed a dependent entry; diff the scratch lockfile for adjacent paths of the failing package.
- Rollback at any point: `git checkout -- package.json package-lock.json`.

### Exit Criteria

- [ ] Structural diff = intended set exactly.
- [ ] Clean `npm ci`; all seven packages at target versions at every lockfile path.

## Phase 2: Cross-layer proof

### Steps

1. `services/nb-bond-api`: lint, format:check, test, build. Attend to rate-limit tests: ip-address 10.3.x *fixes* address parsing, so any test relying on lenient leading-zero behavior fails here and must be judged (library fix vs. product regression).
2. `services/nb-ui`: format:check, lint, test, build (vitest runs jsdom on undici 7.29.0).
3. `python3 scripts/verification/check-third-party-licenses.py` (expect: no inventory change), plus the hygiene and markdown-link checks.

### Exit Criteria

- [ ] All gates green at baseline counts; checker confirms no inventory edit needed.

## Phase 3: PR, alert confirmation, maintenance note

### Steps

1. Add a short `docs/KNOWN_ISSUES.md` entry: override pins are security floors that go stale; on any Dependabot alert against an overridden package, bump the override via the full-resolve transplant procedure (plain incremental installs can silently un-apply overrides).
2. One PR to `development` containing the overrides edit, the lockfile, and the docs note, with the structural-diff output quoted in the PR body. Branch/commit/CI conventions per the repository PR workflow.
3. After merge, confirm on the default branch that all 14 alerts left the open state.

### Exit Criteria

- [ ] PR merged with all checks green.
- [ ] Zero open alerts for the seven packages.

## Phase 4: Patch release v0.7.1

### Steps

1. Promotion PR `development → main` titled `Release v0.7.1`, noting the runtime fixes (rate-limiter IP parsing, body-parser) and that dev-tooling alerts are cleared.
2. Merge (reviewer approval per branch ruleset), annotated tag `v0.7.1`, GitHub Release, fast-forward `development` to the merge commit.
3. Rollout note in the release body: environments consuming released images rebuild the API image to pick up the runtime fixes; no schema, chain, or configuration change in this release.

### Exit Criteria

- [ ] Tag and release published; `main` == `development` SHA.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Runtime API | Rate-limit keying with corrected IP parsing | jest suite incl. any rate-limit tests; judgment call on parsing-behavior deltas |
| Runtime API | Request-body handling via body-parser 2.3.x | jest route tests |
| Dev tooling | jsdom fetch stack on undici 7.29.0 | vitest full run |
| Lockfile integrity | Exactly-intended churn; override application | structural diff + `npm ci` + per-package `npm ls` |
| Public repo | Hygiene, links, license inventory | three verification scripts |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 | All 14 alerts remediated; overrides current; maintenance note recorded | structural diff + gates + alert state | none |
| 2 | v0.7.1 promotion | release checklist per repository convention | none |

## Migration, Rebuild, and Rollout

- Data/schema version effect: none.
- Local rebuild/restart path: none required; `npm ci` refreshes installs.
- Deployed note: the API runtime image must be rebuilt from v0.7.1 in the separate deployment repository to carry the ip-address/body-parser fixes; no other component changes.
- Rollback boundary: revert the single PR; the release is additive.

## Out of Scope

- js-yaml 5.x migration; ws override bump; any direct-dependency changes; Blockscout/Besu image concerns (handled in v0.7.0).

## Residual Risks

- The override pins will go stale again; mitigated by the KNOWN_ISSUES maintenance note, not eliminated.
- ip-address 10.3.x tightens parsing of malformed addresses; behavior behind the rate limiter changes for garbage inputs (that is the point of the fix, but it is a behavior change).
- Dependabot may take one scan cycle after merge to reflect resolved state; do not diagnose until the default-branch scan has run.

## Done Criteria

- [ ] Every acceptance criterion has evidence.
- [ ] Relevant tests and public-repo checks pass.
- [ ] Documentation matches the implemented behavior.
- [ ] PR evidence contains no private environment information.
