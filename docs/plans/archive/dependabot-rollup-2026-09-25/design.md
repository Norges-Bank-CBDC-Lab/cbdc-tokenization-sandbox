# Dependabot rollup (late September 2026) — Design

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-09/` (transplant discipline,
classification of moved entries, legacy peer handling) and
`docs/plans/archive/dependabot-security-rollup-2026-09/` (override audit).

## Decision Summary

Apply the four bumps in the manifests, resolve once in a scratch copy, and transplant into the
tracked lockfile the bumped packages plus the exact-pinned siblings their declared ranges
require, rejecting any other movement. Update the four inventory rows in the same commit, then
let the tool changes prove themselves: typescript-eslint lint, zod OpenAPI regeneration, and the
nb-ui suite and build on the new React plugin and Testing Library.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** All four packages are exact pins in their workspaces and listed in the inventory at those versions | workspace `package.json` files, `THIRD_PARTY_LICENSES.md` | Four inventory rows change |
| **Verified.** All four bot PRs pass lint, format, tests and the other checks and fail only `validate-inventory` | PR checks on #287–#290 | The code is compatible; the missing edit is the inventory |
| **Verified.** The bot branches write `^x.y.z` into the lockfile's workspace entries while the manifests stay exact | PR diffs | The rollup writes exact ranges, as the tracked lockfile has today |
| **Verified.** `zod-openapi` 6.0.1 peers `zod ^4.0.0`; the OpenAPI document is generated from the zod schemas | registry metadata, `services/nb-bond-api/package.json` | Regenerate `openapi.json`; any diff is reviewed, not assumed |
| **Verified.** `typescript-eslint` pins its `@typescript-eslint/*` family exactly | registry metadata, lockfile | Sibling lifts are required, not incidental |
| **Verified.** `@typescript-eslint/eslint-plugin` 8.70.1 keeps `ignore ^7.0.5`; the bot branch lifts `ignore` 7.0.6 → 7.0.9 | registry metadata, #289 diff | Incidental; excluded, as in the previous rollup |
| **Verified.** `typescript-eslint` 8.70.1 still peers `typescript <6.1.0`; nb-bond-api pins 7.0.2 | registry metadata | Existing gap; the scratch resolve needs `--legacy-peer-deps` and its removals are ignored |
| **Verified.** `@vitejs/plugin-react` 6.1.1 keeps its single dependency (`@rolldown/pluginutils ^1.0.1`) and adds `oxc-transform-react ^0.145.0` as an optional peer; engines Node `^20.19.0 \|\| >=22.12.0` | registry metadata, #287 diff | No new package; the nb-ui build and suite are the behaviour gate |
| **Verified.** `@testing-library/react` 16.3.3 keeps its dependency and peer ranges | registry metadata | Patch-level; the nb-ui suite is the gate |
| **Verified.** No open Dependabot security alerts | GitHub | Nothing to fold in |

## Target State

- Manifests: `zod 4.6.5` and `typescript-eslint 8.70.1` in nb-bond-api;
  `@vitejs/plugin-react 6.1.1` and `@testing-library/react 16.3.3` in nb-ui.
- Lockfile: those entries plus the required `@typescript-eslint/*` siblings; workspace ranges
  exact; overrides untouched.
- Inventory: four rows.
- Any lint fixes or `openapi.json` regeneration that the new versions require, each called out
  in the PR body.

## Procedure

1. Snapshot the tracked lockfile; edit the manifests.
2. Scratch copy of the manifests and lockfile;
   `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`.
3. Structural diff of the scratch resolution. Classify each moved entry as: a bumped package; an
   exact-pinned sibling required by a bumped package's declared range; or incidental. Transplant
   the first two classes only, and set the workspace ranges exact.
4. Override audit; `npm ci`.
5. nb-bond-api gate; if `typescript-eslint` 8.70.1 adds findings, fix the code minimally or
   suppress per the repo's narrow-suppression rule, and say which.
6. `npm run regen:openapi`; diff `openapi.json`; explain or accept.
7. nb-ui gate on the new React plugin and Testing Library.
8. The licence, Node-version, hygiene and link checks.

## Alternatives Considered

- **Merge the bot PRs individually after pushing inventory commits to each.** Four PRs, four
  one-line edits, and the caret ranges in the lockfile would still need correcting; a human
  commit also stops Dependabot from rebasing that branch. The rollup is one reviewable diff.
- **Include #286 (`better-sqlite3` 13).** It adds a package, which needs its own approval, and it
  changes how the native binary reaches the API image, which needs a live image check. Mixing it
  in would hold the four low-risk bumps behind that work.
- **Keep `typescript-eslint` at the PR's 8.70.0.** It has longer soak time, but Dependabot would
  retarget #289 to 8.70.1 at its next run. The operator chose 8.70.1, a fix-only patch release
  with the same dependency and peer ranges.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| `typescript-eslint` version | 8.70.1 | Decided at approval (2026-09-25) |
| Release afterwards | None (tooling and one in-range runtime bump covered by tests) | Say if a tag is wanted |
| Dependabot PRs | Close #287–#290 as superseded after merge, with a comment naming the rollup; leave #286 open | None |

## Residual Risks

- `zod` 4.6.5 could change generated OpenAPI text; the regen diff is the control.
- `typescript-eslint` 8.70.1 could report new findings; the lint gate is the control, and any
  fix is listed.
