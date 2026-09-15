# Dependabot rollup (September 2026) — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-15
**Scope:** `services/nb-bond-api/package.json`, `services/nb-ui/package.json`, `scripts/bid-encryption/package.json`, `scripts/bid-submitter/package.json`, `common/node-version.env`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, plus any reformatted or lint-fixed files and `services/nb-bond-api/openapi.json` if regeneration changes it
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Manifests, env pin, lockfile transplant, override audit, inventory
Phase 2  Tool consequences: prettier reformat, lint, openapi regen, test suites
Phase 3  PR, merge, close #267-#271
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Manifests and lockfile

1. `git show HEAD:package-lock.json > <scratch>/lock.before.json`.
2. Bump the five packages in their manifests; set `SANDBOX_TYPES_NODE_VERSION=26.5.1`.
3. Scratch resolve; structural diff; classify moved entries (bumped, required sibling,
   incidental); transplant bumped plus required siblings only.
4. Override audit (every root override at its pin, nested `brace-expansion` copies unchanged).
5. Inventory: eight rows.

Exit: diff listing pasted into `progress.md` with each entry's class.

## Phase 2: Tool consequences

1. `npm ci`.
2. `cd services/nb-bond-api && npm run format:check`; `cd services/nb-ui && npm run format:check`.
   On failure run `npm run format` in that workspace and stage the files.
3. `cd services/nb-bond-api && npm run lint && npm test && npm run build`; fix or narrowly
   suppress new lint findings.
4. `cd services/nb-bond-api && npm run regen:openapi`; `git diff openapi.json`; keep and
   explain, or confirm empty.
5. `cd services/nb-ui && npm run lint && npm test && npm run build` (jest-dom 7, prettier 3.9.6).
6. `python3 scripts/verification/check-third-party-licenses.py`,
   `check-node-version-consistency.py`, `check-public-repo-hygiene.py`, `check-markdown-links.py`.

Exit: all green; test counts unchanged (nb-bond-api 249, nb-ui 125) or the change explained.

## Phase 3: PR and cleanup

1. PR against `development`: `Dependabot rollup: typescript-eslint, @types/node, jest-dom 7, zod, prettier`
   with the bump table, the lockfile classification, and any reformat/lint/openapi notes.
2. After merge: close #267–#271 with a comment pointing at the rollup; archive this folder.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Incidental churn, un-applied overrides | structural diff with classification, override audit |
| Node pin | `@types/node` vs runtime rule | `check-node-version-consistency.py` |
| Formatting | prettier 3.9.6 output change | `format:check` both workspaces |
| Lint | typescript-eslint 8.69 new rules | nb-bond-api lint |
| API contract | zod 4.5.4 emitted schema | `regen:openapi` diff, jest |
| UI tests | jest-dom 7 matchers | vitest suite |
| Inventory | Version drift | licence checker |

## Done Criteria

- [ ] Five bumps landed; only required siblings moved; overrides intact.
- [ ] All gates and verification scripts pass; consequences documented.
- [ ] #267–#271 closed as superseded.
