# Dependabot rollup (November 2026) — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-03
**Created:** 2026-11-03
**Scope:** `services/nb-bond-api/package.json`, `services/nb-ui/package.json`, `scripts/bid-encryption/package.json`, `scripts/bid-submitter/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/dependabot-rollup-2026-11/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, baseline, manifests, scratch resolve, transplant, inventory
Phase 2  Tool consequences: npm ci, audit, both workspace gates, verification scripts
Phase 3  Archive the plan folder, open the PR, merge on go-ahead, confirm the bot
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Manifests and lockfile

1. Branch `feature/dependabot-rollup-2026-11` from `origin/development`, in a separate worktree.
2. Baseline: `npm ci`, then record the nb-bond-api and nb-ui test counts and `npm audit`.
3. Edit the six exact pins in four manifests.
4. Scratch copy of the manifests and lockfile, resolved with
   `npx -y npm@11.14.1 install --package-lock-only --ignore-scripts --legacy-peer-deps`.
5. Structural diff, order-normalised, over whole entries. Transplant the classified entries only.
   A JSON round-trip of the tracked lockfile is first confirmed byte-identical, so the
   transplant cannot reformat anything.
6. Override audit, then the six inventory rows.

Exit: the lockfile diff equals the design's ten entries (60 lines).

Recovery: anything outside the table is classified before transplanting. Never fall back to an
in-place full install.

## Phase 2: Tool consequences

1. Strict `npm ci` with npm 11.14.1, then `npm audit` against the baseline.
2. nb-bond-api: lint, `format:check`, `npm test`, `npm run build`, and `npm run regen:openapi`
   with no resulting diff.
3. nb-ui: `format:check`, lint, `npm test`, `npm run build`.
4. The `bid-encryption` CLI: `keygen` and `encrypt`, which exercise `@noble/secp256k1`.
5. The licence, hygiene, and link checks.

Exit: all green; test counts equal the baseline.

Recovery: a regression that cannot be fixed narrowly holds that bump back, with a note in
`progress.md`.

## Phase 3: PR and cleanup

1. Move this folder to `docs/plans/archive/`, set the `Status:` line, and add the index entry, in
   the same commit.
2. Push and open a PR against `development` with the bump table, the classified lockfile diff,
   the override audit, and the audit result.
3. Merge only on the operator's go-ahead (squash). Then confirm the bot closes #344, #345, #347,
   and #348; #346 is closed or left with a pointer to `docs/KNOWN_ISSUES.md` as the operator
   decides. Delete the local branch and worktree.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Churn, artefact removals, un-applied overrides, caret ranges | classified diff, override audit, strict `npm ci` |
| API runtime | `@noble/secp256k1` 3.2.0 in bidder keys and encryption; `zod-openapi` 6.0.2 | nb-bond-api jest; `openapi.json` regenerates unchanged |
| CLI | `@noble/secp256k1` 3.2.0 in key generation and ECDH | `bid-encryption` `keygen` and `encrypt` runs |
| UI | `vite` 8.3.5 with `postcss` 8.5.32; `user-event` 14.6.8 | nb-ui vitest suite and production build |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] All bumps landed; the lockfile diff equals the classified table.
- [x] Strict `npm ci`, both workspace gates, and the verification scripts pass.
- [ ] PR merged on go-ahead; #344, #345, #347, and #348 closed.
