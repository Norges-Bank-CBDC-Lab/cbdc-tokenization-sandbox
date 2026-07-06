# Operator Audit Trail — Design Brief

Status: Design brief — pre-planning. Direction agreed; an implementation plan will be produced from this brief.

Date: 2026-07-06

## Purpose

Give the NB Bond API a persistent record of operator-initiated on-chain operations and their outcomes — success, error, and (future) partial success — starting with bond coupon payments, so the NB UI Coupon payout page can show a payout-results list at the bottom of the page.

## Why the chain cannot provide this

Two verified facts (Current state):

1. `BondManager.payCoupon` is all-or-nothing: if any holder's cash settlement fails, the whole transaction reverts (`contracts/src/norges-bank/BondManager.sol`), and a reverted transaction emits no events — the ingestion pipeline can never see a failure.
2. Most failed attempts never reach the chain at all. The handler for `POST /v1/bonds/{isin}/coupon-payments` (`services/nb-bond-api/src/index.ts`) submits without an explicit gas limit, so gas estimation runs first; when the payout would revert (including the treasury-held-units deadlock), estimation throws and **no transaction is broadcast**. There is no failed transaction to find afterwards — not via JSON-RPC, not via Blockscout. The decoded revert reason exists only in the transient HTTP 409 response body.

Successes, by contrast, are fully on-chain: `CouponPaid(isin, holder, paymentAmount, paymentNumber)` per holder plus `AllCouponsPaid(isin)` on the final payment, already ingested as `COUPON_PAID` / `COUPON_COMPLETE` rows in `bond_events` and served by `GET /v1/bonds/{isin}/history`.

Conclusion: failure outcomes (and attempt metadata generally) must be persisted by the API at the moment they happen. This is a database feature by necessity, not by preference.

## On "partial success"

Current state: a partial success cannot occur for coupon payments — the contract call is atomic. The schema below still models per-item outcomes, because partial outcomes become real when:

- the treasury-held-units fix lands (manager-held units skipped, so a payout can cover a subset of the supply), and/or
- later phases of `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md` introduce two-tier coupon/redemption, where per-holder legs can fail independently.

Designing for per-item outcomes now avoids a schema migration on a preserved table later (see item 4 in `docs/plans/backend-design-improvements-backlog.md`).

## Design

### Storage — a preserved system-of-record table

New table `operation_attempts` in the NB Bond API SQLite database.

**Hard requirement:** the table joins `bidders` / `banks` in the preserved set in `migrateToCurrentVersion()` (`services/nb-bond-api/src/ingestion-db.ts`). It must never live in the projection tables — those are dropped and rebuilt from chain on every resync or schema bump, which would silently erase failure history (the projection-purity rule, item 3 of the backlog).

| Column | Type | Notes |
|---|---|---|
| `id` | integer, pk | |
| `op_type` | text | `COUPON_PAYMENT` first; later `REDEMPTION`, `WNOK_MINT`, `WNOK_BURN`, `WNOK_TRANSFER`, `FINALISATION`, ... |
| `target` | text | ISIN for bond operations; address for token operations |
| `status` | text | `SUCCEEDED` / `REVERTED` / `FAILED` / `PARTIAL` |
| `tx_hash` | text, nullable | null when gas estimation rejected the call before broadcast |
| `error` | text, nullable | decoded revert reason (output of `describeRevert`, including the treasury-deadlock hint) |
| `detail` | text (JSON), nullable | request summary (holder count, amounts) and per-item outcomes for `PARTIAL` |
| `created_at` | integer | unix seconds, server clock — attempt time, not chain time |

Retention: unbounded is acceptable at sandbox scale; a cap can be added later. Rows are never hard-deleted, matching the repo's audit-preserving posture for operator actions.

### Write points

In the coupon-payments handler: a success row after the receipt, a failure row in the existing catch block where `describeRevert` already produces the human-readable reason. Three failure shapes to distinguish:

- **Estimation-rejected** (the common case): no transaction broadcast → `REVERTED`, `tx_hash` null.
- **Broadcast but reverted** (rare — chain state changed between estimate and mining): receipt with status 0 → `REVERTED` with `tx_hash` (Blockscout-linkable).
- **Non-revert failures** (RPC unreachable, timeout): `FAILED` with the error message.

Later operation types adopt the same recording helper (a small wrapper around the transaction-send path; the central-bank signer path gets an equivalent).

### API surface

`GET /v1/bonds/{isin}/coupon-payments` returning `CouponPayment[]` — the REST twin of the existing POST. Array of DTOs, no wrapper object; discriminated union on `status`:

- **Succeeded** entries are composed from chain truth (`bond_events` `COUPON_PAID` rows grouped by payment number, with per-holder amounts and the transaction hash) — payouts made outside the API therefore still appear.
- **Failed** entries come from `operation_attempts` — API-scope only; attempts made outside the API are invisible (accepted, see limitations).

Standard md5/ETag caching applies. The existing POST keeps returning the updated Bond DTO.

### UI

A results list at the bottom of the Coupon payout page (`services/nb-ui/src/pages/CouponPayoutPage.jsx`): timestamp, bond, status, amount / holder count, the decoded error text for failures, and a Blockscout transaction link when `tx_hash` is present.

## Related capability: payout simulation (preflight)

Besu supports executing a transaction against chain state without committing it, and the sandbox node has everything needed enabled (`infra/besu/config/config.toml` exposes the ETH, DEBUG, and TRACE RPC namespaces; `eth_simulateV1` verified responding on the running node):

- **`eth_call`** (ethers v6 `staticCall`) executes the exact call and, on failure, returns the same custom-error revert data `describeRevert` already decodes — balance and allowlist problems surface without anything being broadcast.
- **`eth_simulateV1`** additionally returns the logs the transaction *would* emit — for `payCoupon`, the would-be `CouponPaid` events, i.e. a full per-holder payment preview (holders and amounts) with no commit. It also supports block overrides.

**Time caveat:** the local chain's clock lags wall clock (blocks mint only on transactions — see ADR 0001), and plain simulation runs at the latest block's timestamp. A simulated `payCoupon` can therefore false-revert with `CouponNotReady` in the window where wall clock has passed the due date but the chain clock has not. `eth_simulateV1`'s block-timestamp override resolves this, with two distinct uses:

- override to **current wall clock** → send-parity preflight (the simulation sees what the mined transaction will see);
- override to the **next coupon due date** → an early diagnostic, days ahead of the due date: "when this coupon comes due, will it fail on balances or allowlists?" — catching e.g. the treasury-held-units deadlock before payout day.

Placement in this design: **simulation predicts, the audit trail records.** A dry-run affordance on the Coupon payout page (preview per-holder amounts, or the decoded would-be failure, before sending) composes naturally with the results list; whether it is a `dryRun` flag on the existing POST or a separate preview endpoint is left to the implementation plan. Making preflight simulation universal for state-changing sends is tracked separately as item 6 of `docs/plans/backend-design-improvements-backlog.md`.

## Accepted limitations

- Failure rows capture only attempts made through the NB Bond API. It is the only operator surface in the sandbox, and successes remain chain-derived, so nothing durable is missed.
- A crash between broadcast and receipt loses the attempt row (the row is written once the outcome is known). Accepted at sandbox scale; a two-phase write (`PENDING` → final status) is the upgrade path if it ever matters.

## Open questions

- v1 scope: coupon payments only, or also redemptions and central-bank `Wnok` operations from day one? (The table is generic either way.)
- Does the results list live only on the Coupon payout page, or does a global "operations" view come later?
- Pagination for the new GET (likely unnecessary at sandbox scale — ETag/304 covers polling).

## Follow-up

- Run implementation planning from this brief.
- Backlog relations: depends on writing down the projection-purity rule (backlog item 3); adds weight to the preserved-table migration question (backlog item 4).
