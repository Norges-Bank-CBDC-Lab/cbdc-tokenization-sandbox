# Bond Lifecycle Management — Implementation Plan

**Status:** Shipped via [#127](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/127) (contracts + ingestion + API + UI, with tests). Archived 2026-06-09. Phase-5 documentation was not fully completed before archival: the stale [`operator-ui-backlog.md`](operator-ui-backlog.md) items 11 + 12 were corrected, and the remaining doc updates were accepted as low-priority debt (recorded in [`outstanding-plan-items.md`](outstanding-plan-items.md)). Auction-deletion was delivered as a no-op (the existing `cancelAuction` + UI filter is sufficient — see "Decisions" §D3).
**Branch suggestion:** `feature/bond-lifecycle-management`
**Components touched:** `contracts/src/norges-bank/BondToken.sol` + `BondManager.sol` + their interfaces, `services/nb-bond-api/` (ingestion, schemas, routes), `services/nb-ui/` (BondsPage + BondDetailPage + new modal), docs.

## Goal

Give the sandbox operator independent control over the bond inventory, separate from the auction calendar:

1. **Create a bond up front, schedule its first auction later** — today the only way to mint a bond into existence is `BondManager.deployBondWithAuction`, which atomically creates a RATE auction. After this iteration, the operator can call `BondManager.deployBond(isin, maturityDuration)` to stage the partition with no auction, then call `BondManager.deployAuctionForBond(isin, ...)` (RATE for the first one, PRICE/BUYBACK afterward) when ready. (Item 12 in the backlog.)
2. **Disable bonds that turned out to be mistakes** — for a bond that has zero minted units, no in-flight auction, and no finalised allocation, the operator can soft-delete it. The partition is marked inactive in `BondToken`, the per-partition metadata is cleared, the projection records the bond as `disabled`, and the bonds-list UI hides it by default. (Item 11.)

After this iteration the operator UX is:

| Action | Today | After |
|---|---|---|
| Create a new bond | Only as a side effect of the first RATE auction | Standalone `+ New bond` action; the first auction is a separate step |
| Schedule the first auction | Forced at bond-create time | Independent; operator picks when (and whether) to open the auction |
| Cancel an in-flight auction | `Cancel auction` (existing) | Unchanged — `cancelAuction` is still the right verb |
| Get rid of a mistaken bond | Impossible — partition stays forever | `Disable bond` action on a bond with no supply + no in-flight auction + no finalised allocation. Hidden from the list by default; visible via "Show disabled" toggle (mirrors PR #117's "Hide cancelled auctions" pattern) |
| Get rid of a cancelled / finalised auction record | Not needed — UI already hides cancelled auctions; finalised auctions are history | Unchanged |

## Current-State Evidence

What was inspected and what was actually verified in this session (2026-05-26).

- **Docs read:**
  - Root `AGENTS.md` — operating principles, change hygiene, dependency policy (any new dep needs operator approval), licensing guardrails (Apache-2.0), flag-documentation banner rule, doc-update expectations.
  - `README.md` — sandbox lifecycle, `*.cbdc-sandbox.local` hostname pattern, `DEPLOY_*` flags, hosts setup.
  - `docs/ARCHITECTURE.md` — referenced for the component diagram and trust-boundary notes (will need a small refresh to reflect the new lifecycle).
  - `docs/KNOWN_ISSUES.md` — confirms there is no existing partition-disable plan and no auction-delete plan; this plan does not invalidate any current entry.
  - `docs/DOCUMENTATION_INDEX.md` — points new plan doc into `docs/plans/`.
  - `docs/plans/archive/operator-ui-backlog.md` — items 11 + 12 verbatim.
  - `docs/plans/archive/bidders-and-central-bank-plan.md`, `docs/plans/archive/health-indicator-and-self-healing-plan.md` — house style for this kind of multi-layer plan.
  - `contracts/AGENTS.md` — Solidity style and Foundry expectations (named struct init, custom errors over revert strings, events for state-changing actions, early-revert validation, `./slither.sh` advisory).
  - `services/nb-bond-api/README.md`, `services/nb-bond-api/DEVELOPMENT.md`, `services/nb-ui/README.md`, `services/nb-ui/DEVELOPMENT.md` — area conventions.
- **Repo declarations inspected:**
  - `contracts/src/norges-bank/BondManager.sol` — orchestrator. Currently exposes `deployBondWithAuction`, `extendBondWithAuction`, `buybackWithAuction`, `closeAuction`, `cancelAuction`, `finaliseAuction`, `redeem`, `payCoupon`, `withdrawFailedIssuance`. `bondActive[isin]` is the in-flight-auction lock, NOT a registry. There is no `deployBond`, no `disableBond`, no enumeration.
  - `contracts/src/norges-bank/BondToken.sol` — ERC-1410-style partitioned token. Bond identity is `keccak256(isin)`. Per-partition mappings: `activePartitions`, `_partitionIsin`, `partitionOffering`, `maturityDuration`, `maturityDate`, `couponDuration`, `couponYield`, `lastCouponPayment`, `couponPaymentCount`, `isMatured`. `createPartition(isin, offering, maturityDuration)` is the only entry today and rejects duplicates. `extendPartitionOffering`, `reducePartitionOffering`, `mintByIsin` follow.
  - `contracts/src/norges-bank/interfaces/IBondManager.sol`, `IBondToken.sol`, `IBondAuction.sol` — event surface that nb-bond-api ingests against. No `BondDisabled` / `IsinDisabled` events exist today.
  - `contracts/src/norges-bank/BondAuction.sol` — auction state machine `NONE → BIDDING → CLOSED → FINALISED` with a `CANCELLED` terminal. Auction IDs are `keccak256(isin, isinToAuctionCount[isin])` and the count is monotonic. `cancelAuction` accepts any non-`NONE`, non-`FINALISED` state and is the existing "remove from working list" verb. **No `disableAuction` exists, and the architecture does not need one** — see §D3 below.
  - `services/nb-bond-api/src/ingestion.ts` — events handled today: `BondAuctionInitialised` / `BondExtensionAuctionInitialised` / `BondBuybackAuctionInitialised` (all upsert into `auctions` + `partitions`), `BondAuctionClosed`, `BondAuctionFinalised`, `BondAuctionCancelled`, `CouponPaid`, `AllCouponsPaid`, plus token-side `IsinIssued` / `IsinExtended` / `IsinMinted` / `IsinReduced`. **No `BondDisabled` / `IsinDisabled` handler exists.**
  - `services/nb-bond-api/src/ingestion-db.ts` — `partitions` table is the bond projection key. Schema is additive-only (per the `SCHEMA_VERSION` doc comment). Adding a `disabled INTEGER NOT NULL DEFAULT 0` column to `partitions` is safe and idempotent via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pattern (or via the existing `migrateToCurrentVersion` shape).
  - `services/nb-bond-api/src/schemas.ts` — Zod-OpenAPI is the single source of truth for DTOs. New endpoints + a `disabled` field on `BondDTO` go here.
  - `services/nb-bond-api/src/bonds.ts` (or equivalent compose path) — bond projection currently surfaces `status: 'unknown'` for many bonds (see live check below). Worth confirming the projection picks up `disabled` correctly without leaking the existing `status` field semantics.
  - `services/nb-ui/src/pages/BondsPage.jsx`, `BondDetailPage.jsx`, `CreateBondModal.jsx` — current bond UI surface. The "+ New bond" button currently opens `CreateBondModal` which always requests a RATE auction together with the bond.
  - `services/nb-ui/src/pages/AuctionsPage.jsx` — already has the "Hide cancelled auctions" toggle (PR #117). This is the pattern we mirror for "Hide disabled bonds".
  - `services/nb-bond-api/openapi.json` is generated from `schemas.ts`; the operator typically regenerates it via the API service's existing tooling (no manual edit).
- **Live local checks (sandbox up, verified 2026-05-26):**
  - `kind get clusters` → `cluster-cbdc-monoledger`. `kubectl config current-context` → `kind-cluster-cbdc-monoledger`.
  - `helm list -A` → `besu`, `blockscout`, `gateway`, `nb-bond-api` (rev 17), `nb-ui` (rev 26), `ngf` all `deployed`.
  - `curl http://bond-api.cbdc-sandbox.local/v1/health` → `status: ok`, contracts: `bondManager=0xe61a…4eB97`, `bondAuction=0xcd15…EDB9b`, `bondToken=0x290c…9563`, `wnok=0xfE11…1Ce8`, chain head 114.
  - `curl http://bond-api.cbdc-sandbox.local/v1/bonds` returns 7 bonds in the projection. Notable for this plan:
    - Two bonds (`PA0847583457`, `QA75842095762`) with status `unknown`, totalSupply `0`, and exactly one auction in status `cancelled`. **These are the "limbo" bonds item 11 is designed to clean up** — they should become disable-able as soon as Phase 3 ships.
    - One bond (`LA3480954865`) with status `unknown`, totalSupply `11000`, one finalised auction — must NOT be disable-able (already minted).
- **Local validation entry points already wired by CI:**
  - `.github/workflows/test-contracts.yml` — gates Foundry tests + Slither for any `contracts/**` change.
  - `.github/workflows/nb-bond-api.yml` — format-lint-test for the API.
  - `.github/workflows/nb-ui.yml` — format-lint-test-build for the UI.
  - `.github/workflows/publication-hygiene.yml` — public-repo hygiene.
- **Blocked or unverified checks:** none for this plan. The sandbox was up throughout.

## Scope

### In Scope

- **Contracts (Solidity + Foundry tests + Slither pass).**
  - `BondManager.deployBond(string isin, uint256 maturityDuration)` — standalone bond create. Marks `bondActive[isin] = false` initially (no auction yet). Calls `BondToken.createPartition(isin, 0, maturityDuration)` with a placeholder zero offering — see §D1 for the offering-at-create question.
  - `BondManager.deployAuctionForBond(string isin, uint64 end, bytes pubKey, uint256 offering, AuctionType type)` — schedules an auction for an existing partition. For the first auction, requires `type == RATE` (the contract already enforces this via `isinToAuctionCount`, no extra check needed). For subsequent auctions, type must be PRICE or BUYBACK. Increases the partition offering ceiling by the auction's offering amount (mirrors the current implicit behavior in `deployBondWithAuction` / `extendBondWithAuction`).
  - `BondManager.deployBondWithAuction` is kept as a thin composition of `deployBond` + `deployAuctionForBond` for backward compatibility (existing call sites in tests + nb-bond-api). Behavior preserved.
  - `BondManager.disableBond(string isin)` — soft-delete entrypoint. Gates: `bondActive[isin] == false` (no in-flight auction), `_totalSupplyOfPartition(partition) == 0` (nothing minted), `isMatured[partition] == false` (sanity), no `FINALISED` auction for this ISIN. Calls a new internal `BondToken.disablePartition(isin)` and emits `BondDisabled(string isin)`.
  - `BondToken.disablePartition(string isin)` — gated on `_totalSupplyOfPartition(partition) == 0` and `activePartitions[partition] == true`. Clears `partitionOffering`, `maturityDuration`, `maturityDate`, `couponDuration`, `couponYield`, `lastCouponPayment`, `couponPaymentCount`, `isMatured` for the partition (sets each back to its zero value). Sets `activePartitions[partition] = false`. Leaves `_partitionIsin[partition]` populated for audit (the field is overwritten on any future `createPartition` for the same ISIN). Emits `IsinDisabled(string isin)`. Restricted to `BOND_CONTROLLER_ROLE` (same as the other write paths).
  - New custom errors in `Errors.sol`: `BondAlreadyDisabled`, `BondNotEmpty(uint256 supply)`, `BondHasFinalisedAuction(bytes32 auctionId)`.
  - New events in interfaces: `IBondManager.BondDisabled(string isin)`, `IBondToken.IsinDisabled(string isin)`. Indexed-ness follows the existing pattern (ISIN is `indexed` on redemption events but not on the auction-creation events — choose `indexed` for `BondDisabled` for filterability, since it's a low-cardinality terminal event).
  - Foundry tests under `contracts/test/norges-bank/`:
    - Happy path for `deployBond` (no auction created, partition active, offering zero).
    - Happy path for `deployAuctionForBond` after `deployBond` (RATE-first contract rule still holds).
    - Happy path for `disableBond` after `deployBond` with no auction (the original item 12 + item 11 combo path).
    - Happy path for `disableBond` after `cancelAuction` (the "limbo cleanup" path that item 11 standalone unlocks).
    - Negative: `disableBond` reverts when supply > 0; when `bondActive == true`; when any auction is `FINALISED`.
    - Re-use case: after `disableBond`, calling `deployBond` with the same ISIN succeeds and yields a clean partition (mappings re-initialised).
    - Backward compat: `deployBondWithAuction` still produces the same observable state.
- **Ingestion (`services/nb-bond-api/`).**
  - Handle the two new events in `src/ingestion.ts`: `IsinDisabled` and `BondDisabled`.
  - `partitions` table gets a `disabled INTEGER NOT NULL DEFAULT 0` column. Migration is additive; no `SCHEMA_VERSION` bump (consistent with the "additive only" rule).
  - `bond_events` rows for `BOND_DISABLED` get inserted so the bond's history table shows the action.
- **API (`services/nb-bond-api/`).**
  - `DELETE /v1/bonds/{isin}` — operator-driven disable. Returns `204` on success, `409` with RFC 7807 problem+json `{ type: "/problems/bond-not-disable-able", title, detail, errors: { supply, activeAuction, finalisedAuctionId } }` when the contract would reject (the API pre-flights the gate so the operator gets a clear error instead of a chain revert). Idempotent: returns `204` if the bond is already disabled.
  - `BondDTO` gets a `disabled: boolean` field. Default `false`.
  - `GET /v1/bonds` accepts an optional `?includeDisabled=true` query param. Default behavior: filter out disabled bonds.
  - New helper in `bondsApi` / compose layer: derive `disabled` from the `partitions.disabled` projection column.
  - Add `POST /v1/bonds` (body: `{ isin, maturityDuration }`) — standalone bond creation that calls `BondManager.deployBond`. Returns the new `BondDTO`.
  - Existing `POST /v1/bonds/{isin}/auctions` (already wired for RATE/PRICE/BUYBACK) is unchanged on the wire but its server-side handler is rewired to call `BondManager.deployAuctionForBond` instead of dispatching to `deployBondWithAuction` / `extendBondWithAuction` / `buybackWithAuction`. This is a refactor, not a behavioral change, and is exercised by existing integration tests.
- **UI (`services/nb-ui/`).**
  - `CreateBondModal.jsx` — simplified to bond-only. Fields: `isin`, `maturityDuration`. On submit, the modal closes and the operator lands on `BondDetailPage` for the new bond, with a "Schedule first auction" CTA visible. The existing combined create-with-auction flow goes away. (Per §D2.)
  - `BondDetailPage.jsx` — add a "Schedule first auction" CTA when the bond has no auctions yet (already partially supported by the existing "+ New auction" button on `AuctionsPage`; this is a contextual entry point). Add a "Disable bond" affordance when the bond meets the disable gate (no supply, no in-flight auction, no finalised auction).
  - `BondsPage.jsx` — add a "Show disabled" checkbox (default off, persisted to `localStorage` under `nbui.showDisabledBonds` matching the existing `nbui.hideCancelledAuctions` precedent). Visual treatment for disabled rows in the table: muted color + "DISABLED" status pill.
  - `bondsApi.js` — add `disableBond(isin)`, optional `includeDisabled` flag on `listBonds`, and `createBond({ isin, maturityDuration })` that posts to the new endpoint.
  - Tests (vitest + Testing Library): page-level tests via `vi.mock('../src/api/bondsApi.js', …)` for the disable button visibility (gated correctly), for the bonds list filter (default hides disabled, "Show disabled" reveals), and for the bond-only create flow (modal submits ISIN + maturity, navigates to `BondDetailPage`, which surfaces the "Schedule first auction" CTA). AI-side verification stops at build / lint / test / grep; the operator drives the browser walkthrough in Phase 4.
- **Docs.**
  - `services/nb-bond-api/README.md` — new endpoints listed.
  - `services/nb-bond-api/DEVELOPMENT.md` — note the `partitions.disabled` column and the gate semantics.
  - `services/nb-ui/README.md` + `DEVELOPMENT.md` — note the new affordances.
  - `contracts/docs/contracts-reference.md` — `BondManager.deployBond` / `deployAuctionForBond` / `disableBond` and `BondToken.disablePartition` documented.
  - `contracts/docs/bond-lifecycle-walkthrough.md` — small addition: the new "pre-stage then schedule" path.
  - `docs/ARCHITECTURE.md` — short paragraph on the bond inventory being independent of the auction calendar.
  - `docs/KNOWN_ISSUES.md` — entry retired (or simplified) for the historical "bond cannot be undone" gap.
  - `docs/DOCUMENTATION_INDEX.md` — pointer added to the archived form of this plan once shipped.
  - `docs/plans/archive/operator-ui-backlog.md` — item 11 + 12 moved to the "What already shipped" list on merge.

### Out Of Scope

- **No auction-deletion contract changes.** The existing `cancelAuction` is the right state transition; the UI's "Hide cancelled auctions" filter already keeps the working list focused. See §D3 for the reasoning.
- **No on-chain "re-enable" of a disabled bond.** Disable is terminal. To bring the ISIN back, the operator calls `deployBond` again with the same ISIN — the partition is re-initialised cleanly because `disablePartition` clears every per-partition mapping.
- **No retroactive disable of bonds that already minted supply.** The `_totalSupplyOfPartition == 0` gate is firm. Bonds with holdings stay in their current lifecycle.
- **No hard-delete from the projection.** Disabled bonds remain queryable via `?includeDisabled=true`. Removing them from SQLite would lose the audit trail.
- **No change to bidder semantics.** Bids on a finalised auction are unaffected; bids on a cancelled auction stay where they are.
- **No change to coupon / maturity / redemption flows.** `payCoupon`, `redeem`, `withdrawFailedIssuance` continue to work for the bonds that have moved past minting.
- **No promotion to a non-local deployment.** This plan is local-first. Portability flags are surfaced below.

## Folder And File Placement

No new top-level folders. All new code lands in existing locations:

| Item | Path | Rationale |
|---|---|---|
| `BondManager.deployBond` + `deployAuctionForBond` + `disableBond` | `contracts/src/norges-bank/BondManager.sol` | Orchestrator already owns bond creation and auction creation |
| `BondToken.disablePartition` | `contracts/src/norges-bank/BondToken.sol` | Partition state lives here |
| `IBondManager.BondDisabled` event | `contracts/src/norges-bank/interfaces/IBondManager.sol` | Matches existing event-on-interface pattern |
| `IBondToken.IsinDisabled` event | `contracts/src/norges-bank/interfaces/IBondToken.sol` | Matches existing event-on-interface pattern |
| New custom errors | `contracts/src/common/Errors.sol` | All custom errors live here today |
| Foundry tests | `contracts/test/norges-bank/BondLifecycle.t.sol` (new file) or extend `BondManager.t.sol` | Matches existing test layout |
| Ingestion handlers | `services/nb-bond-api/src/ingestion.ts` | Same file already handles every other bond event |
| Schema migration | `services/nb-bond-api/src/ingestion-db.ts` | Additive column, same pattern as bidders table |
| API routes + DTOs | `services/nb-bond-api/src/schemas.ts` + `src/index.ts` | Existing seam |
| API handler | `services/nb-bond-api/src/bonds.ts` (or extend `src/index.ts` route) | Matches the existing bonds-resource handler shape |
| UI bonds API | `services/nb-ui/src/api/bondsApi.js` | Same module, additive |
| UI modals + page edits | `services/nb-ui/src/pages/CreateBondModal.jsx`, `BondsPage.jsx`, `BondDetailPage.jsx` | Existing files |
| UI tests | `services/nb-ui/tests/BondsPage.test.jsx` (extend), new `BondLifecycle.test.jsx` | Matches existing test layout |
| Plan doc (this file) | `docs/plans/bond-lifecycle-management-plan.md` | Mirrors `docs/plans/jupyter-removal-plan.md` and the archived plans |

## Decisions

All five resolved with the operator on 2026-05-26 before Phase 1 starts.

| ID | Decision | Choice |
|---|---|---|
| **D1** | `partitionOffering` for a bond created via `deployBond` before any auction exists | **Start at 0.** The first auction adds its offering via `BondToken.extendPartitionOffering` — the same path bond extensions already use. Keeps the `deployBond` signature minimal and avoids a new "auction wants more than ceiling" branch. |
| **D2** | UI `+ New bond` modal behavior | **Always bond-only.** Modal collects only `isin` + `maturityDuration`. Operator schedules the first auction separately from `BondDetailPage` (or `AuctionsPage`) after the bond exists. No combined-flow toggle. Cleaner, fewer branches, fully matches item 12's goal. |
| **D3** | Add a contract-level `disableAuction` to parallel `disableBond`? | **No.** Auction IDs are content-addressed (`keccak256(isin, count)`), so "deletion" gives no ID-collision benefit. `cancelAuction` is already the terminal state transition, and the "Hide cancelled auctions" UI filter (PR #117) keeps the working list clean. No contract change. |
| **D4** | Disabled-bond UI visual treatment | **Muted row + `DISABLED` pill, default hidden, "Show disabled" toggle.** Mirrors PR #117's cancelled-auction pattern exactly. New `localStorage` key: `nbui.showDisabledBonds`, default `false`. |
| **D5** | Roles for the new entrypoints | Keep existing wiring. `deployBond` / `deployAuctionForBond` / `disableBond` use `BOND_MANAGER_ROLE`. `disablePartition` on `BondToken` uses `BOND_CONTROLLER_ROLE`. No new role introduced. |

## Portability Flags

Choices below are local-first and acceptable for this sandbox. None of them block this plan, but each would require attention if any of this is ever promoted to a non-local environment.

- `disableBond` is gated by a role the local sandbox grants to the operator's deterministic fixture key. A non-local deployment would gate it the same way it gates every other privileged action — no change to the contract is needed, just role-grant policy.
- The off-chain pre-flight `409 → /problems/bond-not-disable-able` returns chain-state details (current supply, active-auction id, finalised-auction id) in the problem body. These are public on-chain anyway in this sandbox; a non-local deployment that wants to hide them would need to redact those fields in the problem response. Flagging it here so it's not a surprise later.
- The new "Show disabled" `localStorage` key follows the existing pattern; no portability concern.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| `BondManager.deployBond(isin, maturityDuration)` creates a partition with offering 0, active, no auction | Item 12 minimum | Foundry test + `cast call BondToken activePartitions(keccak256(isin))` returns `true`, `partitionOffering` returns 0, `getAuctionId(isin)` reverts with `AuctionNotFoundForIsin` | Pass |
| `BondManager.deployAuctionForBond(isin, ..., RATE, offering)` after `deployBond` succeeds and behaves identically to `deployBondWithAuction` from the auction's perspective | Item 12 backward compat | Foundry test asserting auction metadata + `partitionOffering == offering` after the call | Pass |
| `BondManager.deployBondWithAuction(...)` continues to produce the same observable state as before | Don't break existing call sites | Existing Foundry tests still green; `forge test --match-contract BondManager` shows no regressions | Pass |
| `BondManager.disableBond(isin)` succeeds when `supply == 0`, no in-flight auction, no finalised auction | Item 11 happy path | Foundry tests covering both "no auction was ever created" and "auction was cancelled" flows; `activePartitions[partition]` becomes `false`; `IsinDisabled` + `BondDisabled` events emitted | Pass |
| `disableBond` reverts with `BondNotEmpty` when `supply > 0` | Safety gate | Foundry test on a `LA3480954865`-shaped fixture (minted supply) | Pass |
| `disableBond` reverts when a `FINALISED` auction exists for the ISIN | Safety gate | Foundry test | Pass |
| `disableBond` reverts when `bondActive[isin] == true` (in-flight auction) | Safety gate | Foundry test | Pass |
| After `disableBond(isin)`, `deployBond(isin, ...)` succeeds again with a fresh, clean partition | Confirms re-use semantics | Foundry test asserts all per-partition mappings are at their zero values after the second `deployBond` | Pass |
| Slither pass with no new high/medium findings | Contract safety | `./slither.sh` output captured in the PR | Clean |
| `DELETE /v1/bonds/{isin}` returns 204 on success, 409 with RFC 7807 problem+json on gate failure, 204 (idempotent) when already disabled | API contract | `curl -X DELETE` against the local sandbox for one of the limbo bonds (`PA0847583457` or `QA75842095762`); 409 against `LA3480954865` (has supply) | Pass |
| `POST /v1/bonds` creates a partition with no auction | Item 12 surface | `curl -X POST -d '{"isin":"NO-TEST-001","maturityDuration":"31536000"}'`; subsequent `GET /v1/bonds/NO-TEST-001` returns the new bond with `auctions: []` and `disabled: false` | Pass |
| `GET /v1/bonds` filters disabled bonds by default; `?includeDisabled=true` returns them | UI consistency | `curl` before/after disabling `PA0847583457`; the bond drops out of the default response and reappears with the flag | Pass |
| `BondDTO.disabled: boolean` is present on every response | DTO consistency | `curl` + jq | Pass |
| `services/nb-bond-api/openapi.json` regenerated and committed | API surface change | Git diff | Updated |
| `BondsPage` hides disabled bonds by default; "Show disabled" toggle reveals them; toggle persists across reload | Operator UX | vitest page-level test using `vi.mock`; manual confirmation from the operator during Phase 4 (AI verification stops at build/lint/test/grep — operator does the browser check) | Pass |
| `BondDetailPage` shows "Disable bond" only when the gate is satisfied; disabled-bond view shows a clear DISABLED pill | Operator UX | vitest page-level test | Pass |
| `+ New bond` modal collects only ISIN + maturity; submitting lands on `BondDetailPage` with a "Schedule first auction" CTA | Operator UX (per §D2) | vitest page-level test | Pass |
| `npm test` in `services/nb-bond-api` and `services/nb-ui` clean | CI gate | Workflows green | Pass |
| `python3 scripts/verification/check-public-repo-hygiene.py` + `check-markdown-links.py` clean | Public-repo hygiene | Script output captured in PR | Clean |
| `docs/plans/archive/operator-ui-backlog.md` items 11 + 12 moved to the "shipped" list | Plan-doc maintenance | Git diff | Updated |
| `docs/KNOWN_ISSUES.md` updated to reflect what (if anything) is still open after this lands | Doc consistency | Git diff | Updated |

## Assumptions

Safe to proceed without operator input.

- The local sandbox stays on the current Besu pin (Clique + London; PUSH0 caveat already absorbed in existing contracts — no new opcode introduced by this plan).
- No new third-party dependency is introduced. All additions reuse existing libraries (`@openzeppelin/contracts`, Foundry, Zod, react-testing-library).
- The two new events (`IsinDisabled`, `BondDisabled`) are additive — no consumer regresses by ignoring them; the API doesn't strictly need them since the projection column is updated via the same ingestion tick that handles all bond-management events.
- Existing `deployBondWithAuction` is kept as a back-compat composition, so the contract ABI change is purely additive on the BondManager surface.
- The `partitions.disabled` column is a new SQLite column; existing rows default to `0`. The ingestion startup migration handles this idempotently — no manual data migration step.

## Plan Order

```
Phase 0  Baseline verification (sandbox up, current addresses captured, current projection snapshot saved)
Phase 1  Contracts: new entrypoints + new events + Foundry tests + Slither pass
Phase 2  Ingestion + API: schema migration + handlers + routes + DTO change + OpenAPI regen  (Gate: Phase 1 deployed to local chain)
Phase 3  UI: modals + page filters + disable button + tests  (Gate: Phase 2 deployed)
  3a  bondsApi.js wiring
  3b  CreateBondModal split
  3c  BondsPage "Show disabled" toggle
  3d  BondDetailPage disable affordance
  3e  Tests
Phase 4  Post-change verification end-to-end against the local sandbox  (Operator drives the browser; AI runs the structural checks)
Phase 5  Documentation + public-repo hygiene  (No state changes; final pre-PR step)
```

## Phase 0: Baseline Verification

### Goal

Capture the current state so anything that drifts later is obvious.

### Steps

- `kind get clusters` + `kubectl config current-context` (confirm `cluster-cbdc-monoledger` / `kind-cluster-cbdc-monoledger`).
- `helm list -A` (capture revisions for `besu`, `blockscout`, `gateway`, `nb-bond-api`, `nb-ui`, `ngf`).
- `curl http://bond-api.cbdc-sandbox.local/v1/health > /tmp/baseline-health.json` (capture contract addresses).
- `curl http://bond-api.cbdc-sandbox.local/v1/bonds > /tmp/baseline-bonds.json` (capture full projection; will diff after Phase 2 against the same snapshot to prove no regression for unrelated bonds).
- `cd contracts && forge test > /tmp/baseline-forge.log` (confirm green baseline before any contract change).
- `cd services/nb-bond-api && npm test > /tmp/baseline-api.log`.
- `cd services/nb-ui && npm test > /tmp/baseline-ui.log`.

### Verification Stop

- All baseline test logs green.
- `/tmp/baseline-bonds.json` saved.
- Contract addresses noted in the PR.

### Fix Iteration / Rollback

If baseline is red, stop and fix the existing breakage before touching this plan.

### Exit Criteria

- Local sandbox state captured.

## Phase 1: Contracts

### Goal

Land the contract surface for items 11 + 12. Behavior must be preserved for existing call sites; new behavior must be gated and covered.

### Scope

- `BondToken.sol` — add `disablePartition(string isin)`. Validate gates, clear mappings, flip `activePartitions`, emit `IsinDisabled`.
- `BondManager.sol`:
  - Add `deployBond(string isin, uint256 maturityDuration)`. Calls `BondToken.createPartition(isin, 0, maturityDuration * DURATION_SCALAR)`. Marks `bondActive[isin] = false` (idempotent, but explicit). Emits a new `BondCreated(string isin, address bondAddress, uint256 maturityDurationSeconds)` event (or reuses an existing event — TBD during implementation; see existing event list).
  - Add `deployAuctionForBond(string isin, uint64 end, bytes calldata pubKey, uint256 offering, IBondAuction.AuctionType type)`. Validates the partition exists (`BondToken.activePartitions`). For first auction: contract already requires RATE via `isinToAuctionCount`. For subsequent: contract already requires PRICE/BUYBACK. Extends `partitionOffering` by `offering` via `BondToken.extendPartitionOffering`. Calls `BondAuction.createAuction` with the resolved auction type. Emits the existing event family (`BondAuctionInitialised` / `BondExtensionAuctionInitialised` / `BondBuybackAuctionInitialised`) chosen by type so the ingestion side needs no new handler for the new entrypoint.
  - Refactor `deployBondWithAuction` to call `deployBond` then `deployAuctionForBond` internally. Public ABI preserved. Tests must show identical observable behavior.
  - Add `disableBond(string isin)`. Gates per §"In Scope". Calls `BondToken.disablePartition`. Emits `BondDisabled(string indexed isin)`.
- `IBondManager.sol` + `IBondToken.sol` — declare the new events.
- `Errors.sol` — three new custom errors: `BondAlreadyDisabled(string isin)`, `BondNotEmpty(string isin, uint256 supply)`, `BondHasFinalisedAuction(string isin, bytes32 auctionId)`.

### Steps

1. Add the new functions, events, and errors. Run `forge build`.
2. Author the test file `contracts/test/norges-bank/BondLifecycle.t.sol` covering every row in the acceptance criteria table.
3. `forge test --match-contract BondLifecycle` and `forge test` overall.
4. `forge fmt`.
5. `./slither.sh` — capture findings, suppress any clear-noise items with the narrowest possible `// forge-lint: disable-next-line(<rule>)` comments (per `contracts/AGENTS.md`).
6. Update `contracts/docs/contracts-reference.md` and `contracts/docs/bond-lifecycle-walkthrough.md` with the new entrypoints.

### Verification Stop

- `forge build` clean.
- `forge test` all green; the new test file contributes at least the test cases listed in §Acceptance Criteria.
- `./slither.sh` shows no new high or medium findings vs. baseline.
- `forge fmt` clean.

### Fix Iteration / Rollback

- Failed test: fix the contract, re-run.
- Slither high finding: address before moving on (don't suppress without operator sign-off).
- The contracts are not yet deployed at this point — rollback is just `git restore`.

### Exit Criteria

- Contract changes ready to deploy.
- `BondLifecycle.t.sol` passes.

## Phase 2: Ingestion + API

### Goal

Surface the new contract behavior to the operator via the API.

### Scope

- `services/nb-bond-api/src/ingestion-db.ts` — extend the `partitions` schema with `disabled INTEGER NOT NULL DEFAULT 0`. Migration is additive (matching the existing `bidders` table additive pattern; no `SCHEMA_VERSION` bump).
- `services/nb-bond-api/src/ingestion.ts` — handle `IsinDisabled` and `BondDisabled`. Both flip `partitions.disabled = 1` for the given ISIN. Insert a `BOND_DISABLED` row into `bond_events` for audit.
- `services/nb-bond-api/src/bonds.ts` (or the equivalent compose path) — surface `disabled` in `BondDTO`; default `listBonds` excludes disabled rows; `?includeDisabled=true` includes them.
- `services/nb-bond-api/src/schemas.ts` — declare the new DTO field, the new query param, and the new endpoints `POST /v1/bonds`, `DELETE /v1/bonds/{isin}`. Use RFC 7807 problem+json for the 409 path with a `type: "/problems/bond-not-disable-able"` URI (consistent with existing problem types).
- `services/nb-bond-api/src/index.ts` — register the new routes; handlers call `BondManager.deployBond` / `BondManager.disableBond` from the existing bond-manager wallet.
- Pre-flight gate logic in the API: read `BondToken.balanceOfByPartition(partition, address(this))` and `_totalSupplyOfPartition(partition)` via the existing read paths; check `bondActive[isin]` via `BondManager`; check for finalised auctions via the ingestion projection's `auctions` table.
- Regenerate `services/nb-bond-api/openapi.json` (via the existing tooling — the operator's runbook in `services/nb-bond-api/DEVELOPMENT.md` documents the command).
- Jest unit tests for the new handlers: shape of the success response, shape of the 409 problem body, idempotency of `DELETE`.

### Steps

1. Apply the schema migration. Start the API in dev mode (`npm run dev` against the local chain) and confirm `PRAGMA table_info(partitions)` returns the new column.
2. Wire the new event handlers; replay the existing chain (`/v1/admin/restart-ingestion?fromBlock=0`) and confirm no projection regressions.
3. Add the routes + DTOs.
4. Regenerate `openapi.json`.
5. `npm test` in `services/nb-bond-api`.
6. Redeploy the API: `./services/nb-bond-api/nb-bond-api.sh start` (image rebuild + helm upgrade).

### Verification Stop

- `npm test` clean in `services/nb-bond-api`.
- `kubectl -n nb-bond-api get pods` shows the new pod `Ready` after rollout.
- `curl http://bond-api.cbdc-sandbox.local/v1/health` reports `ok`.
- `curl -X POST -d '{"isin":"NO-TEST-001","maturityDuration":"31536000"}' http://bond-api.cbdc-sandbox.local/v1/bonds` returns 201 with a `BondDTO`.
- `curl -X DELETE http://bond-api.cbdc-sandbox.local/v1/bonds/PA0847583457` returns 204 (the limbo bond from the baseline snapshot disappears from the default `/v1/bonds` response).
- `curl http://bond-api.cbdc-sandbox.local/v1/bonds?includeDisabled=true | jq '.[] | select(.isin == "PA0847583457") | .disabled'` returns `true`.
- `curl -X DELETE http://bond-api.cbdc-sandbox.local/v1/bonds/LA3480954865` returns 409 with a problem+json body containing the current supply.

### Fix Iteration / Rollback

- Schema migration failed: roll back the API release (`helm -n nb-bond-api rollback nb-bond-api <previous-rev>`), drop the new column manually, fix forward.
- Ingestion bug: stop the API, replay from block 0 via `/v1/admin/restart-ingestion?fromBlock=0` after fixing.
- Failed unit tests: standard fix-and-rerun.

### Exit Criteria

- Disable + create end-to-end works via curl.
- OpenAPI regenerated and committed.
- API CI green.

## Phase 3: UI

### Goal

Operator-facing affordances that match the new API surface, with the same UX conventions as the existing "hide cancelled" pattern.

### Sub-phases

- **3a — `bondsApi.js` wiring.** Add `createBond`, `disableBond`, `listBonds({ includeDisabled })`. Update `getBond` if needed to surface `disabled` (it should come through for free via the DTO).
- **3b — `CreateBondModal.jsx` simplification.** Strip the existing auction-create fields. Required: `isin`, `maturityDuration`. On success, dismiss the modal and navigate to `BondDetailPage` for the new bond. The first-auction action is invoked separately from that page (per §D2).
- **3c — `BondsPage.jsx` "Show disabled" toggle.** New checkbox below the existing filter row, default off, persisted to `localStorage` under `nbui.showDisabledBonds`. Pass the flag to `bondsApi.listBonds({ includeDisabled })`. Add a `DISABLED` status pill in the table row when `bond.disabled === true`.
- **3d — `BondDetailPage.jsx` disable affordance.** Show a "Disable bond" button when `bond.disabled === false`, `bond.totalSupply === '0'`, no auction in `bondActive` state, and no auction with `status === 'finalised'`. Clicking it opens a confirmation modal explaining the irreversible nature and asking the operator to type the ISIN to confirm (mirrors the existing destructive-action confirmation pattern from the network health Resync modal). On success, toast + reload + navigate back to `BondsPage` with the "Show disabled" toggle on so the operator sees the bond they just disabled.
- **3e — Tests.** Page-level tests via `vi.mock('../src/api/bondsApi.js', …)` covering:
  - Bonds list default hides disabled bonds, toggle reveals them.
  - `CreateBondModal` submits bond-only and navigates to the new bond's detail page.
  - `BondDetailPage` shows/hides the "Disable bond" button based on the gate.
  - `BondDetailPage` shows a "Schedule first auction" CTA when the bond has no auctions yet.
  - Disable confirmation requires typing the ISIN.

### Verification Stop

- `npm run lint`, `npm run format:check`, `npm run build`, `npm test` all clean in `services/nb-ui`. AI verification stops at the structural gates; the operator drives the browser check in Phase 4.

### Fix Iteration / Rollback

- Standard frontend cycle. The change is local-only until the bundle is rebuilt and helm-upgraded.

### Exit Criteria

- All UI gates green.
- Operator has performed a manual browser walkthrough and signed off.

## Phase 4: Post-Change Verification

### Goal

Prove the four layers cohere end-to-end on the running sandbox.

### Steps

1. Operator opens `http://web.cbdc-sandbox.local/` after the new bundle is deployed via `./services/nb-ui/nb-ui.sh start`.
2. **Decoupled create flow:** Operator creates a new bond `NO-TEST-NEW-001` via the `+ New bond` modal. Modal collects only ISIN + maturity. After submit, the operator lands on `BondDetailPage` with `auctions: []` and a "Schedule first auction" CTA. Operator clicks the CTA, fills the RATE-auction fields, and confirms the auction transitions to `BIDDING`.
3. **Disable limbo bond:** Operator opens the bond detail for `PA0847583457` (a limbo bond from the baseline). Clicks "Disable bond", types the ISIN to confirm. Confirms the bond disappears from the default bonds list. Toggles "Show disabled" — confirms it reappears with a `DISABLED` pill.
4. **Disable rejected for minted bond:** Operator opens `LA3480954865` (has minted supply). Confirms "Disable bond" button is not rendered (or is disabled with a tooltip explaining the gate failure).
5. **Re-create after disable:** Operator creates a new bond with ISIN `PA0847583457` (the one just disabled). Confirms it succeeds with a fresh partition (no inherited maturity / coupon / supply state).
6. **Idempotency check:** Operator re-clicks "Disable" on `PA0847583457` (now re-created and immediately re-disabled). Confirms the toast shows success on the first try and a no-op on the second (since `DELETE` is idempotent).
7. **Per-bond audit trail:** Operator opens `BondDetailPage` for the disabled bond. Confirms the event history shows `BOND_DISABLED` at the right block.

### Verification Stop

- All seven steps pass.
- `kubectl -n nb-bond-api logs` and `kubectl -n nb-ui logs` show no errors during the walkthrough.

### Fix Iteration / Rollback

- If step 2 fails (decoupled create): contract or API regression — diagnose, fix, re-deploy.
- If step 3 fails (disable a limbo bond): same diagnostic path; the limbo bonds are the cheapest end-to-end fixture.
- If step 5 fails (re-create): the per-partition mappings weren't fully cleared on disable; revisit `BondToken.disablePartition`.
- If something hangs in Helm rollout: `helm -n <ns> rollback <release> <previous-rev>` and diagnose.

### Exit Criteria

- Operator has signed off on the walkthrough.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal

Leave the docs accurate, the index current, and the public-repo posture clean.

### Steps

- Update `services/nb-bond-api/README.md` (new endpoints listed).
- Update `services/nb-bond-api/DEVELOPMENT.md` (note the `partitions.disabled` column + the pre-flight gate semantics).
- Update `services/nb-ui/README.md` and `services/nb-ui/DEVELOPMENT.md` (note the new affordances and the persisted `localStorage` keys).
- Update `contracts/docs/contracts-reference.md` and `contracts/docs/bond-lifecycle-walkthrough.md` (new entrypoints, the "pre-stage then schedule" path).
- Update `docs/ARCHITECTURE.md` (one-paragraph note that bond inventory is independent of auction calendar).
- Update `docs/KNOWN_ISSUES.md` (retire any historical "bond cannot be undone" mention; the entry for `reopenAuction` is unaffected).
- Update `docs/plans/archive/operator-ui-backlog.md` — move items 11 + 12 into the "shipped" list, delete the per-item sections. The doc shrinks accordingly.
- Move this plan doc to `docs/plans/archive/bond-lifecycle-management-plan.md` and update the status line + PR link. Update `docs/DOCUMENTATION_INDEX.md` accordingly.

### Verification Stop

- `python3 scripts/verification/check-public-repo-hygiene.py` clean.
- `python3 scripts/verification/check-markdown-links.py` clean.
- `python3 scripts/verification/check-third-party-licenses.py` is NOT required (no dependency / image-pin change).

### Fix Iteration / Rollback

- Standard doc cycle. No state changes.

### Exit Criteria

- All hygiene scripts green.
- Documentation index reflects the archived plan.

## Documentation And PR Plan

Recommended split: **one PR**, but acceptable to split into two if the contract change wants standalone review.

- **Option A — single PR `feature/bond-lifecycle-management` (preferred):** all four layers in one. Reviewers see the end-to-end story, the operator-ui-backlog doc shrinks in the same diff, and the OpenAPI / DTO / UI changes all reference the contract addresses the chain already exposes.
- **Option B — split:** PR 1 for contracts (`feature/bond-lifecycle-contracts`) with the BondManager + BondToken changes and Foundry tests; PR 2 for ingestion + API + UI + docs once PR 1 lands. Use this only if the contract review is expected to be slow — the API + UI work depends on the deployed contracts, so PR 2 cannot start landing until PR 1 is in `development`.

Evidence to include in the PR body:

- The seven Phase-4 walkthrough steps as a manual test plan checklist.
- Output of `forge test` and `./slither.sh` from Phase 1.
- Output of `npm test` for nb-bond-api and nb-ui.
- A `curl` transcript covering the four happy paths and one rejection (Phase 2 verification stop).
- A note that items 11 + 12 are moved from `docs/plans/archive/operator-ui-backlog.md` to the "shipped" list.

Per repo policy: no AI attribution in the commit messages or the PR body. Branch targets `development`, not `main`.

## Residual Risks

- **Re-using a disabled ISIN re-uses the partition key.** Off-chain consumers that key on ISIN-as-stable-identity-across-time will see the "second life" as if it were the first. The nb-bond-api projection handles this fine (the `bond_events` table preserves the disable + re-create as two distinct events). External integrators (if any) should be aware. Flagged in the new entry in `contracts/docs/contracts-reference.md`.
- **The pre-flight gate in the API can race against the chain.** If a bid lands between the API's gate check and the actual `disableBond` transaction, the chain will revert and the API surfaces the chain error as a 500 (or maps it to a 409 with a generic body). Operator-side this is a "click again" annoyance, not a data-corruption risk — the bond either is or isn't disabled at the end.
- **`deployBondWithAuction` backward compat is preserved by composition.** If a future contract change splits the two further (e.g. different role for create vs schedule), the composition path needs to be reviewed.
- **Slither false positives** on the new code paths may need narrow `// forge-lint:` suppressions. Track in the PR if any are added.
- **Helm rollback after Phase 2 leaves the SQLite column in place** — that's fine, the column is additive and no consumer breaks if it stays during a rollback to the previous API version. The new column reverts to its default `0` when the previous version writes rows.

## Done Criteria

- All acceptance-criteria rows show `Pass` or equivalent.
- Phase 4 walkthrough signed off by the operator.
- PR(s) merged into `development`.
- `docs/plans/archive/operator-ui-backlog.md` items 11 + 12 moved to "shipped".
- Plan doc archived under `docs/plans/archive/` with a status line + PR link.
- `docs/KNOWN_ISSUES.md` no longer has the "bond cannot be undone" gap (or its historical phrasing).
