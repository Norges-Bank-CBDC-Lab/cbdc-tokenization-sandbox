# Dependabot rollup (September 2026) — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-15 — Phases 1 and 2 done; PR opened with the plan archived in it
**Current phase:** Phase 3: PR, then close #267–#271 after merge
**Next action:** After merge, close Dependabot PRs #267–#271 as superseded

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Manifests and lockfile | Done | five bumps plus `SANDBOX_TYPES_NODE_VERSION=26.5.1`; lockfile changed 20 entries: the five packages, ten `@typescript-eslint/*` siblings (exact pins of the bumped family), `undici-types` 8.3.0→8.9.0 (`@types/node` 26.5.1 requires `~8.9.0`), and four workspace ranges; excluded `ignore` 7.0.6→7.0.9 (incidental, `^7.0.5`) and eight removals that were artifacts of legacy peer resolution; scalar overrides at their pins, nested `brace-expansion` copies unchanged; eight inventory rows (2026-09-15) | this PR |
| 2 — Tool consequences | Done | `npm ci` installs the six new versions; prettier 3.9.6 needed no reformat in either workspace; typescript-eslint 8.69.0 added no findings; nb-bond-api 249 jest tests and build; nb-ui 125 vitest tests and build on jest-dom 7.0.1; `regen:openapi` changed only nullable-shape emission (zod 4.5.4 emits `"type": ["string","null"]` instead of `anyOf` with a null branch; equivalent under OpenAPI 3.1, contract tests pass); both CLIs type-check on `@types/node` 26.5.1; inventory, node-version, hygiene, and link checks pass (2026-09-15) | this PR |
| 3 — PR and cleanup | Not started | | |

## Deviations From the Plan

- The scratch resolution needed `--legacy-peer-deps`: `typescript-eslint` (8.64.0 and 8.69.0
  alike) declares `typescript >=4.8.4 <6.1.0` while nb-bond-api pins TypeScript 7.0.2, so the
  existing tree already sits past that peer and a strict resolve refuses. Not introduced here.
- Archived in the same PR as the change, at the operator's request, instead of a separate
  document-move PR.

## Verified So Far

- Bump list, manifests, inventory rows, the Node-pin rule, zod-openapi's peer range, and
  jest-dom 7's peer and engine requirements verified on 2026-09-15 (see `design.md`).

## Follow-ups Found Along the Way

- `typescript-eslint` 8.x peers `typescript <6.1.0`; the repo runs TypeScript 7.0.2. Lint works
  today, but every resolve needs legacy peer handling until typescript-eslint widens its range
  or the repo pins a supported TypeScript. Worth a `docs/KNOWN_ISSUES.md` entry if it persists.
