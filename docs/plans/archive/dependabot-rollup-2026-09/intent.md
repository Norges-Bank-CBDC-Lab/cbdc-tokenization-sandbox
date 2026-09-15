# Dependabot rollup (September 2026) — Intent

**Status:** Draft
**Created:** 2026-09-15
**Requested by:** sandbox operator

## Outcome

The five open Dependabot pull requests are landed as one reviewable rollup that also carries
the inventory and Node-pin edits Dependabot cannot make, so the checks pass and the five
bot PRs are closed as superseded.

## Why This Change

Dependabot opened #267, #268, #269, #270, and #271. Every one fails `validate-inventory`
because `THIRD_PARTY_LICENSES.md` must list each direct dependency at its exact lockfile
version and the bot never edits it; #268 also fails `validate-node-version` because
`@types/node` is pinned alongside the runtime in `common/node-version.env`. Rebasing does not
change either. None is security-related; this is housekeeping.

| PR | Package | From | To | Manifests |
|---|---|---|---|---|
| #267 | `typescript-eslint` | 8.64.0 | 8.69.0 | nb-bond-api |
| #268 | `@types/node` | 26.1.1 | 26.5.1 | nb-bond-api, bid-encryption, bid-submitter, plus `common/node-version.env` |
| #269 | `@testing-library/jest-dom` | 6.9.1 | 7.0.1 (major) | nb-ui |
| #270 | `zod` | 4.4.3 | 4.5.4 | nb-bond-api (runtime dependency) |
| #271 | `prettier` | 3.9.5 | 3.9.6 | nb-bond-api, nb-ui |

## Scope

### In Scope

- The five version bumps in their workspace manifests, exact pins as today.
- `common/node-version.env`: `SANDBOX_TYPES_NODE_VERSION` `26.1.1 → 26.5.1` (runtime stays
  26.5.0; the types line must match the runtime's major and not exceed its minor line, which
  26.5.x satisfies).
- `package-lock.json`: the bumped packages plus whatever exact-pinned siblings their declared
  ranges require (the `@typescript-eslint/*` family in particular); incidental movements excluded.
- `THIRD_PARTY_LICENSES.md`: eight rows (`typescript-eslint`, three `@types/node`, `jest-dom`,
  `zod`, two `prettier`).
- Any reformatting `prettier` 3.9.6 demands, any lint finding `typescript-eslint` 8.69 adds, and
  a regenerated `openapi.json` if `zod` 4.5.4 changes the emitted document.
- Closing #267–#271 after merge.

### Out of Scope

- New packages: none. `@testing-library/dom`, which jest-dom 7 now requires as a peer, is
  already in the tree at 10.4.1 as the auto-installed peer of `@testing-library/react` and
  stays undeclared.
- Runtime image or release: `zod` is the only runtime dependency and the API's behaviour is
  gated by its tests; no release is required by this rollup.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff contains only the five packages and their required siblings, nothing added or removed beyond them | Incidental churn | before/after diff listing, reviewed entry by entry |
| Every root override still resolves at its pin | Un-applied overrides on install | override audit |
| `npm ci` succeeds; all four verification scripts pass | Inconsistent lockfile, inventory or Node-pin drift | script output |
| nb-bond-api and nb-ui gates pass; `openapi.json` unchanged or its diff explained | Behaviour change from zod, lint, prettier, jest-dom | package gates, regen diff |
| The five Dependabot PRs are closed with a pointer to the rollup | Stale bot PRs | GitHub |

## Constraints

- No new dependency; all five packages stay MIT.
- One PR against `development`; public-repo rules.

## Open Questions

- Include the `jest-dom` major in this rollup (recommended: yes; its breaking changes are the
  peer and Node requirements, both already met) or hold it back. Operator decides at approval.
