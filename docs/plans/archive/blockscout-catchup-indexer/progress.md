# Blockscout catch-up indexer — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-25 — Phases 1–3 done; PR opened with the plan archived in it
**Current phase:** Phase 4: PR
**Next action:** Operator reviews and merges the PR

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Enable catch-up | Done | Baseline: chain head 104; Blockscout blocks 1–104 (block 0 missing), `missing_block_ranges` 0, 12 verified contracts, indexing ratio 0.99, `finished_indexing: false`. `DISABLE_CATCHUP_INDEXER: "false"` with its comment; `./services/blockscout/blockscout.sh start` from the branch (9 s, `helm upgrade`) rolled the backend, whose Deployment environment now carries `false`. Within a minute of boot the database held blocks 0–105 (106 blocks, genesis included) and the `block_catchup` fetcher logged "Index already caught up." every 10 s. The new pod logged five error records, all within 240 ms of boot and all from the web application (three Phoenix counters and event handlers starting before the endpoint's ETS table exists, the rate-limit config falling back to local settings, a missing static cache manifest); none from the indexer and none after boot (2026-09-25) | this PR |
| 2 — Live proof | Done | Genesis: indexing status `finished_indexing_blocks: true`, block ratio 1.00, blocks 0–105 of head 105. Component-stop gap: Blockscout stopped at head 105 (11:31:56 UTC); Besu produced blocks 106 and 107 by 11:37:51; `blockscout.sh start` at 11:38:01; block 106 indexed at 11:38:13 by the catch-up fetcher ("Index had to catch up", `missing_block_count` 1, range 106–106) and head block 107 at 11:38:28 by the realtime indexer; blocks 0–107 complete. Full re-index: `blockscout.sh delete` removed the namespace and its volume (167 s, mostly the backend's termination grace period); `blockscout.sh start` on an empty database had all 109 blocks (0–108) and all 74 transactions indexed within 77 s, by the time the backend was Ready, catch-up walking back from the head at about one block per second; `missing_block_ranges` 0; `./contracts/contracts.sh verify-latest` verified 13 of 13. Logs: both Besu nodes logged no WARN or ERROR in the last 20 minutes; Blockscout matched the chain head (108 of 108); each backend boot logged the same web-application startup errors within 250 ms of boot (endpoint ETS table not yet created, rate-limit config fallback, static manifest), none from the indexer. The fresh namespace also logged two BENS `500` responses at 11:42:46 and 11:42:50 (`relation "mapping" does not exist`: Blockscout indexed before BENS had created its table); none since, and the table now has 17 rows (2026-09-25) | this PR |
| 3 — Documentation | Done | `docs/KNOWN_ISSUES.md`: the shutdown entry's catch-up bullet and follow-up replaced by one line saying catch-up fills blocks mined while Blockscout was down. `services/DEVELOPMENT.md`: Blockscout `stop` gaps fill within seconds after `start`, and after `delete` catch-up re-indexes from block 0 in about a minute at this chain size; `verify-latest` still needed after `delete`. `services/blockscout/debugging.md`: the fallback paragraph says catch-up re-indexes from block 0. `services/blockscout/blockscout.sh`: the `stop` comment no longer says blocks are lost (`bash -n` passes). No stale gap wording left in the repo docs or scripts; hygiene and link checks pass (2026-09-25) | this PR |
| 4 — PR | In progress | Plan folder archived in the PR itself | this PR |

## Deviations From the Plan

- The intent spoke of the explorer reporting indexing as finished. Block indexing reports
  finished (`finished_indexing_blocks: true`); the overall `finished_indexing` flag stays false
  because it also counts internal transactions, whose fetcher is disabled and out of scope.
- Archived in the same PR as the change instead of a separate document-move PR.
- The full re-index took about as long as the backend's startup, so the batch settings stay at 1.
- Phase 3 also updated the `stop` comment in `services/blockscout/blockscout.sh`, which repeated
  the old gap warning.

## Verified So Far

- The current indexer settings and their history, the v11.2.6 runtime configuration for catch-up,
  the empty `missing_block_ranges` table during the 2026-09-25 gap, and today's coverage (blocks
  1–90 of 90, block 0 missing, ratio 0.98), verified on 2026-09-25 (see `design.md`).

## Follow-ups Found Along the Way

- Blockscout returns `ens_domain_name: null` for addresses that BENS resolves: BENS answers
  `addresses:batch-resolve-names` correctly (for example `Operator1`, `Alice.sec`) and Blockscout
  calls it on reads, but the names do not reach the API responses. **Inferred** pre-existing,
  because nothing on that path depends on the catch-up setting; not verified against a
  catch-up-off baseline.
- On a freshly created `blockscout` namespace, the indexer can call BENS before BENS has created
  its `mapping` table, which returns `500` for the first few seconds.
