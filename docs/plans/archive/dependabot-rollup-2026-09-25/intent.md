# Dependabot rollup (late September 2026) — Intent

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Requested by:** sandbox operator

## Outcome

Four of the five open Dependabot pull requests are landed as one reviewable rollup that also
carries the inventory rows Dependabot cannot write, so the checks pass and the four bot PRs are
closed as superseded.

## Why This Change

Dependabot opened #286–#290 on 2026-09-20. Every one fails `validate-inventory` because
`THIRD_PARTY_LICENSES.md` must list each direct dependency at its exact lockfile version and the
bot never edits it. The bot branches also write caret ranges into the lockfile's workspace
entries while the manifests stay exact-pinned. The other checks pass on all five. None is
security-related; this is housekeeping.

| PR | Package | From | To | Manifest |
|---|---|---|---|---|
| #290 | `zod` | 4.5.4 | 4.6.5 | nb-bond-api (runtime dependency) |
| #289 | `typescript-eslint` | 8.69.0 | 8.70.1 (PR proposed 8.70.0) | nb-bond-api (dev) |
| #287 | `@vitejs/plugin-react` | 6.0.3 | 6.1.1 | nb-ui (dev) |
| #288 | `@testing-library/react` | 16.3.2 | 16.3.3 | nb-ui (dev) |

## Scope

### In Scope

- The four version bumps in their workspace manifests, exact pins as today.
- `package-lock.json`: the bumped packages plus the exact-pinned siblings their declared ranges
  require (the `@typescript-eslint/*` family), and the four workspace ranges written exact;
  incidental movements excluded.
- `THIRD_PARTY_LICENSES.md`: four rows.
- Any lint finding `typescript-eslint` 8.70.1 adds, and a regenerated `openapi.json` if `zod`
  4.6.5 changes the emitted document.
- Closing #287–#290 after merge.

### Out of Scope

- #286, `better-sqlite3` 12.11.1 → 13.0.3. It is a major bump of the API's native database
  driver that adds a new package (`node-addon-api`) and changes how the prebuilt binary is
  delivered; it needs its own approval, a live image check, and its own PR.
- New packages: none. `@vitejs/plugin-react` 6.1.1 declares one more optional peer
  (`oxc-transform-react`); nothing is installed for it.
- Runtime image or release: `zod` is the only runtime dependency and the API's behaviour is gated
  by its tests; no release is required by this rollup.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Structural lockfile diff contains only the four packages and their required siblings, nothing added or removed beyond them | Incidental churn | before/after diff listing, each entry classified |
| Workspace ranges in the lockfile stay exact | Caret drift the bot branches introduce | lockfile diff |
| Every root override still resolves at its pin | Un-applied overrides on install | override audit |
| `npm ci` succeeds; the licence, Node-version, hygiene and link checks pass | Inconsistent lockfile or inventory drift | script output |
| nb-bond-api and nb-ui gates pass; `openapi.json` unchanged or its diff explained | Behaviour change from zod, lint, the React plugin or Testing Library | package gates, regen diff |
| The four Dependabot PRs are closed with a pointer to the rollup | Stale bot PRs | GitHub |

## Constraints

- No new dependency; all four packages stay MIT.
- One PR against `development`; public-repo rules.

## Resolved Questions

- `typescript-eslint` 8.70.1 was published on 2026-09-21, after #289 opened for 8.70.0. The
  operator chose 8.70.1 at approval (2026-09-25), so Dependabot can close #289 instead of
  retargeting it.
