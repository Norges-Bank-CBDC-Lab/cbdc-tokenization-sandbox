# Dependabot rollup (23 November 2026) — Intent

**Status:** Approved (2026-11-23)
**Created:** 2026-11-23
**Requested by:** sandbox operator

## Outcome

The five open Dependabot pull requests land as one reviewable rollup with a minimal, classified
lockfile change. After merge Dependabot closes #387–#391 as satisfied.

## Why This Change

Dependabot opened #387–#391 on 2026-11-22. Each one re-serialises `package-lock.json`, so they
conflict with each other; one rollup carries the real change.

| Source | Package | From | To | Where |
|---|---|---|---|---|
| #387 | `@azure/msal-browser` | 5.28.0 | 5.30.0 | nb-ui, runtime (`entra` sign-in) |
| #388 | `typescript-eslint` | 8.70.1 | 8.73.0 | nb-bond-api, lint |
| #389 | `vitest` | 5.1.0 | 5.1.1 | nb-ui, tests |
| #390 | `jose` | 6.2.17 | 6.2.18 | nb-bond-api, runtime (`entra` token verification) |
| #391 | `vite` | 8.3.5 | 8.3.8 | nb-ui, build |

All five target versions are the newest releases on the registry, so the PR versions are taken.

## Scope

### In Scope

- Exact-pin bumps in the `services/nb-bond-api` and `services/nb-ui` manifests.
- `package-lock.json`: the five packages, the entries their new ranges require, and the
  workspace entries written exact.

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

- No new direct dependency. The lockfile gains four optional entries (see the design).
- One PR against `development`. Public-repo rules apply.
