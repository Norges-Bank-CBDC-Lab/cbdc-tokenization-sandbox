# Dependabot rollup (late September 2026) — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-09-25
**Created:** 2026-09-25
**Scope:** `services/nb-bond-api/package.json`, `services/nb-ui/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, plus any lint-fixed files and `services/nb-bond-api/openapi.json` if regeneration changes it
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Manifests, lockfile transplant, override audit, inventory
Phase 2  Tool consequences: lint, openapi regen, test suites, builds
Phase 3  PR, merge, close #287-#290
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate). The plan folder is
archived inside the same PR.

## Phase 1: Manifests and lockfile

1. Record the baseline: `npm ci`, then the nb-bond-api and nb-ui test counts on the unchanged
   tree.
2. `git show HEAD:package-lock.json > <scratch>/lock.before.json`.
3. Bump the four packages in their manifests.
4. Scratch resolve; structural diff; classify moved entries (bumped, required sibling,
   incidental); transplant bumped plus required siblings only; workspace ranges exact.
5. Override audit (every root override at its pin, nested `brace-expansion` copies unchanged).
6. Inventory: four rows.

Exit: diff listing recorded in `progress.md` with each entry's class.

## Phase 2: Tool consequences

1. `npm ci`.
2. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`;
   fix or narrowly suppress new lint findings.
3. `cd services/nb-bond-api && npm run regen:openapi`; `git diff openapi.json`; keep and
   explain, or confirm empty.
4. `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build`.
5. `python3 scripts/verification/check-third-party-licenses.py`,
   `check-node-version-consistency.py`, `check-public-repo-hygiene.py`, `check-markdown-links.py`.

Exit: all green; test counts equal the Phase 1 baseline or the change is explained.

## Phase 3: PR and cleanup

1. Archive this folder to `docs/plans/archive/` and update `docs/DOCUMENTATION_INDEX.md` in the
   same commit.
2. PR against `development`:
   `Dependabot rollup: zod 4.6.5, typescript-eslint, plugin-react, RTL` with the bump table,
   the lockfile classification, and any lint or OpenAPI notes.
3. After merge: close #287–#290 with a comment pointing at the rollup. #286 stays open.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Incidental churn, caret ranges, un-applied overrides | structural diff with classification, override audit |
| Lint | typescript-eslint 8.70.1 rule changes | nb-bond-api lint |
| API contract | zod 4.6.5 emitted schema and validation | `regen:openapi` diff, jest |
| UI build and tests | plugin-react 6.1.1 transform, Testing Library 16.3.3 | nb-ui build and vitest suite |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] Four bumps landed; only required siblings moved; overrides intact.
- [x] All gates and verification scripts pass; consequences documented.
- [ ] #287–#290 closed as superseded; #286 left for its own PR.
