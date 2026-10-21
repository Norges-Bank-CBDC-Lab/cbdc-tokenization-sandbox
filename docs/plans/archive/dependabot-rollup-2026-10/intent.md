# Dependabot and security rollup (October 2026) — Intent

**Status:** Approved (2026-10-21)
**Created:** 2026-10-21
**Requested by:** sandbox operator

## Outcome

The five open Dependabot pull requests and every open Dependabot security alert are cleared by
one reviewable rollup that also carries the inventory rows Dependabot cannot write. After merge
the alert list is empty and Dependabot closes #295–#299 as satisfied, without retargeting them.

## Why This Change

Dependabot opened #295–#299 on 2026-09-27. All five fail `validate-inventory`, because
`THIRD_PARTY_LICENSES.md` must list each direct dependency at its exact lockfile version.
#298 also fails the nb-ui suite: it bumps `react` without `react-dom`, and React refuses to run
with mismatched versions. Since then, 18 Dependabot alerts (10 advisories) have opened against the
lockfile, and `npm audit` reports three more advisories against the `brace-expansion` 5.x copy
pinned by a root override. GitHub has not raised alerts for those three yet.

| Source | Package | From | To | Where |
|---|---|---|---|---|
| #295 | `express-rate-limit` | 8.6.2 | 8.7.1 (PR: 8.7.0) | nb-bond-api, runtime |
| #296 | `jose` | 6.2.8 | 6.2.13 (PR: 6.2.12) | nb-bond-api, runtime |
| #297 | `globals` | 17.7.0 | 17.13.0 (PR: 17.12.0) | both workspaces, dev |
| #298 | `react` + `react-dom` | 19.2.8 | 19.3.1 (PR: react 19.3.0 only) | nb-ui, runtime (bundled) |
| #299 | `prettier` | 3.9.6 | 3.9.10 (PR: 3.9.9) | both workspaces, dev |
| Alerts 101–106 | `vite` | 8.2.1 | 8.2.4 | nb-ui, dev server |
| Alerts 84–93 | `undici` (root override) | 8.10.1 | 8.10.2 | nb-ui tests via jsdom |
| Alerts 83, 94 | `ip-address` (transitive) | 10.5.0 | 10.7.4 | nb-bond-api via express-rate-limit, runtime |
| Alert 99 | `source-map-js` (transitive) | 1.2.1 | 1.2.2 | nb-ui build |
| Alerts 97, 100 | `brace-expansion` 1.x (override) and 2.x | 1.1.18 / 2.1.4 | 1.1.21 / 2.1.7 | jest, eslint, glob, dev |
| `npm audit` only | `brace-expansion` 5.x (override) | 5.0.9 | 5.0.12 | eslint 10 minimatch, dev |

## Scope

### In Scope

- Exact-pin bumps in `services/nb-bond-api/package.json` and `services/nb-ui/package.json`.
- Three edits to the root `package.json` `overrides`: `undici`, `minimatch@3.1.5` → `brace-expansion`,
  and `minimatch@10.2.5` → `brace-expansion`.
- `package-lock.json`: the bumped packages, the siblings their declared ranges require (`scheduler`
  for `react-dom`; `rolldown`, its platform bindings, and `@oxc-project/types` for `vite`), the
  transitive security bumps, and the workspace ranges written exact. Incidental movements are
  excluded.
- `THIRD_PARTY_LICENSES.md`: nine rows.
- Any formatting, lint, or test fallout from the new versions.

### Out of Scope

- `vite` 8.3.x and `undici` 8.11/8.12. Each security alert is closed by the minimal patch on the
  current line, and the newer lines are left for a later bot PR.
- Changing the Dependabot schedule, grouping, or the inventory checker.
- A release or tag. The runtime changes are patch-level and covered by the API test suite.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff contains only the classified entries listed in the design, with no removals | Incidental churn, legacy-peer artefacts | before/after diff, each entry classified |
| Every root override resolves at its pin at every lockfile path | npm does not re-apply a changed override to an existing lockfile | override audit |
| `npm ci` succeeds and `npm audit` reports zero vulnerabilities | Inconsistent lockfile; alerts not actually cleared | command output |
| The licence, Node-version, hygiene, and link checks pass | Inventory drift | script output |
| nb-bond-api and nb-ui lint, format, test, and build gates pass with test counts equal to baseline | Behaviour change from React 19.3, the newer rolldown, prettier, jose, or express-rate-limit | package gates |
| After merge, Dependabot alerts show zero open, and #295–#299 are closed | Stale PRs and alerts | GitHub |

## Constraints

- No new direct dependency. Every package involved is MIT, except `source-map-js` (BSD-3-Clause,
  already in the tree).
- One PR against `development`. Public-repo rules apply.

## Resolved Questions

- At approval (2026-10-21) the operator chose the newest patches, `jose` 6.2.13, `rolldown`
  1.2.14 with the new optional Android ARM binding, and the `brace-expansion` 5.0.12 fold-in. No
  live smoke and no release.
