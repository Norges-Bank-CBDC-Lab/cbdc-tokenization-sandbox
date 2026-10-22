# Vitest 4.1.12 security bump — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-10-22
**Created:** 2026-10-22
**Scope:** `services/nb-ui/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/vitest-4-1-12/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Phase 1: Bump and lockfile

1. Baseline: `npm ci` and the nb-ui test count; record `npm audit`.
2. Set `vitest` to 4.1.12 in `services/nb-ui/package.json`.
3. Scratch resolve (`npx -y npm@11.14.1 install --package-lock-only --ignore-scripts
   --legacy-peer-deps`), structural diff, and classification. Transplant vitest, the seven
   `@vitest/*` entries, and the workspace range only.
4. One inventory row.

Exit: the lockfile diff is exactly nine entries.

## Phase 2: Gates

1. `npx -y npm@11.14.1 ci`, `npm audit` (expect 0).
2. nb-ui: `format:check`, lint, test, build. nb-bond-api: lint, `format:check`, test, build.
3. Licence, Node-version, hygiene, and link checks.

Exit: all green with baseline counts.

## Phase 3: PR

Archive this folder in the same commit, add the index entry, and open a PR against `development`
on the operator's go-ahead.

## Done Criteria

- [x] vitest 4.1.12 with its siblings; no incidental entries.
- [x] `npm audit` 0; all gates pass.
- [ ] PR merged on go-ahead.
