# Dependabot and security rollup (October 2026) — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-10-21
**Created:** 2026-10-21
**Scope:** root `package.json` (overrides), `services/nb-bond-api/package.json`, `services/nb-ui/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/dependabot-rollup-2026-10/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, baseline, manifests and overrides, scratch resolve, transplant, inventory
Phase 2  Tool consequences: npm ci, audit, both workspace gates, verification scripts
Phase 3  Archive the plan folder, open the PR, merge on go-ahead, confirm the bot and alerts
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate). The plan folder is
archived inside the same PR.

## Phase 1: Manifests and lockfile

1. Create branch `feature/dependabot-rollup-2026-10` from `origin/development`, in a separate
   worktree, so the main checkout (one commit behind) is left alone.
2. Baseline: `npm ci`, then record the nb-bond-api and nb-ui test counts on the unchanged tree.
   Save `git show HEAD:package-lock.json` to a scratch file as `lock.before`.
3. Edit the manifests and the three overrides to the design's target state.
4. Scratch copy of the manifests and lockfile:
   `npx -y npm@11.14.1 install --package-lock-only --ignore-scripts --legacy-peer-deps`, then
   `npm update ip-address source-map-js brace-expansion --package-lock-only` with the same flags.
5. Structural diff. Classify each moved entry using the design's table. Transplant every class
   except incidental and artefact. Construct the `undici` 8.10.2 entry from registry metadata in
   the shape of the existing entry. Keep the workspace ranges exact and the lockfile key order
   unchanged.
6. Override audit: every root override resolves at its pin at every lockfile path.
7. Inventory: nine rows in `THIRD_PARTY_LICENSES.md`.

Exit: the diff matches the design's classified table exactly (42 lines in the pre-flight), and
the classification is recorded in `progress.md`.

Recovery: if the diff contains anything outside the table, stop and classify it before
transplanting. Never fall back to an in-place full install.

## Phase 2: Tool consequences

1. `npx -y npm@11.14.1 ci` (strict) and `npm audit`: expect zero vulnerabilities.
2. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`.
   jose and express-rate-limit are covered by the auth and app tests.
3. `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build`. Compare
   the build's chunk listing with the baseline, as a sanity check on rolldown 1.2.14.
4. `python3 scripts/verification/check-third-party-licenses.py`,
   `check-node-version-consistency.py`, `check-public-repo-hygiene.py`, `check-markdown-links.py`.
5. Optional, if the operator wants it: a local nb-bond-api smoke (deploy, read endpoints answer,
   `RateLimit` headers present).

Exit: all green, and test counts equal the Phase 1 baseline or the difference is explained.

Recovery: a React 19.3 or rolldown regression that cannot be fixed narrowly holds that bump back,
with a note in `progress.md`, and the security fixes ship without it. A `vite` hold also keeps
alerts 101–106 open, so say so in the PR.

## Phase 3: PR and cleanup

1. Move this folder to `docs/plans/archive/dependabot-rollup-2026-10/`, set the `Status:` line,
   and add the index entry in `docs/DOCUMENTATION_INDEX.md`, all in the same commit.
2. Push and open a PR against `development`:
   `Dependabot and security rollup: React 19.3.1, vite 8.2.4, undici and brace-expansion pins`,
   with the bump table, the classified lockfile diff, the override audit, and the `npm audit`
   result. No AI attribution.
3. Merge only on the operator's go-ahead (squash). Then confirm that Dependabot alerts show zero
   open, and that #295–#299 are closed by the bot, or close them with a pointer to the rollup.
   Delete the local branch and worktree.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Churn, artefact removals, un-applied overrides, caret ranges | classified diff, override audit, strict `npm ci` |
| Security | Alerts not actually cleared | `npm audit` = 0; GitHub alert list after merge |
| API runtime | jose 6.2.13 error-path refactor, express-rate-limit 8.7.1 | nb-bond-api jest (auth, app), optional live smoke |
| UI runtime | React 19.3.1 and react-dom mismatch | nb-ui vitest suite (the 16 suites #298 broke) |
| UI build | vite 8.2.4, rolldown 1.2.14, source-map-js 1.2.2 | nb-ui build, chunk listing |
| Formatting and lint | prettier 3.9.10, globals 17.13.0 | `format:check` and lint in both workspaces |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] All bumps and overrides landed; the lockfile diff equals the classified table.
- [x] `npm ci`, `npm audit` (0), both workspace gates, and all verification scripts pass.
- [ ] PR merged on go-ahead; zero open Dependabot alerts; #295–#299 closed.
