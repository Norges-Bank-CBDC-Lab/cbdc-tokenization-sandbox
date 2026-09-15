# Dependabot security rollup (September 2026) — Design

**Status:** Draft
**Created:** 2026-09-15
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependency-security-pin-refresh-plan.md` (v0.7.1 override
bumps), `docs/plans/archive/browserslist-dev-transitive-refresh-plan.md` (lockfile transplant
discipline), the "Root `overrides` security pins go stale silently" entry in `docs/KNOWN_ISSUES.md`.

## Decision Summary

Two edits and one lockfile operation. Bump the root `js-yaml` override to 4.3.2 and the nb-ui
`vitest` devDependency to 4.1.11, resolve the lockfile in a scratch copy, and transplant only
the nine affected entries into the tracked lockfile, so the structural diff is exactly the
advisory's packages. No manifest gains or loses a package; the inventory changes one version
cell.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `js-yaml` is hoisted once at 4.3.1, dev-only, held by the root override; its dependents declare `^4.3.0` (`@eslint/eslintrc`) and `^3.13.1` (`@istanbuljs/load-nyc-config`, already overridden to 4.x) | `package-lock.json`, root `package.json` | Same override-bump shape as v0.7.1; 4.3.2 satisfies `^4.3.0` |
| **Verified.** `js-yaml` 4.3.2 is MIT with the same single dependency (`argparse`) | registry metadata | No sibling lifts, no inventory change |
| **Verified.** `vitest` 4.1.10 is an exact devDependency of `services/nb-ui`; the lockfile pins the seven `@vitest/*` siblings exactly at 4.1.10 | `services/nb-ui/package.json`, `package-lock.json` | All eight move together to 4.1.11 |
| **Verified.** `vitest` 4.1.11 declares the same dependency names as 4.1.10 and peers `vite ^6 \|\| ^7 \|\| ^8`; the lockfile has `vite` 8.2.1 | registry metadata | No other lift expected; the transplant confirms |
| **Verified.** `THIRD_PARTY_LICENSES.md` lists `vitest 4.1.10` under nb-ui and does not list `js-yaml` | inventory file | One row edit |
| **Verified.** The five open Dependabot PRs all fail `validate-inventory` | `gh pr checks` | Excluded; the raw PRs cannot merge as-is |
| **Verified.** npm does not reliably re-apply changed overrides to an existing lockfile | `docs/KNOWN_ISSUES.md`, first entry | Transplant plus audit, not `npm install` in place |

## Target State

- Root `package.json`: `"js-yaml": "4.3.2"` in `overrides`.
- `services/nb-ui/package.json`: `"vitest": "4.1.11"`.
- `package-lock.json`: `node_modules/js-yaml` 4.3.2 (resolved, integrity); `node_modules/vitest`
  and the seven `@vitest/*` entries 4.1.11 with their exact-pinned sibling ranges updated; the
  nb-ui workspace entry's `vitest` range 4.1.11.
- `THIRD_PARTY_LICENSES.md`: `vitest` row `4.1.11`.

## Procedure

1. Snapshot the tracked lockfile (`git show HEAD:package-lock.json`) for the structural diff.
2. Edit the two manifests.
3. In a scratch copy of the repo root (manifests, workspaces' `package.json`, lockfile), run
   `npm install --package-lock-only --ignore-scripts` to obtain a fully resolved lockfile.
4. Transplant from the scratch lockfile into the tracked one only the entries whose path ends in
   `node_modules/js-yaml`, `node_modules/vitest`, `node_modules/@vitest/<sibling>`, plus the
   `services/nb-ui` workspace entry's `vitest` range. Leave everything else byte-identical.
5. Structural diff (parse both lockfiles, compare `packages` maps): expect exactly those nine
   entries changed and no additions or removals. If the scratch resolution moved anything else
   (a `vite` or `magic-string` bump, for example), stop and decide whether it is required by the
   patched versions; do not carry incidental churn.
6. Override audit: for every root override, assert every matching lockfile path is at the
   pinned version.
7. `npm ci`, then the nb-ui gate (`format:check`, `lint`, `test`, `build`) and the nb-bond-api
   gate (its lint chain uses `@eslint/eslintrc`, which pulls `js-yaml`).
8. `python3 scripts/verification/check-third-party-licenses.py`, hygiene and link checks.

## Alternatives Considered

- **Merge the Dependabot PRs.** They do not touch the two security packages and fail the
  inventory gate; separate concern.
- **`npm install` in place.** Rejected: recorded history of un-applied overrides and incidental
  churn; the transplant keeps the diff to the advisory.
- **Move `js-yaml` to 5.x.** Not required by the advisory; a major line change for no benefit.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Release after merge | None; dev-only packages, images unchanged | Say if a `v0.9.1` tag is wanted anyway |
| Non-security Dependabot PRs | Separate rollup, planned only on request | None |

## Residual Risks

- Alert #79 is keyed to the nb-ui manifest; it clears once the manifest's declared version is
  patched, which step 2 does.
- If `vitest` 4.1.11 changed runner behaviour, the nb-ui suite (125 tests) shows it before merge.
