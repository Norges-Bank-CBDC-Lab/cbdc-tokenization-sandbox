# Dependabot rollup (17 November 2026) — Intent

**Status:** Approved (2026-11-17)
**Created:** 2026-11-17
**Requested by:** sandbox operator

## Outcome

The five open Dependabot pull requests land as one reviewable rollup with a minimal, classified
lockfile change. After merge Dependabot closes #377–#381 as satisfied.

## Why This Change

Dependabot opened #377–#381 on 2026-11-15. All five pass every check, because the licence
inventory no longer carries versions, so the bumps only need the exact-pin edits and a lockfile.
Each bot PR re-serialises the lockfile; one rollup carries the real change.

| Source | Package | From | To | Where |
|---|---|---|---|---|
| #377 | `globals` | 17.13.0 | 17.14.0 | nb-bond-api and nb-ui, ESLint globals |
| #378 | `jose` | 6.2.13 | 6.2.17 | nb-bond-api, runtime (`entra` token verification) |
| #379 | `@babel/core` | 8.1.0 | 8.1.2 | root and nb-bond-api, jest transform |
| #380 | `@vitejs/plugin-react` | 6.1.2 | 6.3.0 | nb-ui, build |
| #381 | `dotenv` | 18.0.9 | 18.0.10 | nb-bond-api, runtime |

All five target versions are the newest releases on the registry, so the PR versions are taken.

## Scope

### In Scope

- Exact-pin bumps in the root, `services/nb-bond-api` and `services/nb-ui` manifests.
- `package-lock.json`: the five packages, the `@babel/*` siblings core 8.1.2 requires, and the
  workspace entries written exact.
- The one prose version reference in `docs/KNOWN_ISSUES.md`.

### Out of Scope

- A release, tag or Dependabot configuration change.
- Any change to `services/blockscout/build-images.sh` or the Blockscout image tags.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Lockfile diff contains only classified entries | Incidental churn | before/after structural diff |
| `npm ci` succeeds and `npm audit` finds nothing | Inconsistent lockfile; new advisories | command output |
| nb-bond-api and nb-ui gates pass at baseline test counts; `openapi.json` unchanged | Behaviour change | package gates |
| Both images rebuild and run on the local sandbox | Runtime regressions | deployed images, read endpoints |

## Constraints

- No new direct dependency. Every package involved is already in the tree.
- One PR against `development`. Public-repo rules apply.
