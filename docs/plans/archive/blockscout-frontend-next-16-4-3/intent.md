# Blockscout frontend Next.js 16.4.3 pin — Intent

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Requested by:** sandbox operator

## Outcome

The locally built Blockscout frontend image ships Next.js 16.4.3 instead of the 16.3.5 that the
upstream `v2.12.1` tag locks. The change is one build step in `services/blockscout/build-images.sh`,
recorded in `docs/KNOWN_ISSUES.md`, and removable once an upstream frontend release locks a fixed
Next.js.

## Why This Change

Upstream Blockscout publishes no release images, so `./sandbox.sh build-images` builds the frontend
from the pinned source tag with upstream's Dockerfile unchanged. The `v2.12.1` tag (the newest v2.12
patch) locks `next` 16.3.5. That version is affected by the Next.js advisories fixed between 16.3.6
and 16.4.1, including two critical remote-code-execution advisories fixed in 16.4.1
(GHSA-2464-fhr4-w9xw, Image Optimization with SVG files; GHSA-673q-mjm6-r5xr, `use cache` functions
returning typed arrays). The explorer frontend is reachable through the local gateway.

## Scope

### In Scope

- One step in the frontend deps stage, added to the cloned upstream Dockerfile before building:
  `pnpm add -w next@16.4.3 --save-exact` after upstream's `pnpm install --frozen-lockfile`, with a
  raised Node heap.
- A fail-closed guard: the build stops if upstream's install line is not found exactly once.
- `docs/KNOWN_ISSUES.md`: the Blockscout source-build item and the frontend row of the trust-store
  register.

### Out of Scope

- The Blockscout backend image and its native libraries.
- Moving the frontend tag, Node base image, or any other upstream dependency.
- Changing how `build-images` pushes into the local registry.
- Any non-local rollout.

## Acceptance Criteria

| Criterion | Verification evidence |
|---|---|
| Every `next/package.json` in the built frontend image reads 16.4.3 | `find / -path "*/node_modules/next/package.json"` in the image |
| The build stops if upstream's install line changes | guard run against a Dockerfile without the line |
| The rebuilt frontend serves the explorer on the local sandbox | HTTP 200 from the explorer host after the rollout |
| Hygiene, link, licence, node-version, and image-hash checks pass | script output |

## Constraints

- No new dependency: Next.js is already part of the upstream frontend (MIT); only its version moves.
- Upstream's pnpm `minimumReleaseAge` (one week) stays in force; the pinned version must satisfy it.
- One PR against `development`. Public-repo rules apply.
