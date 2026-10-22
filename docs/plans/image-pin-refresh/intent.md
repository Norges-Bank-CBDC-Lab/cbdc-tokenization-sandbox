# Image and chart pin refresh — Intent

**Status:** Approved (local scope) — 2026-10-21
**Created:** 2026-10-21
**Requested by:** sandbox operator

## Outcome

Every container image and Helm chart the local sandbox pins outside the npm manifests is on the
newest upstream release of its current line (or of the next major, where the operator approves
it), each bump has been read against its release notes, and each one is proven on a running
local sandbox. Operators who already have a sandbox actually receive the new versions on the next
start, instead of keeping the old ones because a cache key or a running container did not
notice the change.

## Why This Change

Dependabot covers only `npm` and `github-actions` in this repository (`.github/dependabot.yml`):
there is no `docker` ecosystem entry, and Helm charts are pinned in a YAML file it does not
parse. The second layer of
pins (`common/images.yaml`, `common/versions.yaml`, the `ARG` defaults in the Dockerfiles, the
Helm fallbacks, the constants in `common/helpers.sh`) has therefore drifted silently. On
2026-10-21 every one of them trails upstream, and two trail by known security fixes: the nginx
stable line used by the NB UI runtime (1.30.3, fixes through 1.30.6) and the local Docker
registry (`registry:2.8.3`, whose open advisories have no 2.x fix).

Two cache mechanisms can also hide a bump from an existing sandbox:

- `bensImageHash` in `common/helpers.sh` does not include the Python base image ref, so a
  Python-only bump reuses the old `bens-microservice:<hash>` image.
- `ensureKindRegistry` restarts an existing `kind-registry` container rather than recreating it,
  so a `local_registry` bump reaches only machines that never had the container.

## Scope

### In Scope

| Pin | Current | Target | Line |
|---|---|---|---|
| `nginxinc/nginx-unprivileged` (NB UI runtime) | `1.30.3-alpine` | `1.30.6-alpine` | stable patch |
| `postgres` (Blockscout and BENS databases) | `18.4` | `18.6` | minor (patch) |
| `python` (BENS build and runtime) | `3.14.5` | `3.14.8` | patch |
| `charts.blockscout_stack` | `4.5.1` | `4.5.3` | chart patch |
| `charts.nginx_gateway_fabric` (+ Gateway API CRDs) | `2.6.6` | `2.8.0` | chart minor |
| `hyperledger/besu` | `26.7.1` | `26.10.0` | three monthly releases |
| Blockscout smart-contract-verifier | `v1.10.6` | `v1.11.0` | minor |
| Blockscout frontend (source-built) | `v2.10.3` | `v2.12.1` | minor |
| Blockscout backend (source-built) | `v11.2.6` | `v12.0.3` | **major** |
| `registry` (local Docker registry) | `2.8.3` | `3.1.2` | **major** |

Plus, because a bump is not complete if it never reaches a running sandbox:

- the BENS content hash includes its Python base ref, with the matching assertion in
  `scripts/verification/check-image-hash-inputs.sh`;
- a `local_registry` pin change recreates the registry container (or, if the operator prefers,
  the plan documents `registry-reset` as the required step);
- every file that names a moved pin moves with it, including the dead fallback constants that
  still exist today, `docs/THIRD_PARTY_NOTES.md`, the READMEs and `check-besu-qbft-baseline.py`.

### Out of Scope

- Any non-local deployment. The plan only records, per slice, what that later rollout must
  respect.
- Deleting the dead fallback constants in `common/helpers.sh` and adding a pin-consistency
  check. That is Phase 9 (I9) of `docs/plans/sandbox-scripts-and-ci-hardening/`; this plan only
  keeps those constants in step so that phase starts from a consistent tree.
- A Dependabot `docker` ecosystem entry or other automation for these pins (needs a CI decision;
  proposed as a follow-up).
- `kindest/node` (digest-pinned in `infra/cluster/cluster-config.yaml`; changing it recreates the
  cluster) and `busybox:1.37.0` in the Blockscout migration job.
- Python 3.15, nginx mainline 1.31.x, Node.js (handled by the separate Node 26.12.1 pin bump).
- Any nb-ui nginx configuration hardening (owned by
  `docs/plans/nb-ui-correctness-and-hardening/`).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Every in-scope pin names the target version in every tracked file that names it | A half-swept pin: Helm fallback, Dockerfile `ARG`, or docs still on the old version | `git grep` for each old version returns only archived plans and frozen records |
| Each target tag exists for `linux/amd64` and `linux/arm64` on the day of the PR | Apple-silicon and x86 operators cannot pull or build | Registry manifest listing recorded in the PR |
| A Python-only bump changes `bensImageHash` | Stale BENS image after a base bump | `bash scripts/verification/check-image-hash-inputs.sh` asserts it |
| A `local_registry` bump reaches an existing sandbox | Old registry image kept forever | `docker inspect kind-registry` shows `registry:3.1.2` after the documented step |
| The NB UI serves from nginx 1.30.6 | Security fixes not deployed | `Server` header or `nginx -v` in the running pod |
| The gateway, Besu, Blockscout (backend, frontend, verifier, BENS) and NB UI are healthy on the new pins | Upgrade regressions | Per-slice live checks in `plan.md`, including contract verification and the catch-up indexer |
| Besu baseline still holds | QBFT/Osaka regression | `check-besu-qbft-baseline.py` (constant moved to `26.10.0`), block production, `eth_chainId` 2018 |
| Inventory and public-repo gates pass | Stale third-party notes, leaked text | `check-third-party-licenses.py`, `check-public-repo-hygiene.py`, `check-markdown-links.py` |
| Each slice records its non-local impact (node wipe, contract redeployment, data migration, prerequisites) | A later non-local rollout repeats a step that destroys chain or explorer state | "Deferred Non-Local Rollout" table in `plan.md`, re-checked in each PR body |

## Constraints

- **local upgrade only**: this plan changes and proves the local sandbox. No slice deploys to a
  non-local environment; that rollout happens later. Each slice states its non-local impact,
  and in particular whether it would need a node wipe or a smart-contract redeployment there (see
  "Deferred Non-Local Rollout" in `plan.md`)
- sandbox-sized; local-first; nothing about any non-local deployment in committed text beyond
  that environment-neutral impact note
- each slice is a `feature/<kebab>` PR against `development`, opened only on the operator's go-ahead
- no new dependency or licence beyond `ffmpeg` in the source-built Blockscout v12 image
  (decision D4); every other target keeps the licence already listed (re-confirmed per slice)
- destructive local steps (`registry-reset`, `./sandbox.sh delete`) only with the operator's go-ahead

## Open Questions

None. The operator approved the draft and decisions D1–D6 on 2026-10-21, with the scope limited
to the local sandbox. D4 (ffmpeg) needs its second confirmation before slice 6.
