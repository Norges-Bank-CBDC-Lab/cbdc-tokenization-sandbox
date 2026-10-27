# Image and chart pin refresh — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-10-27 — Phase 5 (Besu 26.10.0) merged as #312; D4 second confirmation recorded
**Current phase:** Phase 6: Blockscout v12 + frontend v2.12 (not started)
**Next action:** Branch `feature/blockscout-v12` from a fresh `development` and run the Phase 6
baseline; the prerequisites (D2, D4, Phases 3 and 5 merged) are met.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline | Done for planning (2026-10-21); re-run per slice | see below | — |
| 1 — Image hash base refs | Done (merged 2026-10-21) | `check-image-hash-inputs.sh` 11/11 plus a negative test; one-time rebuild of all three images on the local sandbox; CI green | #308 |
| 2 — nginx 1.30.6 | Done (merged 2026-10-21) | nb-ui pod `nginx -v` = 1.30.6, HTTP 200, `config.js` overlay served; CI green | #309 |
| 3 — Blockscout supporting components | Done (merged 2026-10-21) | Postgres 18.6 in place, BENS on Python 3.14.8, chart 4.5.3 renders identically, verifier v1.11.0 re-verifies Wnok; CI green | #310 |
| 4 — NGINX Gateway Fabric 2.8.0 | Done (merged 2026-10-21) | Gateway API CRDs v1.6.3, NGF CRDs incl. three new kinds, data plane nginx 1.31.7, four hostnames answer; fresh-cluster path covered by the Phase 5 fresh boot; CI green | #311 |
| 5 — Besu 26.10.0 | Done (merged 2026-10-21) | in-place upgrade, validator rollback rehearsal, fresh-chain boot with contracts redeployed and verified | #312 |
| 6 — Blockscout v12 + frontend v2.12 | Not started | | |
| 7 — Local registry 3.1.2 | Not started | | |

## Deviations From the Plan

- 2026-10-21: the operator gave D4's second confirmation (accept `ffmpeg` in the locally built
  Blockscout v12 image). Phase 6 records it in `docs/THIRD_PARTY_NOTES.md` and
  `THIRD_PARTY_LICENSES.md`.
- 2026-10-21, Phase 5: the rollback rehearsal covered only the Bonsai validator. The Forest
  archive's downgrade needs a safety override that was not run (see Verified So Far). `plan.md`
  now documents both halves and the Helm field-manager cleanup.
- 2026-10-21, Phase 4: the NGF CRD apply needs `--force-conflicts`, and only server-side works
  (see Verified So Far); `plan.md` step 2 is updated.
- 2026-10-21, Phase 3: `ANALYZE` runs on `blockscout_db` only; BENS has no separate database.
  `plan.md` is corrected.
- 2026-10-21: the operator approved D1–D6 and limited the scope to the local sandbox. The
  Besu rollback moved from `./sandbox.sh delete` to `besu storage revert-code-format`, after
  confirming that the 26.10.0 database upgrade affects only the Bonsai validator and ships a
  revert subcommand.

## Verified So Far

- Pin inventory by `git grep` on `origin/development` at `f9e9b0a` — 2026-10-21.
- Newest tags and amd64/arm64 availability on Docker Hub, ghcr.io and GitHub releases for
  every in-scope pin — 2026-10-21. Python 3.14.9 is released but has no image yet; `postgres`
  18.5 was never released.
- Running images match the pins; nb-ui `nginx -v` = 1.30.3; Gateway API CRDs v1.5.1; Kind node
  v1.32.11; gateway published on `0.0.0.0:80`/`:8545`, registry on `127.0.0.1:5001` —
  2026-10-21.
- Blockscout `fill_internal_transactions_address_ids` = `completed`; 160 blocks indexed (v12
  upgrade gate satisfied) — read-only `psql` query, 2026-10-21.
- `bensImageHash` omits the Python base ref on `development`; the pending Node 26.12.1 pin
  bump adds base refs for nb-ui and nb-bond-api only — 2026-10-21.
- `docker.io/library/node:26.12.1` resolves to an OCI index with no manifests — 2026-10-21
  (affects the Node pin bump, not this plan directly).
- Upstream facts relied on: Blockscout `version_upgrade.ex` (`since 12.0.0, min_from 11.0.2`),
  the v12.0.3 `docker/Dockerfile` (Elixir 1.20.4 / OTP 28, `ffmpeg`), frontend v2.11.0 / v2.12.0
  compatibility tables, and the verifier v1.11.0 `base.toml` (`[compilers.execution] type =
  "disabled"`). Alpine's `ffmpeg` licence is `GPL-2.0-or-later AND LGPL-2.1-or-later`.
- Besu 26.10.0 release notes: the database auto-upgrade applies to Bonsai only (DB v4 / archive
  v3) and `besu storage revert-code-format` reverts it; `separateApi.enabled: false` in
  `services/blockscout/values.yaml`, so chart 4.5.2's strategy change does not apply — 2026-10-21.

- Phase 1 live check (2026-10-21): new hashes `nb-ui:1c4a3bad4d62`, `nb-bond-api:e9b24c156cd2`
  and `bens-microservice:d23100904bb4` were built, pushed and deployed once. The previous BENS
  tag `f4aa56680fa6` equals the old formula's hash on the same tree, so its change comes only from
  the Python base ref. Pods are Ready; NB Bond API `/v1/health` is `ok` (chain 2018, ingestion
  lag 0); nb-ui answers 200 through the gateway; BENS answers 2xx; Blockscout is unaffected.
- Phase 1 negative test: with the nginx and BENS base-ref lines removed from a scratch copy of
  `common/helpers.sh`, the check fails on `nb_ui.nginx` and `blockscout.bens`.
- Phase 2 live check (2026-10-21): `nginxinc/nginx-unprivileged:1.30.6-alpine` is still the newest
  1.30.x tag (amd64 and arm64). `registry-sync` then `nb-ui.sh start` built `nb-ui:7aa301b9b8bc`
  from base digest `sha256:f5116ed4…` (the Docker Hub digest for the tag); the slice 1 hash
  rebuilt it without any manual step. The pod is Ready with the read-only root filesystem,
  `nginx -v` prints `nginx/1.30.6`, the UI answers 200 through the gateway, and `config.js` is
  served from the ConfigMap overlay. nb-ui format, lint, tests and build pass locally.
- Phase 3 live check (2026-10-21): the newest tags were still `postgres:18.6`, `python:3.14.8`
  (3.14.9 has no image yet), `blockscout-stack` 4.5.3 and verifier `v1.11.0`, all amd64 and
  arm64. With the sandbox values, `helm template` of chart 4.5.1 and 4.5.3 differs only in the
  `helm.sh/chart` label.
  - `registry-sync` then `blockscout.sh start`: Postgres restarted on 18.6 against the existing
    PVC, kept all 12 verified contracts, and `ANALYZE` ran.
  - BENS rebuilt as `bens-microservice:1735ad6bb388`; `python -V` reports 3.14.8, and `/health`
    answers 200.
  - The explorer API answered 500 for about a minute after the database restart (its
    `Repo.Replica1` pool reconnecting), then 200. The indexer reported "caught up" throughout,
    and the latest indexed block equals the chain head.
  - Verifier v1.11.0 with `SMART_CONTRACT_VERIFIER__COMPILERS__EXECUTION__TYPE=native`
    recompiled `Wnok` (14 sources, solc 0.8.36) from its Blockscout-stored standard-JSON input
    and returned `SUCCESS`, a partial match like the stored verification.
  - `indexed_blocks_ratio` stays at 0.98, as before this slice.
- Phase 4 live check (2026-10-21): NGF 2.8.0 is still the newest release, and both images are
  published for amd64 and arm64.
  - Server-side dry runs against the live cluster: client-side apply of `deploy/crds.yaml`
    fails (the `nginxproxies` annotation exceeds 256 KiB), and plain server-side apply
    conflicts with the `helm` field manager. `--server-side --force-conflicts` applies cleanly.
  - `deployApiGateway` alone (not `infra.sh start`, so Besu was not redeployed): Gateway API
    CRDs at bundle v1.6.3; all 14 `gateway.nginx.org` CRDs applied, including the new
    `accesspolicies`, `externalloadbalancers` and `payloadprocessors`; `ngf` revision 2 on
    chart 2.8.0.
  - Within about 30 seconds the data-plane Deployment rolled to revision 4. The controller
    logged `nginx image version mismatch` four times (14:58:12–16Z) while the 2.6.6 pod was
    still connected, and nothing after.
  - The NodePort selector still matches the 2.8.0 data-plane pod, whose `nginx -v` prints
    1.31.7. The Gateway is `Accepted`/`Programmed`, and all four HTTPRoutes are
    `Accepted`/`ResolvedRefs`.
  - `web` 200, `blockscout` 200 (UI and `/api/v2/stats`), `bond-api` `/v1/health` 200, and
    Besu JSON-RPC answers through `:8545`.
  - Not exercised: the fresh-cluster path, where the CRD apply runs before Helm's first install
    and Helm skips CRDs that already exist (documented Helm behaviour). It is covered by the
    next full `./sandbox.sh delete && ./sandbox.sh start`, which Phase 5 runs.
- Phase 5 live check (2026-10-21): Besu 26.10.0 is still the newest release (amd64 and arm64).
  None of the options or genesis keys removed in 26.8.0–26.10.0 appear in `infra/besu/`.
  Discovery is off on both nodes, and the NB Bond API uses neither `trace_*` nor transaction
  `to`.
  - In place (`deployBesu` only): both nodes on 26.10.0. The validator log shows the Bonsai
    database upgrading from version 3 to 4 and migrating its code storage; the Forest archive
    logs no upgrade. A contract creation from a fixture key was mined in block 175 with
    `to: null`, and Blockscout and NB Bond API ingestion followed it.
  - Rollback rehearsal: both nodes stopped, then `besu storage revert-code-format` ran on the
    validator's volume in a one-off pod. It rewrote the code storage, reverted the metadata to
    Bonsai version 3, and deleted the version metadata. The validator on 26.7.1 then sealed
    blocks, including a transaction in block 179.
  - The Forest archive on 26.7.1 refused to start: version-compatibility protection is on by
    default with a custom genesis file, and its metadata recorded 26.10.0. The override
    (`--version-compatibility-protection=false`) disables a safety check; it was not run, so the
    archive half of the rollback is documented in `plan.md` but not rehearsed. The archive went
    back to 26.10.0 instead.
  - Return: `deployBesu` first conflicted with the image field that `kubectl set image` had
    taken from Helm. After setting the image back to Helm's value it applied (revision 4), and
    the `kubectl-set` `managedFields` entries were removed. The validator re-upgraded its
    database, and a transaction was mined in block 180.
  - Fresh chain: `./sandbox.sh delete && ./sandbox.sh start` with the slice 4 and slice 5
    changes. The NGF CRDs were applied server-side before Helm's first install, which then
    completed, covering the Phase 4 fresh-cluster path. Besu 26.10.0 created a new database;
    chain 2018; contracts redeployed (local only); NB Bond API, nb-ui and Blockscout followed
    the head.
  - `contracts.sh verify-latest` verified all 12 contracts through forge, Blockscout and
    verifier v1.11.0 (`Pass - Verified`).

## Blocked / Waiting On

- The later non-local rollout — operator; out of scope here, see `plan.md` "Deferred Non-Local Rollout".
- Phase 7 — the status of scripts-hardening Phase 6 (who owns `ensureKindRegistry`).

## Follow-ups Found Along the Way

- No Dependabot coverage for Docker images or Helm charts — `.github/dependabot.yml` — propose a
  `docker` ecosystem entry for the Dockerfiles and a scheduled pin-freshness report; needs a CI
  decision.
- Upstream moved the nginx-unprivileged Docker Hub home to `nginx/nginx-unprivileged` —
  `common/images.yaml:55` — re-check at the next bump.
- The verifier fetches the `linux-amd64` solc list on every platform —
  `services/blockscout/templates/sc-verifier-deployment.yaml` — check behaviour on arm64.
- `indexed_blocks_ratio` reports 0.98 while the indexer says it is caught up and the latest
  indexed block equals the chain head; it predates this plan. Look at whether a block is
  missing or the ratio counts differently.
- The deploy-time verification in `./sandbox.sh start` (`DEPLOY_VERIFY_CONTRACTS=true`, passed
  as `--verify` through `contracts.sh` and `deploy.sh`) submitted nothing to Blockscout on
  2026-10-21; `contracts.sh verify-latest` then verified every contract. Not caused by any
  image pin. Trace where the flag is lost (`contracts/contracts.sh`, `contracts/deploy.sh`).
- `busybox:1.37.0` in `services/blockscout/templates/blockscout-migration-job.yaml` is outside
  the pin files and unchecked.

## Session Handoff

Phases 1–5 merged as #308, #309, #310, #311 and #312, and shipped in release v0.10.0 (#316).
Outside this plan, #315 moved BENS to `python:3.14.9` (the D6 target once its image was
published) and #313 moved the Node pin to 26.12.1. Phase 6 is next; no branch exists for it yet.
The local sandbox runs a fresh chain (new contract addresses) on all slice 1–5 pins. It runs the
nb-ui and nb-bond-api images from `development` at `f9e9b0a`; before this they were built from an
older tree, so the restart also deployed the changes in that commit. The new hashes match the
stage base refs that Node, nginx and Python pin bumps will move. A later Node pin bump that
rebases onto this change drops its own hash edits.
