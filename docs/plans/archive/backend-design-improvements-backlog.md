# Backend Design Improvements — Backlog

Status: Archived historical backlog. The principal projection, read-your-writes,
audit-trail, and lifecycle-status work shipped through PRs #213, #224, and #225.
Residual ideas remain recorded below for context but are no longer maintained
as an active implementation plan.

Date: 2026-07-06

## Purpose

Capture the outcome of a design review of the NB Bond API storage and chain-sync architecture — plus operator-surface improvements collected along the way — as a ranked improvement backlog, so each item can be picked up for implementation planning without re-deriving the analysis.

## Current state (verified)

The NB Bond API keeps three data planes:

1. **Besu chain — source of truth.** All bond, auction, and token state lives on-chain. Every mutation endpoint signs a transaction (nonce-serialized sends in `services/nb-bond-api/src/chain.ts`), waits for the receipt, and returns the recomposed parent DTO.
2. **SQLite projection — disposable.** A background ingestion loop (`services/nb-bond-api/src/ingestion.ts`) polls `getLogs` from a per-contract checkpoint, decodes `BondManager` / `BondToken` events, and writes projection tables (`auctions`, `auction_events`, `partitions`, `balances`, `balance_events`, `bond_events`). Writes are idempotent via a unique `(tx_hash, log_index)` index. A schema bump or `POST /v1/admin/restart-ingestion?fromBlock=0` drops the projection and rebuilds it from chain.
3. **SQLite system of record — must survive.** `bidders` and `banks` hold generated private keys that cannot be recovered from chain; `migrateToCurrentVersion()` in `services/nb-bond-api/src/ingestion-db.ts` preserves them across every schema bump and resync.

Read path: composers in `services/nb-bond-api/src/compose.ts` merge live chain reads (partition metadata, supply, sealed bids, token balances) with projection reads (event history, holder balances), stamped with md5/ETag for the NB UI 304 cache.

This shape — event-sourced disposable projection, preserved key tables, mutations returning the updated parent — is sound and is not up for change. The items below refine it.

## Items

### 1. Read-your-writes on mutation responses

- **Problem:** mutation handlers historically composed the response from the projection, which could lag the just-mined receipt by up to one poll interval. The "mutations return the updated parent" contract was therefore not always true at response time, and the NB UI previously compensated with delayed reload behavior.
- **Direction:** after `tx.wait()`, run one synchronous ingestion pass up to `receipt.blockNumber` (or block until the ingestion checkpoint reaches that block) before composing the response.
- **Relation:** `docs/plans/archive/cursor-reconcile-sync-plan.md` addresses the client-side half (cursor compare + refetch on divergence). This item is the complementary server-side half: mutation responses become fresh at the source, so the client-side reconcile fires only for genuinely external changes.
- Status: First increment shipped in the architecture work: bond/auction
  mutation responses use a bounded checkpoint wait through the mined receipt
  block. The complete ingestion-coordinator and honest `202` fallback are
  implemented by `projection-aligned-api-contract-plan.md`: mutations actively
  advance the shared coordinator and return an honest `202` when still pending.

### 2. Projection-first reads — shrink request-path chain reads

- **Problem:** `composeBond()` merges chain-head reads with checkpoint-height projection reads, so a composed DTO is not a consistent snapshot. Separately, every request-path chain read becomes an opaque 500 when Besu is unreachable (`docs/KNOWN_ISSUES.md`, "nb-bond-api request-path chain reads bubble up as opaque 500s").
- **Direction:** ingest more state into the projection (supply, coupon schedule counters, allowlist membership) and reserve live chain reads for what genuinely cannot be derived from events (e.g. balances of arbitrary untracked addresses). DTOs then read from one consistent source, and the RPC-down blast radius shrinks structurally rather than cosmetically.
- **Relation:** already sketched as a companion phase of `docs/plans/archive/sse-live-updates-plan.md`; this item promotes it to a standalone work item so it does not ride on the SSE schedule.
- Status: First increment shipped in the architecture work: auction lifecycle
  status is projection-first and composers share an explicit request-level read
  context. Bond/auction snapshot projection expansion was implemented for
  Bond/Auction DTOs by `projection-aligned-api-contract-plan.md`;
  broader WNOK/TBD allowlist projection remains separate.

### 3. Codify the projection-purity rule

- **Problem:** the safety of drop-and-rebuild resync rests on an implicit invariant: projection tables contain only rows reproducible from chain logs. Nothing today warns a maintainer that locally-generated rows added to a projection table (e.g. `bond_events`) will be silently erased by the next resync or schema bump.
- **Direction:** state the rule explicitly in `services/AGENTS.md` and `services/nb-bond-api/README.md`: anything not reproducible from chain goes in a preserved system-of-record table (the set exempted in `migrateToCurrentVersion()`), never in a projection table.
- **Urgency note:** becomes load-bearing the moment the operator audit trail lands — its rows must not live in projection tables (`docs/plans/archive/operator-audit-trail-design.md`).
- Status: ✅ Shipped with the operator-audit-trail implementation — rule documented in `services/AGENTS.md` and `services/nb-bond-api/README.md` ("Projection-purity rule").

### 4. Migration path for preserved tables

- **Problem:** `bidders` and `banks` survive schema bumps by exemption, but there is no in-place migration mechanism for changes to those tables' own schemas. The current strategy (drop projection, recreate, preserve exempt tables untouched) works only while the exempt tables never change shape.
- **Direction:** version the preserved tables separately (or add per-table column migrations) so their first schema change does not require manual surgery on operator databases.
- **Relation:** the preserved set now holds three tables (`bidders`, `banks`, `operation_attempts` — the latter added by the operator audit trail), raising the cost of the first shape change.
- Status: Open question — build now, or on first need.

### 5. Contract-side fix for the treasury-held-units deadlock

- **Problem:** partially allocated auctions leave unsold units on `BondManager`; `payCoupon` / `redeem` require the holder set to cover the entire partition supply, so the payout deadlocks unless the operator allowlists the manager contract on the government settlement TBD (`docs/KNOWN_ISSUES.md`, "Partially allocated bonds deadlock coupon payment and redemption on-chain"). The decoded-revert hint shipped in PR #202 is a stopgap, not a fix.
- **Direction:** burn unsold units at finalisation, or skip manager-held units in `payCoupon` / `redeem`.
- **Relation / open question:** the ERC-3643 migration (`docs/decisions/0002-adopt-erc-3643-for-tokenized-securities.md`) retires the partitioned `BondToken`; decide whether this fix lands in the current contracts or folds into the migration.
- Status: Open question.

### 6. Preflight simulation for all state-changing sends

- **Current state (verified):** an explicit `staticCall` preflight exists for four operations — `deployBond`, `disableBond`, `deployBondWithAuction`, `deployAuctionForBond` (`services/nb-bond-api/src/app.ts`). Every other state-changing send — `payCoupon`, `redeem`, `finaliseAuction`, `closeAuction`, `cancelAuction`, bid submission, central-bank `Wnok` mint/burn/transfer, banking TBD operations — relies only on the implicit `eth_estimateGas` that ethers runs before broadcast. Worse, the close-auction retry path deliberately sets an explicit gas limit to _skip_ estimation (the stale-chain-clock false-revert workaround behind `NB_BOND_API_CLOSE_GAS_LIMIT`), so that path transmits with no simulation at all.
- **Direction:** make preflight deliberate and universal for important state-changing actions. Plain `staticCall` suffices for state-only operations (transfers, mint/burn, finalisation); time-dependent operations (`payCoupon`, `closeAuction`) need `eth_simulateV1` with a block-timestamp override set to wall clock, so the simulation sees what the mined transaction will see — this properly retires the blind-send gas-limit workaround instead of bypassing simulation. After a passing preflight, send with an explicit gas limit derived from the simulation's `gasUsed` (plus margin) to avoid re-running estimation.
- **Verified:** `eth_simulateV1` responds on the running sandbox archive/RPC
  node; `infra/besu/config/archive.toml` enables the ETH, DEBUG, and TRACE RPC
  namespaces. The validator's narrower RPC surface is deliberately not an
  application or simulation endpoint.
- **Relation:** `docs/plans/archive/operator-audit-trail-design.md` ("simulation predicts, the audit trail records"; includes the payout dry-run preview using the same mechanism) and `docs/KNOWN_ISSUES.md`, "Auction close timing is chain-enforced — no operator discretion".
- Status: Planned.

### 7. Retire the "Bond Auction Service" naming

- **Problem:** the product name predates the current scope. The solution now covers bond lifecycle, auctions, coupon payouts, central-bank cash (`Wnok`), banking deposit tokens (TBD), and the registry — "Bond Auction Service" undersells and misdescribes it.
- **Current state (verified occurrences):** OpenAPI `info.title` in `services/nb-bond-api/src/openapi/document.ts` (propagates to the generated `openapi.json` — fix the document source and run `npm run regen:openapi`, never hand-edit the JSON), `services/nb-ui/index.html` page title, `services/nb-ui/src/components/Layout.jsx` (brand subtitle and footer), `services/nb-ui/src/components/LoginPage.jsx`, `services/nb-ui/src/components/AccessDeniedPage.jsx`, and prose in `services/nb-ui/README.md`. The archived plan documents keep the old name (historical record — leave unchanged).
- **Direction:** pick one replacement name and apply it across all live occurrences in a single pass.
- **Open question:** the replacement name itself (e.g. "NB Tokenization Sandbox") — operator's call.
- Status: Planned.

### 8. Overhaul the bond status model

- **Problem:** a bond shows status `minting` immediately after creation, which is misleading — nothing is being minted for a staged bond with no auction and no supply.
- **Previous state:** `minting` collapsed freshly staged, mid-auction, and issued-before-first-coupon bonds into one misleading label.
- **Direction:** replace with lifecycle-truthful statuses derived from signals already available at compose time — e.g. `staged` (created, no auction) → `in auction` (open/closed/finalising, from the auction projection) → `issued` / `outstanding` (supply > 0) → `matured` → `redeemed`, plus the existing disabled soft-delete flag and `unknown` for failed chain reads. Breaking enum changes belong in the owning feature contract under `src/contracts/`; regenerate the OpenAPI document and update NB UI badges/filters/predicates in the same pass (single team, contract breaks together by convention).
- **Relation:** item 2 (projection-first reads) — the status inputs (supply, auction state, coupon count) are exactly the reads that should increasingly come from the projection.
- Status: Implemented as `staged`, `auctioning`, `outstanding`, `matured`, and
  `redeemed`, derived only from replayable projection facts.

## Explicitly out of scope

- **Operator audit trail** (persistent payout results incl. errors and partial successes): designed separately in `docs/plans/archive/operator-audit-trail-design.md`.

## Follow-up

- Run implementation planning per item. Items 1 and 2 are the highest-value candidates; item 3 can ship as a small docs PR ahead of everything else.
