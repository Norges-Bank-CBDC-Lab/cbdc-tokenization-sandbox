# Dependabot security rollup (September 2026) — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-15 — plan drafted; awaiting operator approval
**Current phase:** Not started
**Next action:** Operator approves; then Phase 1 on `feature/dependabot-security-rollup`

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Manifests and lockfile | Not started | | |
| 2 — Gates | Not started | | |
| 3 — PR and alert check | Not started | | |

## Deviations From the Plan

None yet.

## Verified So Far

- Alert-to-pin mapping, patched versions, licences, and dependency shapes verified against the
  GitHub alerts API, the lockfile, and the npm registry on 2026-09-15 (see `design.md`).

## Follow-ups Found Along the Way

- Five open non-security Dependabot PRs (#267–#271) all fail `validate-inventory`; one is a
  major (`@testing-library/jest-dom` 7). Separate rollup on request.
