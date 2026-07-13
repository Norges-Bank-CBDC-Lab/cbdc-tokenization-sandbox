# `sse-live-updates` — Implementation Plan

**Status:** Implemented in code; local gateway and Azure deployment verification pending
**Original date:** 2026-06-18
**Revised:** 2026-07-13
**Owner / operator:** sandbox operator (this repo)
**Branch suggestion:** `feature/sse-live-updates` — defer branch / commit / PR workflow to `sandbox-pr-workflow`.
**Components touched:** `services/nb-bond-api/` (authenticated SSE endpoint and in-process change broadcaster), `services/nb-ui/` (one authenticated fetch-stream client, transport-agnostic live-query reconciliation), and relevant documentation/runtime configuration.
**Related:** `docs/plans/cursor-reconcile-sync-plan.md` defines the server-authoritative query reconciliation primitive. If it lands first, this plan extends it; do not build a second competing callback/reconcile layer.

## Decision Summary

This plan implements SSE as a **notification transport**, not as a second data store, cache, or health system.

- A server event says which coarse resource groups may have changed.
- The UI re-runs the matching mounted query while retaining its ETag, so the existing request returns fresh `200` data or a cheap `304`.
- The client performs one coarse revalidation whenever the stream opens or reconnects. This is the correctness mechanism for missed events.
- The existing `/v1/health` poll stays unchanged. SSE transport failure is not treated as backend or chain failure.
- The first version has no replay buffer and does not use `Last-Event-ID`. Those are optional SSE experiments, not prerequisites for correct live updates.
- One `fetch()` + `ReadableStream` SSE client works in both auth modes: no header in local `none` mode; a fresh MSAL bearer header on every connection/reconnect in `entra` mode.
- `/v1/events` sits behind the existing `authMiddleware` and baseline recognized-role gate. Those middlewares no-op in `none` mode and enforce Entra authentication/authorization in Azure.
- Request-path projection work is removed from this plan. A chain-backed GET is still pushable; it only needs a reliable notification trigger.

## Goal

The UI currently fetches page data on mount and on explicit/manual reload. It does **not** poll every page. The only recurring fetch is the Phase-0-hardened 7-second `/v1/health` poll. Several same-tab mutation paths still perform an immediate reload plus a delayed four-second reload to race the three-second ingestion tick, while another tab can remain stale indefinitely.

Add `GET /v1/events`, a Server-Sent Events stream that tells nb-ui when data becomes readable. One app-level authenticated fetch stream per browser tab drives ETag-preserving query reloads in both the local sandbox and the Entra-protected Azure deployment. Supported mutations in one tab should appear in another tab without a manual page refresh.

The initial supported demonstrations are:

- create/close/cancel/finalise an auction or change a bond lifecycle state;
- submit a bid;
- mint, burn, transfer, or allowlist WNOK;
- mutate bidder, banking/TBD, registry, or operation-audit state through nb-bond-api.

Direct contract calls made outside nb-bond-api are live only when they touch contracts already watched by the ingestion loop. Expanding contract watchers is deliberately not required for the first sandbox implementation.

## Current-State Evidence

Verified against the repository on 2026-07-13:

- `services/nb-ui/src/hooks/useHealthPoll.js` contains the only recurring data timer. It polls `/v1/health`, pauses while hidden, probes on refocus, and backs off while down. Phase 0 has landed.
- Page queries use `useApi(...)`, which fetches on mount/dependency change and exposes `reload()`. Current delayed ingestion-race reloads exist in `AuctionsPage` and `CouponPayoutPage`; `Layout` still uses a full browser reload after reconnect.
- `services/nb-ui/src/api/httpClient.js` caches `{ etag, body }` by full URL. A query reload retains the cache entry, sends `If-None-Match`, and consumes `304` from cache. Deleting the entry before reload would force a full `200`, so SSE must **not** invalidate this cache.
- React StrictMode is enabled in `src/main.jsx`; stream ownership must therefore sit in one app-level provider with correct effect cleanup rather than in individual pages.
- The ingestion loop watches `BondManager` and `BondToken`, persists their handled changes, and advances its checkpoint only after `processBlockRange(...)` completes. It does **not** watch `BondAuction`, WNOK, GlobalRegistry, or dynamically created TBD contracts.
- Auction DTOs are hybrid: the auction row/lifecycle history comes from SQLite, while bids, status, allocations, and other state are read live from `BondAuction`. WNOK, bidders, registry, and banking also include request-path/system-of-record data.
- Mutation helpers wait for transaction receipts before returning for bid, WNOK, and TBD operations. That makes successful API completion a valid notification point for their live-read resources.
- `withOperationRecording(...)` writes the operations audit trail for both successes and failures, so an operations-page notification belongs at the recording seam rather than only on successful chain transactions.
- Browser `fetch`, `ReadableStream`, `AbortController`, `TextDecoder`, and MSAL's existing auth seam provide everything required; the implementation needs no new dependency. Native `EventSource` is not used because it cannot attach the current bearer header.

## Resource-Key Contract

Use a deliberately small, coarse vocabulary:

| Key | Mounted queries it may reload | Primary publisher |
|---|---|---|
| `bonds` | bond list/detail, coupon payout | ingestion after committed BondManager/BondToken projection changes |
| `auctions` | auction list/detail and bond auction subtrees | ingestion for lifecycle changes; successful bid route for new bids |
| `bidders` | bidder list/balances | bidder create/delete; WNOK balance-affecting API operations |
| `central-bank` | central-bank summary and WNOK allowlist | successful WNOK operations |
| `banking` | bank roster and TBD summaries/details | successful bank/TBD operations; WNOK operations that affect reserves |
| `registry` | global registry page | successful bank/registry-changing operations |
| `operations` | operator audit trail | every recorded operation attempt, including failures/reverts |

Keys identify what should be revalidated; they are not event-sourced domain facts. Duplicate keys are removed before publishing. Unknown keys received by the client are ignored.

## Event Sources And Readiness Rule

Publish only when the corresponding GET can observe the new state.

1. **Projected bond/auction lifecycle data:** `processBlockRange(...)` returns a `changed` set derived only from event branches that actually update the SQLite projection. After the database transaction and checkpoint save succeed, the ingestion tick publishes one `changed` SSE event. Merely advancing `lastBlockProcessed` publishes nothing.
2. **Live-chain or system-of-record data:** after a successful API mutation has completed and its receipt/local write is available, the request path publishes the relevant keys. Examples: bid submission publishes `auctions`; WNOK mint publishes `central-bank`, `bidders`, and `banking`; bidder creation publishes `bidders`.
3. **Operation audit trail:** the operation-recording seam publishes `operations` after its SQLite record succeeds, including failed/reverted attempts. A failure to record remains swallowed as today and therefore emits no misleading notification.

Do not publish projected `bonds`/auction-lifecycle changes immediately from their mutation route: the projection may not have ingested the receipt yet, which would recreate the stale-refetch race SSE is intended to remove.

## Scope

### In Scope

- Authenticated `GET /v1/events` using `text/event-stream`, mounted behind the existing baseline auth/recognized-role middleware (open locally because that middleware no-ops in `none` mode).
- A small in-process broadcaster with typed/coarse `changed[]` events and subscriber cleanup.
- A lightweight comment heartbeat (`: heartbeat`) to keep the local gateway connection active. It carries no health payload.
- One app-level `fetch()` stream per tab, with a fresh `auth.getAuthHeader()` result applied on every Entra connection/reconnect.
- Targeted mounted-query reloads during a continuous connection and a coarse mounted-query revalidation on every `open`/reconnect.
- Existing ETag/`If-None-Match` behavior unchanged.
- Existing `/v1/health` poll unchanged.
- Explicit runtime disable switch for debugging/fallback.
- Unit tests, local two-tab verification, OpenAPI/docs, and public-repository checks.

### Out Of Scope

- Replacing or modifying the `/v1/health` poll.
- Treating SSE connection state as backend/chain health.
- `Last-Event-ID`, replay buffers, browser-side event stores, offline queues, or client-side domain merging.
- Projecting bidder, WNOK, allowlist, auction, registry, or TBD request-path reads into SQLite.
- Resolving the broad KNOWN_ISSUES item about opaque RPC 500 responses.
- Detecting every direct external contract call. The first version guarantees notifications for ingestion-watched events and supported nb-bond-api mutation paths.
- Per-event role filtering. Any recognized role may subscribe to coarse change keys; the subsequent resource GET keeps its existing endpoint authorization.
- Azure/GitOps proxy implementation, multi-replica fan-out, SharedWorker/Web-Locks multi-tab dedup, or `eth_subscribe('newHeads')`. Azure buffering/timeouts and authenticated-stream verification are requirements for the deployment repo, not code changes in this repo.
- New packages, contracts, genesis, Kind topology, hostnames, or fixtures.

## Wire Contract

Normal change event:

```text
event: changed
data: {"changed":["auctions","operations"]}

```

Keepalive:

```text
: heartbeat

```

The payload contains coarse resource keys only. Transaction hashes, addresses, entity IDs, values, errors, health snapshots, and resource data stay out of the stream; the client obtains data through the normally authorized GET endpoints.

On every successful streaming response, including reconnect, the client triggers one coarse reconciliation of mounted live queries. No replay guarantee is claimed.

## Acceptance Criteria

| Criterion | Verification |
|---|---|
| Stream works through the local gateway | `curl -N http://bond-api.cbdc-sandbox.local/v1/events` stays open and prints heartbeat comments plus `event: changed` after supported activity |
| ETags are preserved | SSE causes query `reload()` without clearing `httpClient` cache; unchanged targeted queries may return `304`, changed queries return fresh `200` |
| Projected updates publish after ingestion | Auction/bond lifecycle change in tab A appears in tab B after the ingestion commit, with no delayed UI timer |
| Bid updates are covered | A successful bid submission publishes `auctions`; an open auction in tab B shows the new sealed bid after refetch |
| WNOK/banking updates are covered | Successful supported API operations publish the documented `central-bank` / `bidders` / `banking` keys and tab B refreshes |
| Reconnect self-heals | Disconnect/reconnect the stream; `open` causes one coarse ETag revalidation of mounted live queries even though no replay buffer exists |
| Health remains truthful | Breaking only the SSE path does not mark the backend `down`; `HealthBadge` continues to use `/v1/health` |
| Entra authentication works | In `none` mode the stream opens without a token; in `entra` mode no/invalid token returns `401`, an unrecognized role returns `403`, and a recognized user opens the stream with the bearer header |
| Reconnect renews auth | Every Entra reconnect calls the existing auth provider again; `401` follows the session-expired flow, `403` stops reconnecting, and sign-out aborts the active stream |
| Azure gateway streams | Response buffering is disabled and the gateway request/idle timeout exceeds the heartbeat interval, so heartbeat/event bytes arrive incrementally rather than in batches |
| No quiet refetch storm | Heartbeat comments and idle blocks do not reload page queries |
| No new dependency | Service dependency manifests are unchanged |

## Plan Order

```text
Phase 0  Refresh baseline and reconcile dependency
Phase 1  Backend broadcaster, SSE route, and event publishers
Phase 2  Frontend app-level client and live-query integration
Phase 3  Local and Entra/Azure end-to-end verification
Phase 4  Documentation and public-repository hygiene
Optional  Replay, health-over-SSE experiment, more contract watchers
```

## Phase 0: Baseline And Reconcile Decision

### Steps

- Record green nb-bond-api and nb-ui test/lint/build baselines.
- Confirm the Phase-0 health-poll behavior remains present.
- Check whether `cursor-reconcile-sync-plan.md` has landed:
  - if yes, extend its `SyncProvider` / `useLiveQuery` rather than introducing another query registry;
  - if no, implement the same transport-agnostic provider shape in this work and mark the overlapping cursor plan as superseded before merge.
- Inventory every current mutation route and assign resource keys using the table above. Treat unassigned mutations as a plan failure, not an implicit `invalidate-all` fallback.
- With the sandbox running, capture the current same-tab delayed reload and cross-tab stale behavior for PR evidence.

### Exit Criteria

- One query-reconciliation owner is chosen; event coverage is explicit; baselines are green.

## Phase 1: Backend SSE And Publishers

### Scope

- New `services/nb-bond-api/src/live-events.ts`.
- `src/app.ts` for the route and request-path publishers.
- `src/ingestion.ts` for post-commit projected-resource publishing.
- `src/operations.ts` for the audit-trail notification seam.
- `src/env-vars.ts`, `src/schemas.ts`, generated `openapi.json`, and tests.

### Steps

1. **Broadcaster:** implement a typed module containing `ResourceKey`, `publishChanged(...)`, `subscribe(...)`, subscriber count/cleanup, SSE serialization, and duplicate-key removal. Keep it dependency-free and synchronous.
2. **SSE route:** register `/v1/events` after `authMiddleware` and `requireAnyRole(recognizedRoles)`. Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `X-Accel-Buffering: no`; call `res.flushHeaders()`; write the initial stream bytes; subscribe; and unsubscribe on request close. In `none` mode the existing middleware no-ops; in `entra` mode it validates the bearer token and recognized role before headers are flushed.
3. **Heartbeat:** use one process-level interval to write `: heartbeat\n\n` to current subscribers. Start it lazily for the first subscriber and stop it after the last subscriber so an unused API performs no heartbeat work. Add only `NB_BOND_API_SSE_HEARTBEAT_MS` (default 15000); there is no buffer-depth setting.
4. **Keep the limiter:** a held stream is one request. Do not exempt `/v1/events`; test reconnect behavior instead. The existing 300/minute limit is ample for bounded client reconnects. The Azure deployment should separately cap concurrent connections because a request-rate limit does not bound long-held sockets.
5. **Ingestion publisher:** have `processBlockRange(...)` return the set of resource keys actually affected by handled/persisted events. Publish once after the database transaction and checkpoint save. A block/checkpoint advance with an empty set is silent.
6. **Request publishers:** after successful, readable mutation results, publish the table's keys. Keep this mapping close to route/operation semantics rather than inferring it from URL prefixes.
7. **Operations publisher:** notify `operations` only after `recordOperationAttempt(...)` succeeds, for both success and failure rows.
8. **OpenAPI:** document the `text/event-stream` endpoint and `changed` payload under the normal bearer security scheme. It is intentionally not a public `security: []` route.

### Verification

- Broadcaster fan-out, duplicate removal, exact SSE framing, disconnect cleanup, and lazy heartbeat lifecycle.
- Ingestion handled event -> correct keys once; irrelevant/unhandled log or empty block advance -> no event; publish occurs only after successful persistence.
- Bid, WNOK, bidder, banking, registry, and operation-recording seams publish their documented keys.
- `none` permits the route without a token; `entra` returns `401` for missing/invalid tokens, `403` for unrecognized roles, and streams for recognized roles.
- `npm test`, `npm run lint`, `npm run format:check`, and `npm run build`/typecheck pass.

## Phase 2: Frontend Live-Query Integration

### Scope

- App-level live-update provider/client under `src/sync/` or `src/live-updates/`.
- Existing/new `useLiveQuery` integration on live pages.
- Runtime config in `src/config.js`, `public/config.js`, `public/config.template.js`, Helm values, and the runtime ConfigMap.
- Tests with mocked streaming `fetch` responses and the existing auth seam.

### Steps

1. **Single owner:** mount one provider after the UI auth gate. Its effect creates exactly one streaming fetch, survives React StrictMode mount/cleanup correctly, and aborts via `AbortController` on provider unmount, sign-out, account change, or intentional disable.
2. **Authentication:** before every connection/reconnect, call the existing `auth.getAuthHeader()`. Send it as `Authorization` when present; `none` mode naturally sends no header. Never place a token in the URL, logs, event payload, or runtime config.
3. **Streaming parser:** require a successful `text/event-stream` response, consume `response.body.getReader()` with `TextDecoder`, and correctly handle split chunks/UTF-8 sequences, comments, blank-line delimiters, event names, and multiple `data:` lines. Validate that `changed` is an array; ignore malformed JSON and unknown keys without killing the loop.
4. **Reconnect/auth state:** reconnect transient network/5xx failures with bounded exponential backoff plus jitter and reacquire the auth header first. On `401`, hand control to the existing session-expired/renewal flow rather than hammering. On `403`, stop automatic reconnect because retrying cannot change roles.
5. **Reconnect reconciliation:** on every successful streaming response, bump one global reconciliation generation so all mounted live queries reload once. This covers connection gaps, server restart, and any future replay-buffer overflow without client-side event replay.
6. **Preserve ETags:** call query `reload()` only. Do not add `HttpClient.invalidate(...)` and do not call `clearCache()` from SSE handling.
7. **Adopt pages:** bind current live queries to resource keys. A query may subscribe to multiple keys, for example a bond detail that embeds auctions. Remove delayed `setTimeout(reload, 4000)` calls only after the matching backend publisher is covered and verified. Retain manual Refresh buttons.
8. **Keep health separate:** leave `useHealthPoll` and `HealthBadge` unchanged. If stream status is displayed at all, label it as live-update transport state, not network health.

### Verification

- StrictMode does not leave duplicate streams, readers, abort controllers, or listeners.
- `none` connects without Authorization; `entra` obtains and attaches the existing MSAL bearer header on every connection/reconnect.
- Parser tests cover split chunks, comments, multiple data lines, malformed JSON, EOF, abort, and unknown events.
- `401` does not reconnect-loop, `403` stops reconnecting, transient errors back off, and sign-out aborts immediately.
- `changed` reloads only matching mounted queries; unknown/malformed messages do nothing.
- `open`/reopen produces exactly one coarse reconciliation per connection.
- Reload retains the existing ETag cache and sends `If-None-Match`.
- `LIVE_UPDATES=false` creates no stream and preserves existing UI behavior.
- Unmount aborts the stream and removes subscriptions.
- `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` pass.

## Phase 3: Local And Entra/Azure End-To-End Verification

Operator-driven; commands that mutate the cluster require the operator's normal approval/workflow.

### Steps

- Deploy nb-bond-api and nb-ui through their existing start scripts.
- Confirm `/v1/events` streams immediately through NGINX Gateway Fabric without buffering.
- In two tabs verify:
  - auction creation/lifecycle update after ingestion;
  - bid submission via request-path notification;
  - WNOK mint/transfer and banking summary refresh;
  - operation audit rows for both a successful and a deliberately rejected operation.
- Inspect the network panel: changed data returns `200`; broader/unchanged revalidations may return `304`; no SSE handler clears the cache.
- Restart only the SSE/API connection and confirm open-time reconciliation recovers current state.
- Disable `LIVE_UPDATES` and confirm manual reload plus the unchanged health poll continue to work.
- Confirm idle heartbeat comments produce no page-data requests.
- In the Entra-protected Azure deployment, verify unauthenticated `401`, unrecognized-role `403`, recognized-user streaming, token reacquisition on reconnect, and immediate abort on sign-out.
- In the Azure deployment repo, disable Application Gateway response buffering, set the backend request/idle timeout above the heartbeat interval, avoid stream-body logging, and keep nb-bond-api at one replica until shared fan-out is deliberately designed.

### Exit Criteria

- Supported two-tab flows update without manual refresh or delayed UI timers; reconnect self-heals; health remains independent; pods stay steady.

## Phase 4: Documentation And Hygiene

### Steps

- `docs/ARCHITECTURE.md`: document notification -> ETag revalidation, explicit event sources, reconnect reconciliation, and the authenticated Entra trust boundary.
- `services/nb-bond-api/DEVELOPMENT.md` and `README.md`: document `/v1/events`, `NB_BOND_API_SSE_HEARTBEAT_MS`, event keys, normal bearer/role protection, and gateway buffering.
- `services/nb-ui/DEVELOPMENT.md`: document the fetch-stream provider, MSAL reconnect behavior, `useLiveQuery`, `LIVE_UPDATES`, ETag preservation, and health separation.
- Runtime configuration: document and wire `LIVE_UPDATES` through all existing config/template/Helm seams.
- `docs/AZURE_BOUNDARY.md`: make response buffering, timeout/heartbeat alignment, stream-body logging, single-replica delivery, and authenticated-stream verification explicit deployment-repo requirements; do not implement the Azure resources here.
- Update `docs/DOCUMENTATION_INDEX.md` and archive/supersede the overlapping cursor plan if Phase 0 chose to absorb it.
- Run public-repository hygiene and Markdown-link checks.

## Residual Risks

- **Unwatched direct contract calls:** calls outside nb-bond-api to BondAuction, WNOK, registry, or TBD may not notify the UI. This is an explicit sandbox limitation; reconnect/manual refresh still reconciles current state.
- **Route mapping drift:** a new mutation can be added without a resource-key publisher. Mitigate with a route inventory in Phase 0, a documented mapping, and tests beside each mutation family.
- **Proxy buffering:** response headers help, but the local gateway smoke test is authoritative. Cloud proxy configuration remains outside this repo.
- **Missed events during disconnect:** no replay is promised. Reconnect performs a coarse ETag revalidation, which restores correct materialized state.
- **Entra reconnect/session state:** a long-lived connection is authenticated at connect time; token renewal applies on reconnect. The client must reacquire through the existing auth provider and avoid `401`/`403` reconnect loops.
- **Public-endpoint/resource exhaustion:** the route is intentionally authenticated even though its coarse keys are low sensitivity. Azure still needs a concurrent-connection cap because request rate limiting alone does not bound held sockets.

## Optional Follow-Ups

Only add these when the sandbox specifically needs to test them:

- bounded `Last-Event-ID` replay, with an explicit reset/resync signal on buffer miss or process restart;
- health snapshots over SSE, while keeping transport health distinct from backend/chain health;
- more contract watchers for direct external BondAuction/WNOK/registry/TBD calls;
- periodic proactive reconnect if Azure testing shows that role/token changes need to take effect before a naturally occurring disconnect;
- WNOK/bidder/TBD projection and RPC-error translation as separate availability work;
- SharedWorker/Web-Locks connection dedup;
- `eth_subscribe('newHeads')` as an ingestion transport change.

## Done Criteria

- `GET /v1/events` streams heartbeat comments and coarse `changed` events in local `none` mode and authenticated Entra mode with no new dependency.
- Supported ingestion and request-path mutations publish only after the affected GET can observe their state.
- nb-ui owns one stream per tab, reloads matching mounted queries without clearing ETags, and reconciles all mounted live queries on reconnect.
- `/v1/health` polling and health semantics remain unchanged.
- `none` mode works without a token; `entra` mode authenticates recognized users with the existing MSAL bearer flow and rejects missing/invalid/unrecognized credentials.
- Delayed reload timers are removed only for covered flows; manual refresh remains.
- Unit suites, lint, format, build/typecheck, local gateway/two-tab verification, documentation, public-repository hygiene, and Markdown links are green.
