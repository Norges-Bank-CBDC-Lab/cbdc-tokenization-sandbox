# Stop keeps state, delete deletes — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-09-25
**Created:** 2026-09-25
**Scope:** `sandbox.sh`, `common/helpers.sh`, `services/nb-bond-api/src/` (shutdown handling and its test), `infra/infra.sh`, `services/blockscout/blockscout.sh`, `services/nb-bond-api/nb-bond-api.sh`, `services/nb-ui/nb-ui.sh`, `contracts/contracts.sh`, and the docs that describe the lifecycle verbs
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Characterise a graceful node stop on the live sandbox (no code change)
Phase 2  Top-level stop / start (node container)
Phase 3  NB Bond API graceful shutdown on SIGTERM
Phase 4  Component stop (scale to zero) and delete (today's stop); explicit Helm context
Phase 5  Live proof: sandbox stop/start, component stop/start, component delete
Phase 6  Documentation
Phase 7  PR
```

Phase 2's shape depends on Phase 1. One PR; the plan folder is archived in it.

## Phase 1: Characterise a graceful node stop

All commands name `kind-cluster-cbdc-monoledger` and its node container explicitly.

1. Snapshot: chain head, `/v1/bonds`, `/v1/auctions`, `/v1/bidders`, the NB Bond API table counts,
   Blockscout block and verified-contract counts.
2. `time docker stop --time 330 cluster-cbdc-monoledger-control-plane`; record the elapsed time and
   the exit code.
3. `docker start` it; when the pods are back, read the previous run of PostgreSQL (clean shutdown
   line; next start says "was shut down at", not "was interrupted"), Besu, and the NB Bond API.
4. Compare with the snapshot.

Decision rule: exit 0 well inside the timeout and a clean PostgreSQL shutdown means a plain node
stop; otherwise the fallback in `design.md`.

Recovery: if PostgreSQL fails to start, apply the 2026-09-25 procedure (scale to zero, back up
`pgdata` on the node, move the damaged file aside, scale up).

Exit: timings, exit code, and log excerpts in `progress.md`; design choice stated.

## Phase 2: Top-level stop and start

1. `common/helpers.sh`: `nodeContainerState`, `stopClusterNode`, `startClusterNode`, and
   `SANDBOX_STOP_TIMEOUT_SECONDS` with its banner.
2. `sandbox.sh stop`: replace the component calls and `clearContractsDeploymentMarker` with
   `stopClusterNode`; clear messages when the cluster does not exist or is already stopped.
3. `sandbox.sh start`: call `startClusterNode` before the existing flow.
4. Usage text.

Exit: `bash -n`; `shellcheck` if already installed (nothing new is installed).

## Phase 3: NB Bond API graceful shutdown

Added at the operator's request after Phase 1 showed the API ignores SIGTERM.

1. On `SIGTERM` and `SIGINT`: stop the ingestion loop, stop accepting HTTP connections and close
   the server, close the SQLite handles, and exit 0; a second signal or a timeout below the pod's
   30 s grace period exits immediately.
2. Keep the handler in one small module wired from the entrypoint, so it can be tested without a
   process signal.
3. One jest test for the shutdown sequence, sized like the neighbouring tests.
4. nb-bond-api gate (lint, format, tests, build).

Exit: gate green; the live proof in Phase 5 shows the API pod terminating in seconds.

## Phase 4: Component verbs and Helm context

For each of `infra/infra.sh`, `services/blockscout/blockscout.sh`,
`services/nb-bond-api/nb-bond-api.sh`, `services/nb-ui/nb-ui.sh`:

1. Move the current `stop` body to a new `delete` verb.
2. New `stop`: scale the component's Deployments and StatefulSets to zero in its namespaces and
   wait for the pods to terminate.
3. Usage text.

`contracts/contracts.sh`: `stop` prints that contracts live on the chain and there is nothing to
stop; `delete` removes the registry ConfigMap. `sandbox.sh` keeps no call to either.

Every `helm` call in `common/helpers.sh` and the component scripts gains
`--kube-context "kind-$CLUSTER_NAME"`. Today they act on the current `kubectl` context, and
`sandbox.sh` only sets that context on its `start` path, so a component command run while the
context points at another local cluster reaches that cluster instead.

Exit: `bash -n` on each script; no `helm` call without `--kube-context`.

## Phase 5: Live proof

1. Snapshot.
2. `./sandbox.sh stop`: exit 0, elapsed time (seconds, now the API handles SIGTERM), no other container changed; `./sandbox.sh start`:
   no contract redeploy; compare the snapshot; PostgreSQL starts without recovery.
3. `./services/blockscout/blockscout.sh stop` then `start`: pods back, Blockscout counts unchanged
   (apart from blocks mined meanwhile being missing, as the docs will say).
4. Same for nb-bond-api: bidders and bonds unchanged.
5. `./services/nb-ui/nb-ui.sh delete` then `start`: release removed, then restored (stateless, so
   the safest `delete` to exercise live).
6. No-op paths: `stop` twice, `start` on a running sandbox.

Exit: results in `progress.md`.

## Phase 6: Documentation

1. `README.md` lifecycle table: `stop` keeps all state; `start` resumes a stopped sandbox; `delete`
   is the only verb that discards state, and `delete` then `start` is the fresh-sandbox path.
   Recommend `stop` before quitting Docker or rebooting.
2. `infra/README.md`, `infra/DEVELOPMENT.md`, `infra/AGENTS.md`, `services/DEVELOPMENT.md`,
   `services/AGENTS.md`, `services/nb-ui/AGENTS.md`, `contracts/README.md` and its generated copy
   under `contracts/docs/natspec/` (hand-patched): `stop` and `delete` per component.
3. `docs/KNOWN_ISSUES.md`: unclean node shutdowns, the catch-up indexer gap, and the recovery
   procedure.
4. `services/blockscout/debugging.md`: the `replorigin_checkpoint` recovery.
5. Hygiene and link checks.

## Phase 7: PR

Archive this folder, update `docs/DOCUMENTATION_INDEX.md`, and open the PR against `development`
with the Phase 1 and Phase 5 evidence.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Script syntax | Broken verb dispatch | `bash -n`, no-op runs |
| Node shutdown | SIGKILL, unclean PostgreSQL stop | exit code, elapsed time, PostgreSQL logs |
| Sandbox state | Lost chain, explorer, or API data; contract redeploy | before/after snapshot, contracts step output |
| Component state | Scale-to-zero not restored by `start` | per-component snapshot, pod listing |
| Component delete | Reset path lost | release and namespace listing |
| API shutdown | SIGKILL after the grace period | jest test, pod termination time |
| Helm context | Command reaches another local cluster | no `helm` call without `--kube-context` |
| Isolation | Other local containers affected | `docker ps -a` before and after |
| Docs | Wrong command recommended | doc diffs, link check |

## Done Criteria

- [x] Phase 1 measurement recorded and the design choice made.
- [x] Top-level `stop`/`start` keep all state; `delete` unchanged.
- [x] The NB Bond API shuts down cleanly on SIGTERM.
- [x] Component `stop` keeps state, component `delete` resets; every `helm` call names its context.
- [x] Docs, KNOWN_ISSUES, and the Blockscout debugging guide updated.
