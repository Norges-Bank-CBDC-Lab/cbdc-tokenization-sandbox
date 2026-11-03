# Blockscout frontend Next.js 16.4.3 pin — Design

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Intent:** [`intent.md`](intent.md)

## Decision Summary

Patch the cloned upstream Dockerfile in the build's temporary directory, adding one `RUN` line after
the deps stage's frozen install that runs `pnpm add -w next@16.4.3 --save-exact` with
`NODE_OPTIONS=--max-old-space-size=6144`. The builder stage copies `/app` from the deps stage, so the
updated `package.json`, lockfile, and `node_modules` flow into `next build` and into the standalone
runtime output without further changes.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `build-images.sh` clones `blockscout/frontend` at the `common/images.yaml` tag and builds upstream's Dockerfile unchanged | script | The patch point is the cloned Dockerfile |
| **Verified.** `v2.12.1` pins `"next": "16.3.5"` in `package.json` | upstream tag | The image ships 16.3.5 today |
| **Verified.** The deps stage has exactly one `RUN pnpm install --frozen-lockfile` line, and the builder stage starts with `COPY --from=deps /app ./` | upstream Dockerfile | One insertion point, and the result reaches the build |
| **Verified.** Upstream's `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (one week) | upstream tag | 16.4.3 (published 2026-10-23) qualifies; 16.4.4 (2026-11-02) does not yet |
| **Verified.** The 16.4.1 advisories GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr cover `next` up to 16.4.0 | GitHub advisory database | 16.4.3 is past every published fix |
| **Verified.** `loadImageToKind` skips the push when the `-kind` tag is already in the local registry | `common/helpers.sh` | An existing sandbox keeps the old build until its registry copy is replaced |

## Rejected Alternatives

- **A patched copy of the Dockerfile in this repository.** It would drift from upstream on every
  frontend bump. The in-place edit keeps upstream's file and fails if its install line changes.
- **Editing `package.json` and the lockfile before the build.** The lockfile would have to be
  regenerated outside the image with the same pnpm version and config; `pnpm add` inside the deps
  stage does that with upstream's own toolchain.
- **Bypassing `minimumReleaseAge` to take 16.4.4.** Upstream's supply-chain delay stays in force.
- **Waiting for an upstream frontend release.** None locks a fixed Next.js yet.

## Risks

- **Upstream changes its install line.** The guard stops the build and names the step to review.
- **Next.js 16.4 behaviour differs from 16.3 for the explorer.** Covered by building the full
  frontend and checking that the rolled-out explorer serves.
- **The image keeps its upstream tag.** A registry that already holds the tag does not take the new
  build automatically; recorded in `docs/KNOWN_ISSUES.md`.
