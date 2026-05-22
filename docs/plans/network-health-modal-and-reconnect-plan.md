# Network Health Modal + Manual Reconnect — Implementation Plan (Plan C)

**Status:** Planned — depends on Plan B
**Branch:** `feature/network-health-modal-and-reconnect`
**Components:** `services/nb-bond-api/` (recent-error ring buffer + new admin endpoint) and `services/nb-ui/` (clickable HealthBadge → modal with reconnect action).

This is **Plan C**, the additive delta on top of **Plan B** ([`health-indicator-and-self-healing-plan.md`](health-indicator-and-self-healing-plan.md)). **Do not start Plan C until Plan B is shipped and merged.** Plan C assumes Plan B's foundations (`getIngestionStatus()`, extended `/v1/health`, `HealthBadge`) already exist.

## Goal

Replace the stub-non-clickable `HealthBadge` from Plan B with a clickable surface that opens a `NetworkHealthModal`. The modal pretty-prints the extended `/v1/health` payload, surfaces recent ingestion errors, and offers two operator actions:

1. **Reconnect** — `POST /v1/admin/restart-ingestion` tears down the current ingestion loop and starts a fresh one using Plan B's retry-with-backoff helper. Non-destructive: projection survives.
2. **Resync from block 0** (with confirmation) — `POST /v1/admin/restart-ingestion?fromBlock=0` drops the projection tables (`auction_events`, `bond_events`, `balance_events`, `auctions`, `partitions`, `balances`, `ingestion_state`) and restarts the loop from `START_BLOCK`. **Preserves `bidders`** (system-of-record). Destructive: requires a confirmation modal with an explicit type-to-confirm phrase.

After Plan C ships, the operator can diagnose chain/ingestion state and force a recovery from the browser without ever touching `kubectl`.

## Current-State Evidence

Same baseline reads as Plan B, **plus the assumption that Plan B's changes are in place**:

- `services/nb-bond-api/src/ingestion.ts` exports `getIngestionStatus()` and `startIngestionLoopWithRetry()`.
- `/v1/health` returns the extended payload (chain + ingestion blocks).
- `services/nb-ui/src/components/HealthBadge.jsx` exists and polls `/v1/health`. **Not clickable** — Plan C wires the click.

If Plan B drifts (e.g. names change), update this plan accordingly before starting.

## Scope

### In Scope

- **Backend (small additions):**
  - `services/nb-bond-api/src/ingestion.ts`: ring buffer for the last 10 errors with timestamps. Surface via `getIngestionStatus().recentErrors[]`. Each entry: `{ ts: unixMillis, message: string, code: string|null }`.
  - `/v1/health` payload extended with `ingestion.recentErrors[]` (array of those entries).
  - New `services/nb-bond-api/src/admin.ts` module owning the restart logic. Exposes `restartIngestionLoop()` and `resetProjectionAndRestart()`.
  - New route `POST /v1/admin/restart-ingestion` in `index.ts`. Reads `?fromBlock=0` query as the reset switch. Auth: passes through the existing `authMiddleware` (so `none` mode is open, `entra` mode requires a JWT). Returns `202 Accepted` with the new status.
  - Add the route to `schemas.ts` + OpenAPI doc under a new `admin` tag.
  - Unit tests: ring-buffer FIFO behaviour; restart endpoint tears down + restarts loop; reset-from-0 drops projection but preserves `bidders`.
- **Frontend:**
  - New `services/nb-ui/src/api/healthApi.js` extended with `restartIngestion({ fromBlock })`.
  - New `services/nb-ui/src/pages/NetworkHealthModal.jsx`. Reuses `Modal` from `components/ui.jsx`.
  - `HealthBadge` gains `onClick={() => setOpen(true)}` and renders `<NetworkHealthModal />` when open.
  - New `services/nb-ui/src/pages/ConfirmResyncModal.jsx` — the destructive-action confirmation gate. Type-to-confirm with the phrase `resync from block 0` to enable the submit button.
  - Mock client adds `restartIngestion()` stub.
  - Feature tests: modal renders the payload, reconnect button calls the API, resync requires the confirmation phrase.
- **KNOWN_ISSUES.md** — resolve the "request-path chain reads bubble up as opaque 500s" entry if Plan B already addressed it (it doesn't, but if Plan C adds error catching in the admin module flow that's a partial fix; otherwise leave that entry intact).
- **DEVELOPMENT.md** — document the new admin endpoint and the reset semantics.

### Out of Scope (explicit)

- Drift detection via `eth_getLogs` from chain. The `lastEventTxHash` from Plan B remains the cheap variant.
- Real-time event log streaming — transport is HTTP.
- Block-explorer-style historical view — Blockscout already does this.
- Auth changes beyond reusing the existing `authMiddleware`. Specifically: no new role-based gating in `none` mode (the sandbox banner everywhere makes the trust posture explicit).
- A "force-reload the JsonRpcProvider" button. The `restartIngestionLoop()` action implicitly does this in the admin module — the operator doesn't need a separate button.

## Folder And File Placement

| Item | Path | Rationale |
|---|---|---|
| Recent-error ring buffer | `services/nb-bond-api/src/ingestion.ts` (extend) | Module-state, same as the other status fields from Plan B. |
| Restart + reset logic | `services/nb-bond-api/src/admin.ts` (new) | Separation: ingestion owns the loop, admin owns the lifecycle. |
| Admin route | `services/nb-bond-api/src/index.ts` (extend) | Single source of routes. |
| Admin route schemas + path | `services/nb-bond-api/src/schemas.ts` (extend) | OpenAPI single source. New `admin` tag. |
| NetworkHealthModal | `services/nb-ui/src/pages/NetworkHealthModal.jsx` (new) | Follows `services/nb-ui/src/pages/` convention. |
| ConfirmResyncModal | `services/nb-ui/src/pages/ConfirmResyncModal.jsx` (new) | Co-located; tightly coupled to the modal. |
| Backend tests | `services/nb-bond-api/tests/admin.test.ts` | Cover both endpoint paths + the reset preservation invariant. |
| Frontend tests | `services/nb-ui/tests/NetworkHealthModal.test.jsx` | Match existing test naming. |

## Decisions And Open Questions

| Decision | Options | Recommendation | Why |
|---|---|---|---|
| Should `POST /v1/admin/restart-ingestion` require any auth beyond what `authMiddleware` already enforces? | (a) Reuse middleware as-is (none-mode is open, entra-mode validates JWT); (b) Add a dedicated "admin role" check in entra-mode | **(a) Reuse as-is.** | The sandbox-only context means none-mode is the deployment posture. In future entra-mode deployments, the operator's JWT is the gate; layering another role on top is premature without a real RBAC scheme. Document as a portability flag. |
| Include "Resync from block 0" in Plan C, or stage as Plan C.1? | (a) Include now; (b) Defer | **(a) Include now.** | Additive: small backend code, small frontend modal. Same iteration shape, no extra branch. |
| Confirmation phrase for resync | (a) Free-text "type CONFIRM"; (b) Phrase that matches the action; (c) Checkbox | **(b) Phrase that matches the action** (`resync from block 0`). | Forces the operator to read what they're confirming. Lifts from common destructive-action patterns. |
| Ring buffer size | 5 / 10 / 50 entries | **10 entries**. | Enough to see a brief outage pattern, small enough to not bloat `/v1/health` response. |
| Recent-error retention across loop restarts | (a) Clear on restart; (b) Persist | **(a) Clear on restart.** | The buffer is meant to show "what's currently going wrong". After a successful restart, the previous errors are no longer relevant. The persistent log lives in the K8s pod logs anyway. |
| `restartIngestion` returns | (a) `202 Accepted` immediately, polling for status; (b) Block until loop is up; (c) Block with a timeout, fall back to 202 | **(c) Block up to 5s, then 202.** | Common case: loop restarts in milliseconds. Edge case: chain still unreachable, retry-with-backoff takes longer. Operator gets fast feedback for the common case, doesn't hang forever for the edge. |
| Should the modal also expose `pollIntervalMs` of the badge polling itself? | yes/no | **No.** | Already 7s in Plan B, not worth surfacing. Operator who needs to tweak this changes a const. |
| Open question — anything else? | — | None I can see. | The above defaults cover the substantive design choices. |

## Portability Flags

- **`POST /v1/admin/restart-ingestion` has no role gate beyond JWT.** In a real Azure deployment, only a specific subset of operators should be able to call this — particularly the destructive `?fromBlock=0` variant. The current plan assumes "anyone with a valid JWT in entra mode" is OK because the sandbox is the deployment target. The Azure repo will need a per-route RBAC check before promoting this endpoint.
- **`resetProjectionAndRestart()` drops the projection across the whole API**, which is fine in the sandbox where the API is the single source of truth. In a hybrid Azure deployment where external dealers are submitting bids through the same API's ingestion pipeline, a reset-from-0 affects everyone's view. The operator-only modal + destructive confirmation reduces but doesn't eliminate the risk. Plan C's recommendation: in Azure, gate the `?fromBlock=0` query behind a tenant-admin role and put an audit-log entry in `bond_events` (or a new `admin_actions` table) every time it fires.

## Acceptance Criteria

| # | Criterion | Verification evidence | Target |
|---|---|---|---|
| AC1 | The recent-error ring buffer captures the last 10 errors and surfaces in `/v1/health.ingestion.recentErrors[]`. | Unit test pushes 15 errors, asserts buffer holds last 10 in FIFO order. Live: stop besu briefly, observe entries appearing in `/v1/health`. | Pass |
| AC2 | `POST /v1/admin/restart-ingestion` tears down the running loop and starts a new one. | Live: take the loop down via the endpoint, watch logs, observe `loopRunning=false` flicker then `true` again. | Pass |
| AC3 | `POST /v1/admin/restart-ingestion?fromBlock=0` drops projection tables but preserves `bidders`. | Unit test: pre-seed both, run the reset, assert projection empty + bidders intact. Live: place a bid, reset, confirm bidders survive and the bid re-ingests from chain. | Pass |
| AC4 | HealthBadge becomes clickable; click opens NetworkHealthModal. | Vitest: render, assert click handler fires; live browser smoke. | Pass |
| AC5 | NetworkHealthModal pretty-prints the payload. | Vitest: mock health response, assert presence of chain.head, ingestion.lag, recentErrors. | Pass |
| AC6 | Reconnect button calls the admin endpoint and refreshes the modal. | Vitest: click triggers mockClient call; modal data updates. | Pass |
| AC7 | Resync requires the type-to-confirm phrase AND surfaces the consequence text. | Vitest: button is disabled until the phrase matches; only enabled phrase posts `?fromBlock=0`. The modal renders all three "What will happen / Expected duration / While running" sections — assert at least one canonical phrase from each section is in the rendered output. | Pass |
| AC8 | OpenAPI document published in `openapi.json` reflects the new `/v1/admin/restart-ingestion` route. | `npm run regen:openapi` produces no diff after running again (snapshot is committed). | Pass |
| AC9 | All tests, lint, format, build, hygiene scripts green. | Pre-push gate per `sandbox-pr-workflow` skill. | Pass |

## Plan Order

```
Phase 0  Baseline (confirm Plan B is in place)
Phase 1  Backend
  1a  Ring buffer in ingestion.ts
  1b  admin.ts: restartIngestionLoop + resetProjectionAndRestart
  1c  POST /v1/admin/restart-ingestion route + schema
  1d  Backend tests
Phase 2  Frontend
  2a  healthApi.js: restartIngestion()
  2b  NetworkHealthModal
  2c  ConfirmResyncModal
  2d  HealthBadge becomes clickable
  2e  Frontend tests
Phase 3  Local apply + verification
Phase 4  Documentation + hygiene
```

## Phase 0: Baseline (confirm Plan B is in place)

### Goal

Make sure Plan B has shipped before starting Plan C work.

### Steps

- `curl http://bond-api.cbdc-sandbox.local/v1/health | jq` — confirm `chain.*` and `ingestion.*` blocks exist (Plan B shape).
- Browser at `http://web.cbdc-sandbox.local/` — confirm the LIVE pill has a coloured border (HealthBadge from Plan B).
- `git log --oneline | head -3` shows Plan B's merge commit on `development`.

### Exit Criteria

- All three above are true.

## Phase 1: Backend

### Phase 1a — Ring buffer

**Steps**

- In `services/nb-bond-api/src/ingestion.ts`, add `let recentErrors: Array<{ts:number, message:string, code:string|null}> = [];`.
- Helper `pushError(err: unknown)` that prepends to the array, truncates to 10, derives `code` from `err.code` (ethers) or `err.name`.
- Wire into the existing `tick()` catch block and the retry helper's `RpcUnavailableError` branch.
- Extend `getIngestionStatus()` to include `recentErrors: [...recentErrors]`.
- Extend `healthSchema.ingestion` in `schemas.ts` to include `recentErrors: array(...)`.

**Verification stop**

- Unit test for FIFO truncation.

### Phase 1b — `admin.ts`

**Steps**

- New `services/nb-bond-api/src/admin.ts`:
  ```ts
  export async function restartIngestionLoop(): Promise<void>
  export async function resetProjectionAndRestart(): Promise<void>
  ```
- `restartIngestionLoop()`:
  - Calls a new `stopIngestionLoop()` exported from `ingestion.ts` that `clearInterval`s the interval handle and sets `loopRunning = false`.
  - Then awaits `startIngestionLoopWithRetry()` (Plan B helper). Returns once `loopRunning` becomes true or a small timeout (5s) elapses — whichever first.
- `resetProjectionAndRestart()`:
  - Calls `stopIngestionLoop()`.
  - Opens a write DB handle, runs the `DROP TABLE IF EXISTS` block from `migrateToCurrentVersion` BUT excluding `bidders` (the system-of-record exception).
  - Re-creates the tables via `openDatabase` (which calls `createTables`).
  - Calls `startIngestionLoopWithRetry()`.

**Verification stop**

- Unit tests covering both paths. Critical: `bidders` table survives `resetProjectionAndRestart()`.

### Phase 1c — Route

**Steps**

- New `POST /v1/admin/restart-ingestion` handler in `index.ts`.
- Sits **after** the `authMiddleware` (under the auth gate). In `none` mode reachable from the browser; in `entra` mode requires a JWT.
- Reads `req.query.fromBlock`. If `=== '0'`, dispatch to `resetProjectionAndRestart()`; otherwise to `restartIngestionLoop()`.
- Returns `okResponse(req, res, getIngestionStatus())` (the post-restart status) on success.
- Maps any caught error to a 500 with descriptive `detail`.
- Add to `schemas.ts` under a new `admin` tag with the path declaration.
- `npm run regen:openapi` → snapshot updated.

**Verification stop**

- Live `curl -X POST` against each path; observe expected behaviour.

### Phase 1d — Backend tests

**Steps**

- New `services/nb-bond-api/tests/admin.test.ts` covering:
  - `restartIngestionLoop` calls stop then start with the retry helper.
  - `resetProjectionAndRestart` drops projection tables and preserves `bidders` (use the in-memory test DB pattern from `bidders.test.ts`).
  - 5s timeout falls through to 202 when the start blocks indefinitely (mock the retry helper to never resolve).
- Confirm: `npm test` green. `npm run lint` green. `npm run format:check` green. `npm run regen:openapi` produces no diff.

## Phase 2: Frontend

### Phase 2a — `healthApi.js`

**Steps**

- Extend `services/nb-ui/src/api/healthApi.js` with `restartIngestion({ fromBlock })`:
  ```js
  async function restartIngestion({ fromBlock } = {}) {
    const query = fromBlock === 0 ? { fromBlock: '0' } : {};
    if (isMockMode()) return MockClient.restartIngestion({ fromBlock });
    return HttpClient.post('/v1/admin/restart-ingestion', null, { query });
  }
  ```
- Extend `mockClient.js` with a stub returning the canned `ok` health snapshot.

### Phase 2b — `NetworkHealthModal`

**Steps**

- New `services/nb-ui/src/pages/NetworkHealthModal.jsx`.
- Polls `/v1/health` every 7s while open (re-uses the same logic as HealthBadge — extract into a shared `useHealthPoll` hook in `services/nb-ui/src/hooks/useHealthPoll.js`).
- Sections:
  - Chain: `rpcUrl`, `chainId`, `head`, `headReachable` (green ✓ / red ✗).
  - Ingestion: `loopRunning`, `lastBlockProcessed`, `lag`, `pollIntervalMs`, `lastTickAt` (formatted relative — "X seconds ago"), `lastEventTxHash` (short hex), `consecutiveFailures`.
  - Recent errors: table of `{ts, code, message}` from `recentErrors`. Empty state when none.
- Actions:
  - **Reconnect** button — calls `HealthApi.restartIngestion()`, toasts on success, refreshes the modal.
  - **Resync from block 0** button (danger variant) — opens `ConfirmResyncModal`.
- Refresh button — manual reload.
- Close button — standard modal close.

### Phase 2c — `ConfirmResyncModal`

**Steps**

- New `services/nb-ui/src/pages/ConfirmResyncModal.jsx`.
- The modal explains the action in three sections, plain language, so the operator can't miss what they're confirming:

  **What will happen:**
  - The local projection will be **DROPPED**: `auctions`, `auction_events`, `bond_events`, `balance_events`, `balances`, `partitions`, `ingestion_state`.
  - The bidder roster is **PRESERVED**: the `bidders` table is a system-of-record and is excluded from the reset (same rule as the schema migration).
  - On-chain state is **NOT AFFECTED**: bonds, auctions, bids, allocations on chain stay exactly where they are. The chain remains the source of truth.
  - The ingestion loop restarts from block 0 (or `START_BLOCK` env) and rebuilds the projection by replaying every chain log.

  **Expected duration:**
  - Today's sandbox (≤ a few hundred blocks): a few seconds.
  - The rebuild time is roughly linear in chain block count + number of log-bearing blocks. A long-running sandbox (10 k+ blocks) could take a minute or two.
  - The `HealthBadge` colour acts as the readiness signal — yellow while rebuilding, green when caught up.

  **While the rebuild is running:**
  - GET endpoints (`/v1/bonds`, `/v1/auctions`, `/v1/auctions/{id}`, `/v1/bonds/{isin}`) return **PARTIAL** data — only what's been re-ingested so far.
  - Bidder and Central Bank endpoints continue to work normally (their data is not part of the projection).
  - The `HealthBadge` reports `degraded` (yellow) while lag > 0, then flips to `ok` once caught up.
  - Don't draw conclusions about chain state until the badge is green again.

- A type-to-confirm input enables the destructive submit button only when the operator types `resync from block 0` exactly (case-insensitive, trimmed). Empty / mismatched input keeps the button disabled.
- On submit: `HealthApi.restartIngestion({ fromBlock: 0 })`. Toast on success: `"Resync started — projection will rebuild shortly"`. Close both modals.
- On error: toast with `e.message`; keep the modal open so the operator sees the error in context.

### Phase 2d — HealthBadge becomes clickable

**Steps**

- In `HealthBadge.jsx`, add `useState(false)` for `open`, wrap the pill in a `<button>` (preserving its visual), add `onClick={() => setOpen(true)}`.
- Render `<NetworkHealthModal open={open} onClose={() => setOpen(false)} />`.

### Phase 2e — Frontend tests

**Steps**

- Extend `services/nb-ui/tests/HealthBadge.test.jsx` to assert the click opens the modal.
- New `services/nb-ui/tests/NetworkHealthModal.test.jsx`:
  - Renders payload fields.
  - Reconnect button calls `MockClient.restartIngestion()`.
  - "Resync from block 0" disabled until phrase typed; enabled on match; calls `restartIngestion({ fromBlock: 0 })` on submit.

## Phase 3: Local apply + verification

### Steps

- `./services/nb-bond-api/nb-bond-api.sh start`
- `./services/nb-ui/nb-ui.sh start`
- Live verification:
  - Click the HealthBadge — modal opens with current state.
  - Click **Reconnect** — toast says reconnected, modal refreshes.
  - Click **Resync from block 0** — confirmation modal asks for the phrase.
    - Without the phrase, submit is disabled.
    - With the phrase, submit succeeds. Watch logs: projection tables drop, ingestion restarts, projection rebuilds.
  - Repeat the self-heal smoke from Plan B but use the **Reconnect** button instead of `kubectl rollout restart`.

### Verification Stop

- All ACs pass.

### Fix Iteration / Rollback

- `helm rollback nb-bond-api` and/or `nb-ui` if either pod regresses.
- A bricked projection from a botched reset is recoverable by re-running reset (the operation is idempotent) or `./sandbox.sh delete && start` as a last resort.

## Phase 4: Documentation + hygiene

### Steps

- `services/nb-bond-api/DEVELOPMENT.md` — new §7.x documenting the admin endpoint, its two modes, and the bidders-preservation rule.
- `docs/KNOWN_ISSUES.md` — possibly resolve the "request-path chain reads bubble up as opaque 500s" entry if the admin module's wiring effectively catches them; otherwise leave intact.
- `docs/DOCUMENTATION_INDEX.md` — entry for `docs/plans/network-health-modal-and-reconnect-plan.md`.
- Hygiene scripts both pass.

## Documentation And PR Plan

- **Single PR**: `feature/network-health-modal-and-reconnect` → `development`. Depends on Plan B's PR being merged first.
- PR body: Summary (1–3 bullets) + Test plan checklist.
- Commit: imperative, no AI attribution.
- Evidence: curl output of both admin endpoint paths, screenshots of the modal in three states (ok / degraded / down), test counts green.

## Residual Risks

- **Mid-reset state.** Between `dropProjection` and the next successful tick, GET endpoints (`/v1/bonds`, `/v1/auctions`) return empty arrays. Acceptable — the operator opted in via the confirmation. The modal's toast should remind them to wait while ingestion catches up.
- **Provider re-instantiation.** `restartIngestionLoop()` doesn't replace `provider` itself (it's a module-level const in `ingestion.ts`). If the JsonRpcProvider somehow holds bricked state, the reconnect doesn't help. We've verified in Plan B's testing that ethers' provider recovers internally on its own — but if a real bug surfaces, the fix is to expose a `provider.destroy(); provider = new JsonRpcProvider(...)` in the admin module. Document as a follow-up risk.
- **`bidders` exception is brittle.** The "drop everything except `bidders`" logic in `resetProjectionAndRestart()` is the second place the bidders-table-is-system-of-record rule shows up (the first being `migrateToCurrentVersion` in `ingestion-db.ts`). A future contributor adding a new system-of-record table needs to remember both places. Mitigation: add a single `getProjectionTableNames()` helper that both functions import.

## Done Criteria

- AC1–AC9 verifiable on the running sandbox.
- PR merged. Plan doc status → "Implemented".
- Operator can recover from any chain hiccup via the browser, no `kubectl` needed.
