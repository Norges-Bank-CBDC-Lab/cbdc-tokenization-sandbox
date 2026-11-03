# Dependabot rollup (November 2026) — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 1 Manifests and lockfile | Done (2026-11-03) | Scratch resolve classified: ten entries transplanted (60 lines), none added, eight legacy-peer removals and two reordered entries left out; override audit clean |
| 2 Tool consequences | Done (2026-11-03) | All gates green; test counts equal the baseline |
| 3 PR and cleanup | In progress | Folder archived in the change commit; merge and bot follow-up pending |

## Deviations From Plan

None.

## Verified Claims

- Baseline on the unchanged tree: nb-bond-api 39 suites / 293 tests; nb-ui 27 files / 139 tests.
  After the change: identical counts, all passing.
- Strict `npm ci` (npm 11.14.1) accepts the lockfile. `npm audit` reports 32 findings (3 low,
  29 moderate) both before and after, from the `deepmerge`, `glob`, and `minimatch` advisories in
  dev tooling; the change adds none.
- Override audit: `ws` 8.21.0, `undici` 8.12.3, `js-yaml` 4.3.2, `qs` 6.17.0 at every lockfile
  path; the `brace-expansion` pins are unchanged.
- nb-bond-api: lint, `format:check`, jest, and `tsc` build pass, and `npm run regen:openapi`
  leaves `openapi.json` unchanged. nb-ui: `format:check`, lint, vitest, and the Vite 8.3.5
  production build pass. The licence checker passes.
- `bid-encryption`: `keygen` and `encrypt` run on `@noble/secp256k1` 3.2.0. The decrypt path was
  not run separately; it uses the same ECDH call.

## Follow-ups

- #346 (`@babel/preset-env` 8.0.7) is held; see the Babel 8 entry in `docs/KNOWN_ISSUES.md`.
- The `minimatch` and `glob` advisories behind the 32 audit findings need their own fix.

## Session Handoff

Change committed on `feature/dependabot-rollup-2026-11`. Next: operator review, push, PR against
`development`, merge on go-ahead, then confirm the bot closes the four satisfied PRs.
