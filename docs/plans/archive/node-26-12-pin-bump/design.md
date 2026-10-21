# Node 26.12 toolchain pin bump — Design

**Status:** Approved (2026-10-21)
**Created:** 2026-10-21
**Intent:** [`intent.md`](intent.md)
**Builds on:** the centralized pin from #217 (`common/node-version.env` plus
`scripts/verification/check-node-version-consistency.py`).

## Decision Summary

Move the runtime pin to 26.12.1 and `@types/node` to 26.6.5, the newest types line the pin rule
allows. Make the two repo-owned Node image cache keys include their base image refs, so the bump
rebuilds the images instead of silently reusing 26.5.0 builds. Start only once Docker Hub has
published `node:26.12.1` for amd64 and arm64.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** One file holds the pin. `helpers.sh` derives all three Node base images from `SANDBOX_NODE_IMAGE`, the Dockerfiles take them as build args, and CI reads the version through a step output | `common/node-version.env`, `common/helpers.sh:45-51`, both Dockerfiles, `nb-bond-api.yml` / `nb-ui.yml` | The runtime bump is one file; the checker enforces the rest |
| **Verified.** The checker requires `@types/node` to be on the runtime's major and no newer than its minor | `check-node-version-consistency.py` | 26.6.x is allowed under a 26.12 runtime |
| **Verified.** Node 26.5.1 (2026-07-28) and 26.12.1 (2026-10-21) are security releases; the pin is 26.5.0 | `nodejs.org/dist/index.json` | The current pin lacks two sets of security fixes |
| **Verified.** Node 26 enters LTS on 2026-10-28 | nodejs/Release `schedule.json` | A later bump will pick up the first LTS-tagged release; not waited for here |
| **Verified on 2026-10-21.** The manifest index for `node:26.12.1` (and `-slim`) exists but lists no platform images yet; `node:26.5.0` lists amd64 and arm64 | registry manifest query | Phase 0 waits for publication |
| **Verified.** `nbBondApiBundleHash` and `nbUIBundleHash` hash sources, manifests, the lockfile, and the Dockerfile, but not the base image refs. `buildAndPushHashedImage` skips the build whenever that hash tag is already in the local registry | `common/helpers.sh:1746-1835`, `:1235-1290` | **Defect.** A base-image-only bump never reaches local images. It is fixed here because the outcome depends on it |
| **Verified.** `@types/node` 26.6.5 (2026-10-09) keeps `undici-types ~8.9.0`, the version already locked | registry, lockfile | Only the `@types/node` entry and the three workspace ranges move |
| **Verified.** The `nb-bond-api-hardening` plan (not yet implemented) instructs adding `SANDBOX_NODE_RUNTIME_SLIM_IMAGE=node:26.5.0-slim` | `docs/plans/nb-bond-api-hardening/plan.md:64,378`, `design.md:342` | Point those instruction lines at the new pin; leave its dated evidence lines as they are |
| **Verified.** `infra/DEVELOPMENT.md:57` uses `node:26.5.0` as an example | file | Refresh the example, as #217 did |
| **Inferred.** `better-sqlite3`'s prebuilt binary keys on the Node ABI (`NODE_MODULE_VERSION`), which is fixed within a major | Node ABI policy | No rebuild issue is expected; the live read check confirms it |

## Target State

- `common/node-version.env`: `SANDBOX_NODE_VERSION=26.12.1`, `SANDBOX_NODE_IMAGE=node:26.12.1`,
  `SANDBOX_TYPES_NODE_VERSION=26.6.5`. `SANDBOX_NODE_MAJOR` stays at 26.
- `@types/node` 26.6.5 in three workspace manifests, the lockfile, and three inventory rows.
- `nbBondApiBundleHash` also hashes `NB_BOND_API_BUILDER_BASEIMAGE` and
  `NB_BOND_API_RUNTIME_BASEIMAGE`. `nbUIBundleHash` also hashes `NB_UI_BUILDER_BASEIMAGE` and the
  resolved nginx base. All of these are plain strings in the existing hash pipeline.
- `check-image-hash-inputs.sh`: a case asserting that each of the two hashes changes when its base
  image ref changes, with nothing on disk touched.
- Doc refresh: `infra/DEVELOPMENT.md:57`; the hash-input lists in
  `scripts/verification/README.md`, `services/nb-bond-api/README.md`, and
  `services/nb-ui/DEVELOPMENT.md`; `nb-bond-api-hardening/plan.md:64,378` and
  `design.md:342` (the instruction lines only), plus a one-line deviation note in that plan's
  `progress.md`.

## Alternatives Considered

- **Wait a week for the first LTS-tagged 26.x.** That would carry the two missing security
  releases another week, for a label. The LTS bump is a one-file change later.
- **26.5.1, the smallest security step.** It still misses 26.12.1's fixes, and 26.5.1 and 26.12.1
  are the same ABI and major.
- **Rely on the `@types/node` lockfile change to bust the hash.** It works this time, because
  both hashes include the lockfile, but only by accident. The next runtime-only bump, or an
  nginx bump, would ship stale images.
- **Hash `common/node-version.env` as a file.** That is coarser: a types-only pin change would
  rebuild images for no runtime reason. Hashing the resolved refs is exact.
- **Leave `@types/node` at 26.5.1.** It is allowed, but Dependabot will propose 26.6.x and that PR
  fails `validate-node-version`. Moving it here keeps the pins together.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Target runtime | 26.12.1 now; the LTS release in a later bump | Decided at approval (2026-10-21) |
| `@types/node` | 26.6.5 | Decided at approval |
| Fold the base-image cache-key fix into this PR | Yes, for nb-bond-api and nb-ui only; bens recorded as a follow-up | Approved |
| Edit the active `nb-bond-api-hardening` plan's slim-image lines | Yes, instruction lines plus a deviation note | Decided at approval |
| Live check | Yes: rebuild both images locally, `node --version` in the API pod, one read endpoint | Approved, including the restart |
| Release afterwards | None | Decided at approval |

## Residual Risks

- The Node minors between 26.5 and 26.12 can change runtime behaviour (deprecations, defaults).
  The jest and vitest suites, the UI build, and the live API read are the controls.
- The first local start after the change rebuilds both images and pulls the new base (about
  1 GB). That is a one-time cost.
