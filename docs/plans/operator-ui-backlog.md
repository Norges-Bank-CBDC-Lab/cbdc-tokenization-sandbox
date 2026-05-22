# Operator UI — Follow-up Backlog

**Status:** Backlog, not started
**Scope:** Continuation of the post-[#115](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/115) UI-feedback list. Items from that conversation that were not landed in [#117](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/117) / [#118](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/118) live here so the next session can resume without re-deriving context.

Numbering follows the original feedback list to keep cross-references readable.

## What already shipped (for context)

Already landed on `development` via PR #115 + #117 (PR #118 squash-merged into #117's branch and rode along):

- ETH balance column removed from Bidders page (item 1)
- Tooltips on Address / Public key / Private key columns + Reveal-key modal (item 3)
- Pre-fed bidder source documented (item 4, info only)
- Bid-count column on the auctions list (item 6)
- Hide-cancelled-auctions checkbox, default on, persisted to `localStorage` (item 7)
- Allocation card lifecycle gating with five-state coloured pill (item 9)
- Sealing public key rendered in full with one-click Copy + role tooltip (item 10)
- Coupon-rate vs coupon-yield UI relabel + tooltips (items 13 + 14 surface)
- Health-indicator self-heal + admin reconnect/resync (Plans B + C, from PR #115)
- `nb-bond-api` SQLite persistence via PVC (item 2, bidders survive pod restarts)

## Open items

### 5 — BENS integration into NB-UI

**Status:** Deferred.

The operator UI does not display name-resolved addresses via the Blockscout BENS service.

**Why deferred:** Bidders already have human-readable names in the roster; external addresses in event history are not yet surfaced to operators where naming would help. Adding BENS now would be a new API client + fallback rendering + tests for marginal value.

**Trigger to revisit:** a concrete operator workflow that displays an external address and would benefit from a name (e.g., a future "all transfers across all bonds" view).

**Effort if picked up:** ~½ day for client wiring + a name-resolver hook + a few render sites. No contract or backend change.

---

### 8 — Totals row on the bids table

**Status:** TODO.

**Goal:** Add a summary row at the bottom of `AuctionDetailPage`'s bids table showing total units bid and the best clearing rate / price.

**Auction-type sensitivity (the reason this wasn't a one-line change):** "best" depends on the auction type:

| Type | What bidders bid | "Best" direction | Header label |
|---|---|---|---|
| `RATE` | Yield (bps) | Lowest | "Best (lowest) yield" |
| `PRICE` | Price per 100 nominal | Highest | "Best (highest) price" |
| `BUYBACK` | Repurchase price | Lowest | "Best (lowest) repurchase price" |

**Visibility rules (match the bid-state gate):**

- Auction `open`, not in test mode → bids are sealed; totals row shows total bid count only, no rates (they're encrypted).
- Auction `open`, test mode on → bids are unsealed; show units + best-rate.
- Auction `closed` / `finalised` / `rejected` → unsealed; show units + best-rate.
- Auction `cancelled` → still useful to see the totals that would have cleared.

**Files:**

- `services/nb-ui/src/pages/AuctionDetailPage.jsx` — `BidsCard` component (currently around line 280).
- `services/nb-ui/src/utils/format.js` — possibly a new `bestRateLabel(auctionType)` helper.

**Effort:** ~half a day including a Vitest test asserting label and value per auction type.

---

### 11 + 12 — Delete unminted bond + decouple bond creation from auction creation

**Status:** Needs a planning pass via the `sandbox-implementation-planner` skill before any code change.

Two closely related contract-level gaps that are worth designing together so the contract changes don't fight each other:

**11 — Delete unminted bond.**

- Today: `BondManager.sol` has no `removeBond` / `disableBond`. Once a bond is deployed (typically via `deployBondWithAuction`) it stays forever.
- Want: operator can delete or disable a bond that has no minted units, no active auction, and no finalised allocation.
- Soft-delete (flag + UI filter) is probably the right model — hard-delete on EVM has gas + dangling-ISIN-pointer concerns.

**12 — Decouple bond creation from auction creation.**

- Today: the first RATE auction creates the bond as a side effect (`deployBondWithAuction`). Cannot pre-stage a bond.
- Want: `deployBond(isin, maturity, coupon)` standalone, then `deployAuctionForExistingBond(...)` for the first and subsequent auctions. Lets the operator prepare an issuance calendar.

**Why together:** both touch `BondManager.sol`'s public surface, both want new events the ingestion loop has to handle, both reshape the operator UI (new "+ New bond" button independent of the auction flow + a delete affordance on bonds with no auctions). One iteration plan is cleaner than two competing ones.

**Suggested first step next session:** invoke the `sandbox-implementation-planner` skill with both items as input. Expected output is a single Plan D doc covering contract + ingestion + API + UI + tests, with phased delivery and rollback paths.

**Effort estimate (rough, pre-plan):** ~3–5 days of focused work spread across the four layers. Contract changes need Slither + Foundry tests, the rest follows the Plan B/C pattern.

---

### 14b — Rename DTO field `couponYieldBps` → `couponRateBps`

**Status:** TODO (paired with item 14's UI relabel that already shipped).

PR #117 relabelled "Coupon yield" → "Coupon rate" in the UI but left the backend DTO field as `b.coupon.yieldBps` because the rename has blast radius across:

- `services/nb-bond-api/src/schemas.ts` — Zod schema field
- `services/nb-bond-api/openapi.json` — generated snapshot (regen)
- `services/nb-bond-api/src/compose.ts` — DTO assembly
- Any frontend type / accessor that reads `coupon.yieldBps`
- Tests on either side

**Suggested approach:** single PR, mechanical rename, with a brief deprecation note in `DEVELOPMENT.md` §3 explaining the field naming convention going forward (use "rate" for contractual rates fixed at issuance; reserve "yield" for market-derived yields if/when a secondary market is added).

**Effort:** ~1–2 hours including the regen.

## Done criteria for this backlog doc

This file is purely a memory aid. It has no acceptance criteria of its own. Items move out of here as PRs land: tick them off + delete the section.

When the list is empty, this file gets `git rm`'d (it does not move to `docs/plans/archive/` — archive is for shipped plans, not backlog notes).
