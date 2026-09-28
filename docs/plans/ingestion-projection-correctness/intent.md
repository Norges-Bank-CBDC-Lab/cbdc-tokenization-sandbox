# Ingestion and projection correctness — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

The NB Bond API projection shows the same bond, auction, and history facts as the chain,
however the ingestion loop is restarted, reset, or replayed. An operator who restarts or resets
ingestion from the health modal, re-creates a disabled ISIN, looks at a busy bond's history, or
finalises an auction that received a malformed bid gets the correct supply, status, holders,
disabled flag, newest events, and a working finalisation. Every open SQLite connection the loop
opens is closed when the loop stops.

## Why This Change

A review of `services/nb-bond-api` ingestion, projection, and history code on 2026-09-28 found
defects that corrupt or hide projected state through normal operator actions:

- **Replay zeroes supply.** Re-processing a block window that contains `BondCreated` resets the
  bond's projected state, and the deduplicated transfer rows never add the supply back. The bond
  then shows zero supply, the wrong status, and is no longer payable.
- **Restart and reset race in-flight ingestion.** Stopping the loop only clears its timer. The
  window being processed keeps running, commits rows and a checkpoint after the stop, and so
  makes the next loop replay blocks (triggering the defect above) or, after a reset, skip them.
  Overlapping starts can leave two loops running for good. The loop's SQLite connection is never
  closed.
- **A re-created bond can show `disabled: true`.** Within one batch, manager events are applied
  before token events, so the old lifecycle's `IsinDisabled` lands after the new `BondCreated`.
- **History returns the oldest events.** The history query reads the oldest rows first, then keeps
  the newest of those; the newest events of a busy bond (for example `MATURED`) are unreachable.
  A non-numeric `limit` returns 500 and a negative one removes the limit.
- **One malformed bid blocks finalisation.** `submitBid` is permissionless; finalisation unseals
  every bid up front and fails with 500 on the first one it cannot decrypt, and the auction view
  then shows every bid as sealed.
- **Allocation failures are invisible.** `BondAllocationFailed` and `BondBuybackComplete` are not
  ingested.

## Scope

### In Scope

1. A minimal split of the ingestion range processor into an async fetch step and a synchronous
   apply step, with one shared log decoder, so ordering, replay, and stop behaviour can be tested
   without a chain.
2. Loop lifecycle: stop aborts in-flight work before it commits, only the newest start can install
   a loop, the admin reset waits for ingestion to go idle before dropping tables, and the loop's
   SQLite connection is closed after stop, on a failed start, and on shutdown.
3. Chain-ordered application: manager, token, and auction logs of a batch are applied in
   `(block, logIndex)` order; the block-timestamp prefetch list comes from the event handlers
   themselves and a missing timestamp fails the tick instead of projecting `0`.
4. Idempotent bond-state reduction: a reducer event at or before the bond's last applied chain
   position is skipped, plus a projection schema bump so existing databases rebuild with the
   corrected rules.
5. Bond history: newest first, `before` and `limit` applied in SQL, query validated at the
   boundary (400 on bad input), pages that never split a block.
6. Malformed bids: per-bid unsealing, an explicit `invalid` bid state with a reason code in the
   API, invalid bids excluded from the allocation preview and from finalisation, and the operator
   UI showing them.
7. `BondAllocationFailed` and `BondBuybackComplete` recorded in bond history, and the
   `dvpSuccess` flag of `BondAuctionFinalised` kept in its history payload.
8. Dead projection code in the files above: the `BidCancelled` handler and `cancelled` bid
   filtering (the contract never emits `BidCancelled`), the unused `bond_state.redemption_complete`
   column, the unused `AuctionFinalized` timestamp prefetch, and the unused bond event read in
   bond snapshots.
9. Tests for dispatch order, replay idempotency, disable and re-create in one batch, loop
   stop/abort/close, history ordering and validation, and finalisation with an invalid bid.
10. Documentation of the new ingestion invariants, history semantics, restart semantics, and the
    invalid bid state; a live check on the local sandbox including a `fromBlock=0` resync.

### Out of Scope

- Error middleware, nonce handling, the chart, and route extraction from `app.ts` (covered by the
  separate `nb-bond-api-hardening` plan).
- Contract, ABI, or event changes (covered by the separate `bond-coupon-maturity-correctness`
  plan); this plan consumes the current ABI.
- A larger restructuring of ingestion beyond the fetch/apply split and per-source handlers.
- Exposing allocation failures on the `Auction` DTO; history rows only.
- The Jest "worker failed to exit" warning: it comes from a pending timer in
  `tests/shutdown.test.ts`, not from ingestion (recorded as a follow-up).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Applying the same batch twice, or a batch that contains `BondCreated` after later transfers were applied, leaves `bond_state` byte-identical | Replay zeroes supply and status | Apply-seam test replays a full issuance lifecycle batch |
| After `stopIngestionLoop()`, no projection row or checkpoint is written by the stopped loop, and its connection is closed once queued work settles | Restart race, skipped or replayed blocks, handle leak | Lifecycle tests with a controllable fake chain |
| A start superseded by a later stop or start installs no timer and closes its connection | Two concurrent loops | Lifecycle test with a start held mid-setup |
| `resetProjectionAndRestart()` calls stop, then waits for idle (bounded), then drops, then starts | Old loop writing into fresh tables | `tests/admin.test.ts` ordering assertion |
| A batch containing disable of an ISIN and its re-creation projects `disabled: false`, matching the listing | Re-created bond shows disabled | Apply-seam test, plus a live `fromBlock=0` resync of that scenario |
| Logs of one batch are applied in `(block, logIndex)` order across the three contracts | Cross-contract order bugs | Apply-seam dispatch-order test |
| A handler that needs a block timestamp gets one, or the tick fails with a named error | Silent `0` timestamps | Test with a missing timestamp |
| `GET /v1/bonds/{isin}/history` returns the newest events first, reaches the oldest through `before`, never splits a block across pages, and answers 400 for `limit=abc`, `limit=0`, `limit=501`, `before=-1` | Hidden newest events; 500 on bad input | Composer and route tests with more rows than one page |
| Finalising with one undecryptable bid in the auction succeeds when the selection excludes it; selecting it returns 400; the auction view shows it as `invalid` with a reason | One bid blocks the auction | Service and composer tests; nb-ui tests; live malformed-bid run |
| History shows `ALLOCATION_FAILED` for each failed DvP leg and `BUYBACK_COMPLETE` for buybacks | Invisible allocation failures | Apply-seam test; live finalisation with an unfunded bidder |
| Repeated admin restarts leave the API pod with three `ingestion.sqlite` descriptors | Connection leak | Descriptor count in the pod before and after |
| nb-bond-api and nb-ui package gates, `openapi.json` regeneration, hygiene and link checks pass | Regression | CI and local gates |

## Constraints

- Sandbox-sized; local-first; no new dependencies.
- The projection stays rebuildable from chain; system-of-record tables are never dropped.
- Public repo: no secrets, private identifiers, or home-directory paths.
- Reducer transitions stay order-tolerant even after chain-ordered application.

## Open Questions

- None blocking. The decisions that need operator acknowledgement are listed in
  [`design.md`](design.md#decisions).
