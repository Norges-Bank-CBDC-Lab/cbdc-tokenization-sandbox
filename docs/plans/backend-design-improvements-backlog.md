# Backend Design Improvements — Backlog

Status: Backlog — pre-planning. Each item is a candidate for its own implementation plan; none is scheduled yet. The operator audit trail is deliberately excluded from this list — it has its own design brief in `docs/plans/operator-audit-trail-design.md`.

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

- **Problem:** mutation handlers compose the response from the projection, which lags the just-mined receipt by up to one poll interval. The "mutations return the updated parent" contract is therefore not always true at response time, and the NB UI compensates with a delayed second reload (`services/nb-ui/src/pages/PayCouponModal.jsx`).
- **Direction:** after `tx.wait()`, run one synchronous ingestion pass up to `receipt.blockNumber` (or block until the ingestion checkpoint reaches that block) before composing the response.
- **Relation:** `docs/plans/cursor-reconcile-sync-plan.md` addresses the client-side half (cursor compare + refetch on divergence). This item is the complementary server-side half: mutation responses become fresh at the source, so the client-side reconcile fires only for genuinely external changes.
- Status: Planned (direction agreed; no implementation plan yet).

### 2. Projection-first reads — shrink request-path chain reads

- **Problem:** `composeBond()` merges chain-head reads with checkpoint-height projection reads, so a composed DTO is not a consistent snapshot. Separately, every request-path chain read becomes an opaque 500 when Besu is unreachable (`docs/KNOWN_ISSUES.md`, "nb-bond-api request-path chain reads bubble up as opaque 500s").
- **Direction:** ingest more state into the projection (supply, coupon schedule counters, allowlist membership) and reserve live chain reads for what genuinely cannot be derived from events (e.g. balances of arbitrary untracked addresses). DTOs then read from one consistent source, and the RPC-down blast radius shrinks structurally rather than cosmetically.
- **Relation:** already sketched as a companion phase of `docs/plans/sse-live-updates-plan.md`; this item promotes it to a standalone work item so it does not ride on the SSE schedule.
- Status: Planned.

### 3. Codify the projection-purity rule

- **Problem:** the safety of drop-and-rebuild resync rests on an implicit invariant: projection tables contain only rows reproducible from chain logs. Nothing today warns a maintainer that locally-generated rows added to a projection table (e.g. `bond_events`) will be silently erased by the next resync or schema bump.
- **Direction:** state the rule explicitly in `services/AGENTS.md` and `services/nb-bond-api/README.md`: anything not reproducible from chain goes in a preserved system-of-record table (the set exempted in `migrateToCurrentVersion()`), never in a projection table.
- **Urgency note:** becomes load-bearing the moment the operator audit trail lands — its rows must not live in projection tables (`docs/plans/operator-audit-trail-design.md`).
- Status: Planned (docs-only; small enough to ship immediately).

### 4. Migration path for preserved tables

- **Problem:** `bidders` and `banks` survive schema bumps by exemption, but there is no in-place migration mechanism for changes to those tables' own schemas. The current strategy (drop projection, recreate, preserve exempt tables untouched) works only while the exempt tables never change shape.
- **Direction:** version the preserved tables separately (or add per-table column migrations) so their first schema change does not require manual surgery on operator databases.
- **Relation:** becomes more pressing when the operator audit trail adds a third preserved table.
- Status: Open question — build now, or on first need.

### 5. Contract-side fix for the treasury-held-units deadlock

- **Problem:** partially allocated auctions leave unsold units on `BondManager`; `payCoupon` / `redeem` require the holder set to cover the entire partition supply, so the payout deadlocks unless the operator allowlists the manager contract on the government settlement TBD (`docs/KNOWN_ISSUES.md`, "Partially allocated bonds deadlock coupon payment and redemption on-chain"). The decoded-revert hint shipped in PR #202 is a stopgap, not a fix.
- **Direction:** burn unsold units at finalisation, or skip manager-held units in `payCoupon` / `redeem`.
- **Relation / open question:** the ERC-3643 migration (`docs/decisions/0002-adopt-erc-3643-for-tokenized-securities.md`) retires the partitioned `BondToken`; decide whether this fix lands in the current contracts or folds into the migration.
- Status: Open question.

### 6. Preflight simulation for all state-changing sends

- **Current state (verified):** an explicit `staticCall` preflight exists for four operations — `deployBond`, `disableBond`, `deployBondWithAuction`, `deployAuctionForBond` (`services/nb-bond-api/src/index.ts`). Every other state-changing send — `payCoupon`, `redeem`, `finaliseAuction`, `closeAuction`, `cancelAuction`, bid submission, central-bank `Wnok` mint/burn/transfer, banking TBD operations — relies only on the implicit `eth_estimateGas` that ethers runs before broadcast. Worse, the close-auction retry path deliberately sets an explicit gas limit to *skip* estimation (the stale-chain-clock false-revert workaround behind `NB_BOND_API_CLOSE_GAS_LIMIT`), so that path transmits with no simulation at all.
- **Direction:** make preflight deliberate and universal for important state-changing actions. Plain `staticCall` suffices for state-only operations (transfers, mint/burn, finalisation); time-dependent operations (`payCoupon`, `closeAuction`) need `eth_simulateV1` with a block-timestamp override set to wall clock, so the simulation sees what the mined transaction will see — this properly retires the blind-send gas-limit workaround instead of bypassing simulation. After a passing preflight, send with an explicit gas limit derived from the simulation's `gasUsed` (plus margin) to avoid re-running estimation.
- **Verified:** `eth_simulateV1` responds on the running sandbox node; `infra/besu/config/config.toml` enables the ETH, DEBUG, and TRACE RPC namespaces.
- **Relation:** `docs/plans/operator-audit-trail-design.md` ("simulation predicts, the audit trail records"; includes the payout dry-run preview using the same mechanism) and `docs/KNOWN_ISSUES.md`, "Auction close timing is chain-enforced — no operator discretion".
- Status: Planned.

### 7. Retire the "Bond Auction Service" naming

- **Problem:** the product name predates the current scope. The solution now covers bond lifecycle, auctions, coupon payouts, central-bank cash (`Wnok`), banking deposit tokens (TBD), and the registry — "Bond Auction Service" undersells and misdescribes it.
- **Current state (verified occurrences):** OpenAPI `info.title` in `services/nb-bond-api/src/schemas.ts` (line 1634; propagates to the generated `openapi.json` — fix in `schemas.ts` and run `npm run regen:openapi`, never hand-edit the JSON), `services/nb-ui/index.html` page title, `services/nb-ui/src/components/Layout.jsx` (brand subtitle and footer), `services/nb-ui/src/components/LoginPage.jsx`, `services/nb-ui/src/components/AccessDeniedPage.jsx`, and prose in `services/nb-ui/README.md`. The archived plan documents keep the old name (historical record — leave unchanged).
- **Direction:** pick one replacement name and apply it across all live occurrences in a single pass.
- **Open question:** the replacement name itself (e.g. "NB Tokenization Sandbox") — operator's call.
- Status: Planned.

### 8. Overhaul the bond status model

- **Problem:** a bond shows status `minting` immediately after creation, which is misleading — nothing is being minted for a staged bond with no auction and no supply.
- **Current state (verified):** `deriveBondStatus()` (`services/nb-bond-api/src/compose.ts`, lines 492–504) returns `minting` for *any* live bond with zero coupon payments: freshly staged bonds, bonds mid-auction, and fully issued bonds awaiting their first coupon all collapse into one label. `maturing` only begins after the first coupon payment, which is equally off — an issued bond is economically "maturing" from issuance. The enum is `['minting', 'maturing', 'matured', 'redeemed', 'unknown']` (`services/nb-bond-api/src/schemas.ts`, line 102).
- **Direction:** replace with lifecycle-truthful statuses derived from signals already available at compose time — e.g. `staged` (created, no auction) → `in auction` (open/closed/finalising, from the auction projection) → `issued` / `outstanding` (supply > 0) → `matured` → `redeemed`, plus the existing disabled soft-delete flag and `unknown` for failed chain reads. Breaking enum change: update `schemas.ts`, regenerate the OpenAPI document, and update NB UI badges/filters/predicates in the same pass (single team, contract breaks together by convention).
- **Relation:** item 2 (projection-first reads) — the status inputs (supply, auction state, coupon count) are exactly the reads that should increasingly come from the projection.
- Status: Planned.

## Explicitly out of scope

- **Operator audit trail** (persistent payout results incl. errors and partial successes): designed separately in `docs/plans/operator-audit-trail-design.md`.

## Follow-up

- Run implementation planning per item. Items 1 and 2 are the highest-value candidates; item 3 can ship as a small docs PR ahead of everything else.
