# NB UI correctness and hardening — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan written from the 2026-09-28 review; findings re-verified against `db92409`
**Current phase:** not started
**Next action:** Get the operator's answers on the three open decisions in `design.md` (bidder restore endpoint, web fonts, `RefreshState` fold-in), then run Phase 0: record `npm test -w nb-bond-api` counts next to the nb-ui baseline below, check whether the `ingestion-projection-correctness` history fix and the TBD government-path removal are merged or scheduled, and branch `feature/nb-ui-crash-and-session-safety` from `development` for Phase 1.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline | Not started | nb-ui: 25 files, 125 tests passing (`npx vitest run`, 2026-09-28) | — |
| 1 — Crash and session safety | Not started | | |
| 2 — Coupon and bonds correctness | Not started | | |
| 3a — Bidder soft delete (API) | Not started | | |
| 3b — Bidder soft delete (UI) | Not started | | |
| 4 — Bond history card | Blocked | Waits for the history fix in `ingestion-projection-correctness` | |
| 5 — Serving hardening | Not started | | |
| 6 — Cleanup and docs | Not started | | |
| 7 — Duplication (optional) | Not started | | |
| 8 — Test backfill (optional) | Not started | | |
| 9 — Fixture drift guard (optional) | Not started | | |

## Deviations From the Plan

None yet. Corrections to the review findings made while writing the plan:

- **U4 mechanism refined.** The crash is total only on initial load or reload (the throw
  happens in the `useState` initialiser during render). On an in-app `hashchange` the throw
  happens in the event listener, so the route silently fails to change instead of crashing.
  Both are fixed by the same change.
- **U8 guard wording.** Confirmed the API only blocks unrevealed sealed bids on open auctions
  (`app.ts:896-924`); it also blocks with 503 when the chain cannot be read. The UI comment at
  `BiddersPage.jsx:7` is the overstatement, not the API.
- **U8 side effect found.** Hard-deleting every bidder makes `seedFixtureBiddersIfEmpty`
  reseed the fixture roster on the next API start; soft delete removes that surprise. The
  fixture-override reconcile must carry `disabled_at` over.
- **Selectors.** `selectAllAuctions` is also unused outside `selectors.js` (only
  `selectOpenAuctions` calls it); it stays as an internal helper.
- **Dockerfile comment (43-45).** Wrong in the other direction from the review note: Vite copies
  `public/config.js` into `dist/`, so the image does ship a `config.js`; the ConfigMap mount
  masks it.
- **Additional stale doc items** folded into Phases 5 and 6 because they sit in the package
  docs: `DEVELOPMENT.md` claims nginx defaults are "permissive enough" (the image sends no CSP
  at all) and mislabels the OpenAPI plan link at line 33. Two related items are owned by the
  `documentation-refresh` plan and left out here: the stale `docs/KNOWN_ISSUES.md`
  reopen-auction entry and the cloud-wording lines in `services/nb-ui/DEVELOPMENT.md`.
- **U1 status set.** The API enum is exactly `staged, auctioning, outstanding, matured`
  (`services/nb-bond-api/src/contracts/bonds.ts:17`), so adding `matured` is sufficient for the
  tiles to sum.

No finding was dropped.

## Verified So Far

- Every finding in `design.md` "Repository Evidence" marked Verified — read in the repository
  at `db92409` on 2026-09-28.
- nb-ui test baseline 25 files / 125 tests — `npx vitest run` in `services/nb-ui` on
  2026-09-28.
- The API finalisation route never reads `testMode` and the OpenAPI operation does not declare
  it — `services/nb-bond-api/src/app.ts:729` onwards and `src/contracts/auctions.ts:266-279` on
  2026-09-28.
- `entraAuth.handleUnauthorized()` is idempotent and `noneAuth`'s is a no-op — read on
  2026-09-28.
- The current `dist/` contains two source maps of about 1.2 MB each plus `config.template.js`,
  `config.js`, and the logo — `ls -la services/nb-ui/dist` on 2026-09-28 (a local build from
  2026-09-15).
- `nbUIBundleHash` hashes all of `src/` and `public/`, so file removals in Phase 6 change the
  image tag without touching the hash inputs — `common/helpers.sh:1817-1832` on 2026-09-28.

## Blocked / Waiting On

- Phase 4 — the history endpoint fix in `ingestion-projection-correctness` (newest-first query
  with the `before` cursor applied in SQL).
- Phase 5 step 7 — the operator's web-font decision (self-hosting needs licence approval with
  double confirmation).
- Phase 3a/3b restore endpoint — the operator's decision.

## Follow-ups Found Along the Way

- Refresh errors are also swallowed on `BiddersPage`, `BondDetailPage`, `GlobalRegistryPage`,
  and `OperationsPage` (no `RefreshState`) — proposed fold-in into Phases 2–3; otherwise a
  follow-up.
- The `testMode` query-parameter descriptions in `services/nb-bond-api/src/contracts/bonds.ts`
  and `src/contracts/auctions.ts` (and so `openapi.json`) name a specific GitOps tool — already
  owned by the `documentation-refresh` plan.
- `/v1/bonds/:isin/history` parses `before` and `limit` with `Number()` instead of the defined
  `historyQuerySchema` (`services/nb-bond-api/src/app.ts:561-575`) — already in scope of
  `ingestion-projection-correctness` (query validated at the boundary).
- The nb-bond-api chart has no `resources` or `automountServiceAccountToken: false` either —
  separate API chart change if wanted.
- Unknown hash sections silently fall back to the Bonds page (`useRoute.js:51`) — a dedicated
  "not found" state is a possible follow-up; not changed here.
- Exposing `UNIT_NOMINAL` (or computed payout amounts) from the API would remove the UI's
  mirror of contract constants (also noted in the archived coupon-closure plan).

## Cross-Plan Dependencies

- `ingestion-projection-correctness`: must land its history ordering and cursor fix before
  Phase 4.
- A separate hardening change (role-based UI visibility, auth-mode handling): Phase 1 edits `httpClient.js` and `LiveUpdatesProvider.jsx`, Phase 6 edits
  `auctionsApi.js`; rebase whichever lands second. Neither plan should change the other's
  behaviour.
- TBD government-path removal: whichever lands first removes the Banking page tile; if the API
  drops `government` first without the UI edit, the Banking page throws (contained by the Phase 1
  error boundary if that has landed).
- `documentation-refresh`: owns the `docs/KNOWN_ISSUES.md` reopen entry and the nb-ui
  cloud-wording lines (`DEVELOPMENT.md:107`, `:247-250`, `debugSettings.js:18`,
  `entraAuth.js:2`); this plan owns every other nb-ui doc fix. Both edit
  `services/nb-ui/DEVELOPMENT.md`; rebase whichever lands second.
- `bond-coupon-maturity-correctness` and `nb-bond-api-hardening`: no file overlap found beyond
  `services/nb-bond-api/README.md` (Phase 3a edits the bidder lines only).
- [`sandbox-fmi-wallet-plan.md`](../sandbox-fmi-wallet-plan.md) Phase 4 would later remove
  server-side bidder keys; U8 is still worth doing now because that plan is Proposed with no
  work started.

## Changes Since Planning (2026-09-28)

Changes merged after this plan was written (#300, #304, #305). Effects on
this plan:

- The Banking page "Government-nominated" KPI and the API `government` field were removed in
  #300, so Phase 6 step 7 and the coordination notes about the TBD government path are done.
- Role-based visibility (test-mode toggle, issuer actions, Network Health admin actions), the
  `canOperate` capability and `CapabilitiesContext`, and the unknown-`AUTH_MODE` configuration
  error page landed in #304 and #305. Phase 1 edits to `httpClient.js` and
  `LiveUpdatesProvider.jsx` now build on that code.
- `finaliseAuction` in `src/api/auctionsApi.js` still sends `testMode`; Phase 6 step 6 still
  applies.
- `src/utils/debugSettings.js` no longer names deployment tooling (#304).

## Session Handoff

Nothing is half-done: this session wrote only the four plan files. No branch exists, no code
changed, and the sandbox was not touched. The plan folder is not yet in
`docs/DOCUMENTATION_INDEX.md`; add the entry in the PR that commits the folder.
