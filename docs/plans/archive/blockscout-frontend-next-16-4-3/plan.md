# Blockscout frontend Next.js 16.4.3 pin — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-03
**Created:** 2026-11-03
**Scope:** `services/blockscout/build-images.sh`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/blockscout-frontend-next-16-4-3/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Build step, guard, and Known Issues
Phase 2  Build, in-image check, and local rollout
Phase 3  Archive the plan folder, PR, merge on go-ahead
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Build step

1. Branch `feature/blockscout-frontend-next-16-4-3` from `origin/development`.
2. In `build-images.sh`, after cloning the frontend: keep the Next.js version in one variable with
   a comment saying why; check that `RUN pnpm install --frozen-lockfile` occurs exactly once in the
   cloned Dockerfile and stop otherwise; insert the `pnpm add` line after it.
3. Update `docs/KNOWN_ISSUES.md`: the Blockscout source-build item and the frontend register row.

Exit: `bash -n` passes and the guard stops on a Dockerfile without the line.

## Phase 2: Build and rollout

1. Run `services/blockscout/build-images.sh`.
2. List every `next/package.json` in the built frontend image and read its version; re-read the
   image's CA roots for the register row.
3. Replace the frontend's `-kind` tag in the local registry, drop the cached copy on the Kind node,
   and restart the frontend Deployment. Check that the explorer serves.

Exit: every acceptance row in `intent.md` has evidence in `progress.md`.

Recovery: the old image is still the local Docker image under the upstream tag until the rebuild
replaces it; reverting the commit and rebuilding restores 16.3.5. The frontend is stateless.

## Phase 3: PR

1. Archive this folder, set the `Status:` line, add the index entry, in the same commit as the change.
2. Run the hygiene, link, licence, node-version, and image-hash checks.
3. Push and open a PR against `development`. Merge only on the operator's go-ahead.

## Rollback

Revert the commit and rebuild; replace the registry copy the same way as in Phase 2.

## Done Criteria

- [x] Build step and guard in `build-images.sh`.
- [x] Known Issues updated.
- [x] In-image Next.js read as 16.4.3; explorer serves after rollout.
- [ ] PR merged on go-ahead.
