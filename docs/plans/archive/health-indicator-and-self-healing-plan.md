# Health Indicator + Self-Healing Ingestion — Implementation Plan (Plan B)

**Status:** ✅ Implemented and shipped in [PR #115](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/115). Plan B and Plan C landed together as one squashed commit on `feature/health-indicator-and-modal` (the original `feature/health-indicator-and-self-healing` branch was renamed when the two plans were combined into a single PR). No outstanding work items.
**Branch:** `feature/health-indicator-and-modal` (combined Plan B + Plan C)
**Components:** `services/nb-bond-api/` (ingestion self-heal + extended `/v1/health` payload) and `services/nb-ui/` (top-bar `HealthBadge` polling).

This is **Plan B** of a two-iteration design. See [`network-health-modal-and-reconnect-plan.md`](network-health-modal-and-reconnect-plan.md) for **Plan C** (modal + manual reconnect) which builds on the foundations laid here.

## Goal

Two reinforcing changes:

1. **Layer 1 — Root-cause fix.** Wrap the nb-bond-api ingestion-loop startup in retry-with-backoff so the API self-heals when Besu is briefly unreachable at boot. Today the loop fails to start and the API silently serves stale data forever. Documented in `docs/KNOWN_ISSUES.md` ("nb-bond-api ingestion loop doesn't self-heal when Besu is briefly unreachable").
2. **Layer 2 — Health visibility.** Extend `GET /v1/health` with chain + ingestion state, and replace the static `LIVE` pill in the operator UI top bar with a polling `HealthBadge` that renders green / yellow / red borders based on backend status. Not clickable in Plan B — that's Plan C.

After Plan B ships, restarting the PC / Docker no longer breaks the API, and any future chain/ingestion degradation is visible at a glance from the top bar.

## Current-State Evidence

What was inspected and what was verified in this session.

- **Docs read:** root `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md` (latest, including the entry this plan resolves), `docs/DOCUMENTATION_INDEX.md`, `services/nb-bond-api/README.md` + `DEVELOPMENT.md`, `services/nb-ui/AGENTS.md` + `README.md`.
- **Repo declarations inspected:**
  - `services/nb-bond-api/src/index.ts` — current `/v1/health` returns `{ status: 'ok', contracts, sealingPubKey }`. Ingestion start at bottom is the fire-and-forget pattern this plan fixes.
  - `services/nb-bond-api/src/ingestion.ts` — `startIngestionLoop()` is async, opens a write DB handle, resolves contracts via one chain call, loads checkpoint, then runs an immediate `tick()` + `setInterval(tick, POLL_INTERVAL_MS)`. The inner `tick()` already has try/catch — failures don't kill the loop. The failure point is the setup before `tick()`. No module-level introspection state today.
  - `services/nb-bond-api/src/chain.ts` — `provider = new JsonRpcProvider(envVariables.RPC_URL)` (module-level). `RpcUnavailableError` already exists; the ingestion fast-path doesn't use it but should.
  - `services/nb-bond-api/src/schemas.ts` — `healthSchema` is currently `{ status: enum(['ok','degraded']), contracts, sealingPubKey }`. Status enum needs `'down'` added.
  - `services/nb-bond-api/src/ingestion-db.ts` — `ingestion_state` table has `contract / last_block / last_tx_index`. No schema bump needed for this plan — runtime state lives in module variables.
  - `services/nb-ui/src/components/Layout.jsx` — current top bar: `AuthChrome`, `TestModeToggle`, `env-pill` (static), `v1.0.0`. The static `env-pill` is what becomes `HealthBadge`.
  - `services/nb-ui/src/hooks/useApi.js` — exposes `useApi(fetcher, deps)` with `reload`, but no built-in polling. The `HealthBadge` will use `useEffect` + `setInterval` directly.
  - `services/nb-ui/src/api/httpClient.js` — owns the ETag cache, clears on mutations. Health is a GET — uses the existing path-keyed ETag cache, which is desirable (polling will return 304 on unchanged state).
- **Live local checks (verified 2026-05-22):**
  - `kind get clusters` → `cluster-cbdc-monoledger`. `kubectl config current-context` matches.
  - `helm list -A` → all releases `deployed`. `nb-bond-api` rev 10, `nb-ui` rev 17.
  - `curl /v1/health` returns the current 3-field payload above. No `chain.head`, no `ingestion.*`.
  - `kubectl -n nb-bond-api logs deploy/nb-bond-api` after this morning's restart shows the loop running healthily; the bug reproduces on PC/Docker restart only.
- **Blocked or unverified:** none. Everything is reachable.

## Scope

### In Scope

- New `services/nb-bond-api/src/ingestion.ts` module-level state: `{ loopRunning, lastTickAt, consecutiveFailures, lastBlockProcessed, lastEventTxHash }` plus an exported `getIngestionStatus()` accessor.
- New helper `startIngestionLoopWithRetry()` in `index.ts` that wraps `startIngestionLoop()` in exponential backoff (1s → 2s → 5s → 10s → 30s, max 30s, retry forever). Replaces the current fire-and-forget pattern.
- Inner `tick()` updated to record `lastTickAt` + `lastEventTxHash` (from the most-recent log it ingested) + reset `consecutiveFailures` on success, increment on failure.
- `/v1/health` payload extended with `chain` and `ingestion` blocks per the goal section. Status derivation moves into the handler.
- `healthSchema` in `schemas.ts` extended with the new shape. `status` enum gains `'down'`. OpenAPI snapshot regenerated.
- New `services/nb-ui/src/api/healthApi.js` with `getHealth()` (no testMode query, no auth required — `/v1/health` bypasses auth).
- New `services/nb-ui/src/components/HealthBadge.jsx` replacing the inline `env-pill` markup in `Layout.jsx`. Polls every 7s, renders LIVE / MOCK / DOWN with coloured border (green / yellow / red, grey for mock).
- **Clickable from day 1**. Click opens a small placeholder `HealthPlaceholderModal` that says "Detailed Network Health view coming in the next iteration" and lists what's coming (chain + ingestion state, recent error log, Reconnect, Resync from block 0). Plan C replaces this placeholder with the real `NetworkHealthModal`.
- **Dynamic `title` tooltip on the badge** — concrete summary of the current status, derived from the `/v1/health` response. Examples:
  - `ok` — `"Network healthy — chain head 94, ingestion up to date"`
  - `degraded` (lag): `"On-chain healthy, ingestion 7 blocks behind"`
  - `degraded` (stalled): `"On-chain healthy, ingestion poll stalled 35 s"`
  - `degraded` (errors): `"On-chain healthy, recent ingestion errors"`
  - `down` (chain): `"Backend can't reach chain"`
  - `down` (loop): `"Ingestion loop not running"`
  - `down` (stale): `"Ingestion stale for 75 s"`
  - mock: `"Mock API — no real backend connected"`
  The tooltip text derives from the same payload the badge colour does — one helper produces both. Browser-native `title` is fine; no custom tooltip library.
- New `services/nb-ui/src/pages/HealthPlaceholderModal.jsx` — small "coming soon" modal, replaced in Plan C.
- Backend unit tests: retry helper, `getIngestionStatus` shape, status derivation across the three cases.
- Frontend feature tests: HealthBadge renders the right color + tooltip text for each `status`, click opens the placeholder modal, polls on mount, cleans up on unmount.
- Resolve the existing `KNOWN_ISSUES.md` entry on ingestion self-heal — strike-through + replace with a "resolved in PR #X" pointer.
- `services/nb-bond-api/DEVELOPMENT.md` — document the new health payload.

### Out of Scope (explicit)

- Clickable HealthBadge / NetworkHealthModal — **Plan C**.
- `POST /v1/admin/restart-ingestion` admin endpoint — **Plan C**.
- Drift detection via `eth_getLogs` from chain on every health poll. The cheap `lastEventTxHash` (from ingested rows) is sufficient. The block-lag number already catches drift.
- Restart of the JsonRpcProvider itself — not needed for self-heal because the provider's `getBlockNumber()` retries internally once DNS resolves.
- Real-time event streaming via WS — transport is HTTP per the architecture; out of scope here and forever.
- Any auth changes — `/v1/health` stays public (matches today).

## Folder And File Placement

| Item | Path | Rationale |
|---|---|---|
| Ingestion runtime state + `getIngestionStatus()` | `services/nb-bond-api/src/ingestion.ts` (extend) | Same module that owns the loop. |
| Retry helper `startIngestionLoopWithRetry()` | `services/nb-bond-api/src/index.ts` (add) or `src/ingestion.ts` (export) | I'd put it in `ingestion.ts` so the loop owns its own resilience. `index.ts` calls it once. |
| Health payload extension | `services/nb-bond-api/src/index.ts` (extend `/v1/health` handler) | Same handler, more data. |
| `HealthSchema` shape | `services/nb-bond-api/src/schemas.ts` (extend) | Single source of truth for the OpenAPI doc. |
| Health API client | `services/nb-ui/src/api/healthApi.js` (new) | Mirrors `bondsApi.js` / `centralBankApi.js` layout. Mock-client parity. |
| HealthBadge component | `services/nb-ui/src/components/HealthBadge.jsx` (new) | Co-located with `Layout.jsx` since the badge IS the top-bar pill. |
| Layout integration | `services/nb-ui/src/components/Layout.jsx` (edit) | Replace the inline `env-pill` span with `<HealthBadge />`. |
| Tests | `services/nb-bond-api/tests/health-derivation.test.ts` + extended `ingestion.test.ts`; `services/nb-ui/tests/HealthBadge.test.jsx` | Match existing test surface conventions. |
| Doc updates | `services/nb-bond-api/DEVELOPMENT.md` (add §7.x), `docs/KNOWN_ISSUES.md` (resolve entry), `docs/DOCUMENTATION_INDEX.md` (link plan) | Existing patterns. |

## Decisions And Open Questions

| Decision | Options | Recommendation | Why |
|---|---|---|---|
| HealthBadge clickability in Plan B | (a) Clickable with TODO stub; (b) Non-clickable until Plan C; (c) Clickable, opens a small placeholder modal that explains what's coming | **(c) Clickable + placeholder modal**. Operator's muscle memory says "badge is clickable" from day 1; the placeholder modal sets expectations so the click isn't confusing. Plan C swaps the placeholder for the real `NetworkHealthModal`. |
| Where does `lastEventTxHash` live | (a) Module-level variable in `ingestion.ts`, (b) New column on `ingestion_state` | **(a) Module-level**. Lost on pod restart, rebuilt by next tick. | Avoids a schema migration. The value is debug-only, not authoritative — it's fine to recompute. |
| Status derivation thresholds | Tweakable: `lag>5`, `lastTick>30s`/`>60s` | Recommended defaults as in goal: degraded if lag>5 OR failures>0 OR lastTick>30s; down if chain unreachable OR loop never ran OR lastTick>60s. | Match the 3s poll cadence — 5 blocks ≈ 15s of activity (significant), 30s = 10 missed ticks. |
| Polling cadence (frontend) | 5s / 7s / 10s / 30s | **7s** | Chosen to be coprime with the backend's 3s tick so the operator sees status flips quickly without flooding. Cheap response (~500 bytes, no DB writes). |
| `chain.rpcUrl` field in health | (a) Expose full URL, (b) Hide entirely, (c) Sanitise to host + port only | **(c) Sanitise** — return `http://<host>:<port>` without any query or path. | Avoids leaking accidental credentials in a URL while still being useful to the operator. |
| Plan format | Single combined doc vs two | **Two separate** | They land in sequence. Cross-linking is clearer than one giant doc the operator skims for "what's still left". |

No questions blocking Plan B. The above defaults can ship.

## Portability Flags

Local-acceptable choices that would block a future non-local deployment if not addressed later.

- **HealthBadge polling every 7s** is sandbox-fine. For a real deployment behind a CDN or with rate limits, the cadence should be operator-configurable (or backed by SSE/WS push). Mark in plan, do not solve.
- **`chain.rpcUrl` exposure** — fine for sandbox where everyone can reach Besu anyway. In Azure, the RPC URL might point at an internal node that shouldn't be advertised. The sanitised host+port form is the minimal surface; tighten further per deployment.

## Acceptance Criteria

| # | Criterion | Verification evidence | Target |
|---|---|---|---|
| AC1 | `startIngestionLoop()` retries with backoff when Besu is briefly unreachable on boot. | Unit test forces `getBondManagerAddress()` to throw N times then succeed; loop starts. Live test: stop besu, start nb-bond-api pod, wait, start besu, observe loop comes online without manual restart. | Pass |
| AC2 | `/v1/health` returns the new payload shape. | `curl http://bond-api.cbdc-sandbox.local/v1/health \| jq` shows `chain.{rpcUrl,chainId,head,headReachable}` + `ingestion.{loopRunning,lastBlockProcessed,lag,pollIntervalMs,lastTickAt,lastEventTxHash,consecutiveFailures}`. | Pass |
| AC3 | Status derivation matches the rules. | Three test cases (ok / degraded / down) via unit test + one live manual smoke (stop besu briefly → status=down → restart → status=ok). | Pass |
| AC4 | HealthBadge renders the right color + concrete tooltip text per status. | Vitest renders the component with mocked health responses; assert classNames / border colour AND `title` attribute matches the `summarise()` helper output for each case. | Pass |
| AC4b | HealthBadge click opens the placeholder modal explaining what's coming. | Vitest: render, click badge, assert "Network Health" heading visible; click Close, assert dismissed. Live: click in the browser, confirm same. | Pass |
| AC5 | HealthBadge polls without leaking. | Unmount the component, confirm no further fetches (assert via mock). | Pass |
| AC6 | KNOWN_ISSUES entry resolved. | `docs/KNOWN_ISSUES.md` strikes the "ingestion doesn't self-heal" entry, links to merged PR + plan doc. | Pass |
| AC7 | All tests, lint, format, build, hygiene scripts green. | `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build && npm run regen:openapi`; same for `services/nb-ui`; `python3 scripts/verification/check-public-repo-hygiene.py && check-markdown-links.py`. | Pass |
| AC8 | Helm rev bumps cleanly. | `helm history nb-bond-api -n nb-bond-api` shows new revision `deployed`. `kubectl get pods -A` shows ready. | Pass |

## Plan Order

```
Phase 0  Baseline verification
Phase 1  Backend foundations
  1a  Ingestion module-level state + getIngestionStatus()
  1b  Retry-with-backoff helper, wire into index.ts boot
  1c  /v1/health handler extension + schemas.ts update
  1d  Backend tests
Phase 2  Frontend
  2a  healthApi.js + mock client parity
  2b  HealthBadge component
  2c  Layout integration
  2d  Frontend tests
Phase 3  Local apply + verification
Phase 4  Documentation + hygiene
```

## Phase 0: Baseline Verification

### Goal

Capture the starting state so AC1–AC8 have something to compare against.

### Steps

- `helm list -A` and `kubectl -n nb-bond-api get pods` → record the current rev + pod state.
- `curl http://bond-api.cbdc-sandbox.local/v1/health > /tmp/health-before.json` — snapshot.
- `kubectl -n nb-bond-api logs deploy/nb-bond-api --tail=20 > /tmp/ingest-log-before.txt` — confirm ingestion is currently healthy.

### Verification Stop

- The snapshots exist. The current `/v1/health` payload matches the documented "3-field" shape.

### Exit Criteria

- Baseline captured. Ready to edit code.

## Phase 1: Backend Foundations

### Phase 1a — Ingestion module-level state + `getIngestionStatus()`

**Steps**

- In `services/nb-bond-api/src/ingestion.ts`, add module-level state vars:
  ```ts
  let loopRunning = false;
  let lastTickAt: number | null = null;
  let consecutiveFailures = 0;
  let lastBlockProcessed: number | null = null;
  let lastEventTxHash: string | null = null;
  ```
- Export `getIngestionStatus()` returning a typed snapshot of all five.
- Update `tick()` to:
  - Set `lastTickAt = Date.now()` on entry (so even a hung tick is visible).
  - Update `lastEventTxHash` from the most-recent log within `processBlockRange` (pass it back, or maintain it in a closure).
  - On success: set `lastBlockProcessed = to`, `consecutiveFailures = 0`.
  - On failure (existing catch block): `consecutiveFailures++`. Log message unchanged.
- Set `loopRunning = true` once `setInterval` is wired; only here, never elsewhere.

**Verification stop**

- Unit test: `startIngestionLoop()` with mocked provider + DB; assert `getIngestionStatus()` reflects the loop progression.
- Type check passes (`npm run build`).

### Phase 1b — Retry-with-backoff for boot

**Steps**

- Export `startIngestionLoopWithRetry({ initialDelayMs, maxDelayMs, factor })` from `ingestion.ts`. Defaults: 1000ms, 30000ms, factor 2. Retries forever.
- Loop body: try `startIngestionLoop()`; on throw, log a single `warn` (not error — this is expected during boot), `await sleep(delay)`, `delay = Math.min(delay * factor, maxDelayMs)`, retry.
- Detect `RpcUnavailableError` specifically and log at `info` (not `warn`) to avoid alarming logs. Other errors stay `warn`.
- In `index.ts`, replace the existing fire-and-forget block with:
  ```ts
  import('./ingestion')
    .then(({ startIngestionLoopWithRetry }) => startIngestionLoopWithRetry())
    .catch((err) => logger.error(`ingestion module load failed: ${(err as Error).message}`));
  ```
  Module-load failure is now the only "give up" path — and that's not the bug we're fixing.

**Verification stop**

- Unit test: mock `startIngestionLoop` to throw twice then succeed; assert retry happens twice with growing delays; assert success on third attempt; assert `loopRunning` is true at the end.

### Phase 1c — `/v1/health` extension + schema update

**Steps**

- Extend `healthSchema` in `schemas.ts` with `chain` and `ingestion` sub-shapes. `status` enum becomes `['ok','degraded','down']`. Sanitise `chain.rpcUrl` field with a `.transform()` or just compute it in the handler.
- In the `/v1/health` handler in `index.ts`:
  - Read `getIngestionStatus()`.
  - Try `provider.getBlockNumber()`; catch → `headReachable = false`, `head = null`.
  - Derive `status` per the rules in the goal section.
  - Sanitise RPC URL: parse via `new URL()`, build `${protocol}//${host}` (no path, no query, no auth).
  - Build the response. The existing `okResponse()` helper handles ETag.
- `npm run regen:openapi` — commit `openapi.json`.

**Verification stop**

- Unit test for status derivation across three buckets.
- Live curl: confirm new payload shape after a `npm run dev` boot.

### Phase 1d — Backend tests

**Steps**

- Add `services/nb-bond-api/tests/health-derivation.test.ts` covering all three status cases with mocked `getIngestionStatus()` and a mocked provider.
- Extend `tests/ingestion.test.ts` (or add a new `tests/ingestion-retry.test.ts`) for the retry helper.
- Confirm: `npm test` green; coverage of the new functions reasonable.

**Verification stop**

- `npm test` green. `npm run lint` green. `npm run format:check` green.

## Phase 2: Frontend

### Phase 2a — `healthApi.js`

**Steps**

- New `services/nb-ui/src/api/healthApi.js`:
  ```js
  import { AppConfig } from '../config.js';
  import { HttpClient } from './httpClient.js';
  import { MockClient } from './mockClient.js';
  const isMockMode = () => AppConfig.USE_MOCK;
  async function getHealth() {
    if (isMockMode()) return MockClient.getHealth();
    return HttpClient.get('/v1/health');
  }
  export const HealthApi = { getHealth };
  ```
- Extend `mockClient.js` with a `getHealth()` returning a static `ok` payload.

**Verification stop**

- `npm test` — existing tests still green (mockClient additions don't break anything).

### Phase 2b — `HealthBadge` component + placeholder modal

**Steps**

- New `services/nb-ui/src/components/HealthBadge.jsx`:
  - `useState({ health, error, modalOpen })`, `useEffect` polls every 7 seconds, cleanup on unmount.
  - Skip polling when `AppConfig.USE_MOCK` is true; render static grey "MOCK API".
  - Status → color map: `ok` → green border (`#10b981`), `degraded` → yellow (`#f59e0b`), `down` → red (`#ef4444`).
  - Renders the same env-pill shape today but with the new border colour.
  - **Clickable**: rendered as a `<button>` so keyboard activation works; `onClick={() => setModalOpen(true)}`. Renders `<HealthPlaceholderModal />` when open.
  - **Dynamic tooltip** via the native `title` attribute, derived from `health` via a small helper:
    ```js
    function summarise(health) {
      if (!health) return 'Loading health…';
      const { status, chain, ingestion } = health;
      if (status === 'ok') {
        return `Network healthy — chain head ${chain.head}, ingestion up to date`;
      }
      if (status === 'degraded') {
        if (!ingestion.loopRunning) return 'On-chain healthy, ingestion loop not running';
        if (ingestion.lag > 5) return `On-chain healthy, ingestion ${ingestion.lag} blocks behind`;
        if (ingestion.consecutiveFailures > 0) return 'On-chain healthy, recent ingestion errors';
        const stalled = Math.round((Date.now() - (ingestion.lastTickAt ?? 0)) / 1000);
        return `On-chain healthy, ingestion poll stalled ${stalled} s`;
      }
      // down
      if (!chain.headReachable) return "Backend can't reach chain";
      if (!ingestion.loopRunning) return 'Ingestion loop not running';
      const stale = Math.round((Date.now() - (ingestion.lastTickAt ?? 0)) / 1000);
      return `Ingestion stale for ${stale} s`;
    }
    ```
    Single helper feeds both `title` and the modal-pretty-print in Plan C.
- New `services/nb-ui/src/pages/HealthPlaceholderModal.jsx`:
  - Title: "Network Health".
  - Body: paragraph "Detailed view coming in the next iteration." followed by a `<ul>`:
    - "Pretty-printed chain + ingestion state"
    - "Recent error log"
    - "Reconnect — restart the ingestion loop without losing the projection"
    - "Resync from block 0 — drop the projection and rebuild (destructive, sandbox-only)"
  - Footer: standard Close button.
  - Uses the shared `Modal` primitive from `components/ui.jsx`.
  - Plan C replaces this file with `NetworkHealthModal.jsx` (or keeps the filename and just replaces the body).

### Phase 2c — Layout integration

**Steps**

- In `Layout.jsx`, replace the inline `<span className={`env-pill ${isMock ? 'mock' : ''}`}>{isMock ? 'MOCK API' : 'LIVE'}</span>` with `<HealthBadge />`.
- `HealthBadge` reads `AppConfig.USE_MOCK` itself; no props needed.

### Phase 2d — Frontend tests

**Steps**

- New `services/nb-ui/tests/HealthBadge.test.jsx`:
  - Renders LIVE green when mock client returns `status: 'ok'`.
  - Renders LIVE yellow on `'degraded'`, red on `'down'`.
  - Renders MOCK API grey when `USE_MOCK=true`.
  - **Tooltip text matches the helper output** for at least one case per status — assert via `getAttribute('title')`.
  - **Click opens the placeholder modal** — `userEvent.click(badge)` then assert `getByRole('heading', { name: 'Network Health' })`. Close button dismisses.
  - Polls on mount, cleans up `setInterval` on unmount (use Vitest fake timers).

**Verification stop**

- `npm test` green (now 27+ tests). `npm run lint` green. `npm run format:check` green. `npm run build` green.

## Phase 3: Local apply + verification

### Goal

Get both rev'd pods running with the new code on the local sandbox.

### Steps

- `./services/nb-bond-api/nb-bond-api.sh start` — Helm upgrade nb-bond-api with the new image.
- `./services/nb-ui/nb-ui.sh start` — Helm upgrade nb-ui with the new bundle.
- Live AC verification:
  - `curl /v1/health | jq` — new shape, status=ok.
  - Browser at `http://web.cbdc-sandbox.local/` — top bar shows LIVE with green border.
  - **Self-heal smoke test (the critical one):**
    - `kubectl -n besu scale statefulset besu --replicas=0` (or `kubectl -n besu delete pod besu-0`).
    - `kubectl -n nb-bond-api rollout restart deployment/nb-bond-api`.
    - In the browser, top bar should go red ("DOWN"). Logs in nb-bond-api show retry messages, not a permanent "gave up".
    - `kubectl -n besu scale statefulset besu --replicas=1` (or wait for the deleted pod to come back).
    - Within ~30s, the badge flips green again. `/v1/bonds` returns the projection.

### Verification Stop

- Helm history shows the new revisions deployed.
- All ACs pass.

### Fix Iteration / Rollback

- `helm rollback nb-bond-api <prev>` if the new build behaves worse than the old.
- For self-heal regressions, the rollback returns to today's "manual pod restart" workaround — no permanent damage.

### Exit Criteria

- Self-heal smoke test passes. Health badge transitions green ↔ red as expected.

## Phase 4: Documentation + hygiene

### Steps

- `services/nb-bond-api/DEVELOPMENT.md` — add §7.x documenting the new `/v1/health` payload + status derivation rules.
- `docs/KNOWN_ISSUES.md` — strike-through the "ingestion doesn't self-heal" entry; add a "resolved in PR #X" note. Leave the request-path 500s entry intact (out of scope here; could be a separate small follow-up).
- `docs/DOCUMENTATION_INDEX.md` — entry for `docs/plans/health-indicator-and-self-healing-plan.md`.
- Run `python3 scripts/verification/check-public-repo-hygiene.py` and `check-markdown-links.py`. Both green.

### Verification Stop

- Both hygiene scripts pass.

### Exit Criteria

- Plan doc indexed. KNOWN_ISSUES updated.

## Documentation And PR Plan

- **Single PR**: `feature/health-indicator-and-self-healing` → `development`.
- PR body: Summary (1–3 bullets) + Test plan checklist (pre-push gate per `sandbox-pr-workflow` skill + live smoke).
- Commit: imperative, no AI attribution per operator preference.
- Evidence to attach in PR body:
  - `curl` output of the new `/v1/health`.
  - Screenshot or text snippet of the colour transition during the self-heal smoke.
  - Test counts (backend + frontend), lint / format / build / hygiene all green.

## Residual Risks

- **Provider state during retry**. The `provider = new JsonRpcProvider(RPC_URL)` is instantiated at module import. If DNS was unresolvable at that moment, ethers logs the warning we already see today but doesn't permanently brick the provider — subsequent `getBlockNumber()` calls retry internally. Plan B's outer retry trusts that; if it turns out the provider IS bricked, we'd swap to re-instantiating in the retry helper. Verified working today in the live smoke.
- **`lastEventTxHash` being a module variable** means it's not survived across pod restarts. Once the loop has done one tick, it's accurate. The empty-on-startup case shows as `null` in the API for a few seconds — fine, the operator sees lag in the badge tooltip.
- **Polling adds cost.** 7s × ~500 byte ETag-cached response × one operator browser = negligible. Multi-operator scale would change this — out of scope for the local sandbox.

## Done Criteria

- AC1–AC8 all verifiable on the running sandbox.
- PR merged. `feature/health-indicator-and-self-healing` deleted.
- Plan doc status flipped to "Implemented".
- The `KNOWN_ISSUES.md` entry on ingestion self-heal is resolved.
- Operator confirms the PC-restart workflow no longer requires `kubectl rollout restart`.
