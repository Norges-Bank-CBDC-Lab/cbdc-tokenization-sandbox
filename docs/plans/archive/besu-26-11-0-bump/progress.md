# Besu 26.11.0 bump — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Evidence | Done (2026-11-03) | Release notes, advisories, repository search, image availability, and a read-only live baseline |
| 1 Pin sweep | Done (2026-11-03) | Eight files, one line each; the baseline, image-hash, hygiene, link, licence, and node-version checks pass; the only `26.10.2` left outside frozen records is the "26.10.2 and later" wording in the register row |
| 2 Trust-store register | Done (2026-11-03) | The 26.11.0 image carries Temurin 25.0.3 on Ubuntu 24.04.5 with 142 certificates and none of the affected roots; the Besu row is refreshed |
| 3 Live upgrade | Done (2026-11-03) | In-place Helm upgrade on the existing chain; every acceptance row has evidence below |
| 4 PR | In progress | Folder archived in the change commit; push, PR, and merge pending |

## Deviations From Plan

None. The upgrade ran from the checkout that holds the gitignored local fixtures (the node
identities are derived from them), with the two pin files copied in and restored afterwards.

## Verified Claims

Baseline before the upgrade: both nodes `besu/v26.10.2`, chain 2018, head 284, block 0x11b hash
`0x9db516c8...4964d` with state root `0xa511c989ad...`; NB Bond API healthy at head 284 with lag 0;
Blockscout at block 284.

After the upgrade:

- Both nodes report `besu/v26.11.0` on chain 2018, running `localhost:5001/hyperledger/besu:26.11.0-kind`
  on fresh pods. The hash and state root of block 0x11b are identical to the baseline, so the existing
  chain was upgraded in place with no wipe and no redeployment.
- A zero-value self-transfer from a spare fixture account mined in block 285 with status 1. Both
  nodes report the identical block hash (`0x9aa4a1d1...29361`) and state root (`0xb83eac9ad2...`)
  and one transaction. The archive node re-executed a block that the validator, under the new QBFT
  import shortcut, had not executed twice, and reached the same state.
- NB Bond API: status `ok`, head 285, last block processed 285, lag 0, no consecutive failures; a read
  endpoint answered 200. Blockscout indexed block 285 with the same hash.
- The archive node was restarted once. NB Bond API stayed at lag 0 through a second transaction (block
  286), and Blockscout caught up from 285 to 286 within 30 seconds.
- Besu logs: no `ERROR` lines on either node. The `WARN` lines are startup configuration notices
  (zero-gas-price network settings and unused WebSocket and GraphQL host flags), not runtime faults.
- Blockscout logged its WebSocket endpoint as unavailable during each node restart ("shutting down WS
  client", no fallback configured). The same message appears in the log from the earlier restart on
  26.10.2 (2026-10-31), so it is existing Blockscout behaviour, not a regression. Blocks kept
  importing throughout.

## Follow-ups

- Blockscout shuts its WebSocket client down when the archive node restarts and has no fallback
  configured; blocks still import, but whether the client ever reconnects without a Blockscout restart
  was not checked. Existing behaviour, not changed here.
- Consider `--rpc-max-trace-steps` on the archive node (separate change).

## Session Handoff

Change committed on `feature/besu-26-11-0`. The local stack already runs 26.11.0. Next: operator
review, push, PR against `development`, merge on go-ahead. Until the merge, a fresh checkout of the
default branch still pins 26.10.2.
