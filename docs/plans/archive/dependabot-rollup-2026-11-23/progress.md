# Dependabot rollup (23 November 2026) — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 1 Manifests and lockfile | Done (2026-11-23) | Scratch resolve classified: 43 entries transplanted (39 changed, 4 added), none removed; fourteen resolve-artefact removals and two incidental nested bumps left out |
| 2 Tool consequences | Done (2026-11-23) | All gates green; test counts equal the previous rollup's baseline |
| 3 Runtime and PR | Done (2026-11-23) | Both images rebuilt and rolled; merge and bot follow-up pending |

## Deviations From Plan

None.

## Verified Claims

- `npm audit` reports 0 vulnerabilities before and after. Strict `npm ci` (npm 11.20.0) accepts the
  lockfile. The licence, node-version, hygiene, link, image-pin and image-hash-input checks pass.
- nb-bond-api: lint, `format:check`, jest (39 suites / 293 tests) and the `tsc` build pass, and
  `npm run regen:openapi` leaves `openapi.json` unchanged. nb-ui: `format:check`, lint, vitest
  (27 files / 139 tests) and the Vite 8.3.8 production build pass. Both test counts equal those of
  the previous rollup (`docs/plans/archive/dependabot-rollup-2026-11-17/`).
- Image content hashes: nb-bond-api `f4bd7af47035` to `cbaaaeacfe73`, nb-ui `d3c54e30935b` to
  `adf6b70228ce`. The BENS tag (`ced001f1fe3e`) and the Blockscout source-build hash
  (`240cf0be0e9c`) are unchanged.
- Local sandbox: the deployments run those tags and are ready, the nb-bond-api pod has `jose`
  6.2.18 on Node v26.13.1, seven read endpoints return the same bytes as before the roll, and the
  UI answers 200. Nine nb-ui pages (bonds, auctions, bidders, central bank, coupon payout, banking,
  registry, operations, stocks) render in a headless browser with no console errors, exceptions,
  bad responses or failed requests.
- `jose` 6.2.18 was exercised directly: a locally signed token verifies through
  `createRemoteJWKSet` and `jwtVerify` with `issuer` and `audience`, and wrong audience, wrong
  issuer and expired tokens are rejected.
- The built `@azure/msal-browser` 5.30.0 chunk initialises in a browser on a secure origin:
  `PublicClientApplication` constructs, `initialize()` and `handleRedirectPromise()` complete with
  no redirect result and no accounts. (On a non-secure origin it correctly refuses with
  `crypto_nonexistent`.)
- A live `entra` sign-in (redirect to a tenant, token acquisition, an API call carrying that token)
  was not exercised; the local sandbox runs with auth mode `none`.

## Follow-ups

None.

## Session Handoff

Change committed on `feature/dependabot-rollup-2026-11-23`. Next: operator review, merge on
go-ahead, then confirm the bot closes #387–#391.
