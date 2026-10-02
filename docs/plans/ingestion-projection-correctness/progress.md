# Ingestion and projection correctness — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan written from a code review of ingestion, projection, and history; awaiting operator approval
**Current phase:** Not started
**Next action:** Operator approves the plan and acknowledges the decisions in `design.md`; then run Phase 0 (package gates for `services/nb-bond-api` and `services/nb-ui`, live descriptor count) and open `feature/ingestion-apply-seam` for Phase 1.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterization | Not started | | |
| 1 — Fetch/apply seam | Not started | | |
| 2 — Loop lifecycle | Not started | | |
| 3 — Chain-ordered apply | Not started | | |
| 4 — Position-guarded bond state, schema v7 | Not started | | |
| 5 — Bond history | Not started | | |
| 6 — Invalid bids | Not started | | |
| 7 — Live verification and close-out | Not started | | |

## Deviations From the Plan

None yet.

## Verified So Far

All against `development` at `db92409` on 2026-09-28, by reading the code unless stated.

- **A1** `BondCreated` always applies `created`, which resets `bond_state`; `supply-delta` only
  applies with a new `balance_events` row. Re-processing a window with `BondCreated` leaves supply
  at `0`. Other facts recover because later events replay in order.
- **When a window is re-processed today:** (1) plain restart while the old loop is mid-backfill
  or mid-window, because the new loop reads its checkpoint before the old loop's last commit;
  (2) two concurrent loops after a restart during a boot retry or two restarts in quick
  succession, since starts are not single-flight and the first interval handle is overwritten;
  (3) the reset race, where the old loop writes a later window and checkpoint into the fresh
  tables (skip) or partial data the new loop replays. **Not a path:** process crash or RPC error,
  because a window's rows and checkpoint are one SQLite transaction; schema migration, which
  replays into empty tables.
- **A2** `stopIngestionLoop()` only clears the timer; `processTo` never checks for a stop;
  `resetProjectionAndRestart()` drops without waiting; the loop connection is never closed. The
  live pod holds 3 + 3 `ingestion.sqlite` descriptors (checked with `kubectl exec`).
- **A3** Apply order per batch is manager, auction, token, transfers; `disableBond` and
  `_deployBond` emit the token event before the manager event, so a disable and re-create in one
  batch ends with `bond_state.disabled = 1` while `partitions.disabled = 0`.
- **A4** Both history reads are `ORDER BY block, id` with `LIMIT limit*4`; the composer sorts and
  slices afterwards. `Number('abc')` reaches SQLite as a `LIMIT` bind and fails with "datatype
  mismatch" (probed against better-sqlite3 13.0.3); a negative `LIMIT` returns every row.
  `historyQuerySchema` is unused and would reject a request with no parameters as written.
- **A5** `finalise` unseals every sealed bid before reading the selection; `submitBid` is
  permissionless; the composer falls back to all-sealed on any failure; nb-ui assumes one bid
  state per list.
- **A15** `BondAllocationFailed` and `BondBuybackComplete` are in the ABI artifact and emitted, and
  have no ingestion branch; `dvpSuccess` is discarded.
- **Dead code** The contract never emits `BidCancelled`; `redemption_complete` is never written or
  read; the `AuctionFinalized` handler never reads a timestamp; `BondSnapshot.events` is never
  read.
- **Tests** 37 suites, 252 tests pass (`npm test`). The Jest "worker failed to exit" warning comes
  from the 60 s timer in the third `tests/shutdown.test.ts` case (`--detectOpenHandles`), **not**
  from a database handle. The finding that it was likely the DB handle is corrected.
- **Refactor sizing** `processBlockRange` spans `src/ingestion.ts:588-1162`; the two decoders are
  identical. The plan limits the refactor to a fetch/apply split, one decoder, an injected chain
  reader, and per-source handler tables.
- Live sandbox on 2026-09-28: health `ok`, head 219, lag 0, no bonds projected, so no defect was
  reproduced live yet (Phase 7).

## Blocked / Waiting On

- Operator approval of the plan and acknowledgement of the decisions (schema v7 rebuild, `invalid`
  bid state, history page completion, live-verification mutations).

## Follow-ups Found Along the Way

- `tests/shutdown.test.ts` third case leaves a 60 s timer pending (`void shutdown('SIGTERM')`
  never settles), which causes Jest's "worker failed to exit" warning. Proposed: use fake timers in
  that case, or advance and await the first call. Outside this plan's scope.
- The `Auction` DTO could expose allocation failures directly (`allocation.failures[]`) instead of
  only history rows. Proposed: consider once the contracts plan settles the DvP failure events.
- `src/types.ts` `AuctionCache` (used by the in-memory map in `src/state.ts`) still carries
  `cancelled?: boolean` and other pre-projection fields; check whether that cache is still needed
  now that reads come from the projection. Proposed: separate cleanup.
- Error mapping for unexpected errors (a plain `Error` becomes 500) belongs to the separate
  `nb-bond-api-hardening` plan; this plan removes the two causes it found (history `NaN`, bid
  unsealing).

## Coordination With Other Plans

- `docs/plans/bond-coupon-maturity-correctness/` (contracts) may change events or the ABI. Any new
  or changed event needs an entry in the Phase 3 handler tables (with `needsTimestamp` set
  correctly) and must drive at most one `bond_state` transition per log. Landing Phase 3 first makes
  that a one-line addition.
- `nb-bond-api-hardening` touches `src/app.ts` (route extraction) and the error middleware. Phase 5
  changes only the history route's middleware line and handler body; Phase 6 changes
  `src/features/auctions/service.ts`. Whichever lands second rebases.

## Session Handoff

- Nothing implemented; no branch exists. The live sandbox was only read (health, bond list,
  descriptor count).
- `npm test` was run once in `services/nb-bond-api`; it compiles into the ignored `.tmp/` folder.
