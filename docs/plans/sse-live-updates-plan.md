# `sse-live-updates` — Implementation Plan

**Status:** Planned
**Date:** 2026-06-18
**Owner / operator:** sandbox operator (this repo). Cloud/GitOps portability items are flagged for the separate deployment repo, not executed here.
**Branch suggestion:** `feature/sse-live-updates` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`.
**Components touched:** `services/nb-bond-api/` (new `GET /v1/events` SSE endpoint fed by the existing ingestion loop; optional request-path-read fold-in; schemas/env-vars), `services/nb-ui/` (native `EventSource` client; invalidate-and-refetch on push; collapse the health poll into the stream heartbeat with the Phase-0 poll kept as fallback), `docs/` (ARCHITECTURE, KNOWN_ISSUES, per-service DEVELOPMENT, AZURE_BOUNDARY, DOCUMENTATION_INDEX).
**Related:** the client reconcile layer is specced separately in `docs/plans/cursor-reconcile-sync-plan.md` — it ships first on the existing health poll and replaces the crude `window.location.reload()` reconnect; this stream is a later transport for the same event cursor.

> Mirrors the header block and phased structure of `docs/plans/role-based-access-control-plan.md` and `docs/plans/archive/nb-ui-frontend-plan.md`. Update `Status:` as the plan progresses (`Planned` → `Approved` → `✅ Implemented and shipped`); when shipped, move this file to `docs/plans/archive/`.

## Goal

Today the operator UI stays current by **polling**: every page re-fetches its slice on a timer, and a separate 7s `/v1/health` poll (`services/nb-ui/src/hooks/useHealthPoll.js:17`) drives the top-bar `HealthBadge`. That works but is wasteful (most responses are unchanged 304s) and laggy (a new auction or balance change is invisible until the next tick, typically 3–4s after the backend has already ingested it).

This plan replaces the *trigger* for refresh with a **push**: a single `GET /v1/events` Server-Sent Events stream on nb-bond-api, fed by the **existing** ingestion loop, which already knows the exact tick on which a block/event landed (`services/nb-bond-api/src/ingestion.ts:744-745`). When the loop advances `lastBlockProcessed` / `lastEventTxHash`, it emits a small SSE message naming the resource keys that changed; nb-ui's single native `EventSource` client invalidates the matching ETag cache entry and re-fetches **only** the affected resource (which is mostly a cheap 304 if nothing it cares about moved). A periodic heartbeat carries the health snapshot and keeps the connection alive, so the standalone `/v1/health` poll collapses into the stream — a dropped connection means "down". The local sandbox (`AUTH_MODE=none`) gains live updates with **no new runtime dependency** (SSE is plain HTTP server-side; `EventSource` is native in the browser) and the existing poll-based path stays as the fallback for when SSE is unavailable.

When done, after `./sandbox.sh start`: creating an auction / placing a bid / minting WNOK in one tab is reflected in another tab within roughly one ingestion tick **without** a manual refresh or a full-cadence poll, and the `HealthBadge` reflects connection state from the stream.

This builds directly on **Phase 0** (Page Visibility gating + backoff on the 7s `useHealthPoll.js` health poll), which is being implemented separately and is a prerequisite/companion — this plan does **not** re-plan Phase 0 and assumes the polled health path it hardens remains in place as the SSE fallback.

## Current-State Evidence

What was inspected and what was actually verified this session.

- **Docs read:** `.claude/skills/sandbox-implementation-planner/{SKILL.md, templates/implementation-plan.md, references/planning-workflow.md, references/project-context.md}`; `docs/plans/role-based-access-control-plan.md`; `docs/plans/archive/nb-ui-frontend-plan.md`; `docs/DOCUMENTATION_INDEX.md`; `docs/KNOWN_ISSUES.md`; `docs/AZURE_BOUNDARY.md`.
- **nb-ui declarations inspected:**
  - `src/hooks/useHealthPoll.js:17,41,64` — `DEFAULT_POLL_INTERVAL_MS = 7000`; `setInterval(fetchOnce, intervalMs)`; on failure collapses to a frozen `DOWN_SHAPE`; `reload()` re-fetches immediately. Consumed by `src/components/HealthBadge.jsx:57` (which also feeds `NetworkHealthModal`).
  - `src/api/httpClient.js:53,77-93,100-108,122` — in-memory `cache = Map<url, {etag, body}>`; GETs send `If-None-Match`, a `304` short-circuits to the cached body; any mutation calls `cache.clear()`; `clearHttpCache()` / `HttpClient.clearCache` exposed for "force refresh". **Cache key is the full URL** (one entry per URL+query), not per-resource-type.
  - `src/hooks/useApi.js:17,43` — `useApi(fetcher, deps)` exposes `reload()` (bumps an internal `tick` to re-run the effect). The data lives in component state, so clearing the httpClient cache alone does **not** update a mounted page — a `reload()` (or remount) is required.
  - `src/api/{bondsApi,auctionsApi,biddersApi,centralBankApi,healthApi,selectors}.js` — the fetch surface. The **primary cache is the bulky tree** `GET /v1/bonds` (`bondsApi.js:18-22`); pages slice it via `selectors.js`. Separate URL cache entries: `GET /v1/bonds/{isin}`, `GET /v1/auctions`, `GET /v1/auctions/{id}`, `GET /v1/bidders`, `GET /v1/central-bank`, `GET /v1/central-bank/allowlist`, `GET /v1/health`. `getHealth()` notes `/v1/health` "bypasses backend auth (per OpenAPI security: [])".
  - Fetching pages under `src/pages/`: `BondsPage`/`BondDetailPage`/`AuctionsPage`/`BiddersPage`/`CreateAuctionModal`/`PlaceBidModal` all use `useApi(() => …, [])` and several already do the post-mutation `reload(); setTimeout(reload, 4000)` double-pump to race the 3s ingestion tick (`AuctionsPage.jsx:80-84`, `BondDetailPage.jsx:88-92`) — the exact latency SSE removes.
  - `src/components/Layout.jsx:37-42` — the modal's reconnect path uses a full `window.location.reload()` because component state holds stale fetches; a comment there spells out why clearing the cache alone is insufficient.
  - Deps (`package.json`): runtime deps are only `@azure/msal-browser`, `react`, `react-dom`; test script is `vitest run`. **No `EventSource`/SSE code exists today** (`grep` over `src/`+`tests/` is empty). `EventSource` is a browser built-in, so the baseline client needs **no new dependency**.
- **nb-bond-api declarations inspected:**
  - `src/ingestion.ts` — the 3s block-poll loop. `tick()` (`:729-753`) reads `provider.getBlockNumber()`, computes a window (`computeIngestionWindow`), calls `processBlockRange(...)`, then on success sets `lastBlockProcessed = to` (`:744`), `lastEventTxHash = latestTxHash` (`:745`), `consecutiveFailures = 0`, saves the checkpoint (`saveCheckpoint`, `:742`). `processBlockRange` returns `{ latestTxHash }` (`:688`) and is where event *names* are decoded (auction init/closed/finalised/cancelled, coupon, redemption, bond created/disabled, token issue/redeem/transfer). `POLL_INTERVAL_MS` default `3000`; `getIngestionStatus()` (`:85`) is the same snapshot `/v1/health` serves. `startIngestionLoopWithRetry()` (`:783`) wraps boot in backoff.
  - `src/index.ts` — plain Express via `app.listen(port, …)` (`:1321`). Middleware order: `express.json()` → `helmet()` → `cors({ exposedHeaders: ['ETag'], credentials: false, … })` (`:118-126`) → `rateLimit({ windowMs: 60_000, limit: 300 })` (`:132-139`). **Unauthenticated routes mounted BEFORE the auth gate**: `/docs`, `/v1/openapi.json`, `/v1/health` (`:159-235`). The gate boundary is `app.use(authMiddleware)` (`:243`), then baseline `app.use(requireAnyRole(recognizedRoles))` (`:249`), then `app.use('/v1/admin', requireAnyRole(operatorRoles))` (`:258`) and `app.use('/v1/central-bank', requireAnyRole(operatorRoles))` (`:1092`). Error middleware at `:1308`.
  - **Request-path chain reads** (the read surface that is NOT yet DB-served, so not yet pushable, and the source of the KNOWN_ISSUES 500): `GET /v1/bidders` does live `provider.getBalance(...)` + `wnok.balanceOf(...)` per bidder (`index.ts:916-920`); `GET /v1/central-bank` does `Promise.all([balance, allowlist])` on-chain (`:1124`); `/v1/central-bank/allowlist` (`:1146`) and the bond holders fallback (`:1294`, `bondToken.balanceOfByPartition`) likewise hit chain. Other GETs (`/v1/bonds*`, `/v1/auctions*`) compose from the read-only `historyDb` (`composeAllBonds`/`composeBond`, `index.ts:309,322`).
  - `src/auth.ts` — `authMiddleware` is a no-op in `none` mode and per-request `jwtVerify` (JWKS + `iss` + `aud`) in `entra` mode (`:79-115`); it reads the bearer from the `Authorization` header (`extractBearer`, `:63-70`). `requireAnyRole(allowed)` (`:123-140`) no-ops in `none` mode, else 403 unless `res.locals.authRoles` intersects `allowed`. **`EventSource` cannot set an `Authorization` header** — relevant to the auth Open Question.
  - `src/health.ts` — pure status derivation (`deriveStatus`, `computeLag`, `sanitiseRpcUrl`); thresholds: `down` if chain unreachable / loop not running / last tick > 60s; `degraded` if lag > 5 blocks / `consecutiveFailures > 0` / last tick > 30s. Same logic the heartbeat will reuse.
  - `src/schemas.ts:531-638` — the `Health` Zod/OpenAPI schema (`HealthContracts`, `HealthChain`, `HealthIngestion`, `Health`). New SSE event payloads need their own schema entries here.
  - `src/http.ts:41-55` — `okResponse()` stamps `ETag` + `Cache-Control: no-cache, must-revalidate`; `withMd5()` stamps a per-subtree `md5`. This is the ETag the SSE invalidation must cooperate with: a push tells the client *which URL to revalidate*, and the existing `If-None-Match`/304 path does the rest cheaply.
  - `src/env-vars.ts` — Zod-validated env with `POLL_INTERVAL_MS` (`:27`), `CORS_ALLOWED_ORIGINS` (`:38`), `NB_BOND_API_AUTH_MODE` + entra fail-fast (`:44,73-94`). New SSE knobs (heartbeat interval, ring-buffer depth) follow this pattern.
- **CI workflows present** (`.github/workflows/`): `image-hash-inputs.yml`, `license-inventory.yml`, `nb-bond-api.yml`, `nb-ui.yml`, `node-version-consistency.yml`, `publication-hygiene.yml`, `test-contracts.yml`.
- **Live local checks: BLOCKED — local sandbox is down.** The Docker daemon is not running (`kind get clusters` and `docker ps` fail with `dial unix …docker.sock: no such file`; kube context is `kind-cluster-cbdc-monoledger` but unreachable). This does **not** block planning or the unit-test validation surface, but **Phase 0 live verification and the Phase 4 end-to-end stop must be run by the operator after `./sandbox.sh start`.**
- **Local validation entry points the plan uses:** `cd services/nb-bond-api && npm test` (jest); `cd services/nb-ui && npm test` (`vitest run`) + `npm run lint` + `npm run build`; `helm template` for both charts if any chart value is added; `curl -N http://bond-api.cbdc-sandbox.local/v1/events`; `python3 scripts/verification/{check-public-repo-hygiene.py,check-markdown-links.py}`.

## Scope

### In Scope

- **nb-bond-api `GET /v1/events`** (`text/event-stream`), mounted **before** the auth gate (alongside `/v1/health`) for the `none`-mode local default, fed by the existing ingestion loop via a tiny in-process broadcaster. Each tick that advanced `lastBlockProcessed`/`lastEventTxHash` emits one `ingested` event carrying `{ block, txHash, changed: [resource keys] }`; a periodic heartbeat carries the health snapshot. SSE `id:` + `retry:` fields are set; `Last-Event-ID` is honoured for a bounded reconnect catch-up from an in-memory ring buffer.
- **nb-ui single native `EventSource` client** (baseline: one stream per tab). On a `changed` event it invalidates the matching `httpClient` ETag entry/entries (a small `changed-key → URL` map) and triggers a `reload()` of the affected mounted query — turning the post-mutation `reload(); setTimeout(reload, 4000)` double-pump into an event-driven single refetch (mostly 304s).
- **Collapse the `/v1/health` poll into the heartbeat:** `HealthBadge` reads health from the stream's heartbeat; stream connectivity (open / error / `retry`) drives the up/down state. The **Phase-0-hardened polled path is kept as the fallback** when SSE is unavailable or disabled.
- **Companion backend hygiene (own phase; deferral allowed):** fold the request-path chain reads (`/v1/bidders` balances; `/v1/central-bank` allowlist + balance) into the SQLite projection so the **whole** read surface is DB-served and therefore pushable, and emit `changed` keys for them. This also **resolves the KNOWN_ISSUES "request-path chain reads bubble up as opaque 500s" item** (the read no longer touches chain on the hot path).
- Unit tests on both tiers; docs + portability-flag + KNOWN_ISSUES updates; `none`-mode-still-works proof.

### Out Of Scope

- **Re-planning Phase 0** (Page Visibility gating + backoff on the 7s health poll). It is a prerequisite/companion landing separately; this plan only references it as the SSE fallback.
- **Azure / ArgoCD deployment wiring.** Per `docs/AZURE_BOUNDARY.md`, the cloud side lives in the separate deployment repo. SSE imposes real proxy constraints (response buffering off, idle-timeout, multi-replica fan-out) — these are **flagged as portability constraints** (see "Portability Flags") and must be satisfied *there*, not implemented here. All nb-bond-api / nb-ui code stays env-driven and portable; the plan target is local-first.
- **The optional SharedWorker / Web-Locks multi-tab dedup** (hold one `EventSource` in a leader tab shared across tabs). Raised as an Open Question; default is to **defer** and ship one-stream-per-tab first.
- **The `eth_subscribe('newHeads')` migration** (replace the 3s block-poll with a push subscription from Besu). Raised as an Open Question; default is a **follow-up**, because the SSE surface is identical whether the loop is poll-fed or subscription-fed.
- **No new dependency.** SSE is plain HTTP on the server and `EventSource` is native in the browser. If any phase appears to need a new npm package, **stop and ask the operator** (per root `AGENTS.md`).
- Any change to contracts, genesis, Kind config, hostnames, or the local fixture set.

## Decisions And Open Questions

The blocking design uncertainties below should be resolved (or explicitly accepted as defaults) **before Phase 1**. The defaults are chosen to be the smallest safe local-first step; none of them is safe to hide inside the implementation.

| Decision | Options | Recommendation (default) | Needed from operator |
|---|---|---|---|
| **SSE auth in `entra` mode** | (a) mount `/v1/events` before the auth gate and rely on it being closed by the cloud proxy / a future query-param token; (b) short-lived token via query param consumed by a custom SSE-only auth check (since `EventSource` can't send `Authorization`); (c) cookie-based session; (d) fetch-based SSE reader (`fetch` + `ReadableStream`) that *can* send `Authorization` | **Local-first default:** mount before the gate like `/v1/health` (opens unauthenticated in `none` mode). **Flag entra as an Open Question** — do not silently pick a token scheme. If/when entra is needed, (d) fetch-based reader is the cleanest (keeps the existing Bearer flow) but drops native `EventSource` reconnect; (b) query-param token is simplest but must avoid logging the token. | **Yes** — which entra strategy, and whether `/v1/events` should ever carry data that the baseline role gate must protect (if so it cannot sit before the gate). |
| **Event granularity** | (a) per-resource `changed: ["bonds","auctions:0xab…","central-bank"]` keys; (b) a single coarse `"invalidate-all"` signal that just nudges the UI to refetch its visible queries | **(a) per-resource keys**, but **coarse-grained** (resource-type level, e.g. `bonds`, `auctions`, `bidders`, `central-bank`, plus an optional `isin`/`auctionId`), not per-field. Rationale: the UI's main cache is the bulky `/v1/bonds` tree, so a refetch is one ETag revalidation anyway; coarse keys keep the backend mapping trivial and lean on the existing 304 path for cheapness. Keep `(b)` as the trivial fallback if key-mapping proves fiddly. | Confirm the key vocabulary is acceptable (it is part of the wire contract). |
| **Heartbeat interval** | 5s / 10s / 15s / 25s | **10s default**, env-overridable (`NB_BOND_API_SSE_HEARTBEAT_MS`). Must stay **comfortably under** any proxy idle-timeout in a future cloud deploy (App Gateway default 4 min, nginx 60s) — 10s is safe and cheap, and gives the `HealthBadge` a faster cadence than today's 7s only when *needed* (the `ingested` events already cover activity). | Confirm 10s (or pick a value). |
| **SharedWorker multi-tab dedup** | ship now / defer | **Defer** (one `EventSource` per tab). Native `EventSource` is simple and robust; SharedWorker adds lifecycle/leadership complexity and is hard to test under vitest/jsdom. The rate-limit (`limit: 300`/min) tolerates several idle SSE tabs. | Confirm defer (or request now). |
| **`eth_subscribe('newHeads')` migration** | this phase / follow-up | **Follow-up** (separate plan). The SSE contract is identical regardless of how the loop learns about new blocks; coupling the two doubles the risk surface. | Confirm follow-up. |
| **Request-path-read fold-in** | this plan (Phase 3) / defer | **Include as Phase 3, deferral allowed.** It is what makes `/v1/bidders` + `/v1/central-bank` *pushable* and it retires a KNOWN_ISSUES item — but it is a meaningful projection change and can ship as a fast-follow PR if the operator wants the SSE core landed first. | Confirm include-now vs fast-follow. |

> If any default above is not acceptable, **stop and confirm before Phase 1** — each one is part of either the wire contract or the trust boundary.

## Portability Flags

Local-acceptable now; the deployment repo owns the cloud side. Add these to the `services/nb-bond-api/DEVELOPMENT.md` and `docs/AZURE_BOUNDARY.md` Portability lists (per the AZURE_BOUNDARY "clean rule"). **Flagged only — not solved here.**

- **Response buffering must be OFF for `/v1/events`.** A buffering reverse proxy (nginx, App Gateway) will withhold SSE chunks and break the stream. The handler will set `X-Accel-Buffering: no` and `Cache-Control: no-cache`, but the cloud proxy must also be configured to not buffer this path. (Local NGINX Gateway Fabric → confirm pass-through in Phase 4.)
- **Idle-timeout vs heartbeat.** The proxy idle/read timeout must exceed the heartbeat interval (default 10s) or raise the timeout. Local is fine; document the cloud requirement.
- **Multi-replica fan-out.** A single nb-bond-api replica owns its in-process broadcaster fed by its own ingestion loop. With >1 replica behind a load balancer, each replica only knows about its own ingestion progress; clients pinned to different replicas could see slightly different `block` cursors. Coordination is via the **shared DB checkpoint** (`ingestion_state`) that already exists — but cross-replica SSE consistency (sticky sessions, or a shared pub/sub) is a **cloud-deploy decision**, out of scope here. Local runs one replica.
- **`EventSource` can't send `Authorization`.** The local default opens the stream unauthenticated (`none` mode). Any non-local deployment that protects nb-bond-api must choose the entra strategy from the Open Question (query-param token, cookie, or fetch-based reader) — the chart/code must keep this env-driven, never hardcoded.
- **CORS for SSE.** `cors` already runs with `credentials: false` and an env-driven origin list (`index.ts:118-126`); a cookie-based entra strategy would require `credentials: true` + an exact origin (not `*`). Flagged so the cloud side picks consistently.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| `GET /v1/events` streams SSE | Headline mechanism | `curl -N http://bond-api.cbdc-sandbox.local/v1/events` stays open, emits `event: heartbeat` lines on the configured interval and an `event: ingested` line after on-chain activity (e.g. creating an auction in another shell) | After merge |
| Push triggers a targeted refetch in nb-ui | The poll→push switch works | In a browser, create an auction / mint WNOK in tab A; tab B updates **without** a manual refresh and **without** waiting for a full-cadence poll; network tab shows the refetch is mostly `304` | After merge |
| Health collapses into the heartbeat | Removes the standalone 7s poll on the hot path | With SSE connected, `HealthBadge` reflects the heartbeat snapshot; killing the nb-bond-api pod flips the badge to `down` via the stream `error`/reconnect path; the Phase-0 polled fallback resumes when SSE is unavailable | After merge |
| nb-bond-api SSE unit-tested (jest) | Backend correctness without a live chain | `npm test` covers: broadcaster fan-out to N subscribers; an advanced tick emits one `ingested` with the right `changed[]`; a no-advance tick emits nothing; heartbeat carries the derived health status; `Last-Event-ID` replays only buffered events; subscriber cleanup on disconnect (no leak) | All green |
| nb-ui SSE client unit-tested (vitest) | Frontend correctness under jsdom | `npm test` covers: a mocked `EventSource` `ingested` message invalidates the right cache key(s) and calls the bound `reload`; heartbeat updates the health state; `error` flips to the down/fallback state; client tears down on unmount | All green |
| `none`-mode still works | Local sandbox unchanged ergonomically | Full existing suites pass; the stream opens with no token in `none` mode; if `EventSource` is unavailable/disabled, the UI behaves exactly as the Phase-0 poll baseline | No regression |
| Request-path reads DB-served (Phase 3, if included) | Makes the read surface pushable + retires a KNOWN_ISSUES item | `GET /v1/bidders` and `GET /v1/central-bank` return from the projection with Besu **down** (no 500); KNOWN_ISSUES item marked resolved | Present (or explicitly deferred) |
| No new dependency | Operator-approval gate | `git diff` shows no change to `services/*/package.json` `dependencies`/`devDependencies`; `EventSource` is native, SSE is plain HTTP | Confirmed |
| Lint/format/build/test gates | CI | nb-bond-api `format-lint-test` and nb-ui `format-lint-test-build` pass locally (per `sandbox-pr-workflow`) | Green |
| Docs + hygiene | Maintainability + public-safe | ARCHITECTURE / KNOWN_ISSUES / both DEVELOPMENT.md / AZURE_BOUNDARY / DOCUMENTATION_INDEX updated; `check-public-repo-hygiene.py` + `check-markdown-links.py` pass | Pass |

## Public-Repo Safety Checks

This repo is public. Before the plan is called complete:

- [ ] **No secrets** — SSE adds no key material. The heartbeat reuses the existing `/v1/health` payload (already public-safe: sanitised RPC URL via `sanitiseRpcUrl`, sandbox contract addresses, sealing **public** key). Do not add private keys, tokens, or the raw `Authorization` value to any event, log line, or doc.
- [ ] **No internal hostnames / IPs / tenant ids** — examples use `bond-api.cbdc-sandbox.local` only; no Azure tenant/subscription/cluster names; the entra token strategies are described generically.
- [ ] **No AI-vendor names** in any committed file (`.claude/` is gitignored).
- [ ] **No absolute home-dir paths** in committed text.
- [ ] **No new dependency / non-Apache-2.0 license** introduced (none is needed); if that changes, **stop and ask** and run `check-third-party-licenses.py`.
- [ ] `scripts/verification/check-public-repo-hygiene.py` and `check-markdown-links.py` planned for the doc + source changes.

## Assumptions

Safe to proceed with; anything unsafe is in "Decisions And Open Questions".

- The existing ingestion loop is the single authoritative "something changed" signal locally — `tick()` already updates `lastBlockProcessed`/`lastEventTxHash` exactly when a block/event lands (`ingestion.ts:744-745`), so the broadcaster hooks in there with no new chain reads.
- `EventSource` is available in the target (modern) browsers per the nb-ui "modern browsers only" decision (`nb-ui-frontend-plan.md` decisions). No polyfill.
- The existing ETag/`If-None-Match`/304 path (`httpClient.js` + `okResponse`) makes a push-triggered refetch cheap; SSE supplies the *when*, the cache supplies the *diff*.
- `none` mode stays the local default and the stream opens like `/v1/health` (before the auth gate). The entra path is unit-reasoned and documented but runtime-verified only in a real deployment (same posture as the existing entra auth, per KNOWN_ISSUES).
- Per project preference, nb-ui "verify" stops at build/lint/test/grep — **no preview_start / screenshot**.

## Plan Order

```
Phase 0  Baseline verification        (record green tests; confirm Phase-0 health-poll landing; sandbox up if available)
Open Questions resolved               (GATE: entra-SSE auth, granularity, heartbeat, defer SharedWorker/eth_subscribe, Phase-3 include-vs-defer)
Phase 1  Backend SSE endpoint + broadcaster (nb-bond-api)   [code + jest]
Phase 2  Frontend EventSource client + health collapse (nb-ui)  [code + vitest]   (Gate: Phase 1 wire contract fixed)
Phase 3  Request-path-read fold-in into the projection (nb-bond-api)   [code + jest]   (deferral allowed → fast-follow PR)
Phase 4  Local apply + end-to-end verification     (operator-driven, sandbox up)
Phase 5  Docs + public-repo hygiene
Follow-up (separate plan)  eth_subscribe('newHeads') migration; optional SharedWorker multi-tab dedup
```

> Phases 1 and 2 agree on the SSE wire contract (event names, `changed[]` vocabulary, `id:`/`retry:` semantics) and must ship **together** so a contract mismatch can't silently degrade the UI. Phase 3 is independent and may land as a fast-follow PR.

## Phase 0: Baseline Verification

### Goal
Prove the starting state before changing anything, and confirm the Phase-0 health-poll hardening is in place (it is the SSE fallback).

### Steps
- `cd services/nb-bond-api && npm ci && npm test` — record the green baseline (jest).
- `cd services/nb-ui && npm ci && npm test && npm run lint && npm run build` — record the green baseline (vitest + lint + build).
- Confirm the companion **Phase 0** (Page Visibility gating + backoff on `useHealthPoll.js`) has landed or is landing — note its branch/PR so the fallback path is known-good before SSE replaces the hot path.
- `grep -R "EventSource\|event-stream" services/nb-ui/src services/nb-bond-api/src` — confirm no SSE code exists yet (clean slate).
- (Needs a running cluster — **currently blocked, sandbox down**) `./sandbox.sh start`, then `curl -s http://bond-api.cbdc-sandbox.local/v1/health` and `curl -sI http://web.cbdc-sandbox.local/` to confirm the live baseline; `kubectl get gateway,httproute -A` to confirm the gateway is `PROGRAMMED`. Capture for the PR.

### Verification Stop
- Both suites green; no uncommitted changes; Phase-0 fallback path identified; no pre-existing SSE code.

### Fix Iteration / Rollback
- If a baseline test is already red, fix/triage it first — do not build SSE on a red baseline. If the sandbox is down, proceed against repo files and mark the live checks blocked (run them at Phase 4).

### Exit Criteria
- Recorded green baselines for both packages; fallback path confirmed.

## Phase 1: Backend SSE endpoint + broadcaster (nb-bond-api)

### Goal
Expose `GET /v1/events` as `text/event-stream`, fed by the existing ingestion loop, with a heartbeat carrying the health snapshot and bounded `Last-Event-ID` replay — without adding any dependency or any new chain read.

### Scope
`services/nb-bond-api/src/ingestion.ts` (emit on advance), a new small `src/events.ts` (broadcaster + ring buffer + SSE serialiser), `src/index.ts` (mount `/v1/events` before the auth gate; wire the heartbeat timer), `src/env-vars.ts` (heartbeat + buffer knobs), `src/schemas.ts` (document the event payloads + the `/v1/events` path), new `tests/events.test.ts`.

### Steps
1. **Broadcaster** (`src/events.ts`): an in-process emitter holding a `Set<subscriber>`; `subscribe(res)` registers an SSE writer and returns an unsubscribe; `publish(event)` writes `id:`/`event:`/`data:` to every subscriber and appends to a bounded in-memory ring buffer (depth `NB_BOND_API_SSE_BUFFER` default e.g. 100). A monotonic counter is the SSE `id:`. Pure-ish and unit-testable with a fake writer.
2. **Emit on advance** (`ingestion.ts`): in `tick()`, **after** `lastBlockProcessed`/`lastEventTxHash` are updated on a successful window (`:744-745`), call `publish({ type: 'ingested', block, txHash, changed })`. Derive `changed[]` from the decoded event names already available in `processBlockRange` (return a `changed` set alongside `latestTxHash`, mapping decoded names → resource keys: auction* → `auctions` (+`auctionId`), bond created/disabled/coupon/redeemed → `bonds` (+`isin`), token issue/redeem/transfer → `bonds` + holder/balance keys). **No new chain read** — reuse what the tick already decoded. A no-advance tick (window `null`) publishes nothing.
3. **Endpoint** (`index.ts`, in the `#region Unauthenticated routes` block before `app.use(authMiddleware)` at `:243`, next to `/v1/health`): `app.get('/v1/events', …)` that sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; writes an initial `retry: <ms>`; on connect, if `Last-Event-ID` is present, replays buffer entries with a higher id; subscribes via the broadcaster; registers `req.on('close', unsubscribe)`. **Confirm the global `rateLimit` (`:132`) does not count the long-lived stream against the operator** — exempt `/v1/events` from the limiter or mount the limiter after it, so one held-open SSE connection doesn't burn the 300/min budget (decide in implementation; document the choice).
4. **Heartbeat timer** (`index.ts`): a single `setInterval(NB_BOND_API_SSE_HEARTBEAT_MS, …)` that `publish({ type: 'heartbeat', health: <same snapshot /v1/health builds> })`, reusing `getIngestionStatus()` + the chain probe + `deriveStatus`/`computeLag` from `health.ts`. Keep the snapshot **identical in shape** to `/v1/health` so the client has one health model.
5. **env-vars** (`env-vars.ts`): add `NB_BOND_API_SSE_HEARTBEAT_MS` (default 10000) and `NB_BOND_API_SSE_BUFFER` (default 100) as positive ints, mirroring `POLL_INTERVAL_MS`.
6. **OpenAPI** (`schemas.ts`): add `SseIngestedEvent` and `SseHeartbeatEvent` schemas and document `GET /v1/events` (security `[]` to match `/v1/health`; note `text/event-stream`). Regenerate `openapi.json` per the existing generation step.

### Verification Stop
- New `tests/events.test.ts` (jest): broadcaster fans out to N fake subscribers; advanced tick → exactly one `ingested` with correct `changed[]`; no-advance tick → silence; heartbeat payload carries the derived status; `Last-Event-ID` replays only newer buffered events; disconnect removes the subscriber (no leak / no write-after-close).
- `tests/env-vars.test.ts`: new knobs parse + default correctly.
- `npm test`, `npm run lint`, `npm run build` (typecheck) green; `openapi.json` regenerated + committed.

### Fix Iteration / Rollback
- Endpoint is additive and mounted before the gate; removing the `/v1/events` route + the `publish(...)` line in `tick()` + `events.ts` restores prior behaviour. Nothing touches the projection or chain reads. If the rate-limiter interaction is wrong, the symptom is a 429 on the stream — fix the exemption.

### Exit Criteria
- `curl -N …/v1/events` streams heartbeats + an `ingested` after activity; tests green; no new dependency; `/v1/health` unchanged.

## Phase 2: Frontend EventSource client + health collapse (nb-ui)

### Goal
Add one native `EventSource` client that invalidates + refetches the affected resource on `ingested`, feeds `HealthBadge` from the heartbeat, and falls back to the Phase-0 poll when SSE is unavailable — all inert/identical in the no-SSE path.

### Scope
`services/nb-ui/src/api/eventsClient.js` (new — the `EventSource` wrapper + `changed-key → URL/invalidator` map + a small subscription API), `src/hooks/useHealthPoll.js` (prefer the stream heartbeat; keep the poll as fallback), wiring in `HealthBadge.jsx` and the fetching pages (subscribe a query's `reload` to its resource key), `src/config.js` (a `LIVE_UPDATES` / `SSE_ENABLED` runtime flag defaulting on), plus tests.

### Steps
1. **Client** (`src/api/eventsClient.js`): open `new EventSource(`${API_BASE_URL}/v1/events`)`; parse `ingested` and `heartbeat` events; maintain a `Map<resourceKey, Set<callback>>` so pages can `subscribe('bonds', reload)`. On `ingested`, for each `changed` key: `HttpClient.clearCache()` is too coarse — instead invalidate the **specific** cached URL(s) for that key (add a small `invalidate(path)` to `httpClient.js` that deletes one `cache` entry by URL) and invoke the subscribed `reload`s. On `error`, surface a "disconnected" state and let native `EventSource` auto-reconnect (honouring the server `retry:`).
2. **httpClient** (`httpClient.js`): add `HttpClient.invalidate(path)` that deletes the matching `cache` Map entry (or entries by URL prefix) — finer-grained than the existing `clearCache()` so a `bonds` push doesn't needlessly drop the `central-bank` ETag.
3. **Health collapse** (`useHealthPoll.js`): when the stream is connected, set `health` from the latest `heartbeat`; when the stream errors or `LIVE_UPDATES` is off, **fall back to the existing 7s poll** (Phase-0-hardened). The badge's `down` state derives from stream `error` (no heartbeat within ~2× interval) → fallback poll → `DOWN_SHAPE`. Keep `reload()` working (force a one-off health fetch).
4. **Page wiring**: where pages currently do `reload(); setTimeout(reload, 4000)` after a mutation (`AuctionsPage.jsx:80-84`, `BondDetailPage.jsx:88-92`, `BiddersPage`), subscribe that page's `reload` to its resource key so the **server push** drives the refetch; keep a single immediate `reload()` after a local mutation for snappiness, but the `setTimeout` double-pump can be dropped once the push covers the ingestion-lag case (verify in Phase 4 before removing).
5. **Config flag** (`config.js`): `LIVE_UPDATES` (default `true`) so the stream can be disabled at runtime to force the poll path (useful for debugging and as the documented fallback switch).

### Verification Stop
- New `tests/eventsClient.test.js` (vitest, mock `EventSource`): an `ingested` for `bonds` calls `invalidate('/v1/bonds…')` + the subscribed `reload`; an unrelated key does not; a `heartbeat` updates health; an `error` flips to the disconnected/fallback state; the client closes on teardown.
- Extend `tests/` for `useHealthPoll`: with a connected stream, health comes from the heartbeat; with `LIVE_UPDATES=false` or a stream error, the 7s poll drives health (Phase-0 behaviour preserved).
- `npm test`, `npm run lint`, `npm run build` green. **No preview/screenshot** (per project convention).

### Fix Iteration / Rollback
- The stream is additive and behind `LIVE_UPDATES`; setting it `false` (or reverting the new files) restores the pure-poll behaviour. The `httpClient.invalidate` addition is backward-compatible with `clearCache`.

### Exit Criteria
- Push-driven refetch works under a mocked `EventSource`; health reads from the heartbeat with the poll as fallback; tests green; no new dependency.

## Phase 3: Request-path-read fold-in into the projection (nb-bond-api)

> **Deferral allowed.** This makes `/v1/bidders` + `/v1/central-bank` *pushable* and retires the KNOWN_ISSUES "request-path chain reads bubble up as opaque 500s" item. If the operator wants the SSE core landed first, ship this as a fast-follow PR.

### Goal
Serve `/v1/bidders` balances and `/v1/central-bank` allowlist + balance from the SQLite projection instead of live chain reads on the request path, so the whole read surface is DB-served (hence pushable via `changed` keys) and a Besu outage no longer 500s these reads.

### Scope
`services/nb-bond-api/src/ingestion.ts` (project WNOK balances + allowlist into the DB as their events are ingested), `src/ingestion-db.ts` (new tables/queries), `src/index.ts` (`/v1/bidders` `:916-920`, `/v1/central-bank` `:1124`, `/v1/central-bank/allowlist` `:1146` read from the projection), `docs/KNOWN_ISSUES.md` (mark resolved), tests.

### Steps
1. **Project WNOK balances**: ingest the WNOK ERC-20 `Transfer`/mint/burn events (and bond holder balances already partially projected via `balances`) so a per-address balance is queryable from the DB; back `/v1/bidders` and `/v1/central-bank` `balance` with it.
2. **Project the allowlist**: ingest WNOK allowlist add/remove events into an `allowlist` table; back `/v1/central-bank/allowlist` from it.
3. **Swap the reads**: replace the `provider.getBalance`/`wnok.balanceOf`/`allowlist` calls on the hot path with DB queries; keep a chain read only as an explicit `?refresh=1`-style fallback if needed (decide in implementation).
4. **Emit `changed`**: when these projections change during a tick, include `bidders` / `central-bank` in the `changed[]` so the SSE push covers them too.
5. **KNOWN_ISSUES**: mark "nb-bond-api request-path chain reads bubble up as opaque 500s" resolved (the hot-path read no longer touches chain), mirroring how the ingestion-self-heal item was struck through.

### Verification Stop
- jest: `/v1/bidders` and `/v1/central-bank` return correct balances/allowlist **from the projection with the provider mocked as unreachable** (no 500); a relevant tick emits the `bidders`/`central-bank` `changed` keys.
- `npm test`, `npm run lint`, `npm run build` green.

### Fix Iteration / Rollback
- If a projection edge case is wrong (e.g. a missed allowlist event), the read can temporarily fall back to the chain path (the pre-change behaviour) behind a flag — revert the read swap to restore. This phase is isolated from Phases 1–2.

### Exit Criteria
- The whole read surface is DB-served and pushable; the KNOWN_ISSUES item is resolved; tests green. (Or this phase is explicitly deferred to a fast-follow PR.)

## Phase 4: Local Apply + End-to-End Verification

### Goal
Prove SSE works end-to-end on the running sandbox (the unit suites cover logic; this proves the wire + the proxy pass-through). **Operator-driven — sandbox must be up (currently down).**

### Steps
- `./services/nb-bond-api/nb-bond-api.sh start` then `./services/nb-ui/nb-ui.sh start` (or `./sandbox.sh start`) to deploy the changed services.
- `kubectl -n nb-bond-api get pods` and `-n nb-ui` → `Ready`, no restarts; `kubectl get httproute -A` still `Accepted`.
- **Stream smoke:** `curl -N http://bond-api.cbdc-sandbox.local/v1/events` stays open and prints `event: heartbeat` on cadence. In another shell create an auction (via the UI or `curl`) and watch an `event: ingested` arrive — **confirms the local NGINX Gateway Fabric passes SSE through without buffering** (the `X-Accel-Buffering: no` portability check).
- **Browser:** open `http://web.cbdc-sandbox.local/` in two tabs; mutate in one (create auction / mint WNOK), confirm the other updates without a manual refresh; network tab shows the refetch is mostly `304`.
- **Health collapse:** confirm `HealthBadge` tracks the heartbeat; `kubectl -n nb-bond-api delete pod <nb-bond-api>` and confirm the badge flips to `down` via the stream error, then recovers (and that the Phase-0 poll fallback engages while the stream is down).
- **Phase 3 (if included):** `kubectl -n besu scale deploy/<besu> --replicas=0` (or stop Besu), confirm `/v1/bidders` + `/v1/central-bank` still return (no 500), then scale back.

### Verification Stop
- All checks pass; SSE survives the gateway; two-tab live update confirmed; health collapse + fallback confirmed.

### Fix Iteration / Rollback
- If the gateway buffers SSE (stream opens but `ingested`/`heartbeat` never arrive in the browser while `curl -N` works), it is a gateway/proxy buffering issue — confirm the route/headers; this is the portability constraint made real. Set `LIVE_UPDATES=false` to fall back to polling while diagnosing. Narrowest rollback: `helm rollback` the affected release.

### Exit Criteria
- Live push works through the local gateway; fallback proven; pods steady.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal
Leave the repo's docs accurate and public-safe.

### Steps
- `docs/ARCHITECTURE.md`: document `GET /v1/events` (SSE) in the nb-bond-api section and the nb-ui live-update model (push invalidates ETag → 304 refetch; heartbeat carries health; poll is the fallback). Note the trust boundary: `/v1/events` opens before the auth gate in `none` mode (like `/v1/health`).
- `docs/KNOWN_ISSUES.md`: if Phase 3 shipped, mark the "request-path chain reads bubble up as opaque 500s" item resolved; otherwise leave it and note SSE depends on the fold-in to push those resources.
- `services/nb-bond-api/DEVELOPMENT.md`: document `/v1/events`, `NB_BOND_API_SSE_HEARTBEAT_MS` / `NB_BOND_API_SSE_BUFFER`, the heartbeat = `/v1/health` shape, and add the Portability Flags above (buffering off, idle-timeout, multi-replica fan-out, entra-SSE auth, CORS-for-SSE).
- `services/nb-bond-api/README.md`: add the two new env vars to the environment table.
- `services/nb-ui/DEVELOPMENT.md`: document the `EventSource` client, the `LIVE_UPDATES` flag, the `changed-key` vocabulary, and the poll fallback.
- `docs/AZURE_BOUNDARY.md`: add the SSE portability constraints to the nb-bond-api row/notes (buffering, idle-timeout, multi-replica, auth) so the deployment repo owns them.
- `docs/DOCUMENTATION_INDEX.md`: add this plan under the active-plans list (it references no `.claude/` paths, so it is indexed normally).

### Verification Stop
- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- (No dependency / third-party change, so `check-third-party-licenses.py` is **not** required — confirm `package*.json` `dependencies` are untouched.)

### Fix Iteration / Rollback
- Fix any hygiene/link failure before opening the PR.

### Exit Criteria
- Docs accurate; hygiene + link checks pass.

## CI Gates That Will Fire

Defer the exact reproduction commands to `sandbox-pr-workflow`; these are the workflows the diff will trigger:

- **`nb-bond-api.yml`** (`format-lint-test`) — Phases 1 + 3 touch `services/nb-bond-api/**`.
- **`nb-ui.yml`** (`format-lint-test-build`) — Phase 2 touches `services/nb-ui/**`.
- **`publication-hygiene.yml`** (`validate-publication-hygiene`) — Phase 5 touches `docs/**` + the new plan.
- **`image-hash-inputs.yml`** (`validate-image-hash-inputs`) — likely, since `services/*/src/**` changes feed the image content hash.
- **`node-version-consistency.yml`** — only if a Node/engines pin changes (not expected); local equivalent `scripts/verification/check-node-version-consistency.py`.
- **`license-inventory.yml`** — should be a no-op (no dependency change); if any `package.json` dep changes, **stop and ask** and update `THIRD_PARTY_LICENSES.md`.
- **`test-contracts.yml`** — not triggered (no contract changes).
- GitHub-side CodeQL + Aikido scans run on the PR regardless (note: the SSE handler must avoid the `js/polynomial-redos` and `js/missing-rate-limiting` traps the codebase already guards against — see `auth.ts:63-70` and the `rateLimit` note in Phase 1).

## Documentation And PR Plan

Branch naming (`feature/<kebab>` → `development`), commit/PR style, and CI gates are owned by `sandbox-pr-workflow`.

- **PR 1 (recommended):** backend SSE endpoint + broadcaster (Phase 1) **and** frontend client + health collapse (Phase 2) together — the wire contract must stay in sync across tiers.
- **PR 2 (fast-follow, if Phase 3 deferred):** request-path-read fold-in + KNOWN_ISSUES resolution.
- **Docs/runbooks to update:** as Phase 5 (folded into the relevant PR).
- **Evidence to include in PR body:** both `npm test` runs (incl. the new `events`/`eventsClient` tests), a `curl -N …/v1/events` transcript showing a heartbeat + an `ingested`, the two-tab live-update confirmation, the `none`-mode-unchanged note, and (if blocked) which Phase 4 live checks still need the operator to run after `./sandbox.sh start`.

## Residual Risks

- **Proxy buffering breaks SSE silently in a future cloud deploy** — `curl -N` works but the browser sees nothing. Mitigated by the `X-Accel-Buffering: no` header, the heartbeat under the idle-timeout, and the explicit portability flags. Local gateway pass-through is verified in Phase 4.
- **Multi-replica cursor skew** — out of scope here (one local replica), but flagged so the cloud side coordinates via the shared checkpoint or sticky sessions.
- **entra-SSE auth is unresolved** — the default opens the stream before the auth gate (`none`-safe). If `/v1/events` must be protected in a deployment, the Open Question must be answered first; picking a token scheme silently would be a trust-boundary change.
- **Rate-limiter vs long-lived stream** — a held-open SSE connection must not consume the 300/min budget; the Phase-1 exemption decision must be correct or streams will 429.
- **Removing the `setTimeout(reload, 4000)` double-pump too early** — only drop it after Phase 4 confirms the push reliably covers the ingestion-lag window; otherwise a missed event leaves a page stale until the next user action.
- **`EventSource` unavailable / disabled** — covered by the `LIVE_UPDATES` flag and the Phase-0 poll fallback; the UI must degrade to exactly the poll baseline, not break.

## Done Criteria

- `GET /v1/events` streams heartbeats + `ingested` events fed by the existing ingestion loop; nb-ui's single `EventSource` client invalidates the right ETag entry and refetches (mostly 304s) on push; the `HealthBadge` reads the heartbeat with the Phase-0 poll as fallback.
- `none`-mode local sandbox is unchanged ergonomically; no new dependency; both suites green; both charts (if touched) render.
- Phase 3 either shipped (request-path reads DB-served, KNOWN_ISSUES item resolved) or explicitly deferred to a fast-follow PR.
- Docs + index updated; public-repo hygiene + link checks pass; portability constraints flagged for the deployment repo; the `eth_subscribe` migration and optional SharedWorker dedup recorded as follow-ups.
