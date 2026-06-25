# WNOK (Central Bank) Page Enhancement — Implementation Plan

**Status:** Draft, ready for operator review
**Branch suggestion:** `feature/wnok-allowlist-enrichment` — defer the branch / commit / PR / CI workflow to `sandbox-pr-workflow`
**Components touched:** `services/nb-bond-api/` (enrich the central-bank allowlist read), `services/nb-ui/` (CentralBankPage allowlist rendering), docs.

## Goal

Make the existing WNOK allowlist on the Central Bank page legible: each allowlisted address should show *what it is* — a bank, a TBD contract, the government reserve, a bidder, or the Central Bank itself — instead of today's "—" for anything not in the bidder roster, and (optionally) its WNOK balance. The add / remove / list UI **already exists**; this is enrichment only. Built in the Central Bank page's own style — **not** by reusing the TBD page's components — so the WNOK surface can evolve independently.

## Current-State Evidence

- `services/nb-ui/src/pages/CentralBankPage.jsx` already renders the WNOK allowlist (add via `AllowlistAddModal`, list, per-row remove). `allowlistLabel()` labels bidders (from the roster) + the CB account; everything else renders "—".
- `GET /v1/central-bank/allowlist` returns address-only entries (`AllowlistEntry { address, md5 }`) — `services/nb-bond-api/src/index.ts` + `schemas.ts`.
- The banking roster + registry resolution already exist (`services/nb-bond-api/src/banking-tbd.ts`: `TBD_BANKS`, `listConfiguredBanks`, `resolveRegisteredAddress`) and can be reused to recognise bank + TBD-contract addresses.
- **Needs verification (Phase 0):** which addresses are actually on the WNOK allowlist today (are the TBD contracts? the gov reserve?) — read live.

## Scope

### In Scope

- **Backend:** enrich the central-bank allowlist entry with a server-resolved `entity` label (`{ kind: 'bank' | 'tbd' | 'gov-reserve' | 'bidder' | 'central-bank' | 'unknown', name? }`) and, optionally, each entry's WNOK `balance`. The enriched DTO lives in the central-bank region of `schemas.ts` as its **own** shape (not `TbdToken`).
- **Frontend:** render the label (+ balance) in the existing allowlist table; keep add/remove unchanged.

### Out Of Scope

- The TBD page (shipped). Cross-bank `cct`. Deploy-a-new-bank. Any change to the WNOK contract itself.

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| Labels only vs labels + balances | labels / labels + balances | Labels first (the legibility win); balances as a fast follow if wanted | Confirm |
| Where labelling lives | backend-enriched DTO / frontend-resolved | Backend-enriched — keeps the client thin and lets the WNOK surface own its shape | Confirm |
| Recognise TBD *contracts* on the allowlist | yes / no | Yes — that's the missing piece; resolve via the banking roster + GlobalRegistry | Confirm |

## Acceptance Criteria

| Criterion | Verification evidence |
|---|---|
| WNOK allowlist shows banks + TBD contracts labelled (not "—") | UI + `curl /v1/central-bank/allowlist` shows `entity` |
| Add / remove still work unchanged | existing flows exercised |
| (if balances) each entry shows its WNOK balance | matches `cast call <wnok> "balanceOf(address)"` |
| Tests + hygiene green | jest / vitest; `check-public-repo-hygiene.py` + `check-markdown-links.py` |

## Plan Order

```
Phase 0  Baseline — sandbox up; read the live WNOK allowlist + what's on it
Phase 1  Backend — enrich the allowlist entry DTO with entity labels (+ optional balance) + tests
Phase 2  Frontend — render labels/balances in the existing CentralBankPage table + tests
Phase 3  Local apply + end-to-end verification (curl + UI)
Phase 4  Docs + public-repo hygiene
```

## Phases

**Phase 0 — Baseline.** Start the sandbox if down; `curl /v1/central-bank/allowlist`; note which TBD contracts / banks / gov-reserve are present. Exit: current membership captured.

**Phase 1 — Backend.** Add an `entity` (and optional `balance`) to the allowlist entry; resolve kinds via the banking roster + GlobalRegistry + bidder roster. jest. Verify with `npm test -w nb-bond-api` and `npm run regen:openapi`. Rollback: additive — revert the module.

**Phase 2 — Frontend.** Render the label/balance in the existing allowlist table; vitest. Verify via `npm test -w nb-ui` + build (nb-ui verification is build/lint/test — no browser preview).

**Phase 3 — Apply + verify.** Redeploy both services; `curl` shows `entity`; the UI shows labels; add/remove still work.

**Phase 4 — Docs + hygiene.** Update `services/nb-bond-api/README.md`, `services/nb-ui/README.md`, `docs/ARCHITECTURE.md`; run the hygiene scripts.

## Residual Risks

- Address→entity resolution must stay cheap (sandbox-scale allowlist) — cache the roster/registry lookups per request.
- Keep the central-bank DTO independent of `TbdToken` so the WNOK page can diverge over time.

## Done Criteria

- WNOK allowlist entries are labelled (banks + TBD contracts at minimum); add/remove unchanged; tests + hygiene green; docs updated.
