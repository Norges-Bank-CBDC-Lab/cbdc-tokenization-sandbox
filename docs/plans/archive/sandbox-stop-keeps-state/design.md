# Stop keeps state, delete deletes — Design

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Intent:** [`intent.md`](intent.md)
**Builds on:** the Blockscout PostgreSQL recovery and full sandbox reset of 2026-09-25.

## Decision Summary

`./sandbox.sh stop` becomes a graceful stop of the Kind node container with an explicit, long
timeout, so the node's systemd shutdown stops every pod with its own stop signal and every volume
stays. `./sandbox.sh start` starts a stopped node before its usual idempotent run. Component
scripts get the same split: `stop` scales the component's workloads to zero, and a new `delete`
takes over today's uninstall-and-remove behaviour. Phase 1 measures a graceful node stop on the
live sandbox before any code changes, because the design depends on the node's shutdown actually
reaching the pods; if it does not, the top-level `stop` scales the stateful workloads to zero
before stopping the node. The PostgreSQL recovery procedure is written down for the unclean
shutdowns a graceful stop cannot prevent.

## Current-State Evidence

### Repository Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `sandbox.sh stop` calls each component's `stop` (nb-ui, nb-bond-api, contracts, Blockscout, infra) and then `clearContractsDeploymentMarker` | `sandbox.sh` | The whole top-level `stop` branch is replaced |
| **Verified.** Component `stop` verbs: `infra.sh` uninstalls `gateway`, `ngf`, and `besu`; `blockscout.sh` deletes the `blockscout` namespace; `nb-bond-api.sh` and `nb-ui.sh` uninstall their releases; `contracts.sh` deletes the contract-registry ConfigMap | the five scripts | Their current bodies move to new `delete` verbs |
| **Inferred.** The Besu and NB Bond API volumes are chart-templated PVCs without `helm.sh/resource-policy: keep`, so `helm uninstall` deletes them; the Blockscout PVC goes with its namespace | `infra/besu/templates/pvc.yaml`, `services/nb-bond-api/helm/templates/pvc.yaml`, `services/blockscout/templates/db-pvc.yaml` | Not verified live, because checking would destroy the state; `delete` is documented as discarding data on this basis |
| **Verified.** Only `sandbox.sh` calls the component `stop` verbs; no CI workflow uses any `stop` | repository search | Changing the verbs affects the operator's commands and the docs only |
| **Verified.** `clusterExists` uses `kind get clusters`, which also lists a cluster whose node container is stopped | `common/helpers.sh` | `start` must detect a stopped node and start it before any `kubectl` or Helm call |
| **Verified.** Every Deployment and StatefulSet template sets `replicas` explicitly (1, or `replicaCount` defaulting to 1) | chart templates | **Inferred:** a component `start` (`helm upgrade --install`) restores a workload scaled to zero; Phase 3 verifies it |
| **Verified.** The Blockscout backend has a 300-second termination grace period; every other workload has 30 seconds | live Deployments and StatefulSets | The node-stop timeout must exceed the longest stop the shutdown actually waits for |
| **Verified.** The Blockscout PostgreSQL image stops on `SIGINT` (fast shutdown) with default `fsync` | image config, `services/blockscout/templates/db-deployment.yaml` | A clean pod stop gives PostgreSQL a shutdown checkpoint |
| **Verified.** Besu's genesis sets `emptyblockperiodseconds: 300`, and the catch-up indexer is disabled | `infra/besu/config/genesis.json`, `services/blockscout/values.backend.env.yaml` | Stopping the whole node stops the chain too, so no blocks are mined while Blockscout is down; a component-level Blockscout stop still leaves a gap for blocks mined meanwhile, which the docs must say |

### Runtime Evidence

- **Verified:** the node container `cluster-cbdc-monoledger-control-plane` has stop signal
  `SIGRTMIN+3` (a systemd shutdown), no stop timeout of its own (Docker's default of 10 seconds
  applies), and restart policy `on-failure:1`.
- **Verified:** after the node container exited with 137, starting it again brought the cluster
  back with its volumes; the NB Bond API database and the chain survived, and only PostgreSQL's
  damaged file blocked recovery.
- **Needs verification:** how long a graceful node stop takes, whether each pod receives its stop
  signal, and whether PostgreSQL logs a clean shutdown (Phase 1).

## Invariants

- The top-level `stop` and `start` act on `kind-$CLUSTER_NAME`'s node container only, named from
  `CLUSTER_NAME`, never by a wildcard; every `kubectl` call passes `--context=kind-$CLUSTER_NAME`.
- No `stop` verb deletes or uninstalls anything. Only `delete` verbs do.
- A `stop` followed by `start` never redeploys contracts.
- `./sandbox.sh delete` keeps its current behaviour.

## Target Architecture

- `common/helpers.sh`:
  - `stopClusterNode`: if the node container is running, `docker stop --time
    "$SANDBOX_STOP_TIMEOUT_SECONDS" <node>`; report elapsed time and exit code, and fail loudly
    on 137.
  - `startClusterNode`: if the node container exists and is stopped, `docker start` it and wait
    for the API server; a no-op when it is already running.
  - `nodeContainerState` helper used by both, and by `start` to decide.
- `sandbox.sh`:
  - `stop`: `stopClusterNode`. No component verbs, no marker change.
  - `start`: `startClusterNode` before the existing flow.
  - `delete`: unchanged.
- Component scripts: `stop` scales the component's Deployments and StatefulSets to zero and waits
  for their pods to go; `delete` holds today's `stop` body; `start` is unchanged and restores
  replicas through Helm. `contracts.sh stop` prints that there is nothing to stop; `contracts.sh
  delete` removes the registry ConfigMap and, when run through `sandbox.sh`, the deployment
  marker, as `stop` did.
- `SANDBOX_STOP_TIMEOUT_SECONDS`: default set from Phase 1's measurement and at least 330 seconds
  (Blockscout's 300-second grace period plus margin), with the required banner comment.

**Fallback, only if Phase 1 shows the node shutdown does not stop pods gracefully:** the top-level
`stop` first calls each component's new `stop` (scale to zero), then stops the node; `start` starts
the node and lets each component's `start` restore replicas.

## Alternatives Considered

- **A separate `pause` verb, leaving `stop` as it is.** Rejected by the operator: `stop` should
  mean stop.
- **Scale to zero at the top level always.** Deterministic, but slower and duplicates what the
  node shutdown does if Phase 1 shows it works; kept as the fallback.
- **Leave the component verbs destructive.** Would keep two meanings of `stop` in one repo; the
  component split costs little and keeps a one-command fresh-Blockscout path as `blockscout.sh
  delete`.
- **Rely on Docker Desktop's quit.** Its stop timeout is not controlled from this repo; the
  incident shows it is not enough.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Top-level `stop` keeps state; `delete` deletes | Decided | Given 2026-09-25 |
| Component verbs follow the same rule | Yes | Approved 2026-09-25 |
| Stop timeout default | From Phase 1, at least 330 s | None |
| Catch-up indexer | Out of scope; follow-up | Decide separately |

## Residual Risks

- A host crash, power loss, or forced Docker Desktop quit still stops the node uncleanly; the
  recovery procedure in `services/blockscout/debugging.md` covers that case.
- Anyone used to `stop` then `start` as a quick reset now gets their old state back; the README
  says to use `delete` then `start` for a fresh sandbox (about ten minutes, images come from the
  local registry).
- Phase 1 and the live proof stop and start the running sandbox; each run takes a snapshot first.
