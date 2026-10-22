# Vitest 4.1.12 security bump — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 1 Bump and lockfile | Done (2026-10-22) | Nine lockfile entries; `chai` and `tinyrainbow` lifts excluded as incidental |
| 2 Gates | Done (2026-10-22) | All green; counts equal the baseline |
| 3 PR | In progress | Folder archived in the change commit |

## Deviations From Plan

None.

## Verified Claims

- Baseline on `development` (e4a2701): `npm audit` reports 2 moderate (`@vitest/mocker`
  4.1.11); nb-ui 27 files / 139 tests; nb-bond-api 39 suites / 293 tests.
- After the change: `npm ci` succeeds; `npm audit` reports 0; `npm ls` shows `vitest` and
  `@vitest/mocker` at 4.1.12; nb-ui `format:check`, lint, 139 tests, and build pass;
  nb-bond-api lint, `format:check`, 293 tests, and build pass; the licence, Node-version,
  hygiene, and link checks pass.
- Local gates ran on Node 26.12.1. CI runs `development`'s pin.

## Follow-ups

- Vitest 5 when it is wanted; it needs its own change.
