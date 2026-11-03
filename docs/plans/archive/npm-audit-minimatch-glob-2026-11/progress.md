# `npm audit` minimatch and glob advisories (November 2026) — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Investigation | Done (2026-11-03) | Scratch run with global overrides alone: audit 32 to 5, gates green, but two consumers found that cannot run on the override (`test-exclude` 6 with glob 7, `eslint-plugin-react`). Scope with the `babel-jest` bump, the new transitive package, and the hold-back approved by the operator |
| 1 Manifests and lockfile | Done (2026-11-03) | Rebased on the merged November Dependabot rollup, re-resolved; 5 added, 225 removed, 16 changed entries, classified in the design; override audit clean |
| 2 Tool consequences | Done (2026-11-03) | All gates green; test counts equal the baseline |
| 3 PR and cleanup | In progress | Folder archived in the change commit; push and PR wait for the operator |

## Deviations From Plan

None. The first scratch run showed that global overrides alone are not enough; the approved scope
was widened before any repository file changed.

## Verified Claims

- Baseline on the unchanged tree (`development` at the rollup merge): nb-bond-api 39 suites / 293
  tests; nb-ui 27 files / 139 tests; `npm audit` 32 findings (3 low, 29 moderate). After the change:
  identical test counts, all passing.
- Strict `npm ci` (npm 11.14.1) accepts the lockfile, and a default `npm install
  --package-lock-only` leaves it byte-identical. `npm audit` reports 7 findings (5 low, 2 moderate):
  `minimatch` 3.1.5 and `eslint-plugin-react` (nb-ui), and `deepmerge` with `jest-config`,
  `@jest/core`, `jest`, `jest-cli`. None has an upstream fix.
- Override audit: `ws` 8.21.0, `undici` 8.12.3, `js-yaml` 4.3.2, `qs` 6.17.0, `glob` 14.0.3,
  `brace-expansion` 5.0.12, and `minimatch` 11.0.4 at every lockfile path; the only `minimatch`
  3.1.5 and `brace-expansion` 1.1.21 copies sit under nb-ui's `eslint-plugin-react`.
- nb-bond-api: lint, `format:check`, jest, and `tsc` build pass. nb-ui: `format:check`, lint,
  vitest, and the Vite build pass. `test-exclude` 7.0.2 on `glob` 14.0.3 instruments and globs
  correctly in a direct check.
- Local gates ran on Node 26.12.1, the pinned version.

## Follow-ups

- When `eslint-plugin-react` ships a release that takes `minimatch` 11, delete its scoped override
  and re-resolve (recorded in `docs/KNOWN_ISSUES.md`).
- Pre-existing: `npm ls` annotates the shared `minimatch` 11 copy as invalid because of the scoped
  override; it does not affect `npm ci`.

## Session Handoff

Change committed on `feature/npm-audit-glob-minimatch`. Next: operator review, then push and PR
against `development` on request.
