# Auction Finalisation Winner-Selection — Implementation Plan

**Status:** Implemented — verified live on the local sandbox; pending PR. (Move to `docs/plans/archive/` once the PR merges, with the PR link in this status line.)
**Branch suggestion:** `feature/auction-finalisation-winner-selection` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `services/nb-bond-api/src/{schemas.ts,compose.ts,index.ts,allocation.ts,types.ts}`, `services/nb-bond-api/openapi.json`, `services/nb-bond-api/tests/`, `services/nb-ui/src/api/auctionsApi.js`, `services/nb-ui/src/pages/{AuctionDetailPage.jsx,AuctionLifecyclePanel.jsx}`, `docs/{ARCHITECTURE.md,KNOWN_ISSUES.md}`

## Goal

When a Norges Bank operator deselects bids in the "Select winners & finalise" modal, the on-chain mint must reflect that selection. Today the selection never leaves the browser: the modal computes a clearing rate from the picked bids for display, but the API call carries only `{ allocationHash, approve }`, and the backend finalises the **full** close-time allocation. The result is a bond minted at the wrong coupon (verified: auction `0xe6f6…0db5` minted at 4500 bps / 45% because a fat-finger 4500 bps bid was never actually dropped).

After this change, the frontend sends only the **winning selection** (as on-chain `bidIndex` values) plus the operator's **expected clearing rate**. The backend re-fetches the sealed bids from chain, unseals them, recomputes the uniform-price allocation + clearing rate + allocation hash + bidder proofs over **only the selected subset**, cross-checks its recomputed rate against the operator's expectation (rejecting on mismatch), and submits that to `BondManager.finaliseAuction`. The backend is the sole authority for the economic terms; UI math is display-only. Done means: a partial-winner finalise on a fresh local auction mints a `couponYield` equal to the selected subset's clearing rate, and a tampered expected rate is rejected with a clear error.

## Current-State Evidence

- **Docs read:** plan template (`templates/implementation-plan.md`); this plan area maps to the shipped `services/nb-ui` precedent and `docs/plans/auction-web-fixes-plan.md` neighbour.
- **Repo declarations inspected:**
  - UI drop point — `services/nb-ui/src/pages/AuctionLifecyclePanel.jsx:238` and `:589` pass `(approve, winners)`; `services/nb-ui/src/pages/AuctionDetailPage.jsx:85` `doFinalise(approve)` discards `winners`; mutation at `AuctionDetailPage.jsx:37-39`; API client `services/nb-ui/src/api/auctionsApi.js:60-65` sends only `{ allocationHash, approve }`. UI clearing rate = `max(selected rates)` at `AuctionLifecyclePanel.jsx:182-194`.
  - Backend endpoint — `services/nb-bond-api/src/index.ts:755-846`; reuses full close-time allocation `auction.allocation.entries` (`index.ts:787-793`), re-fetches + unseals bids (`index.ts:801-811`), builds proofs by **bidder address** with a positional fallback (`index.ts:813-833`), submits at `index.ts:836`. Tamper check against full-set hash at `index.ts:769-771`.
  - Allocation — `computeUniformAllocation` (`services/nb-bond-api/src/allocation.ts:23-81`) clearing rate = marginal accepted bid; `buildAllocationHash` (`allocation.ts:136-157`). `Allocation` keys by bidder only (no `bidIndex`).
  - DTOs — `unsealedBidSchema` / `sealedBidSchema` (`services/nb-bond-api/src/schemas.ts:159-188`) have no `bidIndex`; `finaliseBodySchema` (`schemas.ts:699-709`) = `{ allocationHash, approve }`; OpenAPI path registered `schemas.ts:1243-1256`; regen via `services/nb-bond-api/scripts/regen-openapi.ts` → `services/nb-bond-api/openapi.json`.
  - Compose — `services/nb-bond-api/src/compose.ts:116-123` builds the unsealed bid DTO; `compose.ts:266` `unsealBid(isin, b, i)` makes the **array index = on-chain bidIndex**; bids array order matches `getSealedBids` order (`compose.ts:349-364`).
  - Tests — `services/nb-bond-api/tests/allocation.test.ts`, `bid.test.ts`, `validation.test.ts` present; no finalisation-endpoint integration test yet.
- **Live local checks (this session):**
  - Cluster context `kind-cluster-cbdc-monoledger`; Besu `eth_chainId` = `0x7e2` (2018).
  - `GET http://bond-api.cbdc-sandbox.local/v1/auctions/0xe6f6…0db5` → RATE, **finalised**, 8 bids incl. `0xa426…224b` @ **4500 bps / 1000 units**; allocation `clearingRate=4500`, all entries 4500, `totalAllocated=2000`.
  - `cast call <BondToken> getCouponDetails("PO9384674360")` → `couponYield = 4500`; `BondAuction.getAuctionStatus(0xe6f6…0db5)` = `3` (FINALISED). Confirms the wrong coupon is locked on chain.
- **Local validation entry points:** `npm test` (per-package, nb-bond-api Jest + nb-ui), `npm run lint` / format, `node services/nb-bond-api/scripts/regen-openapi.ts` (confirm exact invocation via package scripts), service rebuild + restart via `./services/nb-bond-api/nb-bond-api.sh` and `./services/nb-ui/nb-ui.sh` (confirm verb with the script's own usage), `curl` against `bond-api.cbdc-sandbox.local`, `cast call` against the BondToken/BondAuction.
- **Blocked or unverified checks:** the besu gateway route `http://besu.cbdc-sandbox.local/` returned nginx 404 for JSON-RPC POST this session; chain reads were done via `kubectl port-forward -n besu svc/besu 8545` instead. Not in scope here, but flag for `sandbox-doc-maintainer` / stack-verifier if the documented RPC host path is wrong.

## Scope

### In Scope

- Expose the on-chain `bidIndex` on the bid DTO (`UnsealedBid`, and `SealedBid` for symmetry).
- Change the finalise request body to carry the winning selection (`winningBidIndexes`) and the operator's `expectedClearingRate`; remove the now-redundant `allocationHash` field.
- Backend approve path: filter unsealed bids to the selected `bidIndex` set, recompute uniform-price allocation + clearing rate + hash + proofs over the subset, cross-check against `expectedClearingRate`, submit.
- Thread `bidIndex` through `computeUniformAllocation` / the `Allocation` type so proof pairing is unambiguous for duplicate bidders (fixes the latent `index.ts:813-833` ambiguity).
- UI: forward the selection (as `bidIndex` values) and the expected rate from the modal through `doFinalise` → mutation → API client.
- Tests (nb-bond-api allocation subset + finalisation validation), OpenAPI regen, docs.

### Out Of Scope

- **Remediating the existing bad auction `0xe6f6…0db5`.** It is finalised on chain; there is no un-finalise / closed→open transition (`docs/KNOWN_ISSUES.md`, `auctionsApi.js:54-58`). Correcting it would require a brand-new auction for the bond — operator decision, separate task.
- Close-time outlier guard (operator declined).
- Broad rework of the modal's display math (operator declined "align UI calc"). Note the narrow exception in Decisions D2: the **single** `expectedClearingRate` value the UI sends for the cross-check must be computed consistently with the backend, which is a contained change, not a display rework.
- Any contract (`.sol`) change — the contract already accepts a caller-supplied allocation; no Solidity edit is needed.
- Chart values, image pins, genesis, Kind config — none touched (code-only service change).

## Folder And File Placement

No new components or folders. All edits land in existing files (see Components touched). No new top-level directory, no new chart, no new hostname.

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| **D1 — Finalise body shape** | (a) Replace `{ allocationHash, approve }` with `{ approve, winningBidIndexes, expectedClearingRate }` (winners + rate required only when `approve=true`); (b) keep `allocationHash` as an extra optional commitment | **(a)** — the recompute + cross-check make a UI-supplied hash redundant, and the server is now the sole authority. Conditional-required via zod `superRefine` on `approve`. Follow nb-bond-api OpenAPI conventions (array-of-scalar, no wrapper). | ✅ **Resolved: (a) — drop `allocationHash`.** |
| **D2 — How the UI's `expectedClearingRate` is computed (cross-check semantics)** | (a) UI computes it with the **same marginal-fill rule** as the backend so the check is an exact equality; (b) keep the UI's current `max(selected)` and make the cross-check **directional** | **(a)** for an exact, unambiguous check — it's a single contained number, distinct from the declined broad display rework. | ✅ **Resolved: (a) — exact match; UI sends a marginal-fill `expectedClearingRate` via a small contained helper. Backend requires exact equality.** |
| **D3 — Selection identifier** | on-chain `bidIndex` vs array index vs bidder address | **`bidIndex`** — bidder address is ambiguous (this auction has duplicate bidders); raw array index is fragile across refetch ordering. | ✅ **Resolved: `bidIndex`.** |

## Portability Flags

- None introduced. The change is service code behind existing env-driven config; no new hardcoded hostnames or URLs. (Pre-existing besu RPC host-routing quirk noted above is unrelated and not addressed here.)

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Partial-winner finalise mints the subset's clearing rate | The core bug | On a fresh local RATE auction with an outlier bid, deselect the outlier, approve; `cast call <BondToken> getCouponDetails(<isin>)` → `couponYield` equals the subset clearing rate (e.g. 425), **not** the outlier (4500) | Pass |
| On-chain allocation excludes deselected bids | Tokens only to winners | `BondAuction.getAllocations(<id>)` contains only selected bidders; `totalAllocated` matches the subset | Pass |
| Cross-check rejects a mismatched expected rate | Safeguard works | `PUT …/finalisation` with a tampered `expectedClearingRate` → 4xx with a clear error; no on-chain tx sent (block number unchanged) | Pass |
| Duplicate-bidder selection pairs proofs correctly | Avoids mis-allocation | Local auction where one bidder submits two bids, select one; finalise succeeds and allocates only the selected `bidIndex` | Pass |
| `bidIndex` present on unsealed bid DTO | UI can address bids | `GET /v1/auctions/<id>` unsealed bids include `bidIndex`; `GET /v1/openapi.json` shows it on `UnsealedBid` | Pass |
| Reject path still works | No regression | `PUT …/finalisation { approve:false }` → auction rejected, no winners required | Pass |
| Unit + lint + build green | CI gate parity | nb-bond-api `npm test`/lint, nb-ui `npm test`/lint/build pass locally (per `sandbox-pr-workflow`) | Pass |
| Pods Ready after restart | Steady state | `kubectl get pods -A` clean for `nb-bond-api` / `nb-ui` namespaces; helm history shows new revision `deployed` | Pass |

## Assumptions

- The bids array order returned by `getSealedBids` is stable within a finalisation (the same source feeds both the DTO `bidIndex` and the proof rebuild), so a `bidIndex` captured by the UI maps to the same on-chain bid at submit time. (Safe: both derive from one `getSealedBids` call per request and the on-chain array is append-only.)
- No Solidity change is needed; `BondManager.finaliseAuction` already accepts a caller-built allocation array.
- `expectedClearingRate` is expressed in bps as a string, matching `bpsSchema` used elsewhere.

## Plan Order

```
Phase 0  Baseline verification (fresh test auction + capture current behaviour)
Phase 1  Backend + frontend implementation and unit tests
  1a  nb-bond-api: bidIndex on DTO + thread through allocation/Allocation type
  1b  nb-bond-api: finalise body schema (D1) + endpoint recompute/cross-check/proofs
  1c  nb-bond-api: OpenAPI regen + unit tests
  1d  nb-ui: forward selection (bidIndex) + expectedClearingRate (D2)
Phase 2  (omitted — no chart / pin / fixture changes)
Phase 3  Local apply: rebuild + restart nb-bond-api then nb-ui
Phase 4  Post-change verification (partial-winner finalise + cross-check reject, on-chain evidence)
Phase 5  Docs + public-repo hygiene
```

## Phase 0: Baseline Verification

### Goal

Prove the current (buggy) behaviour on a fresh, disposable local auction so Phase 4 can show the delta — without touching the already-finalised production-of-record auction.

### Steps

- Confirm context: `kind get clusters` → `cluster-cbdc-monoledger`; `kubectl config current-context` → `kind-cluster-cbdc-monoledger`; `eth_chainId` via `kubectl port-forward -n besu svc/besu 8545:8545` then `cast chain-id --rpc-url http://127.0.0.1:8545`.
- Create a fresh RATE auction with bids that include one outlier (mirror the failing case: ~7 normal bids ~400 bps + one 4500 bps), via the reference CLI / UI / API. Record its auction id + ISIN.
- Close it; capture `GET /v1/auctions/<id>` allocation (`clearingRate` will be the marginal = 4500 with the outlier present).

### Verification Stop

- The fresh auction reproduces the bug class: finalising the full set (current code) would clear at the outlier rate. (Do **not** finalise the baseline auction at 4500 unless a throwaway is wanted purely to demonstrate the before-state; prefer leaving it `closed` and using it as the Phase 4 subject.)

### Fix Iteration / Rollback

- If the sandbox is down (cluster missing / hosts entries absent), stop and run `./sandbox.sh start`; otherwise proceed against repo files and mark live claims `Needs verification`.

### Exit Criteria

- A `closed` test auction id + ISIN recorded for Phase 4, with a known outlier bid and known expected subset clearing rate.

## Phase 1: Local Implementation And Tests

### Goal

Implement Design B end-to-end and prove it with unit tests before any cluster restart.

### Steps

**1a — `bidIndex` on the DTO + through the allocation path (`schemas.ts`, `compose.ts`, `allocation.ts`, `types.ts`)**
- Add `bidIndex: z.number().int().nonnegative()` to `unsealedBidSchema` and `sealedBidSchema` (`schemas.ts:159-188`); regenerate types.
- In `compose.ts` pass the array index into `composeUnsealedBid` / `composeSealedBid` (`compose.ts:116-123`, `:349-364`) — the index already equals the on-chain bidIndex (`compose.ts:266`).
- Extend the internal `Allocation` type (`types.ts`) and `computeUniformAllocation` (`allocation.ts:43-81`) to carry `bidIndex` per allocation entry, so a filled allocation pairs back to exactly one unsealed bid (and one proof) even when a bidder has multiple bids. `buildAllocationHash` input stays the same shape (hash is over bidder/units/rate/auctionType — do **not** add bidIndex to the hashed tuple, to keep the on-chain commitment unchanged).

**1b — Finalise body + endpoint (`schemas.ts`, `index.ts`)** — applies D1 + D2
- Replace `finaliseBodySchema` (`schemas.ts:699-709`) with `{ approve: boolean, winningBidIndexes?: number[], expectedClearingRate?: string(bps) }`; `superRefine` to require `winningBidIndexes` (non-empty) and `expectedClearingRate` when `approve === true`. Update the OpenAPI registration (`schemas.ts:1243-1256`) and exported `FinaliseBody` type.
- Rework the approve path (`index.ts:785-837`):
  1. Re-fetch + unseal bids (reuse existing `getSealedBids` + `unsealBid`, `index.ts:801-811`).
  2. Validate every `winningBidIndexes` entry exists in the unsealed set; reject unknown/duplicate indices.
  3. Build the selected `UnsealedBid[]` subset and run `computeUniformAllocation` (or `computeBuybackAllocation`) over **only** that subset → `{ clearingRate, allocations(with bidIndex), allocationHash }`.
  4. **Cross-check (D2 — exact match):** compare recomputed `clearingRate` to `expectedClearingRate`; on any inequality throw `badRequest` with both values in the message (no tx sent).
  5. Build `allocPayload` from `result.allocations`, and proofs by pairing each allocation to its unsealed bid **via `bidIndex`** (replaces the bidder-address matching at `index.ts:813-833`).
  6. Submit via the existing `sendWithManagedNonce` → `bondManager.finaliseAuction`.
- Remove the full-set `allocationHash` tamper check (`index.ts:769-771`); the recompute + cross-check supersede it. Reject path (`approve=false`) keeps current behaviour and needs no winners.

**1c — OpenAPI + unit tests (`openapi.json`, `tests/`)**
- Regenerate `services/nb-bond-api/openapi.json` (via the package's regen script).
- Extend `tests/allocation.test.ts`: clearing rate over a subset excluding the outlier; partial-fill marginal rate; duplicate-bidder subset pairs to the right `bidIndex`.
- Add a finalisation validation/unit test: body schema conditional-required rules; cross-check mismatch rejection. (Use the existing test harness; an on-chain submit is covered in Phase 4, not here.)

**1d — Frontend wiring (`auctionsApi.js`, `AuctionDetailPage.jsx`, `AuctionLifecyclePanel.jsx`)**
- `finaliseAuction(auctionId, { approve, winningBidIndexes, expectedClearingRate })` — body carries the selection (`auctionsApi.js:60-65`).
- `doFinalise(approve, winners)` accepts and forwards winners; `finaliseMut` passes them through (`AuctionDetailPage.jsx:37-39`, `:85`).
- In `FinaliseModal`, map the selected row set to **`bidIndex` values** (read `b.bidIndex` from the DTO, not the array position). Add a small helper that computes `expectedClearingRate` with the **same marginal-fill rule** as `computeUniformAllocation` (sort selected by rate, fill to offering, take the marginal) and send that value. The modal's existing `max(selected)` display summary can stay; only the single sent value uses the marginal-fill helper. Cover the helper with a unit test asserting parity with the backend on an over-subscribed fixture.

### Verification Stop

- nb-bond-api: `npm test` (Jest) + ESLint/format green; new allocation + finalisation tests pass.
- nb-ui: `npm test` + ESLint/format + `npm run build` green (per the nb-ui CI gate; see `sandbox-pr-workflow`).
- `git diff services/nb-bond-api/openapi.json` shows only the intended `bidIndex` + `FinaliseBody` changes.

### Fix Iteration / Rollback

- All Phase 1 work is local/uncommitted; revert files if tests fail. No cluster state touched yet.

### Exit Criteria

- Green unit tests + lint + build for both packages; OpenAPI regenerated and reviewed.

## Phase 3: Local Apply / Restart

### Goal

Apply the smallest safe change to the running sandbox: rebuild and restart the two affected services only.

### Steps

- Rebuild + restart **nb-bond-api** first (API contract producer), then **nb-ui** (consumer), via each service's lifecycle script (`./services/nb-bond-api/nb-bond-api.sh …`, `./services/nb-ui/nb-ui.sh …` — confirm the exact verb from the script usage; prefer the narrowest rebuild+restart over `./sandbox.sh start`). This follows the repo's local image-build → kind-registry → helm flow.

### Verification Stop

- `kubectl get pods -A | grep -Ev '\sRunning|\sCompleted'` empty for the nb-bond-api / nb-ui namespaces.
- `kubectl -n <ns> get events --sort-by=.lastTimestamp | tail -10` shows no warnings on the restarted workloads.
- `helm -n <ns> history <release>` shows a new revision `deployed` for each.
- `curl -sI http://bond-api.cbdc-sandbox.local/` and `http://web.cbdc-sandbox.local/` return 200/expected; `GET /v1/openapi.json` shows the new `FinaliseBody` + `bidIndex`.

### Fix Iteration / Rollback

- Chart upgrade gone wrong: `helm -n <ns> rollback <release> <previous-rev>` (image pins/genesis untouched, so rollback is clean).
- No contract redeploy, no genesis/Kind edit → no destructive rollback path.

### Exit Criteria

- Both services Ready on a new helm revision; new OpenAPI surface live.

## Phase 4: Post-Change Verification

### Goal

Prove the fix end-to-end on the running sandbox with on-chain evidence.

### Steps

- Using the Phase 0 `closed` test auction: in the UI, deselect the outlier (or `PUT /v1/auctions/<id>/finalisation` with `winningBidIndexes` excluding the outlier + the correct `expectedClearingRate`), approve.
- Read back: `cast call <BondToken> "getCouponDetails(string)(uint256,uint256,uint256,uint256,uint256)" <isin>` → `couponYield` = subset clearing rate (e.g. 425), not 4500.
- `cast call <BondAuction> "getAllocations(bytes32)(...)" <id>` → only selected bidders; `BondAuction.getAuctionStatus` = `3`.
- Negative test: `PUT …/finalisation` with a wrong `expectedClearingRate` → 4xx; capture `eth_blockNumber` before/after to show no tx was sent.
- Duplicate-bidder test: finalise a selection that includes one of a bidder's two bids; confirm only that `bidIndex` is allocated.
- Confirm chain head advancing (`eth_blockNumber` twice ~1s apart).

### Verification Stop

- All Acceptance Criteria rows produce their listed evidence.

### Fix Iteration / Rollback

- If the minted coupon is still wrong, capture the request body + the backend's recomputed allocation log and iterate on Phase 1b; the test auction is disposable.

### Exit Criteria

- Partial-winner finalise mints the correct subset coupon; cross-check rejects tampered input; duplicate-bidder pairing correct. Evidence captured for the PR.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal

Leave docs accurate and the repo public-safe.

### Steps

- `docs/ARCHITECTURE.md`: update the bid/finalisation flow + trust boundary to state that the backend recomputes the allocation from the operator-selected `bidIndex` set and cross-checks the operator's expected rate (server is authoritative; UI is display-only).
- `docs/KNOWN_ISSUES.md`: if the winner-selection gap is listed, mark it resolved; add a one-line note that already-finalised auctions can't be corrected in place (new auction required).
- `services/nb-bond-api/README.md` / `DEVELOPMENT.md`: note the `FinaliseBody` shape change (selection + expected rate; `allocationHash` removed) and the `bidIndex` DTO field.
- `docs/DOCUMENTATION_INDEX.md`: this plan is indexed normally (it does not reference `.claude/`); add the entry, move to `docs/plans/archive/` when shipped.

### Verification Stop

- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- `check-third-party-licenses.py` not required (no dependency / image / third-party changes).

### Fix Iteration / Rollback

- Fix flagged links / hygiene findings before PR.

### Exit Criteria

- Hygiene + link checks pass; docs reflect the new flow.

## Documentation And PR Plan

Branch naming (`feature/<kebab>` → `development`), commit / PR style, per-package pre-push gates, and CI gate names are owned by `sandbox-pr-workflow` — consult it; do not restate here.

- **PR 1 (single PR preferred):** the full change — nb-bond-api (DTO + body + endpoint + tests + OpenAPI) and nb-ui (wiring), plus docs. It's one coherent behaviour change across producer + consumer; splitting would ship a UI that sends fields the API doesn't yet accept, or an API contract with no caller. If the operator prefers two PRs, land **nb-bond-api first** (backward-compatible-tolerant of missing winners during the gap is **not** guaranteed — so the UI PR must follow immediately, same review cycle).
- **Docs / runbooks to update:** `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md`, `services/nb-bond-api/README.md`/`DEVELOPMENT.md`, `docs/DOCUMENTATION_INDEX.md`.
- **Evidence to include in PR body:** before/after `couponYield` cast output for a partial-winner finalise (e.g. 4500 → 425), the cross-check rejection response + unchanged block number, the duplicate-bidder pairing result, and green test/lint/build logs.

## Residual Risks

- **Cross-check semantics under over-subscription (D2).** With the exact-match check, if the UI's marginal-fill helper diverges from the backend's `computeUniformAllocation` logic, valid finalisations could be spuriously rejected. Mitigation: the UI helper mirrors the backend rule and is covered by a unit test asserting parity on an over-subscribed fixture; keep the two in sync if the allocation algorithm ever changes.
- **`bidIndex` stability.** Relies on `getSealedBids` returning an append-only, stably-ordered array. True for the current contract; if a future contract change reorders or prunes sealed bids, the UI's captured index could drift. Low risk; note for any future BondAuction change.
- **Dropping `allocationHash` (D1)** is a breaking change to the endpoint contract. Acceptable for an internal sandbox API with a single first-party UI consumer, but any external script calling `PUT …/finalisation` must update.
- **No on-chain validation backstop.** `BondAuction.finaliseAuction` still trusts the caller's allocation (only `RatesMustMatch`); the backend remains the sole economic authority. This change makes the backend correct but does not add an on-chain check (out of scope, no Solidity edit).

## Done Criteria

- A partial-winner finalise on a fresh local auction mints a `couponYield` equal to the selected subset's clearing rate (verified via `cast`), deselected bids are absent from `getAllocations`, and a tampered `expectedClearingRate` is rejected without sending a tx.
- nb-bond-api and nb-ui pass their CI-equivalent local gates; OpenAPI regenerated; docs + index updated; public-repo hygiene + markdown-link checks pass.
- The existing finalised auction `0xe6f6…0db5` is explicitly documented as not in-place fixable (new auction required) — no attempt made to mutate it.

## Implementation Evidence (live, local sandbox)

Verified on auction `0x159a9d9e…24e0` (ISIN `PS3486794560`, RATE, offering 2000), a real 7-bid auction closed and finalised through the new path:

- **Deselection now reaches the chain.** Full-set clearing rate was **402 bps** (what the old code would have minted). Finalising the subset `winningBidIndexes=[0,1,3,5,6]` (deselecting idx 2 @ 415 and idx 4 @ 402) minted **`couponYield = 378 bps`** on `BondToken.getCouponDetails("PS3486794560")` — the subset's marginal rate, not 402.
- **Deselected bids excluded on-chain.** The on-chain allocation (`allocation.entries`) contains only the 5 selected bidders at a uniform 378 bps, `totalAllocated = 1980`; idx 2 and idx 4 are absent.
- **Duplicate-bidder pairing correct.** Bidder `0xa426…224b` had three bids (idx 2, 4, 6); only the selected idx 6 was allocated — proving `bidIndex` pairing, not bidder-address matching.
- **Cross-check rejects tampering.** `PUT …/finalisation` with `expectedClearingRate="999"` returned **HTTP 400** (`server recomputed 378 bps … expected 999 bps. No allocation was submitted.`) and the chain block number was unchanged (111 → 111) — no tx broadcast.
- **Gates green.** nb-bond-api: `tsc` clean, ESLint + Prettier clean, **126** Jest tests pass (incl. new subset/marginal/bidIndex/schema tests). nb-ui: ESLint + Prettier clean, `vite build` OK, **63** Vitest tests pass (incl. new marginal-fill parity tests). `openapi.json` regenerated (`FinaliseBody` drops `allocationHash`, adds `winningBidIndexes`/`expectedClearingRate`; `BidIndex` component added).
