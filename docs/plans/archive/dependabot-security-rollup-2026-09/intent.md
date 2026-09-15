# Dependabot security rollup (September 2026) — Intent

**Status:** Draft
**Created:** 2026-09-15
**Requested by:** sandbox operator

## Outcome

The four open Dependabot alerts on the default branch are closed by one lockfile change that
moves exactly the affected packages to their patched versions, with the license inventory
matching, and nothing else in the lockfile moving.

## Why This Change

GitHub reports four open alerts, all against development-only packages:

| Alert | Severity | Package | Now | Patched | Held by |
|---|---|---|---|---|---|
| #81 | high | `js-yaml` (GHSA-2883-xcg3-v3hh, CVE-2026-84375) | 4.3.1 | 4.3.2 | root `overrides` pin `js-yaml: 4.3.1` |
| #80, #78 | medium | `vitest`, `@vitest/mocker` (GHSA-82fw-gwwq-j7x9, CVE-2026-84373) | 4.1.10 | 4.1.11 | `services/nb-ui` exact devDependency `vitest: 4.1.10` |
| #79 | medium | `vitest` (same advisory, manifest `services/nb-ui/package.json`) | 4.1.10 | 4.1.11 | same |

None ships in a runtime image: `js-yaml` is reachable only through `@eslint/eslintrc` and
`@istanbuljs/load-nyc-config`; `vitest` is the nb-ui test runner. The exposure is the
developer workstation and CI, which is why this is a rollup rather than a release-blocking fix.

## Scope

### In Scope

- Root `package.json` `overrides`: `js-yaml` `4.3.1 → 4.3.2`.
- `services/nb-ui/package.json` devDependency `vitest` `4.1.10 → 4.1.11`.
- `package-lock.json`: `js-yaml` (one hoisted entry) and `vitest` plus its seven exact-pinned
  siblings (`@vitest/expect`, `mocker`, `pretty-format`, `runner`, `snapshot`, `spy`, `utils`)
  `4.1.10 → 4.1.11`.
- `THIRD_PARTY_LICENSES.md`: the nb-ui `vitest` row to `4.1.11` (`js-yaml` is transitive and not
  inventoried).
- Structural lockfile diff and override audit as the gate; nb-ui test run on the new runner.

### Out of Scope

- The five open non-security Dependabot PRs (#267 typescript-eslint, #268 @types/node,
  #269 @testing-library/jest-dom 7 (major), #270 zod, #271 prettier). All currently fail
  `validate-inventory`; they are a separate, non-urgent rollup the operator can approve.
- `js-yaml` 5.x, `vite`, or any other version line.
- A release: nothing in a shipped image changes, so no tag is required; a `v0.9.1` patch is
  optional if the operator wants the release tag itself to be alert-free.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff lists only `js-yaml` and the eight vitest-family entries | Unrelated churn or silently un-applied overrides | `python3` structural diff of `package-lock.json` before/after |
| Every root `overrides` pin resolves to exactly its pinned version at every lockfile path | Override un-application (recorded in `docs/KNOWN_ISSUES.md`) | override audit script output |
| `npm ci` succeeds from the new lockfile | Internally inconsistent lockfile | fresh install |
| nb-ui format, lint, test, build pass on vitest 4.1.11 | Test-runner behaviour change | package gate |
| `check-third-party-licenses.py` passes | Inventory drift | script output |
| All four alerts show fixed after merge | Wrong patched version | GitHub Dependabot alerts view |

## Constraints

- No new dependency; both patched versions are MIT like the current ones, so no licence
  approval is triggered.
- Public repo rules; the lockfile diff must stay reviewable.

## Open Questions

- None blocking. Whether to cut `v0.9.1` afterwards is the operator's call (recommended: no).
