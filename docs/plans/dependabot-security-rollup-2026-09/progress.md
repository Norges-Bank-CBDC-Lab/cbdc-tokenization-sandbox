# Dependabot security rollup (September 2026) — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-15 — Phases 1 and 2 done; PR opening
**Current phase:** Phase 3: PR and alert check
**Next action:** Merge the PR, confirm alerts #78–#81 read fixed, archive this folder

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Manifests and lockfile | Done | structural diff: exactly `js-yaml` 4.3.1→4.3.2, `vitest` and its seven `@vitest/*` siblings 4.1.10→4.1.11, and the nb-ui workspace range; zero added or removed entries; every root override at its pin, nested `brace-expansion` copies unchanged; inventory `vitest` row updated (2026-09-15) | PR |
| 2 — Gates | Done | `npm ci` installs vitest 4.1.11 and js-yaml 4.3.2; nb-ui format, lint, 125 vitest tests, build; nb-bond-api lint, format, 249 jest tests, build; license inventory, node-version, hygiene, and link checks pass (2026-09-15) | PR |
| 3 — PR and alert check | Not started | | |

## Deviations From the Plan

- `npm install --package-lock-only` in the scratch copy did not re-apply the bumped `js-yaml`
  override (the known behaviour), and a from-scratch resolve fails on an unrelated peer
  conflict in the scratch tree, so the `js-yaml` 4.3.2 entry was constructed from the registry
  metadata (tarball, integrity, unchanged `argparse` dependency and `bin`) in the shape of the
  existing entry. The vitest family came from the scratch resolution.
- The scratch resolution also moved `tinyrainbow` 3.1.0→3.1.1; both vitest versions declare
  `^3.1.0`, so that incidental bump was left out.

## Verified So Far

- Alert-to-pin mapping, patched versions, licences, and dependency shapes verified against the
  GitHub alerts API, the lockfile, and the npm registry on 2026-09-15 (see `design.md`).

## Follow-ups Found Along the Way

- Five open non-security Dependabot PRs (#267–#271) all fail `validate-inventory`; one is a
  major (`@testing-library/jest-dom` 7). Separate rollup on request.
