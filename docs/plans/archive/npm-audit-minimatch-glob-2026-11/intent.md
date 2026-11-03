# `npm audit` minimatch and glob advisories (November 2026) — Intent

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Requested by:** sandbox operator

## Outcome

`npm audit` on `development` stops reporting the two moderate advisories that cascade into 32
findings, and keeps reporting only what upstream cannot fix. After merge the open Dependabot
minimatch alert is closed.

## Why This Change

| Advisory | Package | Affects | First patched | Where |
|---|---|---|---|---|
| GHSA-g3hv-75wg-m249 | `minimatch` (denial of service through `globparts` amplification) | `<11.0.1` | 11.0.1 (latest 11.0.4) | eslint, typescript-eslint, glob, test-exclude, eslint-plugin-react, all dev tooling |
| GHSA-3g3m-2fjr-6pw4 | `glob` (`AbortSignal` cancellation bypass) | `>=9.0.0 <=14.0.1` | 14.0.2 (latest 14.0.3) | jest, test-exclude, dev tooling |

Both packages sit only in dev tooling, so nothing reaches a runtime image. The advisories are
still the root of 30 of the 32 `npm audit` findings (the other two chain to `deepmerge`), and
every consumer's declared range (`minimatch ^10.2.x`, `glob ^13.0.6`) excludes the fix, so no
Dependabot bump can take it. Neither package has a backport: `minimatch` 3.1.5 and 9.0.9 are the
last releases of their lines. `npm audit fix` proposes downgrades (jest 25, eslint 4) and is not
used.

## Scope

### In Scope

- Root `package.json` `overrides`: `minimatch` 11.0.4 and `glob` 14.0.3 for the whole tree,
  replacing the two scoped `brace-expansion` pins (`minimatch` 11 requires `brace-expansion`
  `^5.0.12` itself), plus a scoped hold-back of `eslint-plugin-react` on `minimatch` 3.1.5.
- `babel-jest` 30.4.1 to 30.5.2 in `services/nb-bond-api/package.json`.
- `package-lock.json`: the classified entries only (see the design).
- `THIRD_PARTY_LICENSES.md` (one row) and `docs/KNOWN_ISSUES.md` (the override description).

### Out of Scope

- `deepmerge` GHSA-gcqx-w48m-w2h4 (via `jest-config`): no upstream fix.
- `eslint-plugin-react` itself: its newest release still needs `minimatch ^3.1.2`.
- Bumping any tool across a major (eslint, jest, typescript-eslint stay on their lines).
- Release, tag, or Dependabot configuration changes.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff contains only the classified entries from the design | Incidental churn, legacy-peer artefacts | before/after diff, each entry classified |
| Every root override resolves at its pin at every lockfile path | npm does not re-apply a changed override to an existing lockfile | override audit |
| `npm ci` succeeds; `npm audit` reports only findings with no upstream fix | Inconsistent lockfile; advisories not cleared | command output |
| nb-bond-api and nb-ui gates pass with test counts equal to baseline | Behaviour change from the new `minimatch`, `glob`, and `babel-jest` | package gates |
| The licence, Node-version, hygiene, and link checks pass | Inventory drift | script output |

## Constraints

- One new transitive package is added:
  `@isaacs/nonrecursive-glob-match` 1.0.3 (BlueOak-1.0.0, same author as `minimatch`)
  is required by every `minimatch` from 11.0.1, so any fix adds it. The operator approved it, the
  `babel-jest` bump, and the `eslint-plugin-react` hold-back on 2026-11-03.
- One PR against `development`. Public-repo rules apply.
