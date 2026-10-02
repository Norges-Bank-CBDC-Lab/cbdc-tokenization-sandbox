# NB UI correctness and hardening — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

The operator UI (`services/nb-ui`) tells the truth and fails safely. The Bonds page tiles add
up to the total once bonds mature. The coupon confirmation always previews the bond as it is
now, not as it was when the dialog opened. A closed bond's coupon history can actually be
found where the Coupon payout page says it is. A malformed link or a render bug shows an
error card instead of a blank page. An expired session sends the operator to the login page
from any request, not only from the live-updates stream. Removing a bidder keeps its key and
audit trail (soft delete) and warns when the address still holds bonds or wNOK. The served
bundle has security and cache headers, no source maps, and a chart that renders its runtime
config safely. Dead code and stale wording left from earlier lifecycle changes are gone, and
the package docs describe what is actually deployed.

## Why This Change

A review of `services/nb-ui` on 2026-09-28 found defects an operator reaches through normal
use, plus serving and hygiene gaps. None of them breaks the happy path, but each one either
shows wrong numbers, loses data, or turns a small fault into a blank screen:

- tile counts ignore `matured`, so the four status tiles stop summing to "Total bonds" after
  the first bond closes;
- the coupon modal keeps a snapshot of the bond row, so live updates while it is open are
  ignored and the preview can differ from what the chain pays;
- the Coupon payout page promises coupon history "on the Bonds page", which does not exist;
- `decodeURIComponent` in the hash router throws on a malformed escape, and there is no
  error boundary, so the whole app unmounts;
- only the live-updates stream reacts to HTTP 401; REST calls with an expired session show raw
  errors, and a 403 on the stream stops live updates without telling anyone;
- deleting a bidder hard-deletes its signing key even when the address still holds bond units
  or wNOK, and the page comment overstates the API guard;
- nginx serves the bundle with no security headers and default caching, so a ConfigMap change
  can be masked by a browser-cached `config.js`; source maps ship in the image; the chart emits
  `LIVE_UPDATES` as raw JavaScript and runs the pod without resource bounds and with a mounted
  service-account token.

## Scope

### In Scope

1. **U1** Bonds page counts and shows `matured`; tiles sum to Total.
2. **U2** Coupon modal keyed by ISIN and re-derived from live data; a bond that stops being
   payable while the dialog is open cannot be submitted from a stale preview.
3. **U3** Bond detail page gains a lifecycle and coupon history card backed by
   `GET /v1/bonds/{isin}/history`; the Coupon payout page wording points at it. Sequenced
   after the history-ordering fix in the separate `ingestion-projection-correctness` plan.
4. **U4** Safe hash decoding and error boundaries (root and per page).
5. **U7** Every API 401 (REST and stream) marks the session expired through the auth
   provider; a 403 on the live stream is surfaced to the operator.
6. **U8** Bidder soft delete end to end: SQLite column added additively, API `DELETE` disables
   instead of deleting, list hides disabled bidders unless asked, bids from disabled bidders
   rejected, optional restore; UI confirmation modal with a holdings warning and a "Show
   disabled" filter; OpenAPI regenerated.
7. Coupon payout page shows background-refresh errors (`RefreshState`).
8. **U9** Serving hardening: chart-rendered nginx server config with CSP, `X-Frame-Options`,
   `nosniff`, `Referrer-Policy`, `server_tokens off`, `no-cache` for `index.html` and
   `config.js`, immutable hashed assets; source maps out of the production build; pod
   `resources` and `automountServiceAccountToken: false`; runtime config values emitted as
   JSON literals. Web-font hosting and nginx digest pinning are operator decisions.
9. Cleanup: dead `public/config.template.js` and its lint ignore, unused selectors,
   `Fmt.durationToYears`, unused CSS rules, unreferenced `public/norges-bank-logo.svg`, the
   undeclared `testMode` query on finalisation, pre-ADR wording on the Central Bank page, the
   "Government-nominated" KPI on the Banking page (coordinated with the TBD government-path
   removal), and stale package docs.
10. Tests for every touched flow, sized like the neighbouring test files.
11. Optional, lower priority: duplication consolidation, a prioritised backfill of untested
    operator flows, and an API fixture drift guard.

### Out of Scope

- Role-based visibility of UI controls and auth-mode configuration handling: owned by a
  separate hardening change.
- Fixing the history endpoint's ordering and `before` cursor (owned by
  `ingestion-projection-correctness`); this plan consumes the fixed endpoint.
- The `docs/KNOWN_ISSUES.md` reopen-auction entry and the cloud-wording lines in nb-ui docs
  (owned by the `documentation-refresh` plan).
- Removing the TBD government mint path from contracts and API (separate change); this plan
  only removes the UI tile, in whichever PR lands first.
- Replacing server-side bidder keys with participant wallets
  ([`sandbox-fmi-wallet-plan.md`](../sandbox-fmi-wallet-plan.md) Phase 4).
- Exposing `UNIT_NOMINAL` through the API, a shared UI/API type package, or any new
  dependency (a JSON-schema validator, an error-boundary library, a font package) without
  explicit operator approval.
- Refresh-error display on the other pages that lack it (listed as a follow-up unless the
  operator folds it in; see `design.md` Decisions).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Staged + Auctioning + Outstanding + Matured tiles equal Total bonds for any status mix | Tiles silently drop closed bonds | `BondsPage.test.jsx` case with one bond per status |
| With the coupon modal open, a live data change (holders, remaining periods, `payable`) updates the preview; a bond that is no longer payable or no longer listed disables confirm with an explanation, except while a submit is in flight | Preview differs from what is paid; paying from a stale final-period preview | `CouponPayoutPage.test.jsx` re-renders with changed `listBonds` data while the modal is open |
| A matured bond's detail page lists its coupon periods, per-holder payments, and the closure totals, newest first; the Coupon payout page text points to that card | Promise of history nobody can find | `BondDetailPage.test.jsx` with a mocked `listBondHistory`; grep for the old "on the Bonds page" wording returns nothing |
| `#/bonds/%E0` and `#/auctions/%E0` render the page's error state; a component that throws renders an error card while navigation still works | Whole app unmounts on a bad link or a render bug | `parseHash` unit tests; `ErrorBoundary` test with a throwing child; App test navigating away from the failed page |
| A REST 401 calls `auth.handleUnauthorized()` once and still rejects with `HttpError`; the stream 401 path goes through the same code; a stream 403 sets a visible "live updates unavailable" state | Raw errors instead of login; silent loss of live updates | `httpClient.test.js` and `LiveUpdatesProvider.test.jsx` cases |
| `DELETE /v1/bidders/{address}` sets `disabled_at`, keeps the row and key, returns 204 idempotently; `GET /v1/bidders` omits disabled bidders unless `includeDisabled=true`; bids for a disabled bidder return 409; creating a bidder with a disabled bidder's name or key returns 409 naming it disabled | Signing key lost while the address still holds assets; roster silently reseeded after all bidders are removed | API unit and route tests; regenerated `openapi.json` passes the contract test; existing database opens with rows intact |
| The Bidders page confirmation shows the bidder's wNOK balance and bond units per ISIN before disabling; disabled bidders are hidden by default and shown on toggle | Operator removes an address that still holds assets without noticing | `BiddersPage.test.jsx` cases |
| Rendered chart: `config.js` values are JSON literals (a hostile string for `liveUpdates` renders as a quoted string); the pod has `resources` and `automountServiceAccountToken: false`; the nginx server config passes `nginx -t` in the pinned image and sets the headers listed in `design.md` | JavaScript injection through a value; ConfigMap change masked by browser cache; missing headers | `helm template` output grep; `nginx -t` in a throwaway container; optional `curl -sI` against the local deployment |
| The production build contains no `.map` files | Source maps shipped and served | `npm run build -w nb-ui` then `find services/nb-ui/dist -name '*.map'` is empty |
| The listed dead code, CSS, and files are gone; finalisation sends no `testMode`; no UI text says the reserve "pays redemption" or shows a government-nomination tile | Drift and misleading wording | grep checks listed in `plan.md` Phase 6 |
| `services/nb-ui/AGENTS.md`, `DEVELOPMENT.md`, `README.md`, `public/config.js`, the Dockerfile comment, and `services/nb-bond-api/README.md` match the shipped behaviour | Docs describe an init container, envsubst, an old nginx tag, and a pending feature that no longer exist | Doc diff review; hygiene and link checks pass |

## Constraints

- Sandbox-sized and local-first; the only portability work is keeping the CSP and headers in
  chart values so a non-local deployment can set its own origins.
- Public repo: no secrets, private identifiers, or home-directory paths in code, docs, or PR
  text.
- No new dependency, copied third-party material, or image pin change without the approvals in
  root `AGENTS.md`; web-font self-hosting and nginx digest pinning are therefore decisions, not
  defaults.
- For nb-ui the verification gate is format, lint, test, build, and grep; no preview or
  screenshot step is required (a manual demo check is optional).
- Operator-facing destructive actions use soft delete (flag plus UI filter).

## Open Questions

- Include a bidder restore endpoint in U8? Owner: sandbox operator. Recommendation and
  trade-off in `design.md`.
- Web fonts: keep the third-party font CDN (allowed in CSP), self-host IBM Plex (copied
  third-party files under a licence more restrictive than Apache-2.0, so double confirmation),
  or drop to the system font stack? Owner: sandbox operator.
