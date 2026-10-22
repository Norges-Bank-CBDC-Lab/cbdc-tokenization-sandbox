# Stop keeps state, delete deletes — Intent

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Requested by:** sandbox operator

## Outcome

The lifecycle verbs mean what they say. `stop` stops the local sandbox, or one component of it,
and keeps every piece of state: the Besu chain, the Blockscout index and its contract
verifications, and the NB Bond API database, including the bidder keys that cannot be recovered
from the chain. `start` brings it back as it was. `delete` is the only verb that discards state.
An operator can therefore run `./sandbox.sh stop` before quitting Docker or rebooting and lose
nothing.

## Why This Change

On 2026-09-15 the Kind node container was killed rather than stopped (it later showed exit code
137). Blockscout's PostgreSQL had just written its replication-origin checkpoint file, and that
file never reached disk intact; it came back as eight zero bytes. PostgreSQL then aborted crash
recovery on every start (`PANIC: replication checkpoint has wrong magic 0`), and Blockscout was
down for ten days until the file was moved aside on 2026-09-25. Because the catch-up indexer is
disabled, the blocks mined in that window were never indexed, and the local sandbox was reset to
get a gap-free explorer.

The command that should have prevented this discards state instead. `./sandbox.sh stop` is
described in the README as "Stop workloads while keeping the cluster and cached images", but it
uninstalls every Helm release, deletes the `blockscout` namespace, and clears the contracts
deployment marker, which removes the chain, explorer, and API volumes. The component scripts'
`stop` verbs do the same for their own component. There is no command that stops the sandbox and
keeps its state.

## Scope

### In Scope

- `./sandbox.sh stop`: stop the Kind node container gracefully, with an explicit timeout long
  enough for every pod's own shutdown. Cluster, releases, volumes, and markers stay.
- `./sandbox.sh start`: when the node container exists but is stopped, start it and wait for the
  cluster before running the usual idempotent start; the contracts marker survives, so contracts
  are not redeployed.
- `./sandbox.sh delete`: unchanged (removes the cluster; the registry and its images stay).
- Component scripts (`infra/infra.sh`, `services/blockscout/blockscout.sh`,
  `services/nb-bond-api/nb-bond-api.sh`, `services/nb-ui/nb-ui.sh`, `contracts/contracts.sh`):
  `stop` scales the component's workloads to zero and keeps its release, configuration, and
  volumes; a new `delete` verb carries today's destructive behaviour (uninstall, namespace
  delete, marker and ConfigMap removal), so a fresh Blockscout database stays one command away.
  `contracts.sh` has no workloads, so its `stop` becomes a no-op that says so.
- The NB Bond API handles SIGTERM and shuts down cleanly, so no stop of its pod ends in a
  SIGKILL (added after Phase 1).
- Every `helm` call names the sandbox's own context, so no lifecycle command can reach another
  local cluster (added in Phase 2).
- Documentation of the new meanings wherever the verbs are described, a `KNOWN_ISSUES` entry, and
  the PostgreSQL recovery procedure in `services/blockscout/debugging.md`.

### Out of Scope

- Enabling the Blockscout catch-up indexer; recorded as a follow-up.
- Protecting against a host crash, power loss, or a forced Docker Desktop quit. A graceful stop
  only helps when it runs.
- Stopping automatically when Docker Desktop quits or macOS shuts down.
- Archived plans that mention the old `stop` behaviour; they are frozen records.
- The non-local deployment.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| `./sandbox.sh stop` stops the node container with exit code 0 inside its timeout, never 137 | The SIGKILL that caused the incident | `docker inspect` exit code, elapsed time |
| PostgreSQL logs a clean shutdown on `stop` and starts without crash recovery on `start` | Unclean database shutdown | PostgreSQL logs |
| After `stop` and `start`: same chain head (plus any new blocks), same bonds, auctions, and bidders from the API, same Blockscout blocks and verifications, no contract redeploy | Lost state | before/after snapshot, contracts step output |
| A component `stop` then `start` keeps that component's data and restores its pods | Component verbs still destructive | per-component snapshot |
| Component `delete` reproduces today's `stop` behaviour for that component | Lost reset path | release, namespace, and PVC listing after `delete` |
| `stop` and `start` act only on this repo's node container | Collateral effect on other local clusters | `docker ps -a` before and after |
| Every doc that describes the verbs states the new meaning | Operator reaches for the wrong command | doc diffs, link check |

## Constraints

- No new dependency; shell plus the tools the scripts already use (`docker`, `kubectl`, `kind`,
  `helm`).
- New script flags get the banner comment the repo requires.
- Public-repo rules; the documents describe the local sandbox only.

## Resolved Questions

- Component-level verbs follow the same rule (approved 2026-09-25).
- The NB Bond API SIGTERM fix is part of this plan (operator, 2026-09-25).
