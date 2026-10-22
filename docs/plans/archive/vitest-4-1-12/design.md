# Vitest 4.1.12 security bump — Design

**Status:** Approved (2026-10-22)
**Created:** 2026-10-22
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-10/` (classified transplant).

## Decision Summary

Take the newest 4.x patch. Resolve once in a scratch copy, then transplant only vitest, its
exact-pinned `@vitest/*` family, and the workspace range.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** vitest 4.1.12 (2026-10-15) is the newest 4.x and the first patched release for both advisories | registry, advisory database | Target version |
| **Verified.** vitest pins `@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}` exactly | vitest 4.1.12 manifest | Seven required siblings |
| **Verified.** The scratch resolve also lifts `chai` 6.2.2 → 6.3.0 and `tinyrainbow` 3.1.0 → 3.2.0, but every declaring range is unchanged (`^6.2.2`, `^3.1.0`) | 4.1.11 and 4.1.12 manifests | Incidental; excluded |
| **Verified.** The `--legacy-peer-deps` resolve removes the same nine artefact entries as earlier rollups | scratch diff | Not transplanted |
| **Verified.** vitest 4.1.12 keeps `vite ^6 \|\| ^7 \|\| ^8` and Node `^20 \|\| ^22 \|\| >=24` | manifest | Fits vite 8.2.4 and Node 26 |

## Alternatives Considered

- **Vitest 5.0.5.** It also fixes both advisories (patched in 5.0.3), but it is a major upgrade;
  4.1.12 is the minimal fix.
- **Transplant the full resolve.** It carries two incidental lifts that nothing requires.

## Residual Risks

- Patch-level test-runner change. The nb-ui suite passing at the baseline count is the control.
