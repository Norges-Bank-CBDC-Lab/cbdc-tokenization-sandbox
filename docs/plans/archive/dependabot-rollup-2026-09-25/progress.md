# Dependabot rollup (late September 2026) — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-25 — Phases 1 and 2 done; PR opened with the plan archived in it
**Current phase:** Phase 3: PR, then close #287–#290 after merge
**Next action:** After merge, close Dependabot PRs #287–#290 as superseded; #286 stays open for its own PR

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Manifests and lockfile | Done | Baseline on the unchanged tree: nb-bond-api 249 jest tests, nb-ui 125 vitest tests. Four manifest pins bumped. Lockfile changed 16 entries, none added or removed: the four packages (`@vitejs/plugin-react` updated in place at its nested `services/nb-ui/node_modules/` path), ten `@typescript-eslint/*` siblings (exact pins of the bumped family), and the two workspace entries with exact ranges. Excluded as incidental: `ignore` 7.0.6→7.0.10 (`^7.0.5` unchanged), the scratch resolve hoisting `@vitejs/plugin-react` to the root, and seven removals caused by legacy peer resolution (`@testing-library/dom`, `@types/aria-query`, `dom-accessibility-api`, `lz-string`, `pretty-format` with its nested `ansi-styles`, `react-is` 17, `typescript` 6.0.3). Scalar overrides at their pins, five nested `brace-expansion` copies unchanged. `npm ci` installs 861 packages, as before. Four inventory rows; licence and Node-version checks pass (2026-09-25) | this PR |
| 2 — Tool consequences | Done | `npm ci` installs the new versions. nb-bond-api: `typescript-eslint` 8.70.1 added no lint findings; prettier clean; 249 jest tests pass (baseline 249); `tsc` build passes; `regen:openapi` on zod 4.6.5 rewrites `openapi.json` byte-identical. nb-ui: prettier and lint clean; 125 vitest tests pass on `@testing-library/react` 16.3.3 (baseline 125); Vite build passes on `@vitejs/plugin-react` 6.1.1. Licence, Node-version, hygiene, and link checks pass. No source file changed (2026-09-25) | this PR |
| 3 — PR and cleanup | In progress | Plan folder archived in the rollup PR itself; bot PRs closed after merge | this PR |

## Deviations From the Plan

- `typescript-eslint` 8.70.1 instead of the 8.70.0 that #289 proposed, chosen by the operator at
  approval.
- Archived in the same PR as the change instead of a separate document-move PR.
- Local checks run on Node 25.8.0 (CI uses the pinned 26.5.0). `npm ci` warns that `jsdom`
  30.0.1 does not list Node 25; that warning predates this change.

## Verified So Far

- Bump list, bot-PR check results, workspace pins, inventory rows, `zod-openapi`'s peer range,
  the `@typescript-eslint/*` exact pins, the incidental `ignore` lift, the new optional peer of
  `@vitejs/plugin-react` 6.1.1, and the absence of open security alerts verified on 2026-09-25
  (see `design.md`).

## Follow-ups Found Along the Way

- #286 (`better-sqlite3` 13.0.3) needs its own PR: approval for the new `node-addon-api`
  package, and a live check that the API image loads the bundled prebuilt binary and that a
  projection resync works.
- `typescript-eslint` 8.x still peers `typescript <6.1.0` against the repo's 7.0.2, recorded by
  the previous rollup and unchanged here.
