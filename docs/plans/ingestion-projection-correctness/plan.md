# Ingestion and projection correctness — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `services/nb-bond-api` (`src/ingestion.ts`, `src/ingestion-db.ts`, `src/admin.ts`,
`src/index.ts`, `src/projection/bond-state.ts`, `src/projection/compose-projection.ts`,
`src/projection/snapshots.ts`, `src/compose.ts`, `src/bid.ts`, `src/features/auctions/service.ts`,
`src/contracts/bonds.ts`, `src/contracts/auctions.ts`, the history route in `src/app.ts`,
`openapi.json`, tests, `DEVELOPMENT.md`); `services/nb-ui` (`AuctionDetailPage.jsx`,
`FinaliseAuctionModal.jsx`, tests)
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline and characterization                      (no PR)
Phase 1  Fetch/apply seam, shared decoder, injected chain   -> PR 1
Phase 2  Loop lifecycle: abort, single start, idle, close   -> PR 2
Phase 3  Chain-ordered apply, declared timestamps,
         allocation-failure events, dead projection code    -> PR 3
Phase 4  Position-guarded bond_state, schema v7             -> PR 4
Phase 5  Bond history newest first, validated query         -> PR 5 (independent)
Phase 6  Invalid bids in API, finalise, and UI              -> PR 6 (independent)
Phase 7  Live verification on the local sandbox, archive    -> evidence in the last PR
```

Phases 1 → 2 → 3 → 4 are strictly ordered: the lifecycle and ordering tests need the seam, and
the position guard is only valid once logs are applied in chain order. Phase 2 comes before the
ordering work because it removes the only live trigger for replays. Phases 5 and 6 touch the
read and auction paths only and can land in parallel with 1–4. Each PR updates the documentation
its change affects; Phase 7 records the live evidence and archives the folder.

## Phase 0: Baseline and Characterization

### Goal

Record the starting point so every later phase can show its delta.

### Scope

- `services/nb-bond-api`, `services/nb-ui` package gates; the live sandbox (read-only).

### Steps

1. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`;
   record suites and tests (37 and 252 on 2026-09-28) in `progress.md`.
2. `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build`; record
   the vitest count.
3. Read-only live baseline: `/v1/health` (head, lag), `/v1/bonds?includeDisabled=true`, and the
   descriptor count
   `kubectl -n nb-bond-api exec deploy/nb-bond-api -- sh -c 'ls -l /proc/1/fd | grep -c "ingestion.sqlite$"'`
   (3 on 2026-09-28).

### Verification Stop

- Gates green; counts recorded.

### Failure Diagnosis / Fix Forward / Rollback

- A red gate on `development` is a pre-existing failure: record it, do not fix it here.

### Exit Criteria

- [ ] Baseline counts and live observations are in `progress.md`.

## Phase 1: Fetch/Apply Seam

### Goal

Make range processing testable without a chain, with no behaviour change.

### Scope

- `src/ingestion.ts`; new `tests/ingestion-apply.test.ts`; a small log-builder helper under
  `tests/` (for example `tests/helpers/chain-logs.ts`).

### Steps

1. Replace `decodeManagerEvents` and `decodeTokenEvents` with `decodeLogs(logs, iface, source)`;
   the entry type gains `source: 'manager' | 'token' | 'auction'`.
2. Introduce `ChainReader` and a narrow `IngestionContracts` type (see `design.md`). Move the three
   `getLogs` calls, decoding, partition resolution, the `AuctionFinalized` allocation reads, and the
   timestamp prefetch into `fetchRangeInputs(...)`, returning `RangeInputs { parsedManager,
   parsedToken, parsedAuction, tokenActions, tokenPartitionMappings, resolvedPartitions,
   blockTimestamps, finalAllocations }`.
3. Move the transaction body verbatim into `applyRangeInputs(db, inputs, nextCheckpoint)`, returning
   `{ latestTxHash, changedResources }`. Keep the loop order exactly as today.
4. Lift `processTo` to module level over `IngestionRun { db, chain, contracts, nextBlock }` and give
   `startIngestionLoop(deps = defaultIngestionDeps)` a deps object (`chain`, `contractsFor(address)`,
   `openDatabase`, `getBondManagerAddress`). Defaults are the current module-level provider and
   functions. Export `applyRangeInputs` and `decodeLogs` with the same "exported for tests" comment
   the file already uses.
5. Test helper: build `Log`-shaped objects from the real ABIs in `src/abi` with
   `Interface.encodeEventLog`, assigning `blockNumber`, `index`, and `transactionHash`, then run them
   through `decodeLogs`.
6. `tests/ingestion-apply.test.ts` (characterization, in-memory `openDatabase({ dbPath: ':memory:' })`):
   - a RATE issuance lifecycle batch (`IsinIssued`, `BondCreated`, `AuctionCreated`,
     `BondAuctionInitialised`, `BidSubmitted`, `BondAuctionClosed`, mint `TransferByPartition`,
     `IsinEnabled`, two DvP transfers, `BondIssuanceComplete`, `AuctionFinalized` with prefetched
     allocations, `BondAuctionFinalised`) → `bond_state` supply, offering, `ever_issued`, coupon
     fields; `balances`; auction status `finalised`; checkpoint saved;
   - a coupon period and a maturity batch → `coupon_payment_count`, `is_matured`, supply `0`.

### Verification Stop

- Package gate green; test count = baseline + new tests; no existing test changed.

### Failure Diagnosis / Fix Forward / Rollback

- A characterization assertion that fails against the moved code means the move changed behaviour:
  diff the moved block against `development` and restore it. Do not adjust the assertion.

### Exit Criteria

- [ ] `processBlockRange` is gone; `fetchRangeInputs` + `applyRangeInputs` replace it.
- [ ] One decoder; the loop runs against an injected chain reader.
- [ ] Characterization tests pass on the moved code.

## Phase 2: Loop Lifecycle

### Goal

A stopped loop commits nothing, only the newest start installs a loop, the reset waits for idle,
and every loop connection is closed.

### Scope

- `src/ingestion.ts`, `src/ingestion-db.ts` (`close()` on `IngestionDatabase`), `src/admin.ts`,
  `src/index.ts` (no call change expected), new `tests/ingestion-loop-lifecycle.test.ts`,
  `tests/admin.test.ts`, `DEVELOPMENT.md` §7.9.

### Steps

1. `IngestionRun` gains `stopped: boolean`; module state gains `currentRun`, `loopGeneration`, and
   `pendingClose: Promise<void>`.
2. `stopIngestionLoop()`: set `currentRun.stopped = true`, `loopGeneration++`, clear timer and
   advancer, `loopRunning = false`, detach the connection and chain
   `pendingClose = ingestionQueue.then(() => closeQuietly(db))`.
3. `processTo(run, target)`: return `false` (no `pushError`, no failure count) if `run.stopped` at
   the start of each window or after `fetchRangeInputs` resolves; the second check sits on the line
   directly before `applyRangeInputs`.
4. `startIngestionLoopWithRetry()`: `const generation = ++loopGeneration`; after each attempt and
   each sleep, return if `loopGeneration !== generation`. Pass `generation` to
   `startIngestionLoop`, which checks it after every await; when superseded it closes the connection
   it opened and returns. Wrap everything after `openDatabase()` so a throw closes the connection
   before rethrowing.
5. `waitForIngestionIdle()` resolves after `ingestionQueue` and `pendingClose`.
6. `IngestionDatabase` declares `close(): void`; remove the cast in `src/admin.ts`.
7. `resetProjectionAndRestart()`: `stop()`, `await` a bounded `waitIdle()` (new `AdminDeps.waitIdle`,
   default `waitForIngestionIdle` raced against 5 s; on timeout log a warning and continue), then
   drop, then start. `restartIngestionLoop()` keeps its shape (the abort makes waiting unnecessary).
8. `__resetIngestionStateForTests()` also clears `currentRun`, `pendingClose`, and the generation.
9. Tests (`tests/ingestion-loop-lifecycle.test.ts`, with a fake chain reader whose `getLogs` returns
   a promise the test resolves):
   - stop while a window is fetching → resolve → no rows, checkpoint unchanged, `processTo`
     resolves `false`, `consecutiveFailures` 0;
   - stop during a multi-window backfill → only windows committed before the stop exist;
   - connection closed only after the queued work settles (a held queue item delays `close`);
   - start that throws after `openDatabase()` closes the connection;
   - start held mid-setup, then `stop()` → release → no timer installed, `loopRunning` false,
     connection closed;
   - two overlapping `startIngestionLoopWithRetry()` calls → exactly one run installed.
10. `tests/admin.test.ts`: reset calls `stop`, `waitIdle`, `dropProjection`, `start` in that order;
    a `waitIdle` that never settles still drops after the bound.
11. `DEVELOPMENT.md` §7.9: plain restart and reset semantics (stop aborts in-flight work; reset
    waits up to the bound for idle; connections closed).

### Verification Stop

- Package gate green.
- Local: deploy the branch image (`./services/nb-bond-api/nb-bond-api.sh start`), call
  `POST /v1/admin/restart-ingestion` five times, then `?fromBlock=0` once; descriptor count stays 3;
  `/v1/health` shows lag 0 and no new `recentErrors`. (Operator go-ahead for the redeploy.)

### Failure Diagnosis / Fix Forward / Rollback

- "database connection is not open" in `recentErrors` → a close ran before its run settled; the
  close must chain on the queue captured at stop time.
- Descriptor count grows → a start path returns without closing; check the superseded and throw
  paths.
- Revert is a single-PR revert; no data migration is involved.

### Exit Criteria

- [ ] Every lifecycle test listed passes.
- [ ] Live descriptor count unchanged across restarts; health clean.

## Phase 3: Chain-Ordered Apply

### Goal

Apply every batch in chain order through declared handlers, fail loudly on a missing timestamp,
record allocation failures, and remove dead projection paths.

### Scope

- `src/ingestion.ts`, `src/ingestion-db.ts` (`getAuctionBids`, `AuctionBidRow` reads),
  `src/projection/compose-projection.ts`, `src/projection/snapshots.ts`,
  `tests/ingestion-apply.test.ts`, `tests/auction-projection.test.ts`, `DEVELOPMENT.md` §7.4.

### Steps

1. Move the branch bodies into `applyManagerLog`, `applyAuctionLog`, and `applyTokenLog` (the latter
   also applies `TransferByPartition` through the existing balance and `supply-delta` code). Each
   source has a handler table `{ [eventName]: { needsTimestamp: boolean; apply(ctx, entry) } }`.
2. `applyRangeInputs`: after the partition upserts, merge the three decoded lists, sort by
   `(blockNumber, index)`, and dispatch. `latestTxHash` becomes the last entry's hash.
3. `fetchRangeInputs` builds the timestamp block set from `needsTimestamp` (today: `CouponPaid`,
   `CouponPeriodPaid`, `IsinEnabled`, `BondAuctionClosed`, `BondAuctionFinalised`). The apply context
   exposes `timestampOf(block, eventName)`, which throws when absent. Replace every
   `blockTimestamps.get(block) ?? 0n`.
4. New handlers: `BondAllocationFailed` → `upsertAuctionEvent` type `ALLOCATION_FAILED`, payload
   `{ bidder, reason }`; `BondBuybackComplete` → `insertBondEvent` type `BUYBACK_COMPLETE`, payload
   `{ total }`. `BondAuctionFinalised` payload gains `dvpSuccess`. Both add `bonds` and `auctions` to
   `changedResources`.
5. Remove the `BidCancelled` handler and `cancelAuctionBid`; stop reading `cancelled` in
   `getAuctionBids` and drop the `row.cancelled === 0` filters in `compose-projection.ts`; stop
   writing it in `upsertAuctionBid` (the column keeps its default until Phase 4). Remove
   `BondSnapshot.events` and its two reads. Update the cancellation test in
   `tests/auction-projection.test.ts` to cover resubmission idempotency only.
6. Tests in `tests/ingestion-apply.test.ts`:
   - dispatch order: interleaved manager/token/auction logs in one block are applied in `logIndex`
     order (assert through a disable-then-re-create batch: `IsinIssued`, `BondCreated`,
     `IsinDisabled`, `BondDisabled`, `IsinIssued`, `BondCreated` → `bond_state.disabled = 0` and
     `partitions.disabled = 0`, `GET`-level `disabled: false` via `composeProjectedBond`);
   - the Phase 1 characterization batches still pass unchanged;
   - missing timestamp → `applyRangeInputs` throws and the checkpoint is unchanged;
   - `ALLOCATION_FAILED` and `BUYBACK_COMPLETE` rows written once and deduplicated on replay.
7. `DEVELOPMENT.md` §7.4: chain-ordered application, handler-declared timestamps, new history
   types.

### Verification Stop

- Package gate green; every Phase 1 characterization test unchanged and green.

### Failure Diagnosis / Fix Forward / Rollback

- A characterization failure after the merge points at a handler that relied on manager-first
  order; fix the handler to be order-tolerant rather than reordering.
- A live tick failing with "missing prefetched timestamp" names the handler whose flag is wrong.

### Exit Criteria

- [ ] One ordered dispatch loop; no hand-kept timestamp list; no `?? 0n` timestamp fallback.
- [ ] Disable and re-create in one batch projects `disabled: false`.
- [ ] Allocation failure and buyback completion rows present; dead paths removed.

## Phase 4: Position-Guarded Bond State and Schema v7

### Goal

Make every `bond_state` transition idempotent under replay and rebuild existing projections with
the corrected rules.

### Scope

- `src/projection/bond-state.ts`, `src/ingestion.ts` (`applyBondStateEvent`),
  `src/ingestion-db.ts` (schema, row types), `tests/bond-state-reducer.test.ts`,
  `tests/ingestion-apply.test.ts`, `tests/ingestion-idempotency.test.ts` (version assertions),
  `DEVELOPMENT.md` §7.4.

### Steps

1. `bond-state.ts`: export `isAfterPosition(state, { block, logIndex })` and document the invariant
   "one transition per log".
2. `applyBondStateEvent`: if the row exists and the event is not after its
   `(updated_block, updated_log_index)`, return without writing.
3. `ingestion-db.ts`: `SCHEMA_VERSION = 7` with its history line; remove
   `bond_state.redemption_complete`, `auction_bids.cancelled`, and `idx_auction_bids_active` from the
   DDL and row types.
4. Tests:
   - reducer: `isAfterPosition` boundaries (same block lower/equal/higher index; lower block);
   - apply: the issuance lifecycle batch applied twice → identical `bond_state` rows;
   - apply: a window containing `BondCreated` re-applied after a later window (transfers,
     coupon) → supply, offering, coupon count, `ever_issued` unchanged;
   - apply: re-create after disable across two windows still resets (a later `created` is applied);
   - migration: a v6 file opens as v7, projection rebuilt, system-of-record rows preserved (extend
     the existing migration test rather than adding a file).
5. `DEVELOPMENT.md` §7.4: position guard, v7 note, current version `7`.

### Verification Stop

- Package gate green.
- Local: redeploy the branch image; logs show `ingestion DB schema migrated from v6 to v7` once;
  projection catches up to the head; `/v1/bonds` matches the pre-upgrade listing.

### Failure Diagnosis / Fix Forward / Rollback

- A bond missing a transition after the upgrade means an event was applied out of chain order
  (Phase 3) or a log produced two transitions; find it by replaying that bond's blocks in a test.
- Rolling back to a v6 binary needs a database backup from before the upgrade (existing guidance);
  locally, `fromBlock=0` on the older image rebuilds it.

### Exit Criteria

- [ ] Replay tests show byte-identical `bond_state`.
- [ ] v7 migration verified locally; no unused columns remain.

## Phase 5: Bond History

### Goal

History returns the newest events first, pages backwards without gaps, and rejects bad input.

### Scope

- `src/ingestion-db.ts`, `src/compose.ts`, `src/contracts/bonds.ts`, the history route in
  `src/app.ts`, `openapi.json`, `tests/ingestion-db.test.ts`, a new `tests/bond-history.test.ts`,
  `DEVELOPMENT.md` §4.2.

### Steps

1. `listBondHistoryPage(db, isin, { before, limit })` as in `design.md`, including the oldest-block
   completion query. Remove `getAuctionEventsByIsin` and `getBondEventsByIsin` once they have no
   callers (after Phase 3 removes the snapshot read; if Phase 5 lands first, keep
   `getBondEventsByIsin` for the snapshot until Phase 3) and update `tests/ingestion-db.test.ts`.
2. `composeBondHistory(db, isin, { before, limit })` maps rows to `HistoryEvent`; no sorting or
   slicing in JS.
3. `historyQuerySchema`: `before` optional non-negative int, `limit` int 1–500 default 100. Route:
   `validateRequest(historyQuerySchema, 'query')` after the params check; read `req.query` values.
4. `bonds.ts` path fragment: `limit` description "A page may exceed `limit` to include every event
   of its oldest block." Run `npm run regen:openapi`; commit `openapi.json`.
5. Tests (`tests/bond-history.test.ts`, in-memory DB):
   - 600 bond and auction rows for one ISIN: first page holds the newest 100 in
     `(block, log_index)` descending order, including the newest `MATURED` row;
   - walking `before` to the end returns every row exactly once;
   - a block with events straddling the page boundary is returned whole;
   - route: `limit=abc`, `limit=0`, `limit=501`, `before=-1` → 400 problem documents; no params →
     100 rows.
6. `DEVELOPMENT.md` §4.2: ordering, cursor, page-completion note, 400 behaviour.

### Verification Stop

- Package gate green; `openapi-contract` test passes on the regenerated document.

### Failure Diagnosis / Fix Forward / Rollback

- Duplicate rows across pages mean the cursor is inclusive; `before` is exclusive by block.

### Exit Criteria

- [ ] Newest-first paging proven past 4 × `limit` rows; bad input returns 400.

## Phase 6: Invalid Bids

### Goal

A bid that cannot be unsealed is shown as `invalid`, excluded from the allocation, and cannot
block or join a finalisation.

### Scope

- `src/bid.ts`, `src/projection/compose-projection.ts`, `src/features/auctions/service.ts`,
  `src/contracts/auctions.ts`, `openapi.json`, `tests/bid.test.ts`,
  `tests/auction-service.test.ts`, `tests/compose-auction-failure.test.ts`;
  `services/nb-ui/src/pages/AuctionDetailPage.jsx`, `FinaliseAuctionModal.jsx` and their tests;
  `DEVELOPMENT.md` §4.3 and §7.2.

### Steps

1. `bid.ts`: `BidUnsealError` with a `code`; `unsealBid` throws it for each existing check
   (decryption failure wrapped as `undecryptable`); add `unsealBids`.
2. Contract: `bidReasonSchema` enum, `invalidBidSchema`, `bidStateSchema` with `invalid`,
   `bidSchema` union of three. `npm run regen:openapi`.
3. Composer: per-bid unsealing via `unsealBids`; bids in `bidIndex` order; allocation preview from
   valid bids; the blanket `try/catch` goes.
4. Service `finalise`: `unsealBids` over the on-chain sealed bids; invalid selected index → 400
   with the reason; allocation and proofs from valid bids only.
5. nb-ui: `BidsCard` splits unsealed and invalid rows (the unsealed table and totals ignore
   invalid bids; invalid rows show bidder, index, reason); detail KPI shows the invalid count;
   `FinaliseAuctionModal` notes excluded invalid bids.
6. Tests:
   - `bid.test.ts`: each reason code from a crafted bid (garbage ciphertext, wrong ISIN, hash
     mismatch, unsigned);
   - `auction-service.test.ts`: finalise with one garbage bid not selected → sends the transaction;
     selecting it → 400; all-valid path unchanged;
   - `compose-auction-failure.test.ts` (or a sibling): closed auction with one garbage bid →
     one `invalid` bid, others `unsealed`, allocation computed from valid bids;
   - nb-ui: mixed bid list renders both sections and correct totals; modal hint with N > 0.
7. Docs: `DEVELOPMENT.md` §4.3 (finalise with invalid bids) and §7.1/§7.2 (sealing key change shows
   bids as `invalid (undecryptable)`).

### Verification Stop

- Both package gates green; regenerated `openapi.json` committed.

### Failure Diagnosis / Fix Forward / Rollback

- An allocation hash mismatch between preview and finalise means the two paths used different
  valid sets; both must call `unsealBids`.

### Exit Criteria

- [ ] One undecryptable bid no longer blocks finalisation; it is visible with its reason.

## Phase 7: Live Verification and Close-Out

### Goal

Prove the fixes on the local sandbox, including a `fromBlock=0` resync, then archive the plan.

### Scope

- Local sandbox (operator go-ahead required: creates bonds and auctions, submits a malformed bid,
  restarts and resets ingestion). No `./sandbox.sh delete`.

### Steps

1. Deploy the final branch image. Record `/v1/health` and the descriptor count.
2. Disable and re-create: create a bond, disable it, create the same ISIN again; confirm
   `disabled: false` and listed; `POST /v1/admin/restart-ingestion?fromBlock=0`; after catch-up,
   confirm the same.
3. Supply under replay: run a RATE auction to finalisation; compare projected `totalSupply` with
   `cast call <BondToken> "totalSupplyByPartition(bytes32)(uint256)" <partition>`; trigger
   `fromBlock=0`, then a plain restart during the backfill; compare again.
4. Malformed bid: submit a bid with arbitrary ciphertext bytes to an open auction from a dealer
   account (address and key from the generated local fixture files, referenced by path); close;
   the auction shows one `invalid` bid; finalise with the valid selection succeeds.
5. Allocation failure: finalise with a winner lacking wNOK balance or allowlisting; history shows
   `ALLOCATION_FAILED` and `FINALISED` with `dvpSuccess: false`.
6. History: `GET /v1/bonds/{isin}/history?limit=5` shows the newest rows; `limit=abc` → 400.
7. Record evidence in `progress.md`; move the folder to `docs/plans/archive/`, set statuses, update
   `docs/DOCUMENTATION_INDEX.md` in the same PR as the last slice.

### Verification Stop

- Every acceptance criterion in `intent.md` has recorded evidence.

### Failure Diagnosis / Fix Forward / Rollback

- A live mismatch that unit tests did not show: capture the block range, reproduce it as an
  apply-seam test from the real logs, fix forward in the owning phase's code.

### Exit Criteria

- [ ] Live evidence recorded; folder archived; index updated.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Reducer/domain | Position comparison boundaries; order tolerance kept | `tests/bond-state-reducer.test.ts` |
| Persistence/ingestion | Characterization of a full lifecycle through the real apply path | `tests/ingestion-apply.test.ts` (Phase 1) |
| Persistence/ingestion | Cross-contract `logIndex` order; disable and re-create in one batch | `tests/ingestion-apply.test.ts` (Phase 3) |
| Persistence/ingestion | Replay of a window with `BondCreated`; duplicate batch | `tests/ingestion-apply.test.ts` (Phase 4) |
| Persistence/ingestion | Missing timestamp fails the tick without committing | `tests/ingestion-apply.test.ts` (Phase 3) |
| Persistence/ingestion | Allocation failure and buyback rows, deduplicated | `tests/ingestion-apply.test.ts` (Phase 3) |
| Loop lifecycle | Stop mid-window, mid-backfill; superseded and failed starts; deferred close | `tests/ingestion-loop-lifecycle.test.ts` |
| Admin | Reset order stop → idle → drop → start; bounded wait | `tests/admin.test.ts` |
| Schema | v6 → v7 rebuild keeps system-of-record tables | `tests/ingestion-idempotency.test.ts` |
| Composer/service | History newest first, cursor walk, block completion | `tests/bond-history.test.ts` |
| Composer/service | Invalid bid excluded from preview and finalise; selection rejected | `tests/compose-auction-failure.test.ts`, `tests/auction-service.test.ts` |
| API/Zod contract | History query 400s; `invalid` bid in the union; regenerated spec | route tests, `tests/openapi-contract.test.ts` |
| UI/client | Mixed bid states render; totals ignore invalid bids | nb-ui vitest |
| Local runtime | Descriptor count; `fromBlock=0` resync of re-create; supply vs chain; malformed bid; failed allocation | Phase 7 evidence |

## Recommended PR Slices

| Slice | Branch | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|---|
| 1 | `feature/ingestion-apply-seam` | Testable fetch/apply split, one decoder, injected chain | Characterization tests | None |
| 2 | `feature/ingestion-loop-lifecycle` | Stop aborts; single start; idle before drop; connections closed | Lifecycle and admin tests; live descriptor count | None |
| 3 | `feature/ingestion-chain-order` | Chain-ordered dispatch; declared timestamps; allocation failure history; dead paths removed | Order, re-create, timestamp tests | `cancelled` and `redemption_complete` columns remain until slice 4 |
| 4 | `feature/ingestion-idempotent-bond-state` | Position guard; schema v7 rebuild | Replay tests; local migration log | None |
| 5 | `feature/bond-history-newest-first` | SQL paging, validated query | History tests; regenerated spec | Keeps `getBondEventsByIsin` if slice 3 has not merged |
| 6 | `feature/auction-invalid-bids` | `invalid` bid state across API, finalise, UI | Service, composer, UI tests | None |

Phase 7 evidence and the archive move ride on whichever slice merges last. Branching, commits,
and CI gates follow the repository PR workflow.

## Migration, Rebuild, and Rollout

- Data/schema version effect: v6 → v7 in slice 4; one automatic projection rebuild on first boot;
  system-of-record tables untouched.
- Local rebuild/restart path: `./services/nb-bond-api/nb-bond-api.sh start` from the branch; the
  migration runs at open. `POST /v1/admin/restart-ingestion?fromBlock=0` remains the manual path.
- Compatibility window: slice 3 leaves two unused columns on existing databases (harmless defaults);
  slice 4 removes them. Slices 5 and 6 are independent of the schema.
- Deployed note: a non-local deployment with a persistent projection volume rebuilds once on the
  v7 image; take the backup described in `DEVELOPMENT.md` §7.4 first.
- Rollback or fix-forward boundary: slices 1–3 and 5–6 revert cleanly; after slice 4 a rollback
  needs the pre-upgrade database or a `fromBlock=0` resync on the older image.

## Documentation and Public-Repo Hygiene

- `services/nb-bond-api/DEVELOPMENT.md`: §4.2 history, §4.3 finalise, §7.1–§7.2 invalid bids, §7.4
  ingestion order, timestamps, position guard, schema v7, §7.9 restart semantics.
- `docs/ARCHITECTURE.md`: check the projection paragraph (around the atomic-commit sentence) and
  `docs/diagrams/processes/mutation-projection-sequence.md` for ordering or restart claims.
- `docs/KNOWN_ISSUES.md`: no new entry expected; the `cancelBid` entry stays accurate.
- `docs/DOCUMENTATION_INDEX.md`: add this folder when the plan is committed; move it to the archive
  list when it ships.
- Third-party/license inventory impact: none.

Verification:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

## Out of Scope

- Error middleware, nonce handling, the chart, and `app.ts` route extraction (separate hardening
  plan); contract and ABI changes (separate contracts plan).
- Allocation failures on the `Auction` DTO; history rows only.
- The `tests/shutdown.test.ts` timer leak (follow-up).

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] No temporary compatibility path remains (unused columns removed by v7).
- [ ] Both package gates, the regenerated `openapi.json`, hygiene and link checks pass.
- [ ] `DEVELOPMENT.md` describes the implemented ordering, idempotency, history, restart, and
      invalid-bid behaviour.
- [ ] PR evidence contains no private environment information.
