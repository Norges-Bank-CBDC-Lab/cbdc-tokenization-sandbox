# Dependabot rollup (17 November 2026) — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-17
**Created:** 2026-11-17
**Scope:** `package.json`, `services/nb-bond-api/package.json`, `services/nb-ui/package.json`, `package-lock.json`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/dependabot-rollup-2026-11-17/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, baseline, manifests, scratch resolve, transplant
Phase 2  Tool consequences: npm ci, audit, both workspace gates, verification scripts
Phase 3  Image builds, local rollout and runtime checks, PR
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Manifests and lockfile

1. Branch `feature/dependabot-rollup-2026-11-17` from `origin/development`.
2. Baseline: record the nb-bond-api and nb-ui test counts and `npm audit` on the unchanged tree.
3. Edit the exact pins in the three manifests.
4. Scratch copy of the manifests and lockfile, resolved with
   `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`.
5. Structural diff over whole entries. Transplant the classified entries only; update the nested
   `@vitejs/plugin-react` entry in place.

## Phase 2: Tool consequences

1. `npm ci` accepts the lockfile; `npm audit`.
2. nb-bond-api: lint, `format:check`, jest, `tsc` build, `regen:openapi` (no diff).
3. nb-ui: `format:check`, lint, vitest, Vite production build.
4. The licence, node-version, hygiene, link and image-hash-input checks.

## Phase 3: Runtime

1. Compute the nb-ui and nb-bond-api content hashes before and after.
2. `./sandbox.sh start` builds both images and rolls them on the local sandbox; check the deployed
   tags, the in-pod package versions, the read endpoints and the UI.
3. Exercise `jose` 6.2.17 directly (local JWKS, `issuer` and `audience` as `auth.ts` uses them),
   because the repository's tests mock `jose`.
4. Open the PR against `development`; merge on the operator's go-ahead.
