# Auction Web Fixes — Implementation Plan

**Status:** Draft, ready for operator review
**Branch suggestion:** `feature/auction-web-fixes` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `services/nb-bond-api/src/{compose.ts,index.ts,schemas.ts,chain.ts}`, `services/nb-bond-api/openapi.json` (regen), `services/nb-bond-api/tests/`, `services/nb-ui/src/pages/AuctionDetailPage.jsx`, `services/nb-ui/tests/`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`

## Goal

Fix four issues the operator hit while running an auction in the web UI: (1) "clearing yield" is shown while the auction is still `open` even though it's only a speculative number, (2) the "allocation hash" KPI has no explanation and its DTO description is inaccurate, (3) an auction can't be closed after its end time because the local Besu clock lags wall-clock, and (4) contract custom-error reverts (e.g. `InBidPhase()`) surface as opaque 500s instead of clear 409s. After this, clearing yield only appears once the auction is `closed` (labelled "proposed") and `finalised` ("final"); the allocation-hash KPI has an accurate tooltip; closing a past-end auction succeeds; and a genuine before-end close returns a clear 409.

## Current-State Evidence

Verified this session (live + repo):
- **Chain**: `infra/besu/config/genesis.json:7-8` → Clique `blockperiodseconds: 1`, **`createemptyblocks: false`**. Live: latest block `#99`, timestamp **~1421s (24 min) behind** wall-clock; block deltas are irregular (158/33/96/6401/22 s) → **Besu stamps new blocks at wall-clock when mined**, not parent+period.
- **Close handler**: `services/nb-bond-api/src/index.ts:650-703`. Precheck at `:680-689` uses `Date.now()` (passes once wall-clock > end). Send at `:693` is `bondManager.closeAuction(isin, { nonce })` — **no `gasLimit`**, so ethers v6 runs `eth_estimateGas` against the **stale latest block** → `block.timestamp <= end` → reverts `InBidPhase()` before broadcast. (A real mined block would be stamped at wall-clock > end and succeed.)
- **Custom-error decode pattern** already exists: `index.ts:357-415` (disable handler) loops `iface.parseError(data)`. Auction errors are defined in `contracts/src/common/Errors.sol`; `InBidPhase()` selector `0xeec5b85e`. Reverts bubble from **BondAuction** (`chain.ts:143 getBondAuction`), so must be parsed with `bondAuction.interface`. RFC 7807 via `src/http.ts` `conflict()` / `buildProblem()`.
- **Clearing yield**: backend `compose.ts:397` computes a speculative allocation in the `else if (unsealedBids && metadata.offering > 0n)` branch (clearing rate/hash) regardless of status — `unsealedBids` is computed at `:263-266` even while `open` (the API holds the auctioneer key). On-chain the clearing rate first exists at `FINALISED` (`BondAuction.finaliseAuction`); the on-chain path is `compose.ts:371`. Frontend gates the KPI only on truthiness: `AuctionDetailPage.jsx:202` (`auction.allocation?.clearingRate ?`), sub-label `:208`.
- **Allocation hash**: computed off-chain by `allocation.ts buildAllocationHash` (ISIN + type + clearing rate + allocations); rendered at `AuctionDetailPage.jsx:211-213`. **No on-chain allocation hash exists** (contracts carry a `// TODO: Post root of bids` at `BondManager.sol:279`), so the DTO description `schemas.ts:142` ("…matches on-chain") is inaccurate.
- **Tooltip house pattern**: native `title=` attribute (e.g. the "Sealing public key" `<dt title=…>` on the same page; `RadioGroup`/`HealthBadge` use the same). No custom tooltip component.
- **Status values**: auction status enum is `open | closed | finalised | rejected | cancelled` (`schemas.ts`). AllocationCard already gates on `status !== 'open' && status !== 'cancelled'` (`AuctionDetailPage.jsx:429`).
- **Tests**: `services/nb-bond-api/tests/` (jest; `allocation.test.ts`, `http.test.ts`, `state.test.ts`, `validation.test.ts`, …). `services/nb-ui/tests/` (vitest; `AllocationCard.test.jsx`, …) — **no `AuctionDetailPage` test exists yet**.

## Scope

### In Scope
- Backend: gate the speculative allocation to non-`open` states; explicit `gasLimit` on `closeAuction`; extract `decodeCustomError` + map `InBidPhase → 409` on close (and reuse on disable); fix the `allocation.hash` DTO description; regen `openapi.json`.
- Frontend: gate the clearing-yield KPI on status with Proposed/Final sub-label; add an accurate `title` tooltip to the allocation-hash KPI.
- Tests: unit test for `decodeCustomError`/close-error mapping; assert compose leaves `allocation` null while `open`; a focused nb-ui test for the clearing-yield gate if low-cost.
- Docs: refresh the `KNOWN_ISSUES.md` close-timing entry; register this plan in the index.

### Out Of Scope
- **No genesis change.** `createemptyblocks` stays `false` (operator decision — API-layer fix only). Flipping it to fix chain-time at the root is noted as a future option, not done here.
- On-chain allocation-hash posting (the `BondManager.sol:279` TODO) — separate contract work.
- Reworking the off-chain clearing algorithm; BUYBACK has no single clearing rate (leave as today).

## Decisions And Open Questions

| Decision | Choice |
|---|---|
| When to show clearing yield | **From `closed` as "Proposed", "Final" at `finalised`; hidden while `open`** (backend stops exposing it while open; UI gates + relabels). |
| Close-timing fix | **API-layer only**: explicit `gasLimit` to skip the stale `estimateGas`; keep the `Date.now()` precheck; decode `InBidPhase → 409`. No genesis change. |
| Allocation-hash tooltip + DTO | Add native `title` tooltip; correct the `schemas.ts` description (drop "matches on-chain"); regen `openapi.json`. |

No open questions — both design decisions are resolved.

## Acceptance Criteria

| Criterion | Verification evidence |
|---|---|
| Clearing yield hidden while `open` | API `GET /v1/auctions/{id}` for an `open` auction returns `allocation: null`; UI shows "—" / "Awaiting close". |
| Clearing yield shows proposed/final | `closed` → value with "Proposed" sub-label; `finalised` → "Final". |
| Allocation-hash tooltip | Hovering the KPI label shows the accurate text; DTO description no longer claims on-chain; `openapi.json` regenerated + committed. |
| Past-end close succeeds | With wall-clock past end, `PATCH /v1/auctions/{id}` (status=closed) returns 200 and the auction is `closed` on-chain (no `InBidPhase` revert). |
| Before-end close → clean 409 | Before end (or `testMode` boundary), the API returns a 409 with a friendly detail naming the bidding window — not a 500. |
| Custom errors decoded | `decodeCustomError` maps `InBidPhase` (and is reused on the disable path); unknown reverts still propagate. |
| Gates green | nb-bond-api lint/format/test/build + `regen:openapi`; nb-ui format/lint/test/build; hygiene + markdown-links. |

## Plan Order

```
Phase 0  Baseline (reproduce: open auction shows clearing yield; past-end close fails)
Phase 1  nb-bond-api backend (Fix 1 gate, Fix 2 DTO+regen, Fix 3 gasLimit, Fix 4 decode) + tests
Phase 2  nb-ui frontend (Fix 1 UI gate + sub-label, Fix 2 tooltip) + test
Phase 3  Local rebuild + live verification
Phase 4  Docs (KNOWN_ISSUES refresh, index) + hygiene
```

One PR (`sandbox-pr-workflow`), one commit (repo convention). Backend + frontend ship together because the clearing-yield fix spans both and the regen'd `openapi.json` is the contract between them.

## Phase 0: Baseline

### Goal
Reproduce and record current behavior so the fix is provable.

### Steps
- Confirm an `open` auction's `GET /v1/auctions/{id}` currently includes a non-null `allocation.clearingRate` (speculative) and the UI shows it.
- Confirm a past-end close currently fails (capture the error shape — opaque 500 / revert).
- Re-confirm chain lag: latest block timestamp vs wall-clock.

### Verification Stop / Exit
- Baseline behaviors captured (for PR evidence).

## Phase 1: nb-bond-api backend

### Goal
All four backend changes, behind unit tests, with `openapi.json` regenerated.

### Steps
- **Fix 1 (gate speculative allocation):** in `compose.ts`, guard the `else if` proposed-allocation branch (`:397`) so it only runs when the auction is **closed** (not `open`; the on-chain path at `:371` already covers finalised). Verify the exact `status` representation at `compose.ts:340` and gate accordingly so `allocation` stays `null` while `open`.
- **Fix 2 (DTO accuracy):** edit `schemas.ts:142` description to drop "matches on-chain" (e.g. "Off-chain commitment to the computed allocation result (clearing rate + per-bidder units); recomputed server-side at finalisation."). Run `npm run regen:openapi` and commit `openapi.json`.
- **Fix 3 (close survives stale-chain gas estimation — upgrade-robust):** keep the `Date.now()` precheck (`:680-689`) as the validity gate. Send `closeAuction` normally first (ethers estimates gas); if it fails and `decodeCustomError` (Fix 4) identifies `InBidPhase()` — the stale-latest-block false-revert, given the precheck already confirmed wall-clock > end — retry the send **once** with an explicit, generous, **env-overridable** `gasLimit` (e.g. `NB_BOND_API_CLOSE_GAS_LIMIT`, default ~2–3M) so ethers skips the stale `eth_estimateGas`. The retried tx mines at a fresh wall-clock timestamp > end and succeeds. This is consensus/client-agnostic (gasLimit is a standard tx field) and **self-adapts to the planned QBFT + Besu upgrade**: if the new setup produces regular blocks (chain time tracks wall-clock), estimation succeeds on the first try and the fallback never fires; if it still avoids empty blocks, the fallback handles it — no code change needed at upgrade time. Tighten the precheck message if useful.
- **Fix 4 (decode custom errors):** add `decodeCustomError(err, ifaces[])` (in `chain.ts`, where contract interfaces live) that reads `(err as {data?}).data` and returns the first `iface.parseError(data)?.name`. Wrap the `closeAuction` send (`index.ts:691-694`) in a try/catch using `[bondAuction.interface, bondManager.interface]`; map `InBidPhase → conflict(...)` (409) with a friendly detail; rethrow unknown reverts. Refactor the disable handler (`index.ts:357-415`) to reuse the helper.

### Verification Stop
- `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build` — green.
- New/updated tests: `decodeCustomError` maps `InBidPhase`→409 and passes unknown through; `composeAuction` leaves `allocation` null for an `open` auction.
- `git diff openapi.json` reflects only the description change.

### Fix Iteration / Rollback
- Pure service change; revert the files. The `gasLimit` value can be tuned if a real close ever needs more gas (local chain only).

### Exit Criteria
- Backend builds + tests green; `openapi.json` regenerated.

## Phase 2: nb-ui frontend

### Goal
UI reflects the lifecycle and explains the allocation hash.

### Steps
- **Fix 1:** `AuctionDetailPage.jsx:202` — require `auction.status !== 'open'` in addition to `allocation?.clearingRate`. Sub-label `:208` → `open` "Awaiting close" / `closed` "Proposed" / `finalised` "Final". Keep consistent with `AllocationCard` gating.
- **Fix 2:** add `title="…"` (the accurate off-chain-commitment text) to the allocation-hash `kpi-label` at `:211`; optionally `style={{ cursor: 'help' }}`.

### Verification Stop
- `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build` — green.
- Add a focused test (extend or new) asserting clearing yield is hidden while `open` and shown when `closed`, if low-cost given there's no existing `AuctionDetailPage` test.

### Exit Criteria
- Frontend builds + tests green.

## Phase 3: Local rebuild + live verification

### Goal
Prove end-to-end on the running sandbox.

### Steps
- Rebuild + redeploy: `./services/nb-bond-api/nb-bond-api.sh start` and `./services/nb-ui/nb-ui.sh start` (content-hash images rebuild on source change).
- Verify: an `open` auction shows no clearing yield (API `allocation: null`); create a short auction, let wall-clock pass end, `PATCH` close → **200, auction closed** (no `InBidPhase`); attempt a before-end close → **clean 409**; allocation-hash tooltip renders at `http://web.cbdc-sandbox.local/`.

### Verification Stop
- `kubectl -n nb-bond-api` + `-n nb-ui` pods Ready; `curl` against `http://bond-api.cbdc-sandbox.local/v1/health`; browser smoke at `http://web.cbdc-sandbox.local/`.

### Fix Iteration / Rollback
- `helm -n <ns> rollback` the affected release if a pod misbehaves.

### Exit Criteria
- All acceptance criteria pass live.

## Phase 4: Docs + public-repo hygiene

### Steps
- `docs/KNOWN_ISSUES.md`: refresh the close-timing entry (`~112-134`) to record that the API now sends `closeAuction` with an explicit gas limit (so a past-end close succeeds despite the idle-chain clock lag) and decodes `InBidPhase → 409`; note `createemptyblocks:false` remains the accepted baseline.
- `docs/DOCUMENTATION_INDEX.md`: register this plan.
- `python3 scripts/verification/check-public-repo-hygiene.py` + `check-markdown-links.py` green. (No dependency/image/license change → no third-party-license check.)

### Exit Criteria
- Docs accurate; hygiene green.

## Documentation And PR Plan

Branch / commit / PR / CI-gate detail defers to `sandbox-pr-workflow`. One PR `feature/auction-web-fixes → development`, single commit. Evidence for the PR body: before/after on the `open`-auction `allocation`, a successful past-end close, a before-end 409, and the tooltip. CI that will fire: `format-lint-test` (nb-bond-api), `format-lint-test-build` (nb-ui), `validate-publication-hygiene`.

## Residual Risks
- **`gasLimit` fallback skips simulation on retry:** a genuinely-invalid close would broadcast and revert on-chain instead of failing at estimate — but the `Date.now()` precheck already blocks before-end closes, the fallback only fires on a decoded `InBidPhase` after that precheck passed, and reverts are free on the local chain and decode to a clear 409.
- **Upcoming QBFT + Besu upgrade (operator-flagged):** Fix 3 is intentionally consensus/client-agnostic — it keys off the wall-clock precheck + ethers `gasLimit` with an estimate-then-fallback, so it remains valid after the upgrade. If the new setup enables regular block production, the fallback becomes dormant (estimation succeeds first try). No change required at upgrade time beyond re-verifying a past-end close; the env-overridable gas limit absorbs any opcode-repricing drift.
- **Status representation in `compose.ts`:** confirm whether `status` is the string enum or numeric before gating (Phase 1) to avoid mis-gating.
- **No `AuctionDetailPage` test today:** adding one is best-effort; the gate logic mirrors the already-tested `AllocationCard`.
- **Root cause unaddressed:** chain time still lags for any *other* time-gated path; documented, not fixed (operator chose API-layer only).

## Done Criteria
- All acceptance criteria met live; backend + frontend gates green; `openapi.json` regenerated; docs refreshed; hygiene green; plan moved to `docs/plans/archive/` on ship.
