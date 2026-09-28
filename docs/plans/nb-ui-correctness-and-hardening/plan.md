# NB UI correctness and hardening — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `services/nb-ui` (`src/`, `tests/`, `helm/`, `public/`, `index.html`,
`vite.config.js`, `Dockerfile`, `eslint.config.mjs`, package docs); `services/nb-bond-api`
bidder soft delete (`src/ingestion-db.ts`, `src/bidders.ts`, `src/app.ts`,
`src/contracts/bidders.ts`, `openapi.json`, tests, `README.md`)
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline                                                   (no PR)
Phase 1  Crash and session safety: U4 router + error boundaries, U7 401/403     -> PR 1
Phase 2  Coupon and bonds correctness: U1 tiles, U2 live modal, RefreshState    -> PR 2
Phase 3  Bidder soft delete: 3a API + schema + OpenAPI                          -> PR 3
                             3b UI confirm modal, holdings warning, filter      -> PR 4
Phase 4  Bond history card (U3)   [after ingestion-projection-correctness fix]  -> PR 5
Phase 5  Serving hardening (U9): nginx config, CSP, cache, chart, source maps   -> PR 6
Phase 6  Cleanup and docs                                                       -> PR 7
Phase 7  Optional: duplication consolidation                                    -> PR 8
Phase 8  Optional: test backfill for untouched operator flows                   -> PR 9
Phase 9  Optional: API fixture drift guard                                      -> PR 10
```

Why this order: Phase 1 first because the error boundary contains any fault a later phase (or
a sibling plan) introduces, and the 401 path changes the client every later phase uses.
Phase 2 fixes the money-moving preview. Phase 3a lands before 3b and is safe alone: the current
UI's Delete button keeps working and the row simply disappears from the default list.
Phase 4 waits on the history endpoint fix. Phases 5 and 6 are independent of 2–4 and may land
in either order after Phase 1. Every phase updates the package docs it makes stale, in the same
PR; Phase 6 sweeps what remains.

Package gate for every nb-ui phase (matches `.github/workflows/nb-ui.yml`), run from the repo
root:

```bash
npm run format:check -w nb-ui && npm run lint -w nb-ui && npm test -w nb-ui && npm run build -w nb-ui
```

For nb-bond-api phases (matches `.github/workflows/nb-bond-api.yml`):

```bash
npm run regen:openapi -w nb-bond-api
npm run lint -w nb-bond-api && npm run format:check -w nb-bond-api && npm test -w nb-bond-api
```

Every PR also runs the public-repo checks listed under "Documentation and Public-Repo
Hygiene". Verification for nb-ui is build, lint, test, and grep; no preview or screenshot step
is part of any gate.

## Phase 0: Baseline

### Goal

Record the starting point so each phase's test delta is visible.

### Steps

1. `npm test -w nb-ui` (2026-09-28: 25 files, 125 tests) and `npm test -w nb-bond-api`;
   write both counts into `progress.md`.
2. `helm template services/nb-ui/helm --set image=example/nb-ui:0` into a scratch file
   outside the tree, for diffing in Phase 5.
3. Check whether `ingestion-projection-correctness` has merged its history fix; record the
   answer (it gates Phase 4).
4. Check whether the TBD government-path removal is scheduled before Phase 6; if so, move the
   Banking tile removal (Phase 6 step 7) into the earliest PR from this plan.

### Exit Criteria

- [ ] Baseline counts and both dependency answers are in `progress.md`.

## Phase 1: Crash and session safety (U4, U7)

### Goal

A bad link or a render error never blanks the app; every 401 leads to the login flow; a 403 on
the stream is visible.

### Scope

- `src/hooks/useRoute.js`, new `src/components/ErrorBoundary.jsx`, `src/main.jsx`,
  `src/App.jsx`
- `src/api/httpClient.js`, `src/sync/LiveUpdatesProvider.jsx`, `src/components/Layout.jsx`
- Tests: new `tests/useRoute.test.js`, new `tests/ErrorBoundary.test.jsx`,
  `tests/httpClient.test.js`, `tests/LiveUpdatesProvider.test.jsx`
- Docs: `services/nb-ui/AGENTS.md` (class-component exception; `httpClient.js` owns 401),
  `DEVELOPMENT.md` auth section if it describes 401 handling

### Steps

1. `useRoute.js`: add `safeDecode(segment)` (try `decodeURIComponent`, return the raw segment
   on `URIError`); use it at both call sites. Update the header comment.
2. `ErrorBoundary.jsx`: class with `state = { error: null }`, `static
   getDerivedStateFromError`, `componentDidCatch(error, info)` logging `console.error` with
   `info.componentStack`, `componentDidUpdate` resetting when `props.resetKey` changes, and
   `render` calling `props.fallback({ error, reset })`.
3. `main.jsx`: wrap `<App />` in `ErrorBoundary` with a plain fallback (heading, message,
   "Reload" button calling `window.location.reload()`); no dependency on Layout or toasts.
4. `App.jsx`: wrap `{page}` inside `Layout` with `ErrorBoundary resetKey={JSON.stringify(route)}`
   and a card fallback (`EmptyState` "This page failed to render", error message, "Try again"
   calling `reset`, link to `#/bonds`).
5. `httpClient.js`: add `failedResponse(res, data)` that calls `auth.handleUnauthorized()` when
   `res.status === 401` and returns the `HttpError`; use it in `request()` (line 143) and in
   `streamLiveEvents()` (line 72).
6. `LiveUpdatesProvider.jsx`: drop the direct `auth.handleUnauthorized()` call (keep `return` on
   401); add a `status` state (`disabled` when `enabled` is false, `connecting`, `open` on
   `onOpen`, `reconnecting` in the backoff wait, `forbidden` on 403) exposed through the context
   next to the generations and a `useLiveUpdatesStatus()` hook. Keep `useLiveQuery`'s
   dependencies on generations only so status changes do not refetch.
7. `Layout.jsx`: when status is `forbidden`, render one muted line under the top bar: "Live
   updates are not permitted for this account; use Refresh on each page."
8. Tests:
   - `parseHash`: every documented route; `#/bonds/%E0` and `#/auctions/%E0` return the raw
     segment without throwing; unknown section falls back to bonds.
   - `ErrorBoundary`: throwing child renders the fallback; "Try again" re-renders the child;
     changing `resetKey` clears the error.
   - `httpClient`: a 401 on GET calls `handleUnauthorized` once and rejects with
     `HttpError(401)`; a 403 does not call it; a 401 on the stream calls it once.
   - `LiveUpdatesProvider`: move the 401 assertion to the client test (the provider now only
     stops); 403 sets status `forbidden` (render a probe component reading the hook).
9. Update `services/nb-ui/AGENTS.md` "Style and conventions" (ErrorBoundary is the one class
   component) and the `httpClient.js` bullet (also reacts to 401).
10. Package gate.

### Verification Stop

- Package gate green; new tests fail when `safeDecode` or the `failedResponse` call is
  reverted (check once locally).
- `grep -n "decodeURIComponent" services/nb-ui/src` shows only `safeDecode`.
- `grep -rn "handleUnauthorized" services/nb-ui/src` shows the provider interface, the two
  plugins, and `httpClient.js` only.

### Failure Diagnosis / Fix Forward / Rollback

- Login page flashes during normal use in `entra` mode: some request is getting 401 for a
  reason other than an expired session (for example a missing scope). Inspect that request; do
  not special-case it in the client.
- StrictMode double-invokes render: the boundary must not log twice as an error loop; check
  that `componentDidCatch` is only logging.
- Rollback: revert the PR; no data or API change.

### Exit Criteria

- [ ] Malformed hash links do not throw; a render error shows a fallback and navigation works.
- [ ] REST and stream 401 both reach `auth.handleUnauthorized()` through `httpClient.js`.
- [ ] Stream 403 produces a visible notice.

## Phase 2: Coupon and bonds correctness (U1, U2, refresh errors)

### Goal

Tiles add up; the coupon preview is always the live bond; background refresh failures show.

### Scope

- `src/pages/BondsPage.jsx`, `src/pages/CouponPayoutPage.jsx`, `src/pages/PayCouponModal.jsx`
- Tests: `tests/BondsPage.test.jsx`, `tests/CouponPayoutPage.test.jsx`
- Conditional (Decision "RefreshState fold-in"): `BondDetailPage.jsx`, `GlobalRegistryPage.jsx`,
  `OperationsPage.jsx` (BiddersPage is handled in Phase 3b)

### Steps

1. `BondsPage.jsx`: counts start with `matured: 0`; add a "Matured" tile after Outstanding.
2. `CouponPayoutPage.jsx`:
   - replace `payTarget` state with `payIsin`; derive `payBond = (data ?? []).find((b) =>
     b.isin === payIsin) ?? null`;
   - derive `staleReason`: `'gone'` when `payBond` is null, `'matured'`, `'disabled'`, or
     `'not-payable'` when `!payBond.coupon?.payable`;
   - render the modal while `payIsin` is set, passing `bond={payBond}` and `staleReason`;
   - destructure `refreshing, refreshError` from `useLiveQuery` and render `RefreshState` under
     the header, as on `BondsPage`.
3. `PayCouponModal.jsx`:
   - accept `staleReason`; when set and `mutation.loading` is false, disable the confirm button
     and show a notice ("This bond changed while the dialog was open: it is no longer payable /
     has closed / is no longer listed. Close and check the queue.");
   - when `bond` is null, render the notice only (title uses the ISIN passed separately, so the
     page passes `isin={payIsin}` too);
   - the mutation reads `bond.isin` at call time; keep it bound to `isin` so a null `bond`
     cannot break it.
4. Tests (`CouponPayoutPage.test.jsx`), using the existing module mock for `BondsApi`:
   - open the modal on an interim-period bond, then resolve `listBonds` with the same bond at
     `remaining: 1` and trigger a reload (click the page's Refresh button): modal title and
     columns switch to the final-payout form;
   - same setup, next data has `payable: false`: confirm is disabled with the notice;
   - next data omits the bond: notice, confirm disabled, Cancel closes;
   - `payCoupon` pending while next data flips `payable` to false: confirm stays in "Paying…",
     no stale notice, success closes the modal;
   - a rejected background refresh shows the `RefreshState` alert and keeps the rows.
5. Test (`BondsPage.test.jsx`): fixture with one bond per status; the five tile values render
   and the four status tiles sum to Total.
6. Package gate.

### Verification Stop

- Package gate green; `grep -n "setPayTarget" services/nb-ui/src` is empty.

### Failure Diagnosis / Fix Forward / Rollback

- Modal flickers to the stale notice right after a successful payment: the stale guard is not
  checking `mutation.loading`, or `onPaid` runs after the live update; keep the guard and close
  on success.
- Rollback: revert the PR.

### Exit Criteria

- [ ] Tiles sum to Total for all four statuses.
- [ ] The modal re-derives from live data and cannot submit from a stale preview.
- [ ] Coupon payout page shows refresh errors.

## Phase 3a: Bidder soft delete — API

### Goal

Disabling a bidder keeps its row and key, is idempotent, and is reflected in list, bid, and
create behaviour. Safe to land before the UI change.

### Scope

- `services/nb-bond-api/src/ingestion-db.ts` (table DDL, `BidderRow`, list and write helpers,
  `ensureBidderDisabledColumn`)
- `services/nb-bond-api/src/bidders.ts` (`listBidders`, `disableBidder`, `restoreBidder`,
  create conflicts, reconcile carry-over, record mapping)
- `services/nb-bond-api/src/app.ts` (list query, `DELETE`, `PATCH` if accepted, bid rejection,
  DTO fields)
- `services/nb-bond-api/src/contracts/bidders.ts`, regenerated `openapi.json`
- Tests: `tests/bidders.test.ts`, `tests/ingestion-db.test.ts`, route cases in
  `tests/app.test.ts` or a sibling file of the same shape
- Docs: `services/nb-bond-api/README.md` (bidder routes line 26, reconcile note line 133),
  `services/AGENTS.md` line 24 wording if it implies delete semantics

### Steps

1. DDL: add `disabled_at INTEGER` to `CREATE TABLE IF NOT EXISTS bidders`. Add
   `ensureBidderDisabledColumn(db)` (reads `PRAGMA table_info(bidders)`; runs `ALTER TABLE
   bidders ADD COLUMN disabled_at INTEGER` when missing) and call it from `createTables` after
   the bidders DDL, so it runs inside the existing initialisation transaction on the write
   handle only. Leave `SCHEMA_VERSION` at 6 and extend the system-of-record comment to say why.
2. `BidderRow.disabled_at: number | null`; every `SELECT` on `bidders` includes it;
   `insertBidderRow` writes it (default null).
3. `listBidderRows(db, { includeDisabled = false } = {})` adds `WHERE disabled_at IS NULL`
   unless requested. Add `setBidderDisabledAt(db, address, value)`.
4. `bidders.ts`: `BidderRecord` gains `disabledAt`; `disableBidder(db, address, now =
   Date.now())` returns the record or null (unknown) and leaves an existing timestamp untouched;
   `restoreBidder(db, address)` if accepted; `createBidder` conflict messages append
   "(disabled; restore it instead)" when the clashing row is disabled; reconcile copies
   `disabled_at`; the old `deleteBidder` export is removed (its tests move to disable).
5. `app.ts`:
   - `GET /v1/bidders`: parse `includeDisabled` like the bonds route;
   - `DELETE /v1/bidders/:address`: 404 when unknown; if already disabled return 204 without the
     chain guard; otherwise run the existing unrevealed-bid guard, then `disableBidder`,
     `publishLiveChange(['bidders'])`, 204;
   - `PATCH /v1/bidders/:address` (if accepted): body schema `{ disabled: z.literal(false) }`;
     404 unknown; restore; publish; 200 with the DTO;
   - `POST /v1/bidders/:address/bids`: 409 `bidder ${address} is disabled` before any chain
     work;
   - `composeBidderDto` adds `disabled` and `disabledAt`.
6. `contracts/bidders.ts`: schema fields, `includeDisabled` parameter (reuse the bonds wording
   pattern), DELETE operationId `disableBidder` and new summary, PATCH operation if accepted,
   409 on the bids route documented. `npm run regen:openapi -w nb-bond-api`.
7. Tests:
   - `ingestion-db.test.ts`: open a temp-file database created with the old `bidders` DDL and a
     row, then open it with the new code: column exists, row intact, `disabled_at` null; opening
     twice is a no-op.
   - `bidders.test.ts`: disable hides from the default list and shows with `includeDisabled`;
     disable is idempotent and keeps the first timestamp; restore clears it; create with a
     disabled name or key conflicts with the "disabled" message; seed does not reseed when every
     row is disabled; reconcile preserves `disabled_at`.
   - Route cases that need no chain: list filter; restore; bids for a disabled bidder return
     409; DELETE of an already-disabled bidder returns 204. The first-time DELETE path calls the
     chain guard; cover it at service level unless `createApp` dependencies allow stubbing the
     auction reader.
8. Docs: `services/nb-bond-api/README.md` route list and reconcile note.
9. nb-bond-api gate; nb-ui gate as well (the UI still calls `deleteBidder` against the same
   path and must keep passing).

### Verification Stop

- Gates green; `git diff --stat services/nb-bond-api/openapi.json` shows only bidder changes.
- `grep -n "DELETE FROM bidders" services/nb-bond-api/src` shows only `deleteBidderRow`, and
  `grep -n "deleteBidderRow" services/nb-bond-api/src` shows only the reconcile path.

### Failure Diagnosis / Fix Forward / Rollback

- `ALTER TABLE` fails on the read-only history handle: the helper must run only on the write
  handle (inside the `!config.readonly` branch).
- Existing local database: the column is added at API start; nothing to rebuild. Rolling back
  to an older image ignores the column (disabled bidders reappear as active); no data loss.
- Fix forward in the same PR; the change is additive.

### Exit Criteria

- [ ] No route hard-deletes a bidder; disabled bidders keep their keys.
- [ ] List, bid, create, and seed behaviour follow `design.md`.
- [ ] `openapi.json` regenerated and the contract test passes.

## Phase 3b: Bidder soft delete — UI

### Goal

The operator sees what an address still holds before disabling it, and can find disabled
bidders again.

### Scope

- `src/api/biddersApi.js`, `src/pages/BiddersPage.jsx`, `src/components/ui.jsx`
  (`ConfirmModal`)
- Tests: `tests/BiddersPage.test.jsx`
- Docs: `services/nb-ui/README.md` or `DEVELOPMENT.md` wherever the Bidders page is described

### Steps

1. `biddersApi.js`: `listBidders({ includeDisabled })`, `disableBidder(address)` (DELETE),
   `restoreBidder(address)` (PATCH, if accepted); remove `deleteBidder`.
2. `ui.jsx`: `ConfirmModal({ title, children, confirmLabel, variant = 'danger', onConfirm,
   onCancel })` built on `Modal`, holding its own `submitting` state and keeping the dialog
   open when `onConfirm` throws (pattern from `ConfirmResyncModal`).
3. `BiddersPage.jsx`:
   - header comment: "Disable a bidder (soft delete: the API keeps its key and the row;
     blocked while it has unrevealed bids on an open auction)";
   - "Show disabled" checkbox persisted like `BondsPage` (`nb-ui:bidders:showDisabled`), passed
     to `listBidders`; disabled rows show a `DISABLED` badge, no Place bid button, and a Restore
     button (if accepted);
   - replace `window.confirm` with `ConfirmModal`; the body lists the wNOK balance from the DTO
     and, from `bondsQ.data`, each bond where the bidder appears in `holders` with a positive
     balance (ISIN and units). When anything is held, show a warning: the address keeps its
     holdings and still receives coupons and closure payouts; disabling only removes it from the
     roster and bid entry, and the key stays in the API;
   - roster KPIs count active bidders only;
   - add `RefreshState` (same defect as the Coupon payout page) if the fold-in decision is
     accepted.
4. Tests: confirm modal shows wNOK and per-bond units for a holder; no warning for an empty
   address; confirming calls `disableBidder`; the toggle passes `includeDisabled` and renders
   the badge; Restore calls `restoreBidder` (if accepted); a 409 keeps the modal open with the
   message.
5. nb-ui gate.

### Verification Stop

- Gate green; `grep -rn "window.confirm" services/nb-ui/src/pages/BiddersPage.jsx` empty;
  `grep -rn "deleteBidder" services/nb-ui/src` empty.

### Failure Diagnosis / Fix Forward / Rollback

- Holdings missing for a known holder: address case; compare lower-cased.
- Rollback: revert the UI PR; the API from 3a keeps working with the old client.

### Exit Criteria

- [ ] Disable goes through a modal with an accurate holdings warning.
- [ ] Disabled bidders are hidden by default and reachable through the toggle.

## Phase 4: Bond history card (U3)

### Goal

The history the Coupon payout page promises exists on the bond detail page.

### Precondition

The `ingestion-projection-correctness` history fix (newest-first query with the `before`
cursor applied in SQL) is merged to `development`. If it slips and the operator wants the
wording fixed sooner, land only step 4 (reword to "on the bond's detail page" without promising
full history) and keep the card for later.

### Scope

- `src/pages/BondDetailPage.jsx` (or new `src/pages/BondHistoryCard.jsx`), new
  `src/components/TxLink.jsx` extracted from `OperationsPage.jsx`'s `TxCell`,
  `src/pages/CouponPayoutPage.jsx` wording
- Tests: `tests/BondDetailPage.test.jsx`, `tests/OperationsPage.test.jsx` (still green after the
  extraction)

### Steps

1. Extract `TxCell` to `src/components/TxLink.jsx`; `OperationsPage` imports it.
2. History card per `design.md`: bond-level events only, newest first, period rows with grouped
   per-holder `COUPON_PAID` rows (holder, amount via `Fmt.formatWnok`), `MATURED` with its four
   totals, the other types with a one-line summary; unknown types render their `type` and raw
   payload keys so a future event does not break the card; empty state "No lifecycle events
   yet"; note when 500 rows came back.
3. Place the card after "Bond details" and before "Auctions"; its own `ErrorState` so a history
   failure does not blank the page.
4. `CouponPayoutPage.jsx`: hint and empty-state text say closed bonds keep their coupon history
   on the bond's detail page (Bonds, then the ISIN).
5. Tests: a matured bond's history renders periods newest first, per-holder rows under their
   period, and closure totals; a history error shows inside the card while the rest of the page
   renders; the Coupon payout page text no longer mentions "on the Bonds page".
6. nb-ui gate.

### Verification Stop

- Gate green; `grep -rn "on the Bonds page" services/nb-ui/src` empty;
  `grep -rn "listBondHistory" services/nb-ui/src/pages` non-empty.

### Failure Diagnosis / Fix Forward / Rollback

- Closure rows missing on a long-lived bond: the dependency is not in the running API image;
  check the endpoint returns the newest rows first.
- Rollback: revert the PR.

### Exit Criteria

- [ ] A matured bond shows every coupon period and its closure totals.
- [ ] The Coupon payout page's promise matches the UI.

## Phase 5: Serving hardening (U9)

### Goal

The served bundle has security and cache headers; config is rendered safely; the pod is bounded
and token-free; no source maps ship.

### Scope

- `services/nb-ui/helm/templates/configmap.yaml`, `deployment.yaml`, `values.yaml`
- `services/nb-ui/vite.config.js`, `Dockerfile` (comment only), `index.html` (only if the font
  decision changes it)
- Docs: `services/nb-ui/DEVELOPMENT.md` ("Runtime config injection", "Deployment shape",
  "Known gotchas", "Portability Flags"), `README.md` if it lists served files

### Steps

1. Read the pinned image's default server config (`docker run --rm
   nginxinc/nginx-unprivileged:1.30.3-alpine cat /etc/nginx/conf.d/default.conf`) and
   `/etc/nginx/nginx.conf`; record listen port, root, and temp paths in `progress.md`.
2. `values.yaml`: add
   - `web.cspReportOnly: false`, `web.extraConnectSrc: []`, `web.fontOrigins` (the two CDN
     origins while fonts stay remote; empty after a font decision removes them);
   - `resources` (requests `cpu: 10m`, `memory: 16Mi`; limits `memory: 64Mi`) with a comment
     that values are sandbox-sized.
3. `configmap.yaml`: render every `config.js` value with `toJson` (fixes the unquoted
   `LIVE_UPDATES`), and add a `default.conf` key with the server block from `design.md`:
   `listen 8080`, `server_tokens off`, the same root as the image default, one
   `security_headers` snippet repeated in each location (nginx drops server-level `add_header`
   in a location that sets its own), `/assets/` immutable, `= /index.html`, `= /config.js`, and
   `/` `no-cache`. Build `connect-src` from `urlParse .Values.runtimeConfig.apiBaseUrl`, the auth
   authority origin when `authMode` is `entra`, and `web.extraConnectSrc`.
4. `deployment.yaml`: `automountServiceAccountToken: false` in the pod spec; `resources` from
   values; mount `default.conf` from the same ConfigMap at
   `/etc/nginx/conf.d/default.conf` with `subPath` and `readOnly`. The existing checksum
   annotation already covers the ConfigMap.
5. `vite.config.js`: `sourcemap: false` with a comment (dev server unaffected).
6. `Dockerfile`: correct the lines 43-45 comment (the image does contain `public/config.js`; the
   ConfigMap mount masks it) and mention the chart-supplied server config.
7. Fonts: apply the operator's decision. Default (keep CDN): no `index.html` change. System
   stack: remove the three `<link>` tags and `web.fontOrigins`. Self-host: separate approval,
   font files and licence text added, `THIRD_PARTY_LICENSES.md` and
   `docs/THIRD_PARTY_NOTES.md` updated, `check-third-party-licenses.py` run, and
   `nbUIBundleHash` already covers `public/` or `src/` wherever the files land.
8. Docs: rewrite the envsubst paragraph (no init container; the chart renders `config.js` and
   the server config), fix the nginx tag to the pinned one, replace the "CSP from defaults"
   gotcha with the new headers and the `add_header` inheritance note, and add a Portability
   Flags line: a deployment that does not use this chart must supply an equivalent server
   config and set its own `connect-src` origins. The cloud-wording lines in this file
   (`DEVELOPMENT.md:107`, `:247-250`) belong to the `documentation-refresh` plan; leave them and
   rebase over that change.
9. nb-ui gate (build must still pass; tests unaffected).

### Verification Stop

- `helm template services/nb-ui/helm --set image=example/nb-ui:0` renders; grep shows
  `automountServiceAccountToken: false`, `resources:`, `LIVE_UPDATES: true`, and the header
  names; `--set-string runtimeConfig.liveUpdates='x; alert(1)'` renders
  `LIVE_UPDATES: "x; alert(1)"`; `--set runtimeConfig.authMode=entra --set
  runtimeConfig.authAuthority=https://login.example.test/tenant` adds that origin to
  `connect-src`.
- Save the rendered `default.conf` to a scratch file and run `docker run --rm -v
  <scratch>/default.conf:/etc/nginx/conf.d/default.conf:ro
  nginxinc/nginx-unprivileged:1.30.3-alpine nginx -t` (pinned image, throwaway container).
- `npm run build -w nb-ui` then `find services/nb-ui/dist -name '*.map'` is empty.
- Optional, with operator go-ahead: `./services/nb-ui/nb-ui.sh start`, then `curl -sI
  http://web.cbdc-sandbox.local/`, `/config.js`, and one `/assets/*.js` show the expected
  `Cache-Control`, CSP, and no nginx version in `Server`. A manual look at the UI with the
  browser console open is optional.

### Failure Diagnosis / Fix Forward / Rollback

- `nginx -t` fails: compare with the image's default server block from step 1 (root path, pid
  and temp paths live in `nginx.conf`, not the server block).
- Page loads but API calls fail with a CSP error: `connect-src` missing the API origin; check
  the rendered value and `urlParse` output.
- Fonts missing: `font-src`/`style-src` do not include the CDN origins.
- Rollback: revert the PR and `./services/nb-ui/nb-ui.sh start`; no data involved.

### Exit Criteria

- [ ] Rendered chart carries headers, cache policy, JSON-literal config, resources, and no
      service-account token.
- [ ] No source maps in the build output.
- [ ] Font decision recorded in `progress.md`.

## Phase 6: Cleanup and docs

### Goal

Remove dead code and stale wording; package docs match the shipped behaviour.

### Scope

`services/nb-ui/public/config.template.js`, `eslint.config.mjs`, `src/api/selectors.js`,
`src/utils/format.js`, `src/styles.css`, `public/norges-bank-logo.svg`,
`src/components/NorgesBankLogo.jsx` (comment), `src/api/auctionsApi.js`,
`src/pages/CentralBankPage.jsx`, `src/pages/BankingPage.jsx`, `tests/BankingPage.test.jsx`,
`public/config.js`, `AGENTS.md`, `DEVELOPMENT.md`, `README.md`

### Steps

1. Delete `public/config.template.js` and its entry and comment in `eslint.config.mjs`.
2. `selectors.js`: remove `selectBond`, `selectAuction`, `selectAuctionInList`,
   `selectHolders`, `selectBids`, `selectAllocation`, `selectLatestAuctionTx`; keep
   `selectAllAuctions` (used by `selectOpenAuctions`) but stop exporting it if nothing imports
   it. Re-run the grep before deleting.
3. `format.js`: remove `durationToYears` and its `Fmt` entry.
4. `styles.css`: remove `.divider`, `.lc-decision`, `.row-between`, `.section-title`,
   `.stack-2`, `.stack-3`, `.stack-4` after a final grep of `src` for each class name (also as
   template-string fragments).
5. Delete `public/norges-bank-logo.svg`; update the `NorgesBankLogo.jsx` comment.
6. `auctionsApi.js`: `finaliseAuction` sends no query; remove the stale blank line in its
   JSDoc. Add a case to `tests/auctionsApi.test.js` asserting the PUT URL has no `testMode`.
   Coordinate with the separate hardening change, which also edits this file.
7. `BankingPage.jsx`: remove the "Government-nominated" tile and the "Distinct from
   government-nomination" phrase in the WNOK settlement tooltip; drop `government` from the test
   fixtures. Moves to the earliest PR if the TBD government-path removal is scheduled first
   (Phase 0 step 4); if that change lands before this plan it must carry this edit, because
   `token.government.nominated` throws once the field is gone.
8. `CentralBankPage.jsx:190`: "pays coupon, buyback, and principal at maturity".
9. Docs: `AGENTS.md` (selectors bullet lists the remaining helpers; drop the
   `config.template.js` bullet; replace the init-container checklist item with "the chart
   mounts `config.js` and the nginx server config from its ConfigMap"; replace the
   `reopenAuction` pattern reference with a neutral "add a follow-up entry to
   `docs/KNOWN_ISSUES.md`"); `public/config.js` header (local dev only; the chart renders the
   deployed file); `DEVELOPMENT.md` "Follow-ups" (drop `reopenAuction`), the line 33 link label
   (`docs/openapi-v2-plan.md` → the archived path it already targets), and the selectors
   sentence under "API surface and cache-first data flow". The `docs/KNOWN_ISSUES.md` reopen
   entry is replaced by the `documentation-refresh` plan, not here.
10. nb-ui gate; hygiene and link checks.

### Verification Stop

```bash
grep -rn "config.template\|durationToYears\|selectBond\b\|selectLatestAuctionTx\|norges-bank-logo.svg" services/nb-ui --exclude-dir=node_modules --exclude-dir=dist
grep -rn "redemption\|Government-nominated\|government-nomination" services/nb-ui/src
grep -rn "envsubst\|init container\|1.27-alpine\|reopenAuction" services/nb-ui/*.md services/nb-ui/public
```

Each returns nothing (the second may match "redemption" only in comments that describe the
ADR 0005 closure; review each hit).

### Failure Diagnosis / Fix Forward / Rollback

- A removed class or selector was used through a dynamic string: restore it and add a comment
  at the use site.
- Rollback: revert the PR.

### Exit Criteria

- [ ] All listed dead code and files removed; greps clean.
- [ ] Package docs describe the chart-rendered config, the pinned nginx tag, and no pending
      reopen feature.

## Phase 7 (optional): Duplication consolidation

1. `App.jsx`: `NotAuthorised({ message })` component used by the three gated routes.
2. `src/utils/mutationToast.js`: `pushMutationResult(toast, result, { title, body })` pushing
   the committed-transaction toast when `isMutationAccepted(result)` and the given success
   toast otherwise; returns whether the result was accepted so callers can skip navigation.
   Replace the five call sites.
3. `format.js`: first add characterization tests (`formatNok('')` currently renders "0 NOK",
   `formatWnok('')` renders "—"); then implement `formatNok(units)` as
   `formatWnok(units × UNIT_NOMINAL)` and decide the `''` case explicitly (recommend "—").
4. `src/domain/amounts.js`: export `UNIT_NOMINAL = 1000n` with a comment pointing at
   `BondToken.UNIT_NOMINAL`; `PayCouponModal` and `format.js` import it.
5. Replace the remaining `window.confirm` calls in `BankingPage.jsx` and `CentralBankPage.jsx`
   with `ConfirmModal` from Phase 3b.
6. Export `SHOW_DISABLED_KEY` (or a `setShowDisabledBonds(true)` helper) from `BondsPage.jsx`
   and use it in `BondDetailPage.jsx`.
7. Existing tests must pass unchanged except the new characterization cases; nb-ui gate.

Exit: each duplicate has one implementation; no behaviour change except the documented `''`
case.

## Phase 8 (optional): Test backfill for untouched operator flows

Priority by consequence (money movement or irreversible chain effect first), each file sized
like `CouponPayoutPage.test.jsx` or smaller:

| Priority | Flow | Cases |
|---|---|---|
| 1 | `AuctionDetailPage` close, cancel, finalise (`FinaliseAuctionModal`) | Buttons gated by status; finalise sends only `winningBidIndexes` and `expectedClearingRate`; accepted-mutation toast; error keeps the modal open |
| 1 | `PlaceBidModal` | Validation of units and rate; bidder and auction selection; expired-auction gating with and without test mode |
| 1 | `CreateAuctionModal` | RATE forced for a bond without auctions; RATE disabled and PRICE preselected after a RATE auction; BUYBACK availability text |
| 2 | `CreateBondModal` | Submit payload (ISIN, maturity duration units); validation errors |
| 2 | `ConfirmDisableBondModal` | Direct test of the typed-ISIN gate and error path (today covered only through `BondDetailPage`) |
| 3 | wNOK modals (`MintWnokModal`, `BurnWnokModal`, `TransferWnokModal`) and TBD modals (`TbdMintBurnModal`, `TransferTbdModal`, `AddTbdAllowlistModal`, `AddBankModal`) | Amount validation and payload shape, one file per family |

Exit: priority-1 rows covered; lower rows as time allows, recorded in `progress.md`.

## Phase 9 (optional): API fixture drift guard

1. Move the fixtures touched by this plan (bond, bidder, history event) into
   `tests/fixtures/` modules that the page tests import.
2. New `tests/fixtureContract.test.js`: load `../nb-bond-api/openapi.json` (as
   `liveEventContract.test.js` does), resolve the component schema for each fixture, and assert
   every `required` property is present and every fixture key is a declared property, one level
   deep plus arrays of objects. No validator package.
3. Extend to other fixtures only when they are next touched.

Exit: a renamed or removed API field fails the UI test suite. A full JSON-schema validator
would be a new dependency and needs approval.

## Test Matrix

| Layer | Risk or behavior | Test/evidence |
|---|---|---|
| Persistence | Additive `disabled_at` on an existing database; idempotent reopen | `ingestion-db.test.ts` temp-file case |
| Domain (API) | Disable, restore, conflicts, seeding, reconcile carry-over | `bidders.test.ts` |
| API/Zod contract | New fields, `includeDisabled`, `disableBidder`, PATCH, 409 on bids | Route cases; regenerated `openapi.json`; API contract test |
| UI client | 401 on REST and stream; 403 untouched; finalise without `testMode` | `httpClient.test.js`, `auctionsApi.test.js` |
| UI routing | Malformed escapes; documented routes | `useRoute.test.js` |
| UI resilience | Throwing page contained; reset on navigation | `ErrorBoundary.test.jsx` |
| UI live data | Modal follows live data; stale guard; in-flight guard; refresh error | `CouponPayoutPage.test.jsx` |
| UI display | Tile sums; history card; holdings warning; disabled filter | `BondsPage`, `BondDetailPage`, `BiddersPage` tests |
| Chart | JSON-literal config; headers; resources; token off | `helm template` greps |
| Serving | nginx accepts the rendered config | `nginx -t` in the pinned image |
| Build | No source maps | `find dist -name '*.map'` |
| Local runtime (optional) | Headers and caching as served | `curl -sI` after `nb-ui.sh start`, with go-ahead |

## Recommended PR Slices

Each slice is a `feature/<kebab>` branch with a PR against `development`, landed only with the
operator's go-ahead.

| Slice | Branch | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|---|
| 1 | `feature/nb-ui-crash-and-session-safety` | Router never throws; error boundaries; client owns 401; stream 403 visible | Phase 1 tests | None |
| 2 | `feature/nb-ui-coupon-live-modal` | Tiles sum; modal by ISIN; refresh errors shown | Phase 2 tests | None |
| 3 | `feature/bidder-soft-delete-api` | Bidder soft delete in API and schema | API tests; `openapi.json` diff | Old UI still calls DELETE (works; row hidden) until slice 4 |
| 4 | `feature/nb-ui-bidder-soft-delete` | Confirm modal, holdings warning, disabled filter | `BiddersPage` tests | Removes the `deleteBidder` client name |
| 5 | `feature/nb-ui-bond-history-card` | History card; wording fixed | `BondDetailPage` tests | Waits for the history fix |
| 6 | `feature/nb-ui-serving-hardening` | Headers, cache, CSP, chart safety, no maps | `helm template`, `nginx -t`, build | Font CDN origins stay until the font decision |
| 7 | `feature/nb-ui-cleanup-and-docs` | Dead code and stale docs removed | Greps; gates | Government tile may move earlier |
| 8–10 | `feature/nb-ui-dedup`, `feature/nb-ui-test-backfill`, `feature/nb-ui-fixture-contract` | Optional phases | Their tests | None |

The plan folder itself lands first (with its `docs/DOCUMENTATION_INDEX.md` entry) or with
slice 1, as the operator prefers.

## Migration, Rebuild, and Rollout

- Data/schema version effect: `bidders.disabled_at` added in place at API start; no
  `SCHEMA_VERSION` change, no projection rebuild, no chain change.
- Local rebuild/restart path: API slices need `./services/nb-bond-api/nb-bond-api.sh start`;
  UI slices need `./services/nb-ui/nb-ui.sh start` (content-hash image rebuild). Neither needs a
  fresh chain.
- Compatibility window: between slices 3 and 4 the old UI's Delete disables instead of deleting;
  the toast still says "Bidder removed", which is acceptable for one release.
- Non-local note: a deployment that does not use this chart must supply an equivalent nginx
  server config and its own `connect-src` origins (documented in `DEVELOPMENT.md`).
- Rollback or fix-forward boundary: every slice reverts cleanly; slice 3 leaves an extra column
  that older code ignores.

## Documentation and Public-Repo Hygiene

- Docs to update, per phase as listed: `services/nb-ui/AGENTS.md`, `DEVELOPMENT.md`,
  `README.md`, `public/config.js`, `Dockerfile` comment, `services/nb-bond-api/README.md`,
  `docs/DOCUMENTATION_INDEX.md` (plan folder entry). Not here: the `docs/KNOWN_ISSUES.md`
  reopen entry and the nb-ui cloud-wording lines (`documentation-refresh`).
- Third-party/license inventory impact: none by default. Font self-hosting or an nginx digest
  pin, if approved, update `THIRD_PARTY_LICENSES.md` and `docs/THIRD_PARTY_NOTES.md` and run the
  licence check.
- `services/nb-ui/public/` changes alter the image content hash; `nbUIBundleHash` already covers
  `public/` and `src/`, so the image-hash-inputs check needs no change. The server config lives
  in the chart, not the image.
- Public-safe values only: example origins in tests use `.example.test` or the local sandbox
  hostnames.

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
# Only when fonts are self-hosted or an image pin changes:
python3 scripts/verification/check-third-party-licenses.py
```

## Out of Scope

- Role-based visibility of UI controls and auth-mode handling (separate hardening
  change).
- History endpoint ordering and cursor (`ingestion-projection-correctness`).
- TBD government-path removal outside the one UI tile.
- Participant wallets replacing server-held bidder keys (`sandbox-fmi-wallet-plan.md`).

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] Slice 3's compatibility window closed by slice 4.
- [ ] Package gates, hygiene and link checks pass on every slice.
- [ ] Package docs match the implemented behaviour.
- [ ] PR text contains no private environment information.
