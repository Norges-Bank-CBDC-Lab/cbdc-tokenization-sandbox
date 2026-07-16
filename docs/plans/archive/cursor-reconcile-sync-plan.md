# `cursor-reconcile-sync` — Implementation Plan

**Status:** Archived — superseded by `docs/plans/archive/sse-live-updates-plan.md` (2026-07-13)
**Date:** 2026-06-18
**Owner:** operator (greaker)
**Related:** rides on the merged Phase-0 health-poll hardening (#166); became a transport-upgrade target for `docs/plans/archive/sse-live-updates-plan.md`.

> This plan was not implemented as a separate health-cursor layer. The SSE
> implementation absorbed its transport-agnostic `useLiveQuery` reconciliation
> shape, while reconnect-time coarse reconciliation covers gaps without using
> `lastEventTxHash` as a second trigger.

## Goal

Make the operator UI **auto-refresh when on-chain data actually changes**, and **self-heal after a disconnect, sleep, or backgrounded tab**, by treating the backend's event cursor as authoritative:

> The client remembers the last cursor it applied. On every heartbeat it compares that against the cursor the backend reports. If they differ — or it reconnects after a gap — **the backend wins**: the client refetches its live queries (an ETag revalidation that returns fresh data, or a cheap `304`). No client-side merge, no client-side event replay.

This is the "cursor compare, server-authoritative, resync on divergence" model. It ships on the **existing `/v1/health` poll** (which already carries the cursor) and needs **no new dependency** and **little or no backend change** — so it lands independently of, and ahead of, the SSE stream. When SSE lands (`sse-live-updates-plan.md`), the same cursor simply arrives via push instead of poll.

### Non-Goals (explicitly rejected — see "Decisions")

- **A separate events/event-sourcing backend service.** The chain is already the canonical event log; nb-bond-api already projects it. Adding a second event store is redundant. Out of scope.
- **A browser-side event store with replay.** That re-implements the server's projection (`compose*`) in JavaScript and must stay byte-for-byte in sync — wrong tradeoff for a live-money operator console. We cache the *materialised result* (ETag), not an event log.
- **`lastBlockProcessed` (block number) as the change trigger.** Blocks tick ~every 1s (`blockperiodseconds: 1`) regardless of activity; using it would refetch every second. The change cursor must move *only when an event is ingested*.
- SSE itself, scoped `changed[]` resync, offline support — those belong to `sse-live-updates-plan.md`.

## Current-State Evidence

Inspected this session; **live sandbox checks are BLOCKED** (Docker daemon not running — `kind get clusters` fails with `dial unix …docker.sock: no such file`). Repo-file evidence is current; the operator runs the live stops (Phase 0 / Phase 4) after `./sandbox.sh start`.

- **The cursor already exists in the health payload.** `services/nb-bond-api/src/ingestion.ts:745` sets `lastEventTxHash = latestTxHash` only when `processBlockRange` returns a non-null `latestTxHash` (`:688`, `latest?.txHash`) — i.e. **only when a relevant event was ingested**. `lastBlockProcessed` (`:744`) advances every tick. `getIngestionStatus()` (`:85-91`) is the exact snapshot `/v1/health` serves; the field is schema'd at `services/nb-bond-api/src/schemas.ts:599` (`lastEventTxHash`, *"Most recent tx hash whose log we ingested; null before any events have been seen this process"*) alongside `lastBlockProcessed` (`:587`) and `lag` (`:590`). **So v1 needs no backend change** — the change-cursor is already on the wire.
- **The client already polls health and already exposes the right hooks.**
  - `services/nb-ui/src/hooks/useHealthPoll.js` (post-#166) polls `/v1/health`, pauses while hidden, **probes once on refocus**, and backs off while down. Its `health.ingestion.lastEventTxHash` is the cursor source; the refocus probe is the natural gap-reconcile trigger.
  - `services/nb-ui/src/hooks/useApi.js:17,43` — `useApi(fetcher, deps)` re-runs its fetch whenever `deps` change (`reload()` bumps an internal `tick`). **Adding a value to `deps` is a refetch trigger** — the whole reconcile layer can reuse this.
  - `services/nb-ui/src/api/httpClient.js:53,77-93,100-108` — GETs send `If-None-Match`; a real change returns `200` + new body + new ETag, an unchanged resource returns `304`. **A `reload()` alone yields fresh-or-304 — cache invalidation is not required for correctness**, only a refetch trigger is. (`clearCache()` is all-or-nothing; a finer `invalidate(path)` is a *nice-to-have*, not a dependency of this plan.)
- **The crude mechanisms this replaces.** `services/nb-ui/src/components/Layout.jsx:37-42` does a full `window.location.reload()` on reconnect "because component state holds stale fetches"; several pages double-pump `reload(); setTimeout(reload, 4000)` to race the 3s ingestion tick (`AuctionsPage.jsx:80-84`, `BondDetailPage.jsx:88-92`). The cursor-reconcile layer makes both obsolete.
- **No new dependency.** Pure nb-ui React logic over an existing endpoint. `vitest` is the test surface (`services/nb-ui/package.json`).

## Scope

### In Scope

- **A small nb-ui reconcile layer** (`SyncProvider` context + a `useLiveQuery` wrapper) that tracks the last-applied cursor, compares it to the cursor surfaced by `useHealthPoll`, and triggers a `reload()` of live queries on divergence — **server wins, coarse "resync the visible queries"**.
- **Wiring the existing health cursor** (`health.ingestion.lastEventTxHash`) into the provider. No backend change in v1.
- **Adopting it at the live pages** — replace the `setTimeout(reload, 4000)` double-pumps and the `window.location.reload()` reconnect with the reconcile layer.
- Unit tests (vitest) for the compare/adopt/reload state machine; a `DEVELOPMENT.md` note; index update.

### Out Of Scope

- SSE transport, scoped `changed[]` keys, SharedWorker dedup, `eth_subscribe` — all in `sse-live-updates-plan.md`.
- A separate events service or a browser event store (rejected above).
- Any backend schema change in v1 (the optional monotonic `eventSeq` is a flagged refinement, below — not v1).
- Contracts, genesis, charts, hostnames, fixtures, dependencies.

## Decisions And Open Questions

Defaults are the smallest safe local-first step. Resolve (or accept) before Phase 2.

| Decision | Options | Recommendation (default) | Needs operator? |
|---|---|---|---|
| **Cursor field** | (a) `lastEventTxHash` — already exposed, moves only on events; (b) `lastBlockProcessed` — **rejected** (ticks every block); (c) a new monotonic `eventSeq` counter | **(a) `lastEventTxHash` for v1** — zero backend change, correct change-signal. Flag **(c)** as a robustness follow-up: a monotonic counter survives a backend restart cleanly and lets a client know *how many* events it missed (incremental catch-up) rather than just "different → resync". | Confirm (a) for v1. |
| **Transport (the key choice)** | ride the existing `/v1/health` poll now / wait for the SSE stream | **Ride the poll now.** It decouples this from SSE and ships live-refresh immediately; SSE later just changes how the cursor arrives. The poll already runs (post-#166) and already carries the cursor. | **Yes — confirm shipping on the poll vs holding for SSE.** |
| **Resync scope** | (a) coarse — reload the *visible/live* queries on any cursor change; (b) scoped per-resource | **(a) coarse for v1.** The main cache is the bulky `/v1/bonds` tree, so a refetch is one ETag revalidation; coarse + `304` is cheap. Scoped resync arrives with SSE `changed[]`. | Confirm coarse. |
| **First-observation + restart handling** | how to treat `null → value` and a backend restart | **Adopt silently on `null → value`** (the page's mount fetch is already fresh — don't double-fetch). Reload only on `non-null → different-non-null`. Ignore `→ null` (backend down; nothing to resync to). After a restart, re-ingestion deterministically re-reaches the same final `txHash` ⇒ no spurious reload unless real events occurred during downtime. | Confirm the edge-rule. |
| **Reconcile API shape** | extend `useApi` for all callers / an opt-in `useLiveQuery` wrapper | **Opt-in `useLiveQuery(fetcher, deps)` = `useApi(fetcher, [...deps, generation])`.** Pages choose which queries are "live"; reuses `useApi`'s existing dep-driven reload. Avoids surprise refetches on one-shot queries. | Confirm opt-in. |

> The **transport** and **cursor-field** rows are the load-bearing ones. If shipping-on-the-poll is not wanted, **stop before Phase 2** — the rest of the plan assumes it.

## Portability Flags

This layer is pure nb-ui logic over an existing endpoint — **portable by construction**. The only flag:

- **Keep the cursor read transport-agnostic.** The `SyncProvider` consumes "the latest server cursor" from a source it doesn't own (the health hook today, an SSE heartbeat later). Don't couple it to `setInterval` or to `/v1/health` specifically — take the cursor as an input so the SSE plan can swap the source with no change to the reconcile logic. (No cloud/proxy implications; no env knobs needed in v1.)

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target |
|---|---|---|---|
| Open page auto-refreshes on change | The headline outcome | With a `#/auctions` page open and untouched, create an auction in another shell; within ≤1 heartbeat the page shows it **with no manual Refresh** | After merge |
| Quiet chain causes **no** refetch storm | Proves block-number-as-trigger was avoided | With the sandbox idle (blocks ticking, no events), observe **zero** `/v1/bonds`-class refetches over several minutes (cursor stable) | After merge |
| Refocus reconciles a missed change | Sleep/background recovery | Hide the tab, create an auction, refocus → the page reconciles on the refocus probe | After merge |
| Reconnect reconciles | Down→up recovery | Stop/restart ingestion (`POST /v1/admin/restart-ingestion`); the UI resyncs once when health recovers if events occurred | After merge |
| Crude mechanisms removed | Cleanup | No `window.location.reload()` in `Layout.jsx`; no `setTimeout(reload, 4000)` double-pumps remain | After merge |
| `none` mode unaffected | Local default | All existing vitest green; `npm run lint`/`build` clean | After merge |

## Public-Repo Safety Checks

- [ ] No secrets / keys / tokens / internal hostnames / personal data / AI-vendor names introduced (frontend logic + a Markdown plan only).
- [ ] No new dependency (per root `AGENTS.md`).
- [ ] `python3 scripts/verification/check-public-repo-hygiene.py` and `check-markdown-links.py` pass.

## Assumptions

- The post-#166 `useHealthPoll` is on `development` (it is — merged via #166).
- `lastEventTxHash` is monotonic-per-process in the sense that matters: it changes iff a new relevant event is ingested. (Confirm in Phase 0 against the running loop.)
- Data scale stays modest (single-digit MB tree), so coarse "resync visible queries" is cheap — consistent with the openapi-design "bulky tree + ETag" posture.

## Plan Order

Phase 0 (verify) → Phase 1 (confirm cursor; near-zero backend) → Phase 2 (reconcile layer) → Phase 3 (adopt at pages) → Phase 4 (tests + local e2e) → Phase 5 (docs + hygiene). Phases 2–3 are nb-ui only.

## Phase 0: Baseline Verification

### Goal
Confirm the cursor behaves as assumed before building on it.

### Steps
- Operator, with the sandbox up: `curl -s http://bond-api.cbdc-sandbox.local/v1/health | jq '.ingestion | {lastBlockProcessed, lastEventTxHash}'` twice a few seconds apart **with no on-chain activity** → `lastBlockProcessed` advances, `lastEventTxHash` **unchanged**.
- Then create an auction (UI or `cast`/CLI) → `lastEventTxHash` **changes**.
- Confirm `useHealthPoll` (post-#166) exposes `health.ingestion.lastEventTxHash`.

### Verification Stop
The two-sample check shows block-number moving while the event cursor holds, then moving on a real event.

### Fix Iteration / Rollback
If `lastEventTxHash` does **not** track events as assumed, switch the cursor decision to the monotonic `eventSeq` (Phase 1 grows a small counter) before proceeding. Nothing to roll back (read-only).

### Exit Criteria
Cursor semantics confirmed; cursor field chosen.

## Phase 1: Confirm The Sync Cursor (nb-bond-api)

### Goal
Establish `lastEventTxHash` as the documented **sync cursor** with (ideally) no code change.

### Scope
nb-bond-api docs/schema descriptions only in the default path; **optional** monotonic `eventSeq` only if Phase 0 forced it.

### Steps
- Default: add a one-line description note in `src/schemas.ts` (near `:599`) that `lastEventTxHash` is the client sync cursor. No behavioural change.
- **Optional (flagged, only if chosen):** add a monotonic `eventsIngested` counter incremented in `processBlockRange`, surface it in `getIngestionStatus()` + the health schema. Adds jest coverage. This is the robustness upgrade, not v1.

### Verification Stop
`cd services/nb-bond-api && npm test` green; `/v1/health` still validates against its schema.

### Fix Iteration / Rollback
Revert the schema note (no runtime effect).

### Exit Criteria
The cursor field is named and documented; backend unchanged behaviourally (v1).

## Phase 2: Client Reconcile Layer (nb-ui)

### Goal
A transport-agnostic "server-wins" reconcile primitive.

### Scope
New `src/sync/` (or `src/hooks/`) module + a `SyncProvider` mounted in `App.jsx`; `useLiveQuery`.

### Steps
- `SyncProvider`: holds `appliedCursor` (string\|null) + a `generation` counter. Exposes `observeCursor(serverCursor)`:
  - `serverCursor == null` → ignore.
  - `appliedCursor == null` → adopt silently (`appliedCursor = serverCursor`, no bump).
  - `serverCursor !== appliedCursor` → `appliedCursor = serverCursor`, `generation++`.
- Feed the cursor in from the existing health hook (e.g. the top-level `HealthBadge`/provider calls `observeCursor(health?.ingestion?.lastEventTxHash)` on each health update — including the refocus probe and the reconnect recovery, so gap-reconcile is automatic).
- `useLiveQuery(fetcher, deps=[]) = useApi(fetcher, [...deps, generation])` — a `generation` bump re-runs the fetch (server returns fresh-or-304). Keep `useApi` itself untouched.

### Verification Stop
`cd services/nb-ui && npm test` (new vitest: adopt-silently on first cursor; reload on change; **no reload** when cursor stable; ignore null) + `npm run lint`.

### Fix Iteration / Rollback
The layer is additive; pages not yet migrated keep working. Revert the `App.jsx` provider mount to disable.

### Exit Criteria
Reconcile state machine covered by tests; no existing test regressed.

## Phase 3: Adopt At The Live Pages (nb-ui)

### Goal
Switch the pages that show live chain data onto `useLiveQuery` and delete the crude refresh hacks.

### Scope
`BondsPage`, `BondDetailPage`, `AuctionsPage`, `BiddersPage`, `CentralBankPage`, and `Layout.jsx`.

### Steps
- Convert those pages' `useApi(...)` calls to `useLiveQuery(...)`.
- Remove the `reload(); setTimeout(reload, 4000)` double-pumps (the cursor advance now drives the refetch) — keep an explicit manual **Refresh** button as a user-initiated override.
- Replace the `window.location.reload()` reconnect in `Layout.jsx` with a `generation` bump / live-query reload.

### Verification Stop
`cd services/nb-ui && npm test && npm run lint && npm run build` all green; existing page tests updated for the new reload path.

### Fix Iteration / Rollback
Per-page; revert any single page to `useApi` if a regression appears. Low blast radius.

### Exit Criteria
Live pages refetch on cursor change; the crude mechanisms are gone.

## Phase 4: Local Apply + End-To-End Verification (operator)

### Goal
Prove the Acceptance Criteria on the running sandbox.

### Steps (operator, after `./sandbox.sh start`)
- Auto-refresh: open `#/auctions`, create an auction elsewhere, watch it appear with no manual Refresh.
- No-storm: idle the chain; confirm no `/v1/bonds`-class refetches in the network panel.
- Refocus + reconnect reconciles (hide/restore tab; restart ingestion).

### Verification Stop
All four behavioural criteria observed; `none` mode unaffected.

### Fix Iteration / Rollback
Frontend-only; revert the nb-ui change (no backend/chain/state impact, nothing persisted).

### Exit Criteria
Behavioural criteria met on the live sandbox.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal
Capture the model and keep the repo public-safe.

### Steps
- `services/nb-ui/DEVELOPMENT.md`: a short "Live data: cursor-reconcile" note (cursor = `lastEventTxHash`; server-wins; `useLiveQuery`).
- `docs/KNOWN_ISSUES.md`: note the post-mutation `setTimeout(reload, 4000)` race is removed.
- Defer all branch/commit/PR/CI detail to `sandbox-pr-workflow`.

### Verification Stop
`python3 scripts/verification/check-public-repo-hygiene.py && python3 scripts/verification/check-markdown-links.py` pass.

### Fix Iteration / Rollback
Docs-only.

### Exit Criteria
Docs updated; hygiene green.

## Follow-up (separate work)

- **SSE transport swap** (`sse-live-updates-plan.md`): point `observeCursor` at the SSE heartbeat instead of the poll, and use SSE `changed[]` to make the resync **scoped** rather than coarse. The reconcile logic is unchanged.
- **Monotonic `eventSeq` cursor**: clean restart semantics + incremental catch-up ("you are N behind") instead of "different → resync".
- **Finer `HttpClient.invalidate(path)`**: only needed if coarse revalidation proves too chatty (unlikely at this scale).
