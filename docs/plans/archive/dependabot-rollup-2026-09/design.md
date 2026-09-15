# Dependabot rollup (September 2026) — Design

**Status:** Draft
**Created:** 2026-09-15
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-security-rollup-2026-09/` (transplant discipline,
override audit), the Dependabot rollup #262, `docs/KNOWN_ISSUES.md` "Root `overrides` security
pins go stale silently".

## Decision Summary

Apply all five bumps in the manifests, resolve once in a scratch copy (direct-dependency bumps
resolve normally; the overrides are untouched), and transplant into the tracked lockfile the
bumped packages plus the exact-pinned siblings their declared ranges require, rejecting any
other movement. Update the Node types pin and the eight inventory rows in the same commit,
then let the tool changes prove themselves: prettier reformat, typescript-eslint lint, zod
OpenAPI regeneration, jest-dom test suite.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** All five packages are exact pins in their workspaces and listed in the inventory at those versions | workspace `package.json` files, `THIRD_PARTY_LICENSES.md` | Eight inventory rows change |
| **Verified.** `check-node-version-consistency.py` asserts `@types/node` equals `SANDBOX_TYPES_NODE_VERSION` in every workspace and at the hoisted lockfile entry | `scripts/verification/check-node-version-consistency.py`, `common/node-version.env` | The env pin moves with the bump; runtime 26.5.0 keeps the same minor line |
| **Verified.** `zod-openapi` 6.0.1 peers `zod ^4.0.0`; `zod` is the API's runtime schema library and the OpenAPI document is generated from it | `services/nb-bond-api/package.json`, registry metadata | Regenerate `openapi.json`; any diff is reviewed, not assumed |
| **Verified.** `jest-dom` 7.0.1 peers `@testing-library/dom >=10 <11` (required) and `vitest` (optional), engines Node ≥22; `@testing-library/dom` 10.4.1 is in the lockfile as `@testing-library/react`'s peer | registry metadata, `package-lock.json` | No new package; the nb-ui suite (125 tests) is the behaviour gate |
| **Verified.** `typescript-eslint` pins its `@typescript-eslint/*` family exactly | lockfile | Sibling lifts are required, not incidental |
| **Verified.** `prettier` is pinned in both workspaces and CI runs `format:check` on the whole workspace | package scripts, PR-workflow gate | A patch release can still change output; reformat if so |
| **Verified.** Dependabot rebases but never edits the inventory or the Node env pin | the five failing checks | Manual rollup is the only path |

## Target State

- Manifests: `typescript-eslint 8.69.0`; `@types/node 26.5.1` in three workspaces; `@testing-library/jest-dom 7.0.1`; `zod 4.5.4`; `prettier 3.9.6` in two workspaces.
- `common/node-version.env`: `SANDBOX_TYPES_NODE_VERSION=26.5.1`; banner comment unchanged
  (it already states the rule).
- Lockfile: those entries plus required siblings; overrides untouched.
- Inventory: eight rows.
- Any reformatted files, lint fixes, or `openapi.json` regeneration that the new tool versions
  require, each called out in the PR body.

## Procedure

1. Snapshot the tracked lockfile; edit the manifests and the env pin.
2. Scratch copy of the manifests and lockfile; `npm install --package-lock-only --ignore-scripts`.
3. Structural diff of the scratch resolution. Classify each moved entry as: a bumped package;
   an exact-pinned sibling required by a bumped package's declared range (check the range in the
   new package's `dependencies`); or incidental. Transplant the first two classes only.
4. Override audit; `npm ci`.
5. `prettier --check` in both workspaces; if it fails, run `npm run format` and stage the result
   as part of the rollup (list the files in the PR).
6. nb-bond-api gate; if `typescript-eslint` 8.69 adds findings, fix the code minimally or
   suppress per the repo's narrow-suppression rule, and say which.
7. `npm run regen:openapi`; diff `openapi.json`; explain or accept.
8. nb-ui gate on jest-dom 7 and prettier 3.9.6.
9. The four verification scripts.

## Alternatives Considered

- **Merge the bot PRs individually after pushing inventory commits to each.** Five PRs, five
  one-line edits, and a human commit stops Dependabot from rebasing that branch; the rollup is
  one reviewable diff.
- **Hold `jest-dom` 7 for a separate PR.** Reasonable if the operator wants majors isolated;
  the breaking changes are already satisfied, so the plan includes it by default.
- **Lift `@types/node` only to the runtime's exact patch.** The rule is same major and not
  beyond the runtime's minor line; 26.5.1 satisfies it and is what Dependabot proposes.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Include the jest-dom major | Yes | Confirm at approval |
| Release afterwards | None (tooling and one in-range runtime bump covered by tests) | Say if a tag is wanted |
| Dependabot PRs | Close as superseded after merge, with a comment naming the rollup | None |

## Residual Risks

- `zod` 4.5.4 could change generated OpenAPI text; the regen diff is the control.
- `prettier` 3.9.6 could reformat files unrelated to the bump; those changes are
  format-only and listed.
