# `npm audit` minimatch and glob advisories (November 2026) — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-03
**Created:** 2026-11-03
**Scope:** root `package.json` (overrides), `services/nb-bond-api/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/npm-audit-minimatch-glob-2026-11/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, baseline, overrides and manifest, scratch resolve, transplant, inventory
Phase 2  Tool consequences: npm ci, audit, both workspace gates, verification scripts
Phase 3  Archive the plan folder, open the PR on request, merge on go-ahead
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Manifests and lockfile

1. Branch `feature/npm-audit-glob-minimatch` from `origin/development`.
2. Baseline: `npm ci`, then record the nb-bond-api and nb-ui test counts and `npm audit`.
3. Edit the overrides and the `babel-jest` pin to the design's target state.
4. Scratch copy of the manifests and lockfile, resolved with
   `npx -y npm@11.14.1 install --package-lock-only --ignore-scripts --legacy-peer-deps`, then
   `npm update minimatch glob brace-expansion babel-jest eslint-plugin-react --package-lock-only`
   with the same flags (a changed override is not re-applied to an existing lockfile).
5. Structural diff over whole entries, classified with the design's table. Transplant the
   intended, sibling, obsolete, and moved classes; keep the artefact and layout entries at the
   tracked state. A JSON round-trip of the tracked lockfile is first confirmed byte-identical, and
   the tracked key order is kept.
6. Override audit: every override resolves at its pin at every lockfile path.
7. Inventory: the `babel-jest` row.

Exit: the diff equals the design's classification.

Recovery: anything outside the table is classified before transplanting. Never fall back to an
in-place full install.

## Phase 2: Tool consequences

1. Strict `npx -y npm@11.14.1 ci`, then `npm audit` against the baseline.
2. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`.
3. `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build`.
4. Direct checks of the consumers the suites do not reach: `test-exclude` 7 on `glob` 14
   (`shouldInstrument`, `globSync`), and `minimatch` 11 named exports.
5. `python3 scripts/verification/check-third-party-licenses.py`,
   `check-node-version-consistency.py`, `check-public-repo-hygiene.py`, `check-markdown-links.py`.

Exit: all green; test counts equal the baseline.

Recovery: a `babel-jest` 30.5.2 regression that cannot be fixed narrowly holds that bump back,
which also holds the jest chain's findings open; say so in the PR.

## Phase 3: PR and cleanup

1. Move this folder to `docs/plans/archive/`, set the `Status:` line, and add the index entry, in
   the same commit.
2. On the operator's request, push and open a PR against `development` with the override table,
   the classified lockfile diff, the override audit, and the audit result.
3. Merge only on the operator's go-ahead (squash). Then confirm the Dependabot minimatch alert
   closes. Delete the local branch and worktree.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Churn, artefact removals, un-applied overrides | classified diff, override audit, strict `npm ci` |
| Security | Advisories not cleared | `npm audit`: only the findings with no upstream fix remain |
| Lint | `minimatch` 11 in eslint 10, eslint 9, typescript-estree | lint in both workspaces |
| Tests and coverage | `glob` 14, `test-exclude` 7, `babel-jest` 30.5.2 | jest and vitest suites; direct `test-exclude` check |
| Build | none expected | `tsc` and Vite builds |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] Overrides, `babel-jest` pin, and lockfile landed; the diff equals the classified table.
- [x] Strict `npm ci`, `npm audit` (7 findings, none fixable upstream), both workspace gates, and
      the verification scripts pass.
- [ ] PR merged on go-ahead; the minimatch alert closed.
