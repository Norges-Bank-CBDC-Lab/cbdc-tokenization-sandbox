# Dependabot rollup (17 November 2026) — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 1 Manifests and lockfile | Done (2026-11-17) | Scratch resolve classified: fifteen entries transplanted (65 lines changed), none added or removed; fourteen legacy-peer removals left out |
| 2 Tool consequences | Done (2026-11-17) | All gates green; test counts equal the baseline |
| 3 Runtime and PR | Done (2026-11-17) | Both images rebuilt and rolled; merge and bot follow-up pending |

## Deviations From Plan

None.

## Verified Claims

- Baseline on the unchanged tree: nb-bond-api 39 suites / 293 tests; nb-ui 27 files / 139 tests.
  After the change: identical counts, all passing.
- Strict `npm ci` (npm 11.20.0) accepts the lockfile. `npm audit` reports 0 vulnerabilities before
  and after.
- nb-bond-api: lint, `format:check`, jest, and `tsc` build pass, and `npm run regen:openapi`
  leaves `openapi.json` unchanged. nb-ui: `format:check`, lint, vitest, and the Vite 8.3.5
  production build pass. The licence, node-version, hygiene, link and image-hash-input checks pass.
- Image content hashes: nb-ui `e26e7ca1e8ce` to `dd3761baeb45`, nb-bond-api `5acd8e34c3ba` to
  `f4bd7af47035`. The BENS tag (`07041d56f6d1`) and the Blockscout source-build hash
  (`8ba6f500012c`) are unchanged.
- Local sandbox: the deployments run those tags, all pods ready, the nb-bond-api pod has `jose`
  6.2.17 and `dotenv` 18.0.10 on Node v26.13.1, the ten read endpoints and the UI answer 200, and
  the chain data is kept.
- `jose` 6.2.17 was exercised directly: a locally signed token verifies through
  `createRemoteJWKSet` and `jwtVerify` with `issuer` and `audience`, and wrong audience, wrong
  issuer and expired tokens are rejected. A live `entra` sign-in was not exercised; the local
  sandbox runs with auth mode `none`.

## Follow-ups

None.

## Session Handoff

Change committed on `feature/dependabot-rollup-2026-11-17`. Next: operator review, merge on
go-ahead, then confirm the bot closes #377–#381.
