# Node 26.12 toolchain pin bump — Intent

**Status:** Approved (2026-10-21)
**Created:** 2026-10-21
**Requested by:** sandbox operator

## Outcome

CI, the local image builds, and the `@types/node` pin all move from Node 26.5.0 to the newest
26.x release, so the sandbox runs on a Node line that includes the two security releases it
currently lacks. After `./sandbox.sh start`, the running nb-bond-api and nb-ui build images
report the new version.

## Why This Change

`common/node-version.env` pins `SANDBOX_NODE_VERSION=26.5.0` (released 2026-07-08). Since then
Node has shipped two security releases on the 26 line: 26.5.1 (2026-07-28) and 26.12.1
(2026-10-21). Dependabot does not track this file or the Dockerfile base images, so nothing
prompts the bump.

## Scope

### In Scope

- `common/node-version.env`: `SANDBOX_NODE_VERSION`, `SANDBOX_NODE_IMAGE`, and
  `SANDBOX_TYPES_NODE_VERSION`.
- `@types/node` 26.5.1 → 26.6.5 in nb-bond-api, bid-encryption, and bid-submitter. This updates
  the lockfile entry, the three workspace ranges, and three inventory rows.
- (Landed separately as #308.) The repo-owned image cache keys (`nbBondApiBundleHash`, `nbUIBundleHash` in
  `common/helpers.sh`) include their base image refs, so a base-image bump rebuilds the image.
  Without this, the env-file change alone would leave existing local images on 26.5.0.
- A sensitivity case for that in `scripts/verification/check-image-hash-inputs.sh`.
- Docs that name the pin as an instruction or example: `infra/DEVELOPMENT.md`, and the slim-image
  steps of the active `docs/plans/nb-bond-api-hardening/` plan.
- A local rebuild and version check of the two repo-owned Node images.

### Out of Scope

- The Node 26 LTS transition (scheduled 2026-10-28) and its first LTS-tagged release. That goes
  in a later bump.
- Base-image cache keys for `bens-microservice` (Python). It has the same gap, but nothing in this
  change bumps it.
- The `packageManager` field (`npm@11.14.1`) versus the npm bundled with Node (11.17.0 today,
  11.20.0 with 26.12.1). They already differ, and changing that is a separate decision.
- Adding Dependabot `docker` or Node-version tracking.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| `node:<new>` publishes amd64 and arm64 before work starts | Building on an incomplete image index | registry manifest listing |
| `check-node-version-consistency.py` passes with the new pins | Pin drift across env, manifests, lockfile, workflows | script output |
| Changing only a base image ref changes both bundle hashes; unrelated files still do not | Stale local images after a base bump | `check-image-hash-inputs.sh`, including the new case |
| Lockfile diff contains only `@types/node` and the three workspace ranges | Incidental churn | structural diff |
| Both workspace gates and both CLI typechecks pass, with test counts equal to baseline | Runtime or types regression | package gates |
| CI runs on the new version | Local/CI mismatch | `setup-node` log in the PR |
| Rebuilt local images report the new version via `node --version`, and the API serves reads | Images not actually rebuilt; native `better-sqlite3` binding | `kubectl exec` and a read-only curl |

## Constraints

- No new dependency. Node is MIT, and so is `@types/node`.
- One PR against `development`. Public-repo rules apply.

## Resolved Questions

- At approval (2026-10-21) the operator chose 26.12.1 now, `@types/node` 26.6.5, the
  nb-bond-api and nb-ui cache-key fix in this PR, the hardening plan line updates, a live check
  with a local sandbox restart, and no release.
