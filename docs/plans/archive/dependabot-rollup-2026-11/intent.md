# Dependabot rollup (November 2026) — Intent

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Requested by:** sandbox operator

## Outcome

Four of the five open Dependabot pull requests land as one reviewable rollup that also carries
the inventory rows Dependabot cannot write. After merge Dependabot closes #344, #345, #347, and
#348 as satisfied. #346 (Babel 8) stays out, for the reason recorded in `docs/KNOWN_ISSUES.md`.

## Why This Change

Dependabot opened #344–#348 on 2026-11-01. All five fail `validate-inventory`, because
`THIRD_PARTY_LICENSES.md` must list each direct dependency at its exact lockfile version, and
Dependabot does not edit it. The other checks pass on all five.

| Source | Package | From | To | Where |
|---|---|---|---|---|
| #344 | `vite` | 8.2.4 | 8.3.5 | nb-ui, dev server and build |
| #345 | `@noble/secp256k1` | 3.1.0 | 3.2.0 | nb-bond-api, bid-encryption, bid-submitter, runtime |
| #347 | `@testing-library/user-event` | 14.6.1 | 14.6.8 | nb-ui, tests |
| #348 | `zod-openapi` | 6.0.1 | 6.0.2 | nb-bond-api, runtime (OpenAPI generation) |
| #346 | `@babel/preset-env` | 7.29.5 | 8.0.7 | **held** |

All four target versions are already the newest releases on the registry, so the PR versions are
the ones taken.

## Scope

### In Scope

- Exact-pin bumps in `services/nb-bond-api/package.json`, `services/nb-ui/package.json`,
  `scripts/bid-encryption/package.json`, and `scripts/bid-submitter/package.json`.
- `package-lock.json`: the four bumped packages, the siblings `vite` 8.3.5's declared ranges
  require (`postcss`, `nanoid`), and the four workspace entries written exact.
- `THIRD_PARTY_LICENSES.md`: six rows.

### Out of Scope

- `@babel/preset-env` 8 (#346). It peer-requires `@babel/core` 8, while `nb-ui`'s
  `@vitejs/plugin-react` needs core 7, so a correct upgrade is a dual Babel tree. No concrete
  reason to take that on has appeared; see the Babel 8 entry in `docs/KNOWN_ISSUES.md`.
- The `minimatch` and `glob` advisories that `npm audit` reports. They are unchanged by this
  change and need their own fix.
- Changing the Dependabot schedule, grouping, or the inventory checker.
- A release or tag.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff contains only the classified entries listed in the design, with no removals | Incidental churn, legacy-peer artefacts | before/after diff, each entry classified |
| Every root override still resolves at its pin at every lockfile path | npm does not re-apply a changed override | override audit |
| `npm ci` succeeds and `npm audit` finds nothing beyond the baseline | Inconsistent lockfile; new advisories | command output |
| The licence, hygiene, and link checks pass | Inventory drift | script output |
| nb-bond-api and nb-ui gates pass with test counts equal to baseline; `openapi.json` regenerates unchanged | Behaviour change from the new versions | package gates |
| After merge, #344, #345, #347, and #348 are closed | Stale PRs | GitHub |

## Constraints

- No new direct dependency and no new lockfile entry. Every package involved is MIT.
- One PR against `development`. Public-repo rules apply.
