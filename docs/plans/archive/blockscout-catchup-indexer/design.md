# Blockscout catch-up indexer — Design

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/sandbox-stop-keeps-state/`, `docs/plans/archive/blockscout-v11-upgrade-plan.md`, `docs/post-mortems/post-mortem-blockscout-besu-2026-01-22.md`.

## Decision Summary

Set `DISABLE_CATCHUP_INDEXER: "false"` and keep every other indexer setting. With catch-up on,
Blockscout's missing-ranges collector compares the database with `BLOCK_RANGES` (default
`FIRST_BLOCK..latest`, `FIRST_BLOCK` defaults to 0) and the catch-up fetcher fills each missing
range, alongside the realtime indexer. The chain is small, so the repo's conservative batch
settings (one block per batch, concurrency one) are kept; Phase 2 measures whether they are fast
enough.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `DISABLE_CATCHUP_INDEXER: "true"`, internal-transaction and pending-transaction fetchers disabled, catch-up batch size, concurrency, and missing-ranges batch size all `1` | `services/blockscout/values.backend.env.yaml` | One line changes |
| **Verified.** The setting has been there since the initial release; the Blockscout v11 upgrade plan kept it and noted that an explorer-only restart loses history | `git log`, `docs/plans/archive/blockscout-v11-upgrade-plan.md` | No recorded reason to keep it |
| **Inferred.** It belongs to the same round of trace-timeout tuning as the batch sizes and RPC timeouts, which the 2026-01-22 post-mortem traced to `ETHEREUM_JSONRPC_HTTP_INSECURE` | values-file comments, post-mortem | Enabling catch-up does not reopen that issue; the flag stays `"false"` |
| **Verified.** In the running v11.2.6 release, `DISABLE_CATCHUP_INDEXER` switches `Indexer.Block.Catchup.Supervisor`; the missing-ranges collector and catch-up fetcher live under it; upstream defaults are batch 10, concurrency 10, missing-ranges batch 100 000; `BLOCK_RANGES` defaults to `FIRST_BLOCK..latest` with `FIRST_BLOCK` 0 | `/app/releases/11.2.6/runtime.exs` in the backend pod | Enabling it covers the whole chain from genesis |
| **Verified.** With catch-up disabled, `missing_block_ranges` stayed empty while blocks 106–344 were absent, and the realtime fetcher (`max_gap` 1 000) did not fill a 239-block gap across a restart | live database on 2026-09-25 | Realtime alone cannot heal a restart gap |
| **Verified.** Today Blockscout holds blocks 1–90 of 90, block 0 is missing, and it reports `finished_indexing: false` with ratio 0.98 | indexing-status endpoint, `blocks` table | Block 0 is the first visible effect |
| **Verified.** Internal transactions are not fetched, so catch-up issues block and receipt calls, not traces | values file | RPC load per block is small |
| **Verified.** `blockscout.sh start` applies the values through `helm upgrade`, which rolls the backend with the new environment | `services/blockscout/blockscout.sh`, `common/helpers.sh` | No database migration or reset is needed |

## Target State

- `DISABLE_CATCHUP_INDEXER: "false"` with a comment: catch-up fills blocks mined while Blockscout
  was not running, including genesis.
- Docs describe a Blockscout-only stop or delete as self-healing, with the time it takes.

## Alternatives Considered

- **Leave it disabled and document the gap.** Already done in #293; it keeps the explorer
  incomplete after every Blockscout-only interruption and never reaches `finished_indexing`.
- **Enable catch-up and restore upstream batch defaults (10/10).** Faster, but a second change
  with no demonstrated need at this chain size; revisit if Phase 2 shows catch-up is slow.
- **Raise `INDEXER_REALTIME_FETCHER_MAX_GAP`.** Does not help: the realtime fetcher did not fill a
  gap below its current limit across a restart.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Enable catch-up | Yes | Approve the plan |
| Batch settings | Keep at 1 unless Phase 2 shows a problem | None |

## Residual Risks

- A very long outage leaves a long gap to fill at one block per batch; Phase 2 measures the rate.
- `blockscout.sh delete` still loses contract verifications; `verify-latest` restores them.
