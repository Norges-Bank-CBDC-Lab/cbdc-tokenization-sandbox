# `operator-audit-trail` — Implementation Plan

**Status:** Draft, ready for operator review — implements `docs/plans/operator-audit-trail-design.md` with the operator-decided scope: record **all** operator-initiated on-chain operations (bond lifecycle + central-bank WNOK + banking TBD + bid submission), surface them on a new **System → Operations** page, defer the per-bond merged coupon-payments endpoint.
**Branch suggestion:** `feature/operator-audit-trail` — defer the actual branch / commit / PR / CI-gate workflow to the repo PR conventions.
**Components touched:** `services/nb-bond-api/` (`src/ingestion-db.ts`, new `src/operations.ts`, `src/index.ts`, `src/central-bank.ts`, `src/banking-tbd.ts`, `src/banks.ts`, `src/bidder-bid.ts`, `src/schemas.ts` + regenerated `openapi.json`, `tests/`), `services/nb-ui/` (`src/components/Layout.jsx`, `src/App.jsx`, new `src/pages/OperationsPage.jsx`, new `src/api/operationsApi.js`, `tests/`), docs (`services/AGENTS.md`, `services/nb-bond-api/README.md`, `docs/ARCHITECTURE.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/backend-design-improvements-backlog.md`).

## Goal

Give the sandbox a persistent operator audit trail: every operator-initiated on-chain operation (attempted through the NB Bond API) is recorded with its outcome — success, revert (with the decoded reason), or failure — in a preserved SQLite table, exposed via `GET /v1/operations`, and rendered as an Operations page under the System nav category. Failed payout attempts finally become visible after the fact instead of existing only in a transient 409 body.

## Current-State Evidence

Verified in-session against repo @ `cdff0ef` and the running sandbox:

- **Chain cannot provide failures** (re-verified in the design brief): reverts emit no events, and most failed sends are rejected at gas estimation and never broadcast. The decoded reason (`describeRevert`, `services/nb-bond-api/src/chain.ts`) exists only in the error path of each handler.
- **Table creation is additive**: `createTables()` (`services/nb-bond-api/src/ingestion-db.ts:75`) runs `CREATE TABLE IF NOT EXISTS` on every write-mode open, *after* `migrateToCurrentVersion()` (`:233`). A new preserved table therefore needs **no `SCHEMA_VERSION` bump** and causes no projection rebuild — existing databases pick it up at next boot. The preserved set (`bidders`, `banks`) is exempted from the migration drop list (`:35`, `:228`); `operation_attempts` must join that exemption.
- **Write handles**: handlers hold a read-write DB handle (`biddersDb` pattern in `src/index.ts`) alongside the read-only `historyDb`; the recording helper uses the read-write handle.
- **Send paths**: bond-admin operations go through `sendWithManagedNonce` in handlers in `src/index.ts`; central-bank WNOK operations sign with the CB wallet (`src/central-bank.ts`); banking TBD operations sign per-bank (`src/banking-tbd.ts`, `src/banks.ts`); impersonated bids sign per-bidder (`src/bidder-bid.ts`). Recording happens at **handler level** (where `op_type`/target/detail are known), not in the transport.
- **UI conventions**: the System nav category exists ungated with one item (`services/nb-ui/src/components/Layout.jsx:151–154`); `GlobalRegistryPage.jsx` + `registryApi.js` + the `registry` route in `App.jsx:122` are the exact precedent for a new System page. The API layer is the single network seam (`src/api/`), with the ETag cache in `httpClient.js`.
- **Live checks**: sandbox up (six releases, all pods Ready), NB Bond API `/v1/health` ok. `npm test` surfaces exist for both packages (jest / vitest) and gate CI.

## Scope

### In Scope

- Preserved `operation_attempts` table + recording helper.
- Recording wired into **all** operator mutation handlers that submit transactions: bond create/disable, auction create/close/cancel/finalise, coupon payment, redemption, bid submission, WNOK mint/burn/transfer + allowlist add/remove, bank create, TBD mint/burn/transfer + allowlist add/remove.
- `GET /v1/operations` (array of `OperationAttempt`, md5/ETag, optional `?limit`).
- System → Operations page in NB UI.
- The projection-purity rule write-up (backlog item 3) — load-bearing once this table exists.

### Out Of Scope

- The per-bond merged `GET /v1/bonds/{isin}/coupon-payments` (deferred by operator decision; design retained in the brief).
- Payout preflight simulation (`eth_simulateV1` dry-run) — backlog item 6.
- `PARTIAL` outcomes in practice — the schema supports the status, but no current operation can produce it (atomic contract calls); becomes real with the treasury-held-units contract fix or two-tier settlement.
- Retention caps / pruning (unbounded is accepted at sandbox scale; noted as follow-up).
- DB-only mutations (bidder roster create/delete) — the trail records **on-chain** operations per the design brief.

## Decisions And Open Questions

| Decision | Resolution |
|---|---|
| v1 operation coverage | **All operator on-chain ops** incl. central-bank + banking (operator, 2026-07-06) |
| Per-bond merged coupon-payments GET | **Deferred** (operator, 2026-07-06) |
| Page placement + label | **System → Operations**, route `#/operations` (operator, 2026-07-06) |
| Read-access gating | **Ungated reads** (recommended, applied unless operator objects): matches the System category precedent (Global Registry) and the tester-visible bond surface; in `entra` mode the global auth middleware still requires a valid token. Mutations remain gated as today. |
| Recording altitude | Handler-level via one helper (`withOperationRecording`) — the transport seams (3 signer paths) don't know `op_type`/target/detail. |

## Portability Flags

None — the table lives in the existing `DB_PATH` SQLite file; no new env vars, hostnames, or pins.

## Acceptance Criteria

| Criterion | Verification evidence |
|---|---|
| Failed coupon payout is visible after the fact | Trigger a payout that reverts (e.g. coupon not due); `GET /v1/operations` returns a `REVERTED` row with the decoded reason and null `txHash`; row survives an API pod restart AND a `POST /v1/admin/restart-ingestion?fromBlock=0` resync |
| Successes recorded with tx hash | WNOK mint via UI → `SUCCEEDED` row with `txHash`; visible on the Operations page with a Blockscout link |
| Every in-scope op type records | One smoke per handler group (bond, auction, bid, WNOK, TBD) produces rows with correct `op_type`/`target` |
| Contract unchanged elsewhere | `GET /v1/bonds`, `/v1/auctions` etc. byte-identical (no DTO churn); `npm run regen:openapi` diff shows only the new schema + path |
| Both packages green | nb-bond-api: lint + format:check + test + build; nb-ui: format:check + lint + test + build (the four CI gates) |
| ETag/304 works on the new endpoint | Second `GET /v1/operations` with `If-None-Match` returns 304 |
| Docs updated | Projection-purity rule in `services/AGENTS.md` + nb-bond-api README; ARCHITECTURE + index updated; hygiene + markdown-link checks pass |

## Assumptions

- The `detail` JSON column stays small (holder counts, amounts as strings — no full holder lists for large sets; cap the array or store counts).
- `created_at` uses server wall clock (attempt time); chain time is irrelevant for an attempt log.
- One recording helper can serve all three signer paths because it wraps at handler level.

## Plan Order

```
Phase 0  Baseline (read-only)
Phase 1  Table + recording core + unit tests
Phase 2  Handler wiring (bond → CB → banking → bids) + tests
Phase 3  GET /v1/operations (schemas.ts + regen + handler) + tests
Phase 4  NB UI Operations page + tests
Phase 5  Live validation on the running sandbox
Phase 6  Docs, hygiene, PR
```

Single PR — backend and frontend break together per repo convention (precedent: #179).

## Phase 0: Baseline Verification

### Steps

- `curl -s http://bond-api.cbdc-sandbox.local/v1/health` healthy; note current block.
- `cd services/nb-bond-api && npm test` and `cd services/nb-ui && npm test` green pre-change.
- Snapshot `openapi.json` (`git stash`-free working tree) for the regen diff in Phase 3.

### Exit Criteria

Clean tree, green tests, healthy sandbox.

## Phase 1: Table And Recording Core

### Steps

1. `src/ingestion-db.ts`: add `operation_attempts` to `createTables()` — `(id INTEGER PRIMARY KEY, op_type TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, tx_hash TEXT, error TEXT, detail TEXT, created_at INTEGER NOT NULL)` + index on `created_at`. Extend the preserved-tables doc comment (`:35`) and **do not** touch `dropProjectionTables` or `SCHEMA_VERSION`.
2. New `src/operations.ts`: `recordOperationAttempt(db, row)` insert + `listOperationAttempts(db, {limit})` newest-first read + `withOperationRecording(db, opType, target, detail, fn)` — runs `fn`, records `SUCCEEDED` with the receipt hash, or classifies the failure (`REVERTED` + decoded reason via `describeRevert`, `txHash` when a mined-reverted receipt exists, `FAILED` for RPC/transport errors) and rethrows so existing ProblemDetails behavior is unchanged.
3. Jest units: insert/list round-trip, newest-first ordering, limit, classification of the three failure shapes, and a migration test proving the table survives `migrateToCurrentVersion` (mirror the existing preserved-table test if present).

### Verification Stop

`npm test` green; `npm run build` clean.

### Fix Iteration / Rollback

Pure additive module — revert the two files.

### Exit Criteria

Core recording provably works and survives resync in tests.

## Phase 2: Handler Wiring

### Steps

Wrap each transaction-submitting handler with `withOperationRecording` (≈3-line diff each), passing an `op_type` from a single zod enum and the natural target (ISIN or address):

- `src/index.ts`: `BOND_CREATE`, `BOND_DISABLE`, `AUCTION_CREATE`, `AUCTION_CLOSE`, `AUCTION_CANCEL`, `AUCTION_FINALISE`, `COUPON_PAYMENT`, `REDEMPTION`.
- `src/bidder-bid.ts` call site: `BID_SUBMISSION` (target: auction id; detail: bidder address).
- `src/central-bank.ts` call sites: `WNOK_MINT`, `WNOK_BURN`, `WNOK_TRANSFER`, `WNOK_ALLOWLIST_ADD`, `WNOK_ALLOWLIST_REMOVE`.
- `src/banks.ts` / `src/banking-tbd.ts` call sites: `BANK_CREATE`, `TBD_MINT`, `TBD_BURN`, `TBD_TRANSFER`, `TBD_ALLOWLIST_ADD`, `TBD_ALLOWLIST_REMOVE`.

Detail payloads: amounts as strings, holder **counts** not holder lists, and the existing treasury-deadlock hint text when present. Error responses to clients are unchanged (record-and-rethrow).

### Verification Stop

- `npm test` green (extend existing handler tests where they stub the chain: assert a row is written on success and on revert).
- `rg -n 'sendWithManagedNonce|\.wait\(\)' src/ | grep -v operations` cross-checked against the wired list — every send path either wrapped or explicitly listed as out of scope.

### Fix Iteration / Rollback

Per-handler wrapping is independently revertible; an unwrapped handler is a gap, not a break.

### Exit Criteria

All in-scope sends record; no client-visible behavior change.

## Phase 3: `GET /v1/operations`

### Steps

1. `src/schemas.ts`: `operationTypeSchema` (zod enum of the op types), `operationStatusSchema` (`SUCCEEDED | REVERTED | FAILED | PARTIAL`), `operationAttemptSchema` (`OperationAttempt` id: opType, target, status, txHash nullable, error nullable, detail nullable, createdAt, `md5`) in the **system** region; path `GET /v1/operations` (operationId `listOperations`, optional `?limit`, default 200, array-of-DTO response — no wrapper). `npm run regen:openapi`; commit the regenerated `openapi.json`.
2. `src/index.ts`: handler mounted with the standard auth chain (no extra role gate — see Decisions), `okResponse` for md5/ETag/304.
3. Tests: response shape, newest-first, limit, 304 round-trip.

### Verification Stop

`npm test` + `npm run regen:openapi` (idempotent — second run produces no diff); openapi diff contains only the new schema + path.

### Exit Criteria

Endpoint green in tests; spec regenerated from source.

## Phase 4: NB UI Operations Page

### Steps

1. `src/api/operationsApi.js`: `listOperations()` via the shared `httpClient` (ETag cache for free).
2. `src/pages/OperationsPage.jsx`: modeled on `GlobalRegistryPage.jsx` — table of time (relative + absolute), operation type, target, status chip, decoded error (truncated with expand), tx hash → Blockscout link when present; newest first; refresh affordance consistent with the registry page.
3. `Layout.jsx`: add `{ label: 'Operations', href: '#/operations', match: ['operations'] }` to the System category. `App.jsx`: route + page import.
4. Mock client: if the mock/api fallback mode covers other endpoints, add `listOperations` fixtures so mock mode exercises the same selectors.
5. Vitest: page renders rows from a stubbed API, status chips map correctly, empty state ("No operations recorded yet").

### Verification Stop

`npm run format:check && npm run lint && npm test && npm run build` (nb-ui gate order).

### Fix Iteration / Rollback

UI is additive; removing the nav item + route hides it completely.

### Exit Criteria

nb-ui gates green with the new page covered by tests.

## Phase 5: Live Validation

### Steps

- Rebuild + redeploy both services on the running sandbox (`./services/nb-bond-api/nb-bond-api.sh start`, `./services/nb-ui/nb-ui.sh start`).
- Smokes, one per handler group: WNOK mint (SUCCEEDED + txHash), coupon payout on a non-due bond (REVERTED, decoded `CouponNotReady`, null txHash), TBD transfer, bid submission, bond create.
- `curl -s http://bond-api.cbdc-sandbox.local/v1/operations | jq length` and a second conditional GET → 304.
- Open `http://web.cbdc-sandbox.local/#/operations`: rows render, Blockscout links resolve, error text readable.
- Durability: restart the API pod, then `POST /v1/admin/restart-ingestion?fromBlock=0` — rows survive both.

### Verification Stop

All acceptance-criteria rows in the table above check off with captured evidence.

### Fix Iteration / Rollback

`helm -n <ns> rollback` per service; the table is additive so no data migration to unwind.

### Exit Criteria

Feature demonstrably works end-to-end on the local stack.

## Phase 6: Documentation, Hygiene, PR

### Steps

- **Projection-purity rule** (backlog item 3, ships here): one explicit paragraph in `services/AGENTS.md` and `services/nb-bond-api/README.md` — projection tables hold only chain-reproducible rows; anything else goes in the preserved set (`bidders`, `banks`, `operation_attempts`).
- `services/nb-bond-api/README.md`: document the table + endpoint. `docs/ARCHITECTURE.md`: extend the off-chain architecture section (three data planes → system-of-record now includes the audit trail).
- `docs/plans/backend-design-improvements-backlog.md`: mark item 3 shipped-with-this-PR; note item 4 (preserved-table migrations) now covers three tables.
- `docs/DOCUMENTATION_INDEX.md`: index this plan; annotate the design brief's entry as implemented-by this plan. On shipping, move this plan to `docs/plans/archive/` with the PR number.
- `python3 scripts/verification/check-public-repo-hygiene.py && python3 scripts/verification/check-markdown-links.py`.

### Exit Criteria

Docs coherent; hygiene green; PR opened per repo conventions with the acceptance-criteria evidence in the body.

## Residual Risks

- **Unbounded growth** — accepted at sandbox scale; a `?limit` default protects the endpoint. Follow-up: retention cap if a long-lived deployment ever needs it.
- **Crash window** — a crash between broadcast and receipt loses the row (written once the outcome is known). Accepted per the design brief; `PENDING`→final two-phase write is the upgrade path.
- **API-scope only** — operations performed outside the NB Bond API are invisible to the trail. Accepted: it is the only operator surface.
- **Coverage drift** — a future handler that forgets `withOperationRecording` silently skips the trail. Mitigated by the Phase 2 cross-check grep, repeated in review; a lint rule is possible follow-up.

## Done Criteria

- All acceptance criteria verified on the running sandbox with evidence captured in the PR.
- Both packages' CI gates green; hygiene checks pass.
- Plan archived with the merging PR number; design brief annotated as implemented.
