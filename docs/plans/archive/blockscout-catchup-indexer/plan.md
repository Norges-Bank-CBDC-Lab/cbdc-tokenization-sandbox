# Blockscout catch-up indexer — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-09-25
**Created:** 2026-09-25
**Scope:** `services/blockscout/values.backend.env.yaml`, `docs/KNOWN_ISSUES.md`, `services/DEVELOPMENT.md`, `services/blockscout/debugging.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Enable catch-up and apply it to the running Blockscout
Phase 2  Live proof: genesis, a component-stop gap, a full re-index after delete
Phase 3  Documentation
Phase 4  PR
```

One PR; the plan folder is archived in it.

## Phase 1: Enable catch-up

1. Baseline: chain head, Blockscout block count, minimum and maximum block, `missing_block_ranges`
   count, indexing status, verified-contract count.
2. `DISABLE_CATCHUP_INDEXER: "false"` with its comment.
3. `./services/blockscout/blockscout.sh start` from the branch (a `helm upgrade`); wait for the
   backend to be Ready.
4. Confirm the backend environment carries the new value.

Recovery: set the value back to `"true"` and run `start` again.

Exit: backend running with catch-up enabled, no new errors in its log.

## Phase 2: Live proof

1. Genesis: block 0 appears in `blocks`; indexing status reports `finished_indexing_blocks: true`.
2. Component-stop gap: record the head, `blockscout.sh stop`, wait until Besu has produced at least
   two empty blocks (about ten minutes), `blockscout.sh start`, and confirm those blocks are
   indexed; record how long catch-up took.
3. Full re-index: `blockscout.sh delete`, `blockscout.sh start`, then confirm the block count
   equals the chain head plus one and the range starts at 0; run
   `./contracts/contracts.sh verify-latest` and confirm 13 of 13; record the time to finish.
4. During each step: no new errors in the backend log, Besu logs clean, realtime indexing keeps up
   with the head.

Exit: results recorded in `progress.md`; if catch-up is too slow to be useful, stop and decide on
the batch settings with the operator.

## Phase 3: Documentation

1. `docs/KNOWN_ISSUES.md`: drop the catch-up bullets and follow-up from the shutdown entry.
2. `services/DEVELOPMENT.md`: Blockscout `stop` and `delete` now self-heal; state the observed
   times and that `delete` still needs `verify-latest`.
3. `services/blockscout/debugging.md`: the fallback paragraph no longer warns about unindexed
   blocks.
4. Hygiene and link checks.

## Phase 4: PR

Archive this folder, update `docs/DOCUMENTATION_INDEX.md`, open the PR against `development` with
the Phase 2 evidence.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Config | Setting not applied | backend environment |
| Indexing | Gaps not filled | `blocks` against chain head, `missing_block_ranges` |
| Verification | Lost after delete | `verify-latest` result |
| Load | RPC or database errors | backend and Besu logs, head lag |
| Docs | Stale gap warnings | doc diffs, link check |

## Done Criteria

- [x] Catch-up enabled and applied.
- [x] Genesis, stop gap, and full re-index proven live.
- [x] Docs updated.
