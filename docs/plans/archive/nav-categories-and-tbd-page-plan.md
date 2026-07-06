# Nav Categories + Banking / TBD Page — Implementation Plan

**Status:** ✅ Implemented and shipped — merged via #179 (nav categories + Banking/TBD page in one PR); follow-ups shipped separately: tester-role access to the Banking page (#198), bank creation (#200). The Central Bank/WNOK allowlist enrichment was split out to `docs/plans/central-bank-wnok-allowlist-enrichment-plan.md`.
**Branch suggestion:** `feature/nav-categories` (PR1) and `feature/banking-tbd-page` (PR2) — defer branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `services/nb-ui/` (nav, router, capabilities, new Banking page + modals, new API module), `services/nb-bond-api/` (new `/v1/banking/tbd/*` route surface, schemas, Tbd ABI, ingestion), docs (`ARCHITECTURE.md`, `nb-ui` + `nb-bond-api` READMEs, `DOCUMENTATION_INDEX.md`). No contract changes.

## Goal

Give the sandbox operator a **Banking → TBD** page that surfaces every deployed tokenized-bank-deposit token (one per bank) and lets the operator manage it — view supply / bank / reserve backing / holders, edit the allowlist, and mint / burn / transfer — mirroring the existing Central Bank (WNOK) surface. This unblocks **coupon-payout testing**, which settles into bank-money (TBD). Because the top nav cannot absorb another flat item, first refactor it into **categories with dropdowns**, then hang the TBD page off a new **Banking** category. When done, the operator can, in the local sandbox, list the Nordea and DNB TBDs, change an allowlist, and mint/burn/transfer TBD with the result confirmable on-chain via `cast`.

## Current-State Evidence

- **Docs read:** root `AGENTS.md` / `README.md` conventions (prior sessions), `docs/ARCHITECTURE.md` on-chain/off-chain sections, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`.
- **Repo declarations inspected:**
  - `contracts/src/private-bank/Tbd.sol` — per-bank ERC-20 (`decimals = 0`), `Allowlist` + `AccessControl`, WNOK-reserve-backed. Surface: `mint(account,value)` (MINTER_ROLE), `burn(account,value)` (BURNER_ROLE), allowlist `add`/`remove`/`allowlistQuery*` (inherited), `transfer`/`transferFrom` (allowlist-gated via `_update`), `getBankAddress()`, `govReserve` / `isGovernmentNominated()`, `decimals()=0`, and the cross-bank `cctFrom` / `cctSetToAddr` / `onTransferReceived` settlement path (DvP / WNOK driven).
  - `contracts/script/private-bank/04_Tbd.s.sol` + `08_TbdSetup.s.sol` — deploys **two** TBDs (Nordea, DNB) with `admin = bank` (the bank is its own admin/minter/burner), `wnok`/`dvp` from `GlobalRegistry`, `govReserve` from `PK_GOV_RESERVE` (Nordea) / `address(0)` (DNB); registers each in `GlobalRegistry` by `name()`; allowlists retail investors (Alice→Nordea, Bob→DNB) + CSD, mints 10 000 initial.
  - `services/nb-ui/src/components/Layout.jsx` — flat top-bar nav via `navItem(key,label,href)`; items Bonds / Auctions / Bidders / Central Bank (last gated by `canAccessCentralBank`).
  - `services/nb-ui/src/hooks/useRoute.js` — custom hash router; sections `bonds` / `auctions` / `bidders` / `central-bank` (no react-router).
  - `services/nb-ui/src/auth/capabilities.js` — `capabilitiesForAccount` → `{ canUseApp, canAccessCentralBank }`; `none` mode = fully open, gating only in `entra` mode (operator role → `canAccessCentralBank`).
  - `services/nb-ui/src/pages/CentralBankPage.jsx` + `MintWnokModal` / `BurnWnokModal` / `TransferWnokModal` / `AllowlistAddModal` + `src/api/centralBankApi.js` — the exact page/modal/API pattern to mirror per-TBD.
  - `services/nb-bond-api/src/index.ts` — `/v1/central-bank` surface: `GET /v1/central-bank`, `GET/PUT/DELETE /v1/central-bank/allowlist[/:address]`, `POST /v1/central-bank/wnok/{mint,burn,transfer}`, all behind `requireAnyRole(operatorRoles)`.
- **Live local checks:** **BLOCKED — sandbox is down this session** (`kind get clusters` failed: Docker daemon not running; RPC to `http://besu.cbdc-sandbox.local:8545/` did not respond). Live enumeration of the deployed TBD addresses/supplies is deferred to Phase 0.
- **Local validation entry points:** `npm test -w nb-ui` (vitest), `npm test -w nb-bond-api` (jest), `npm run build` per workspace, `./services/nb-ui/nb-ui.sh start`, `./services/nb-bond-api/nb-bond-api.sh start`, `cast call <tbd> "totalSupply()(uint256)"`, `curl http://bond-api.cbdc-sandbox.local/v1/banking/tbd`.
- **Blocked / unverified:** deployed TBD addresses, current supplies, allowlist membership, GlobalRegistry entries — all `Needs verification` in Phase 0 once the sandbox is up.

## Scope

### In Scope

- **PR1 — Nav refactor (frontend-only, no behaviour change):** convert the flat top nav into **top-bar dropdown categories** — Central Bank (wNOK, Coupon payout), Securities (Bonds, Stocks, Auctions, Bidders), Banking (TBD). Existing routes keep working; new/not-yet-built sub-pages (Coupon payout, Stocks, TBD) render a "coming soon" placeholder until built. Add a `canAccessBanking` capability parallel to `canAccessCentralBank`.
- **PR2 — Banking / TBD page (full stack):**
  - nb-bond-api read surface: `GET /v1/banking/tbd` (list deployed TBDs: bank, name, symbol, totalSupply, reserve backing, gov-nominated flag) and `GET /v1/banking/tbd/:id` (detail incl. allowlist + holder balances).
  - nb-bond-api write surface: `PUT/DELETE /v1/banking/tbd/:id/allowlist/:address`, `POST /v1/banking/tbd/:id/{mint,burn,transfer}`, operator-gated, signed with the owning bank's key.
  - nb-ui Banking page: TBD list → detail with allowlist editor + Mint / Burn / Transfer modals (mirrors CentralBankPage), wired under the Banking category.

### Out Of Scope (future / separate)

- **Deploy a new bank's TBD from the UI** (operator-chosen: manage existing first). Tracked as a fast follow-up — needs a new deploy endpoint + form.
- **Coupon payout page** and **Stocks page** (nav placeholders only here).
- **Cross-bank `cct` transfer test action** and a **roles editor** per TBD (phase-2 candidates).
- **Contract hardening of `cctSetToAddr`** (no access control — in-code `//TODO`). To be folded into the ERC-3643 contract refactor (ADR 0002) — the planned window to revisit all contracts, TBD included; see Residual Risks.

## Folder And File Placement

| Item | Path | Rationale |
|---|---|---|
| Banking page | `services/nb-ui/src/pages/BankingPage.jsx` | Mirrors `CentralBankPage.jsx` placement |
| TBD modals | `services/nb-ui/src/pages/{MintTbdModal,BurnTbdModal,TransferTbdModal}.jsx` | Mirrors the `*WnokModal.jsx` set (reuse `AllowlistAddModal`) |
| Frontend API | `services/nb-ui/src/api/bankingApi.js` | Mirrors `centralBankApi.js` |
| Backend route module | `services/nb-bond-api/src/banking/tbd.ts` | Mirrors the `central-bank` module imported in `index.ts` |
| Tbd ABI | `services/nb-bond-api/src/abi/Tbd.json` | New; alongside existing `BondManager.json` etc. |
| Plan doc | `docs/plans/archive/nav-categories-and-tbd-page-plan.md` | This file (single-file plan convention; archived after shipping) |

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| **D1 Nav taxonomy** *(resolved)* | — | Central Bank: wNOK, Coupon payout · Securities: Bonds, Stocks, Auctions, Bidders · Banking: TBD | ✅ chosen |
| **D2 Nav UX** *(resolved)* | — | Top-bar dropdown categories | ✅ chosen |
| **D3 Add-a-bank deploy** *(resolved)* | — | Manage existing TBDs in v1; deploy-new deferred | ✅ chosen |
| **D4 Sequencing** *(resolved)* | — | Nav refactor PR1, then TBD page PR2 | ✅ chosen |
| **D5 Banking RBAC gate** *(resolved)* | — | Add `canAccessBanking`, operator-gated parallel to central bank; `none` mode open | ✅ yes |
| **D6 Signer selection** *(resolved, refined)* | — | UI **bank-selector dropdown** lists the configured banks (name/address — **never private keys**); the operator chooses which bank signs and the API maps the choice to a server-side key. Enabled in **both** `none` (sandbox) and `entra` (azure). Key-custody model revisited later. | ✅ refined |
| **D7 TBD discovery** *(resolved)* | — | v1: config list (`TBD_*_CONTRACT_NAME`) resolved via `GlobalRegistry`. **Future:** add a `GlobalRegistry` view returning all TBDs (enumeration) for dynamic discovery — also supports deploy-new-bank. | ✅ yes |
| **D8 v1 read depth** *(resolved)* | — | Enriched: reserve backing (bank WNOK vs TBD supply), per-holder balances, gov-nominated flag; defer cross-bank `cct` history + roles editor | ✅ enriched |
| **D9 `cctSetToAddr` hardening** *(resolved)* | — | **Not a separate PR.** Folded into the ERC-3643 contract refactor (ADR 0002), which is the window to revisit all contracts (TBD included). Out of scope for this UI work. | ✅ defer to ERC-3643 refactor |

## Portability Flags

- **D6 signer custody.** The bank-selector + server-side per-bank signing is enabled in both `none` and `entra` modes per operator request, but a real deployment would not have one operator service holding multiple commercial banks' keys. Private keys are **never** sent to the client — the dropdown lists bank identities (name/address) and the server maps the choice to a key. Keep the `/v1/banking/tbd/*` HTTP surface identical so the transport contract survives a later non-local signing model; the key-custody model itself is to be revisited.
- Hostnames stay env-derived (`*.cbdc-sandbox.local` via `rootDnsZone`); no new hostname is introduced (TBD rides the existing `bond-api` + `web` hosts).

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Nav shows 3 dropdown categories; every existing route still resolves | Refactor must not regress navigation | `npm test -w nb-ui` green; manual click-through of Bonds/Auctions/Bidders/Central Bank | PR1 |
| Not-yet-built sub-pages show a placeholder, not a broken route | Avoid dead links | Click Coupon payout / Stocks / (pre-build) TBD → placeholder | PR1 |
| `GET /v1/banking/tbd` lists Nordea + DNB with correct supply + bank | Core read | `curl .../v1/banking/tbd` vs `cast call <tbd> "totalSupply()(uint256)"` / `"getBankAddress()(address)"` | PR2 |
| Allowlist add/remove + mint/burn/transfer change on-chain state | Core write | API call → `cast call <tbd> "allowlistQuery(address)(bool)"` / `"balanceOf(address)(uint256)"` reflects it | PR2 |
| Operator gating holds in `entra`, open in `none` | RBAC correctness | `403` on `/v1/banking/*` for non-operator token; open in `none` | PR2 |
| `npm test` (both workspaces) + `forge test` unaffected, builds pass | No regressions | jest + vitest green; `npm run build` per workspace | PR1, PR2 |
| Docs + index updated; hygiene scripts pass | Public-repo maintainability | `check-public-repo-hygiene.py`, `check-markdown-links.py` pass | PR2 |

## Assumptions

- The Tbd contract surface is stable (no contract change needed for v1).
- nb-bond-api can resolve TBD addresses from `GlobalRegistry` by name exactly as it resolves WNOK/bonds today.
- Sandbox fixtures provide the bank keys (`PK_NORDEA`, `PK_DNB`) the API needs to sign per-bank writes.

## Plan Order

```
Phase 0  Baseline verification (sandbox up; enumerate deployed TBDs)
Phase 1  Nav category refactor — frontend-only            ── PR1 ──
Phase 2  nb-bond-api /v1/banking/tbd read + write + tests  ┐
Phase 3  nb-ui Banking/TBD page + nav wiring + tests       ├─ PR2 ─
Phase 4  Local apply + end-to-end verification             ┘
Phase 5  Docs + public-repo hygiene
```

## Phase 0: Baseline Verification

### Goal
Prove the starting state before changing anything.

### Steps
- `./sandbox.sh start` (sandbox is currently down); then `kind get clusters` → `cluster-cbdc-monoledger`, `kubectl config current-context` → `kind-cluster-cbdc-monoledger`.
- Resolve and read the two TBDs: `cast call <GlobalRegistry> "getContract(string)(address)" "<TBD_NORDEA_CONTRACT_NAME>"` (and DNB), then `name() / symbol() / totalSupply() / getBankAddress() / decimals() / govReserve()` on each.
- Confirm current nav routes load (`http://web.cbdc-sandbox.local/`) and `GET /v1/health` is OK.

### Verification Stop
- Both TBD addresses resolve and return sane values; record them in the PR as the baseline.

### Fix Iteration / Rollback
- If a TBD name/address can't be resolved, reconcile with `08_TbdSetup` env names before proceeding.

### Exit Criteria
- Deployed TBD inventory captured; nav baseline confirmed.

## Phase 1: Nav Category Refactor (PR1, frontend-only)

### Goal
Replace the flat nav with dropdown categories, no behaviour change to existing pages.

### Scope
`services/nb-ui/src/components/Layout.jsx`, `src/auth/capabilities.js`, `src/hooks/useRoute.js` (placeholder routes), `src/App.jsx` (placeholder pages), nav tests.

### Steps
- Introduce a category model (Central Bank / Securities / Banking) rendered as accessible top-bar dropdowns; preserve the active-state collapse (bond→bonds, auction→auctions).
- Add `canAccessBanking` to `capabilities.js` (operator-gated in `entra`, open in `none`); gate the Banking and Central Bank categories.
- Add placeholder routes + a shared "coming soon" page for `coupon-payout`, `stocks`, and `tbd` (pre-build) so dropdown items resolve.
- Keep all existing hrefs (`#/bonds`, `#/auctions`, `#/bidders`, `#/central-bank`) working.

### Verification Stop
- `npm run format:check -w nb-ui && npm run lint -w nb-ui && npm test -w nb-ui && npm run build -w nb-ui` all green.
- Manual: each existing page reachable; placeholders render; keyboard/focus works on dropdowns.

### Fix Iteration / Rollback
- Frontend-only and behind a single PR; revert the PR if nav regresses.

### Exit Criteria
- Dropdown nav merged; existing routes intact; placeholders in place.

## Phase 2: nb-bond-api `/v1/banking/tbd` (read + write) + tests

### Goal
Expose the TBD surface the page needs, mirroring `/v1/central-bank`.

### Scope
`services/nb-bond-api/src/banking/tbd.ts` (new), `src/index.ts` (route wiring + `requireAnyRole(operatorRoles)`), `src/schemas.ts` (DTOs), `src/abi/Tbd.json`, ingestion/compose if TBD reads need projection, jest tests.

### Steps
- Resolve the configured TBD names (D7) via `GlobalRegistry`; read `name/symbol/totalSupply/getBankAddress/decimals/govReserve` + bank WNOK balance (reserve backing) + allowlist membership with `balanceOf` per holder.
- Implement writes signed by the owning bank's key (D6): allowlist `add`/`remove`, `mint`, `burn`, `transfer`.
- Follow existing nb-bond-api conventions (bulky resource tree, md5/ETag caching, RFC 7807 errors, dual auth) — see the `openapi-design` skill and the `/v1/central-bank` precedent.

### Verification Stop
- `npm run lint -w nb-bond-api && npm run format:check -w nb-bond-api && npm test -w nb-bond-api && npm run build -w nb-bond-api` green (new jest coverage for list/detail/allowlist/mint/burn/transfer, incl. 403 in `entra`).
- `npm run regen:openapi -w nb-bond-api` if schemas changed; commit the regenerated `openapi.json`.

### Fix Iteration / Rollback
- New routes are additive; remove the route module to revert.

### Exit Criteria
- Endpoints return correct data against the running sandbox (verified in Phase 4).

## Phase 3: nb-ui Banking / TBD page + nav wiring + tests

### Goal
Build the operator page and replace the TBD placeholder.

### Scope
`services/nb-ui/src/pages/BankingPage.jsx`, the three TBD modals, `src/api/bankingApi.js`, route + capability wiring, vitest.

### Steps
- TBD list (cards per bank: name, symbol, supply, reserve-backing indicator, gov flag) → detail with allowlist editor (reuse `AllowlistAddModal`) + Mint/Burn/Transfer modals (mirror the WNOK modals; whole-unit inputs because `decimals=0`).
- `available:false` empty state when the API can't resolve TBDs (mirror CentralBankPage).
- Replace the Banking placeholder route with the real page.

### Verification Stop
- `npm run format:check -w nb-ui && npm run lint -w nb-ui && npm test -w nb-ui && npm run build -w nb-ui` green.

### Fix Iteration / Rollback
- Page is additive behind the Banking category; revert PR2 if needed.

### Exit Criteria
- Page renders against the live API (verified in Phase 4).

## Phase 4: Local Apply + End-to-End Verification (PR2)

### Goal
Prove the feature works end-to-end on the running sandbox.

### Steps
- Rebuild + restart the two services: `./services/nb-bond-api/nb-bond-api.sh start` then `./services/nb-ui/nb-ui.sh start` (content-hash image build + redeploy).
- `curl http://bond-api.cbdc-sandbox.local/v1/banking/tbd` → matches `cast` reads from Phase 0.
- In the UI: add an address to a TBD allowlist, mint to it, transfer between two allowlisted holders, burn — confirm each via `cast call <tbd> "balanceOf(address)(uint256)"` / `"allowlistQuery(address)(bool)"`.
- Confirm `403` on `/v1/banking/*` with a non-operator token in `entra` mode (or note it's covered by jest if `entra` isn't running locally).

### Verification Stop
- `kubectl get pods -n nb-bond-api -n nb-ui` Ready, no restarts; on-chain reads match UI actions.

### Fix Iteration / Rollback
- `helm -n <ns> rollback` or redeploy the previous image tag per `sandbox-stack-verifier`.

### Exit Criteria
- All Acceptance Criteria rows for PR2 pass with captured evidence.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal
Leave docs accurate and the repo public-safe.

### Steps
- `docs/ARCHITECTURE.md` — add the Banking/TBD operator surface + nav category model.
- `services/nb-ui/README.md` / `DEVELOPMENT.md` — new page + nav structure; `services/nb-bond-api/README.md` / `DEVELOPMENT.md` — new `/v1/banking/tbd/*` surface + any new env (TBD names, bank keys).
- `docs/DOCUMENTATION_INDEX.md` — this plan (added with the plan) and any new docs.

### Verification Stop
- `python3 scripts/verification/check-public-repo-hygiene.py` and `python3 scripts/verification/check-markdown-links.py` pass.

### Exit Criteria
- Docs updated; hygiene green.

## Documentation And PR Plan

Branch / commit / PR / CI gates owned by `sandbox-pr-workflow`.

- **PR1:** nav category refactor (frontend-only). Gates: `format-lint-test-build` (nb-ui), `validate-publication-hygiene`.
- **PR2:** Banking/TBD full stack. Gates: `format-lint-test` (nb-bond-api), `format-lint-test-build` (nb-ui), `validate-publication-hygiene`, plus `validate-node-version` if any package.json changes.
- **Docs to update:** as Phase 5.
- **Evidence in PR body:** Phase 0 baseline reads, the `curl` ↔ `cast` comparison, and the UI-action → on-chain confirmation.

## Residual Risks

- **Per-bank key custody (D6)** is a sandbox-only convenience and must not leak into a non-local deployment design.
- **`cctSetToAddr` has no access control** (in-code `//TODO`). Out of scope here; to be addressed during the **ERC-3643 contract refactor (ADR 0002)** — the planned window to revisit all contracts, TBD included — before any cross-bank `cct` test action is built (a later feature would otherwise expose it through the UI).
- **TBD discovery via config list (D7)** won't see a bank deployed after startup until the config/registry-enumeration follow-up lands — acceptable while deploy-from-UI is deferred.

## Done Criteria

- PR1 merged: dropdown nav live, no route regressions.
- PR2 merged: Banking/TBD page lists Nordea + DNB and performs allowlist / mint / burn / transfer, confirmed on-chain in the local sandbox; docs updated; hygiene green.
