# Image and chart pin refresh — Implementation Plan

**Status:** Implemented — shipped in #308–#312, #332 and #333 (local scope; approved 2026-10-21); archived 2026-10-28
**Created:** 2026-10-21
**Scope:** `common/images.yaml`, `common/versions.yaml`, `common/helpers.sh`,
`services/nb-ui/Dockerfile`, `services/blockscout/{values.yaml,values.local.yaml,debugging.md,bens-microservice/Dockerfile,templates/sc-verifier-deployment.yaml}`,
`infra/besu/values.yaml`, `infra/gateway/templates/nodeport-config.yaml`,
`scripts/verification/{check-image-hash-inputs.sh,check-besu-qbft-baseline.py,README.md}`,
`README.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY_NOTES.md`, `THIRD_PARTY_LICENSES.md`,
`infra/README.md`, `infra/DEVELOPMENT.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline (per slice, re-run on the day)
Phase 1  Image hash base refs                          slice 1   (D1)
Phase 2  nginx-unprivileged 1.30.6                     slice 2   security
Phase 3  Blockscout supporting components              slice 3   Postgres, Python, chart, verifier
Phase 4  NGINX Gateway Fabric 2.8.0                    slice 4
Phase 5  Besu 26.10.0                                  slice 5   (D5)
Phase 6  Blockscout backend v12 + frontend v2.12       slice 6   (D2, D4, D5)
Phase 7  Local registry 3.1.2                          slice 7   (D3)
```

Each of Phases 2–7 moves one coherent set of pins and ends with a live check. Phase 1 is the
prerequisite for every base-image bump. Phases 4 and 5 do not depend on 3 and can swap order.
Phase 6 waits for 3 (chart and verifier already moved, so v12 is the only variable) and for 5
(the explorer re-indexes on the final chain baseline). Phase 7 goes last: it has the widest
blast radius (empty registry, Blockscout rebuild) and the lowest reachable exposure.

**Every slice, on the day:**

1. Branch `feature/<kebab>` from a fresh `development`.
2. Re-check the newest tag and its platforms. The commands are below; take a newer patch on the
   same line if one has appeared, and record it in `progress.md`.
3. `git grep -n '<old version>'` before and after; the after-list may contain only archived
   plans and dated evidence rows.
4. Run the local gate:
   - `python3 scripts/verification/check-public-repo-hygiene.py`
   - `python3 scripts/verification/check-markdown-links.py`
   - `python3 scripts/verification/check-third-party-licenses.py`
   - `bash scripts/verification/check-image-hash-inputs.sh`
   - `python3 scripts/verification/check-besu-qbft-baseline.py`
   - `helm lint` for each chart the slice touches
5. Update `progress.md` in the same commit.

```bash
# Docker Hub tag + platforms (repo like library/postgres or nginxinc/nginx-unprivileged)
curl -s "https://hub.docker.com/v2/repositories/<repo>/tags/<tag>" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["last_updated"], sorted({i["architecture"] for i in d["images"] if i["os"]=="linux"}))'
# ghcr / any registry: inspect the index
docker buildx imagetools inspect <image>:<tag>
```

## Phase 0: Baseline

### Steps

1. Record the running images:
   `kubectl get pods -A -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u`.
   Also record `docker inspect --format '{{.Config.Image}}' kind-registry`.
2. Record health: Besu head (`cast block-number --rpc-url http://besu.cbdc-sandbox.local:8545`),
   Blockscout `GET /api/v2/main-page/indexing-status` and `GET /api/v2/stats`, NB Bond API
   `/health`, and the nb-ui page through the gateway.
3. Record the verified-contract count:
   `GET /api/v2/smart-contracts?filter=solidity` (or the count used by `make verify-contracts`).

### Exit Criteria

- [x] Baseline written to `progress.md` "Verified So Far" with the date.

## Phase 1: Image Hash Base Refs (slice 1)

### Goal

Every repo-owned image rebuilds when one of its stage base images changes.

### Steps

1. `common/helpers.sh`:
   - `nbUIBundleHash`: append `printf 'base %s\n' "$(getNBUIBuilderImage)" "$(getNBUINginxImage)"`.
   - `nbBondApiBundleHash`: append the same line for its builder and runtime images.
   - `bensImageHash`: append `printf 'base %s\n' "$(getBensBaseImage)"`.
   - Each function's comment says why base refs are inputs. Carry the first two hunks over from
     the pending Node pin bump unchanged so that branch rebases cleanly (D1).
2. `scripts/verification/check-image-hash-inputs.sh`:
   - Keep `assert_base_image_sensitivity` for the Node variables, as in the pending Node pin bump.
   - Add `assert_images_key_sensitivity NAME HASH_FN KEY`. In a subshell it copies
     `$IMAGES_CONFIG` to a `mktemp -d` dir, runs `yq -i ".${KEY} += \"-hashcheck\""`, sets
     `IMAGES_CONFIG` to the copy, and expects the hash to differ.
   - Call it for `nbUIBundleHash nb_ui.nginx` and `bensImageHash blockscout.bens`.
   - Update the header comment block.
3. `scripts/verification/README.md`: one sentence that the check also covers the base image refs.

### Verification Stop

- `bash scripts/verification/check-image-hash-inputs.sh` passes, and lists the new assertions.
- Negative test in a scratch copy: remove the BENS `printf` line; the check fails with the
  "base-image bump would reuse the old image" message.
- `python3 scripts/verification/check-node-version-consistency.py` passes.
- Live: `./services/blockscout/blockscout.sh start` (or `./sandbox.sh start`) builds new
  `nb-ui`, `nb-bond-api` and `bens-microservice` tags once, because every hash changed. The pods
  roll and stay healthy.

### Failure Diagnosis / Rollback

A failure here is a script error, not a runtime one: revert the PR. The images rebuild once more
on the next start.

### Exit Criteria

- [x] All three hashes react to their base refs, asserted in CI (`Image Hash Inputs`).
- [x] The pending Node pin bump drops its now-duplicate hash change on rebase.

## Phase 2: nginx-unprivileged 1.30.6 (slice 2)

### Steps

1. `common/images.yaml` `nb_ui.nginx`, `common/helpers.sh` `NB_UI_NGINX_BASEIMAGE`, and the
   `services/nb-ui/Dockerfile` `ARG NB_UI_NGINX_IMAGE` default all become
   `nginxinc/nginx-unprivileged:1.30.6-alpine`.
2. `docs/plans/nb-ui-correctness-and-hardening/plan.md:426,471`: the two commands that run the
   pinned image now name `1.30.6-alpine`. That plan is active, not frozen.
3. PR body: the exposure table from `design.md`. The stock config uses no HTTP/3, TLS, AIO, SSI,
   `alias` or `rewrite`; CVE-2026-93479 is the only plausible path.

### Verification Stop

- `./infra/infra.sh registry-sync`, then `./services/nb-ui/nb-ui.sh start`. A new
  `nb-ui:<hash>` tag is built.
- `kubectl -n nb-ui exec deploy/nb-ui -- nginx -v` prints `nginx/1.30.6`.
- `curl -s -o /dev/null -w '%{http_code}' -H 'Host: web.cbdc-sandbox.local' http://127.0.0.1/`
  returns 200.
- `curl -s -H 'Host: web.cbdc-sandbox.local' http://127.0.0.1/config.js` serves the ConfigMap
  overlay.
- The read-only root filesystem still works: the pod is Ready with no restarts.

### Rollback

Revert, then `registry-sync` and `nb-ui.sh start`. The previous hash tag is still in the
registry unless `cleanup-images` pruned it.

### Exit Criteria

- [x] The running nb-ui reports nginx 1.30.6; the UI loads through the gateway.

## Phase 3: Blockscout Supporting Components (slice 3)

### Steps

1. Postgres: `common/images.yaml` `blockscout.db` and `services/blockscout/values.yaml`
   `dbImage` → `postgres:18.6`.
2. Python: `common/images.yaml` `blockscout.bens`, `services/blockscout/values.yaml`
   `bensImage`, both `ARG` defaults in `bens-microservice/Dockerfile`, and `helpers.sh`
   `BENS_BASEIMAGE` → the newest `3.14.x` with a published image (D6).
3. Chart: `common/versions.yaml` `charts.blockscout_stack`, `helpers.sh`
   `BLOCKSCOUT_CHART_VERSION`, and the two `blockscout-stack-4.5.1` comment URLs → `4.5.3`.
   Diff the upstream `values.yaml` 4.5.1…4.5.3 against `services/blockscout/values*.yaml`: no
   overridden key moved.
4. Verifier: `common/images.yaml` `blockscout.smart_contract_verifier` → `v1.11.0`.
   - `sc-verifier-deployment.yaml` gains
     `SMART_CONTRACT_VERIFIER__COMPILERS__EXECUTION__TYPE=native`, with a comment: v1.11.0
     refuses compiler-backed endpoints without it, and `native` is upstream's local mode.
   - `docs/THIRD_PARTY_NOTES.md` names `v1.11.0`.
5. Diff the rendered chart before and after:
   `helm template` with the sandbox values files, at 4.5.1 and 4.5.3.

### Verification Stop

- `registry-sync`, then `./services/blockscout/blockscout.sh start`. The Postgres pod restarts
  on 18.6 against the existing PVC, and `SELECT version()` reports 18.6.
- Run `ANALYZE;` once on `blockscout_db`; BENS has no database of its own (its init job writes
  into `blockscout_db`). This is upstream's post-update advice for GIN `reltuples`; it is cheap
  at this size.
- BENS: a new `bens-microservice:<hash>` tag (proves Phase 1). The pod is Ready. `python -V` in
  the pod prints the new version.
- Verifier pod is Ready, and its log shows the native execution mode.
  `make verify-contracts` (or `./contracts/contracts.sh verify`) re-verifies one contract, and
  `GET /api/v2/smart-contracts/<addr>` shows `is_verified: true`.
- Indexing status is 100% and new blocks keep arriving.

### Rollback

Revert, then `registry-sync` and `blockscout.sh start`. PostgreSQL minor releases never change
the on-disk format, so 18.4 can start on the data directory 18.6 used. If it does not, wipe the
explorer database (`blockscout.sh delete` then `start`, which is destructive) and let it reindex,
which is cheap here.

### Exit Criteria

- [x] Explorer, BENS, and contract verification work on the new pins.

## Phase 4: NGINX Gateway Fabric 2.8.0 (slice 4)

### Steps

1. `common/versions.yaml` `charts.nginx_gateway_fabric`, the `helpers.sh` literal in
   `getNginxGatewayFabricVersion`, and the `nodeport-config.yaml` version label → `2.8.0`.
2. `deployApiGateway`: after the Gateway API CRD apply, add
   `kubectl apply --server-side --force-conflicts -f "https://raw.githubusercontent.com/nginx/nginx-gateway-fabric/v${NGINX_GATEWAY_FABRIC_VERSION}/deploy/crds.yaml"`.
   Add a comment explaining why: Helm installs chart CRDs only on first install. Server-side,
   because `nginxproxies` is too large for client-side apply's annotation. `--force-conflicts`,
   because the first install left Helm as the CRDs' field manager. This is the one script
   change the bump cannot work without.
3. `infra/DEVELOPMENT.md` (new "Gateway Version Bumps" section): a pin bump re-applies both
   CRD sets.

### Verification Stop

- `./infra/infra.sh start`, or the gateway part of `./sandbox.sh start`, on the existing
  cluster.
- `kubectl get crd gateways.gateway.networking.k8s.io -o jsonpath='{.metadata.annotations.gateway\.networking\.k8s\.io/bundle-version}'`
  returns `v1.6.3`. The three new `gateway.nginx.org` CRDs exist.
- Both NGF pods run `2.8.0` images. The data-plane pod labels still match the NodePort selector:
  `kubectl -n nginx-gateway get endpoints nginx-gateway` is non-empty.
- All four hostnames answer through `127.0.0.1`: `besu.…:8545` (JSON-RPC `eth_chainId`),
  `blockscout.…`, `bond-api.…/health`, and `web.…`.
- Every HTTPRoute is `Accepted` and `ResolvedRefs`.

### Rollback

Revert and redeploy the gateway. The v1.6.3 CRDs stay installed: they still serve `v1`, which
every route uses. If the chart downgrade fails, `helm uninstall ngf` and redeploy. Routes are
recreated by their component charts on the next start.

### Exit Criteria

- [x] Gateway on 2.8.0 with CRDs v1.6.3; every hostname routes.

## Phase 5: Besu 26.10.0 (slice 5)

### Steps

1. Sweep `26.7.1` → `26.10.0`:
   - `common/images.yaml`, `infra/besu/values.yaml`
   - the constant in `check-besu-qbft-baseline.py:94`
   - `README.md:56`, `docs/ARCHITECTURE.md:97`, `docs/THIRD_PARTY_NOTES.md:38`
   - `infra/README.md:49`, `infra/DEVELOPMENT.md:83`
2. Confirm the release-note items against config:
   - `discovery-enabled=false` on both nodes;
   - genesis uses `emptyblockperiodseconds`;
   - no removed option appears in `infra/besu/config/*.toml`. Grep for `Xv5`,
     `min-block-occupancy`, `network=dev`, `xemptyblock` and `PANTHEON_`.
3. Decide nothing about the upcoming deprecations (`--rpc-tx-feecap=0`,
   `--Xbft-legacy-protocol-encoding`). If either is in use, record it as a follow-up.

### Verification Stop

- `python3 scripts/verification/check-besu-qbft-baseline.py`, `helm lint infra/besu`,
  `helm template besu infra/besu`.
- Live, in place (D5):
  1. `registry-sync`, then `./infra/infra.sh start` (Besu redeploy).
  2. Both pods run 26.10.0. The validator log shows the one-way Bonsai database upgrade
     completing; the archive node (Forest) starts without one.
  3. Blocks are produced, and the head advances on the archive RPC.
  4. `eth_chainId` returns `0x7e2`.
  5. A transaction through the NB Bond API, for example an operator action in the UI, is mined.
     Blockscout indexes it, including a contract-creation transaction with `"to": null`.
  6. NB Bond API `/health` shows `headReachable: true`.
- Rollback rehearsal (local, in place): scale both nodes down, run
  `besu storage revert-code-format` against the validator's data path in a one-off pod (the
  exact invocation is printed in the validator log after the upgrade), start the validator on
  26.7.1, check that blocks continue, then return to 26.10.0 with `deployBesu`. This proves the
  rollback the later non-local rollout would rely on, without a wipe. Any image change made
  outside Helm (for example `kubectl set image`) leaves a second field manager on the
  StatefulSet, and Helm's next server-side apply conflicts. Set the image back to Helm's value
  and remove that `managedFields` entry afterwards.
- Fresh chain (local only): `./sandbox.sh delete && ./sandbox.sh start` once, to prove a new
  genesis on 26.10.0. This is a local node wipe with contract redeployment. It is extra proof,
  not a step the upgrade needs.

### Rollback

Revert the pins. On the validator, run `besu storage revert-code-format` before starting 26.7.1,
because 26.7.1 cannot open the upgraded Bonsai database. The subcommand also deletes the
validator's version metadata, so 26.7.1 then starts.

The Forest archive node's storage format does not change, but Besu's version-compatibility
protection still refuses the downgrade: it is on by default with a custom genesis file, and the
node's metadata records 26.10.0. `revert-code-format` treats a Forest database as needing no
revert and leaves that metadata in place. Downgrading the archive therefore needs one start with
`--version-compatibility-protection=false`, the option Besu's own error message names. This
disables a safety check, so it is an operator decision at rollback time, and it was not
rehearsed here.

Local last resort: `./sandbox.sh delete && ./sandbox.sh start` (new chain, contracts redeploy;
D5).

### Exit Criteria

- [x] The baseline check passes on 26.10.0; in-place and fresh boots both produce blocks and
      index.

## Phase 6: Blockscout Backend v12 + Frontend v2.12 (slice 6)

### Prerequisite

D2 approved; D4 second confirmation recorded in `progress.md`. Phases 3 and 5 merged.

### Steps

1. Pre-check:
   `SELECT status FROM migrations_status WHERE migration_name='fill_internal_transactions_address_ids'`
   returns `completed`. It did on 2026-10-21.
2. Pins: in `common/images.yaml` `blockscout.backend` → `v12.0.x` (newest patch) and
   `blockscout.frontend` → `v2.12.x`. The `services/blockscout/values.yaml` fallback tags move
   with them. `services/blockscout/debugging.md:139` says "v12 backend".
3. Env review against the v12 and v11.3 deprecation lists:
   - `values.backend.env.yaml` uses none of `ETHEREUM_JSONRPC_HTTP_GZIP_ENABLED`, `MUD_*`, or
     the removed `CACHE_*` periods. Re-grep on the day.
   - `values.frontend.env.yaml` does not set `NEXT_PUBLIC_TOKEN_ACTION_BUTTON_CONFIG`.
4. Licence (D4):
   - `docs/THIRD_PARTY_NOTES.md`: the locally built Blockscout backend image includes Alpine's
     `ffmpeg` (GPL-2.0-or-later AND LGPL-2.1-or-later), built and run locally and not
     redistributed.
   - `THIRD_PARTY_LICENSES.md`: the "Blockscout application" row notes it.
   - Run `check-third-party-licenses.py`.
5. `docs/KNOWN_ISSUES.md` source-build entry: re-state the ghcr tag ceiling. ghcr still stops at
   v9; re-check on the day.

### Verification Stop

- `./sandbox.sh build-images` builds both images for the host platform (about 20 minutes).
  Record the time and that the backend build pulls the Elixir 1.20 / OTP 28 base.
- `./services/blockscout/blockscout.sh start` on the existing database:
  - the init container passes the upgrade gate and runs the migrations;
  - the backend pod is Ready;
  - `migrations_status` shows the v12 background migrations progressing to `completed`.
- Explorer checks, mirroring the archived v11 plan:
  - the home page and a block, transaction and address page render;
  - `GET /api/v2/main-page/indexing-status` reaches 100%;
  - a new transaction appears within the realtime window;
  - the catch-up indexer still fills gaps: stop Blockscout for a few blocks, then start it again.
- Contract verification: `make verify-contracts`, and `is_verified: true` for the deployed
  contracts. This proves the forge `--verifier blockscout` route still exists on v12.
- BENS stub: browse a few addresses and search with three or more characters, which v12 now
  sends to BENS. `kubectl -n blockscout logs deploy/bens-deployment` shows only 2xx responses.
- nb-ui explorer links (`EXPLORER_BASE_URL`) open the right pages.

### Rollback

Revert the pins. Wipe the explorer database (`./services/blockscout/blockscout.sh delete` then
`start`), because the v12 schema cannot be read by v11. Then run `build-images` for the old tags
if they are no longer in the registry. Reindexing 160+ blocks is cheap.

### Exit Criteria

- [x] Explorer, indexers, BENS and verification all work on v12; licence notes updated.

## Phase 7: Local Registry 3.1.2 (slice 7)

### Prerequisite

D3 approved. Check `docs/plans/sandbox-scripts-and-ci-hardening/` Phase 6 status: if it has
landed, rebase onto its `syncImagesToRegistry`. If it is in flight, agree which PR owns
`ensureKindRegistry`.

### Steps

1. Phase 0 for this slice, against a throwaway container so the real registry is untouched:
   - `docker run -d --rm -p 127.0.0.1:5099:5000 --name reg3-probe registry:3.1.2`
   - push one OCI image and one Docker v2 image to it;
   - with `KIND_REGISTRY_ENDPOINT=http://localhost:5099`, check that `kindRegistryHasImage`,
     `registryManifestDigest` and the `tags/list` probe return the expected values;
   - then `docker rm -f reg3-probe`.
   If the `Accept` header proves too narrow, widen it to also accept
   `application/vnd.oci.image.manifest.v1+json` in the same slice.
2. `common/images.yaml` `local_registry` and `helpers.sh` `KIND_REGISTRY_IMAGE` →
   `registry:3.1.2`.
3. `ensureKindRegistry`: if a `kind-registry` container exists and
   `docker inspect --format '{{.Config.Image}}'` differs from the pin:
   - print why;
   - `docker rm -f` it, then create it as today;
   - after the network attach and ConfigMap steps, run `syncImagesToRegistry`.
   Repo-owned images rebuild on the next start because their hash tags are missing. The
   Blockscout images re-push from the host Docker cache if present, or need `build-images`.
4. Docs:
   - `infra/DEVELOPMENT.md` registry section: a pin change recreates the container on the next
     `registry-start`, `registry-sync` or cluster creation.
   - README `registry-reset` row unchanged.

### Verification Stop

- `./sandbox.sh registry-start` on the existing machine. The message shows a recreate.
  `docker inspect kind-registry` shows `registry:3.1.2`, and the binding is still
  `127.0.0.1:5001`.
- `./sandbox.sh build-images` if the host cache no longer holds the Blockscout tags.
- Then `./sandbox.sh start`. Every pod pulls from `localhost:5001` with no `ImagePullBackOff`,
  and `./infra/infra.sh image-report` lists the expected tags.
- Second `registry-start`: no recreate (idempotent).
- `./infra/infra.sh cleanup-images --keep 1` still works against the v3 API.

### Rollback

Revert the pin. The next `registry-start` recreates `registry:2.8.3` through the same code path
and re-syncs.

### Exit Criteria

- [x] An existing machine moves to registry 3.1.2 with one command; the stack starts from it.

## Test Matrix

| Layer | Risk or behaviour | Test/evidence |
|---|---|---|
| Static: hash inputs | Base bump skips rebuild | `check-image-hash-inputs.sh` new assertions plus a negative scratch test (Phase 1) |
| Static: pin sweep | Half-swept pin | `git grep` old version per slice; Besu constant in `check-besu-qbft-baseline.py` |
| Static: charts | Values key drift | `helm lint` / `helm template` diff for Blockscout 4.5.1→4.5.3, `infra/besu`, `infra/gateway` |
| Licence | ffmpeg, new versions | `check-third-party-licenses.py`; D4 recorded |
| Live: nb-ui | nginx version, read-only root | `nginx -v`, HTTP 200, `config.js` overlay |
| Live: gateway | CRD upgrade, selector labels | CRD bundle version, endpoints non-empty, four hostnames |
| Live: Besu | One-way DB, block production | in-place and fresh boot, `eth_chainId`, mined tx indexed |
| Live: Blockscout | Migrations, verifier, BENS, catch-up | gate pass, indexing 100%, `make verify-contracts`, BENS 2xx, gap fill |
| Live: registry | Recreate, API compatibility | probe container checks, recreate once, stack pulls |
| Platform | arm64 and amd64 | manifest listing per pin on the day; local build on the operator's host platform. The other platform is unverified for the source-built Blockscout images (KNOWN_ISSUES) |

## Recommended PR Slices

| Slice | Branch | Outcome | Main proof | Notes |
|---|---|---|---|---|
| 1 | `feature/image-hash-base-refs` | Base refs in all three hashes | hash check in CI, one-time rebuild | Carved from the pending Node pin bump (D1) |
| 2 | `feature/nginx-1-30-6` | NB UI on nginx 1.30.6 | `nginx -v` in the pod | Security; smallest diff |
| 3 | `feature/blockscout-support-pins` | Postgres 18.6, Python 3.14.x, chart 4.5.3, verifier v1.11.0 | explorer + verification + BENS rebuild | Verifier env var is mandatory |
| 4 | `feature/ngf-2-8` | NGF 2.8.0, Gateway API v1.6.3, CRD apply step | four hostnames, CRD versions | Gateway is the LAN-facing nginx |
| 5 | `feature/besu-26-10` | Besu 26.10.0 | baseline check, in-place and fresh boot | One-way validator DB (D5) |
| 6 | `feature/blockscout-v12` | Backend v12 + frontend v2.12 | full explorer checklist | D2, D4 (double confirmation), D5 |
| 7 | `feature/local-registry-3` | registry 3.1.2, recreate on pin change | probe + recreate + start | D3; coordinate with scripts-hardening Phase 6 |

## Deferred Non-Local Rollout

This plan upgrades and proves the **local sandbox only**. No slice deploys anywhere else. A later
non-local rollout uses this table. Each PR body repeats its own row so the impact is visible
where the change lands.

| Slice | Node wipe needed? | Contract redeployment needed? | Data effect | What a non-local rollout must respect |
|---|---|---|---|---|
| 1 Hash inputs | No | No | None | Local build tooling only |
| 2 nginx 1.30.6 | No | No | None (stateless) | Rebuild the NB UI image from the new base |
| 3 Postgres 18.6 | No | No | In place on the existing volume; no dump/restore within 18.x | Run `ANALYZE` afterwards; back up the explorer database first as routine. Expect the explorer API to answer 500 for about a minute after the database restart, while its read pool reconnects (seen locally) |
| 3 Python 3.14.x | No | No | None (BENS is stateless; its database is untouched) | Rebuild the BENS image |
| 3 Chart 4.5.3 | No | No | None (`separateApi` is disabled) | — |
| 3 Verifier v1.11.0 | No | No | None (stateless) | **Must** set `SMART_CONTRACT_VERIFIER__COMPILERS__EXECUTION__TYPE=native`, or verification stops |
| 4 Gateway Fabric 2.8.0 | No | No | Gateway API CRDs v1.5.1 → v1.6.3, NGF CRDs re-applied | Only where Gateway Fabric is used: Kubernetes ≥ 1.32; apply both CRD sets before the chart upgrade (server-side, taking ownership from Helm). Expect the data plane to roll a few times within a minute, and the controller to log `nginx image version mismatch` until the old data-plane pod is gone (seen locally) |
| 5 Besu 26.10.0 | **No** (in-place upgrade) | **No** (no fork activation, genesis unchanged, chain continues) | **One-way-by-default:** the validator's Bonsai database is upgraded on first start. The Forest archive node's format is not, but its version metadata blocks a downgrade | Back up node volumes first. Upgrade all nodes in one step: 26.8.0 and 26.9.0 change state-transition rules, so mixed versions can disagree. Rollback: run `besu storage revert-code-format` on each Bonsai node before starting the old version (rehearsed locally: 26.7.1 then sealed blocks on the reverted validator). A Forest node needs one old-version start with `--version-compatibility-protection=false`, an operator decision that was not rehearsed. A wipe would mean a new chain and redeployed contracts, and is never part of the upgrade |
| 6 Blockscout v12 + frontend v2.12 | No (explorer only; the chain is untouched) | No (a reindex would need contracts **re-verified**, not redeployed) | **One-way:** the explorer schema migrates and v11 cannot read it afterwards | Back up the explorer database first. Prerequisite: the explorer is on v11.0.2 or later and `fill_internal_transactions_address_ids` is `completed`. Build both images from source at the new tags. ffmpeg licence note (D4) |
| 7 Registry 3.1.2 | No | No | Local registry cache emptied and re-synced | Local-only component; no non-local counterpart |

**Summary for scheduling the later rollout:** nothing here forces a node wipe or a contract
redeployment. Two slices are one-way on existing data and should be rolled out only with a
backup and a rehearsed rollback: slice 5 (Besu) and slice 6 (Blockscout v12). Slices 2–4 are
image and chart changes that can be rolled back.

## Migration, Rebuild, and Rollout

- Data effects:
  - Postgres 18.6 runs in place on the existing PVC.
  - Blockscout v12 migrates the explorer schema one way.
  - Besu 26.10.0 upgrades the validator Bonsai database one way.
  - Registry 3 starts empty.
- Rebuilds:
  - slices 1–3 rebuild the repo-owned images automatically;
  - slice 6 needs `build-images`;
  - slice 7 may need `build-images` if the host cache has been pruned.
- Non-local: not part of this plan; see "Deferred Non-Local Rollout" above.

## Documentation and Public-Repo Hygiene

- Version mentions: Besu (README, ARCHITECTURE, infra README/DEVELOPMENT, THIRD_PARTY_NOTES),
  verifier (THIRD_PARTY_NOTES), Blockscout backend major (`services/blockscout/debugging.md`).
- New behaviour: registry recreate and the NGF CRD re-apply (`infra/DEVELOPMENT.md`), and the
  hash coverage (`scripts/verification/README.md`).
- `docs/DOCUMENTATION_INDEX.md`: add the plan folder when it is committed. Move it to
  `docs/plans/archive/` with the last slice.
- `THIRD_PARTY_LICENSES.md` snapshot date and the ffmpeg note in slice 6.
- Check every diff by hand before pushing: none of these files may name or describe a specific
  non-local environment; only the environment-neutral impact table above.

## Out of Scope

- Deleting the dead fallback constants and adding a pin-consistency check (scripts-hardening
  Phase 9).
- Dependabot `docker` / Helm automation (follow-up; needs a CI decision).
- `kindest/node`, `busybox:1.37.0`, Python 3.15, nginx mainline, moving to
  `nginx/nginx-unprivileged`, and the verifier's amd64-only solc list.

## Done Criteria

- [x] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [x] All seven slices merged, or explicitly deferred with a reason.
- [x] Gates pass on each PR; no old version left outside archived or dated text.
- [x] Plan folder archived with the last slice.
