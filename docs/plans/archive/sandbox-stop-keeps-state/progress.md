# Stop keeps state, delete deletes — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-25 — Phases 1–6 done; PR opened with the plan archived in it
**Current phase:** Phase 7: PR
**Next action:** Operator reviews and merges the PR

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Characterise a graceful node stop | Done | `docker stop --time 330` on the node returned after 92 s with container exit code 130 (not 137); the other local containers were unaffected. After `docker start`, the API server was ready in 6 s and every pod in 112 s. PostgreSQL's previous run ended with fast-shutdown connection terminations at 09:24:49 and its next start logged "database system was shut down at 2026-09-25 09:24:49" with no crash recovery; the Blockscout backend also stopped at 09:24:49. Before/after snapshot: API responses, API table counts, and Blockscout verified-contract and transaction counts identical; the chain gained one empty block (80 → 81), which Blockscout indexed. The 92 s matches systemd's 90 s stop timeout: timed pod deletes show the NB Bond API pod needs 31 s (its full 30 s grace period, then SIGKILL) because its PID 1 `node` process has no SIGTERM handler, while `besu-archive-0` exits in 1 s. Decision: plain node stop (exit well inside the timeout, clean PostgreSQL shutdown); the scale-to-zero fallback would not help the API, which ignores SIGTERM either way (2026-09-25) | this PR |
| 2 — Top-level stop and start | Done | `common/helpers.sh`: `clusterNodeContainers` (via `kind get nodes`, so stopped nodes are listed), `nodeContainerRunning`, `stopClusterNodes` (`docker stop --time $SANDBOX_STOP_TIMEOUT_SECONDS`, reports elapsed time, fails on exit 137 with a pointer to the PostgreSQL recovery), `startClusterNodes` and `waitForKubeApiServer` (`/readyz`, 120 s). `createKindCluster` resumes a stopped node instead of failing as unreachable. `sandbox.sh`: `stop` calls only `stopClusterNodes` (no component calls, no marker change); `start` resumes stopped nodes right after the registry check, so it also works with `DEPLOY_INFRA=false`; `SANDBOX_STOP_TIMEOUT_SECONDS` (default 330) with its banner line; usage text. `bash -n` passes on both files; `shellcheck` is not installed and was not added. No-op paths checked against the live cluster: resume of a running node and stop of a missing cluster do nothing. The full stop/start runs in Phase 5 (2026-09-25) | this PR |
| 3 — NB Bond API graceful shutdown | Done | New `src/shutdown.ts`: on the first `SIGTERM`/`SIGINT` it closes the HTTP server and drops open connections (SSE clients would otherwise hold it open), stops the ingestion loop, waits for queued ingestion work with a 10 s bound, and exits 0; a second signal exits 1. `src/ingestion.ts` exports `waitForIngestionIdle()`; `src/index.ts` keeps the server handle and installs the handlers. `tests/shutdown.test.ts` covers the normal path, the timeout path, and the second signal. nb-bond-api lint and prettier clean, 252 jest tests pass (249 + 3), build passes. Real-process check: the built API run locally against a scratch database and the live chain (ingestion at block 83, one SSE client open) exited 0.08 s after `SIGTERM`, logging `received SIGTERM; shutting down` and `shutdown complete` (2026-09-25) | this PR |
| 4 — Component verbs and Helm context | Done | `common/helpers.sh` gains `scaleNamespacesToZero` (scales every Deployment and StatefulSet in the given namespaces to zero, waits until no Running or Pending pods remain, so completed job pods such as `db-init-job` do not block; volumes, releases, and ConfigMaps stay). `stop` now scales to zero in `blockscout.sh` (namespace `blockscout`, with a comment that blocks mined meanwhile are not indexed), `nb-bond-api.sh`, `nb-ui.sh`, and `infra.sh` (`besu` and `nginx-gateway`). New `delete` verbs carry the old bodies: `blockscout.sh delete` deletes the namespace, `nb-bond-api.sh delete` and `nb-ui.sh delete` uninstall their releases. `contracts.sh stop` prints that there is nothing to stop; `contracts.sh delete` removes the registry ConfigMap as `stop` did, and accepts the same flags. Usage text updated in all five scripts. All six `helm upgrade` calls and both remaining `helm uninstall` calls pass `--kube-context "kind-$CLUSTER_NAME"`, and the two context-less `kubectl get pods --all-namespaces` reads behind `image-report` and `cleanup-images` now pass `--context`. `clearContractsDeploymentMarker` removed: its only caller was the old `sandbox.sh stop`. `bash -n` passes on all seven scripts; no `helm` or `kubectl` call without a context remains; image-hash-input, Node-version, and hygiene checks pass (2026-09-25) | this PR |
| 5 — Live proof | Done | Three full cycles from this branch. `./sandbox.sh stop`: exit 0 in 90–91 s each time, node exit code 130, other local containers unaffected; a second `stop` printed "already stopped". `./sandbox.sh start`: resumed the stopped node ("Starting stopped node", API server wait ✔), printed "Contracts already deployed … Skipping deploy", left the `contracts-deployed` marker and every contract address unchanged, and rolled out the API image with the SIGTERM handler (`nb-bond-api:29559e7aa199`); on a running node it skipped the resume. After each cycle, API responses, API table counts, and Blockscout verified-contract and transaction counts matched the snapshot, the chain gained one empty block per cycle, Blockscout indexed it (no gap), and PostgreSQL started with "database system was shut down at …". With the new image the API pod terminates in 1 s (31 s before). Sampling processes inside the node during a stop: every workload process, etcd included, exits within 8 s; `kube-apiserver` and 20 `containerd-shim` processes then stay until systemd's 90 s stop timeout, which is where the 90 s goes; they hold no state. Components: `blockscout.sh stop` in 3 s (all five Deployments 0/0, completed `db-init-job` pod left, PVC and release kept), `blockscout.sh start` restored every Deployment to 1 and PostgreSQL started cleanly; `nb-bond-api.sh stop` in 2 s with the PVC kept, `start` back to 1/1 in 9 s; `nb-ui.sh delete` uninstalled only this cluster's release while the current `kubectl` context pointed at another local cluster whose `nb-ui` release stayed, and `nb-ui.sh start` restored it (web 200); `contracts.sh stop` printed its no-op message and left both ConfigMaps. Final snapshot identical to the pre-component snapshot; the same Docker containers exist as before Phase 5 (2026-09-25) | this PR |
| 6 — Documentation | Done | `README.md` lifecycle table: `start` resumes, `stop` keeps all state (with the timeout flag, the 90 s, and a link to the new known issue), `delete` discards all state and `delete` then `start` is the fresh-sandbox path. `infra/README.md`, `infra/DEVELOPMENT.md`, `infra/AGENTS.md`, `services/DEVELOPMENT.md` (including the Blockscout stop gap and what `blockscout.sh delete` costs), `services/AGENTS.md`, `services/nb-ui/AGENTS.md`, `services/nb-bond-api/DEVELOPMENT.md` (what the SQLite volume survives), `contracts/README.md` and its generated copy under `contracts/docs/natspec/src/` (hand-patched): `stop` and `delete` per component. `docs/KNOWN_ISSUES.md`: new entry on stopping before Docker quits, the 90 s stop, and the catch-up gap. `services/blockscout/debugging.md`: `replorigin_checkpoint` recovery (symptom, cause, commands with explicit context, validation, fallback, prevention); its read-only steps were run against the live sandbox. `docs/DOCUMENTATION_INDEX.md` entry for the debugging playbook updated. Hygiene and link checks pass; anchors checked by hand (2026-09-25) | this PR |
| 7 — PR | In progress | Plan folder archived in the PR itself | this PR |

## Deviations From the Plan

- Phase 3 does not close the SQLite handles explicitly. Each better-sqlite3 transaction is
  synchronous and committed before control returns, so exiting cannot interrupt a write; the
  handles are local to `createApp` and `startIngestionLoop`, so closing them would add plumbing
  through both. Exiting releases them, and the WAL is checkpointed on the next open.

## Verified So Far

- The lifecycle verbs' current behaviour and callers, `clusterExists`, the charts' replica
  settings, the node container's stop signal, timeout and restart policy, the workloads' grace
  periods, PostgreSQL's stop signal and `fsync` setting, Besu's empty-block period, and the
  catch-up indexer setting, verified on 2026-09-25 (see `design.md`).
- Operator decision on 2026-09-25: `stop` stops and keeps state; `delete` deletes.

## Follow-ups Found Along the Way

- Decide whether to enable the Blockscout catch-up indexer so a gap heals itself.
- The NB Bond API does not handle SIGTERM: as PID 1 without a handler, `node` ignores it, so
  every stop of its pod ends in a SIGKILL after the grace period, and a node stop takes about
  90 s instead of a few seconds. Folded into this plan as Phase 3 by the operator.
- No `helm` call in the scripts passes `--kube-context`; they act on the current `kubectl`
  context, which only `sandbox.sh start` sets. Today's `sandbox.sh stop` would therefore uninstall
  same-named releases in whichever local cluster is current. Folded into Phase 4.
- `stopIngestionLoop()` never closes the ingestion loop's write handle, so each
  `POST /v1/admin/restart-ingestion` leaves one SQLite handle open until the process exits. Not
  fixed here.
- `contracts/docs/natspec/src/README.md`, the generated copy of `contracts/README.md`, already
  differed from its source in unrelated places (for example "redemption flow" against "maturity
  closure"); only the `stop` section was patched here. A `forge doc` regeneration would resync it.
