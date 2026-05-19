# NB UI Frontend — Implementation Plan

**Status:** Planned
**Branch:** `feature-frontend/nb-ui`
**Component:** new `services/nb-ui/` (React + Vite) + supporting `services/nb-bond-api/` changes + `infra/gateway/` route + `sandbox.sh` wiring

## Goal

Introduce a browser-facing operator UI for the bond auction lifecycle that runs end-to-end against the local sandbox at `http://web.cbdc-sandbox.local/` after `./sandbox.sh start`. The UI ports the React frontend prototype (mock-backed) into the repo, switches its single network seam to the real NB Bond API, fills the two missing aggregate endpoints (`/v1/bonds`, `/v1/auctions`) on the backend, and ships a pluggable auth layer that defaults to no-auth locally and can be flipped to OIDC (Entra) at runtime via configuration — without committing any tenant-specific values.

## Current-State Evidence

What was inspected and what was actually verified in this session.

- **Docs read:**
  - `README.md` — sandbox lifecycle, `/etc/hosts` setup, `DEPLOY_*` flag pattern.
  - `AGENTS.md` (root) — operating principles, change hygiene, dependency policy ("any new dep needs explicit operator approval"), licensing guardrails (Apache-2.0 preferred), flag documentation banner rule.
  - `docs/ARCHITECTURE.md` — component diagram, trust-boundary section ("treat the entire environment as trusted-local only").
  - `services/AGENTS.md`, `services/README.md`, `services/DEVELOPMENT.md` — service conventions, lifecycle scripts, hostname pattern.
  - `services/nb-bond-api/README.md` + `DEVELOPMENT.md` — env vars, OpenAPI surface, helm path.
  - `infra/README.md` + `infra/AGENTS.md` — Kind layout, registry workflow, gateway chart.
- **Repo declarations inspected:**
  - `services/nb-bond-api/src/index.ts` — full route list; **no CORS middleware**; routes confirmed: `/v1/bonds/:isin`, `/v1/bonds/:isin/auctions`, `/v1/bonds/:isin/holders`, `/v1/bonds/:isin/history`, `/v1/bonds/:isin/coupon-payments`, `/v1/bonds/:isin/redemptions`, `/v1/auctions/:auctionId`, `/v1/auctions/:auctionId/bids`, `/v1/auctions/:auctionId/allocations`, `/v1/auctions/:auctionId/close`, `/v1/auctions/:auctionId/finalisation`, `/v1/auctions/:auctionId/cancel`, `/v1/health`, `/v1/openapi.json`. **No `/v1/bonds`, no `/v1/auctions` aggregate routes.**
  - `services/nb-bond-api/openapi.json` — same gap confirmed.
  - `services/nb-bond-api/src/ingestion-db.ts` — `auctions` table (keyed by `auction_id`, columns include `isin`, `type`, `created_block`, `bond`) and `partitions` table (keyed by `partition`, columns include `isin`, `bond`, `created_block`). These two are sufficient to back `/v1/bonds` and `/v1/auctions` server-side aggregates.
  - `services/nb-bond-api/src/schemas.ts` — Zod schemas + OpenAPI document live here; new routes need new schemas + spec entries.
  - `services/nb-bond-api/helm/` — chart shape (NB Bond API service).
  - `infra/gateway/templates/` — HTTPRoute resources for the existing four hostnames.
  - `common/images.yaml` — pin point for new base images.
  - `common/versions.yaml` — pin point for any new chart.
  - `sandbox.sh` — `DEPLOY_*` flag pattern, hostname-append logic.
- **Frontend prototype inspected** (extracted from the operator-supplied zip, kept under `/tmp/nb-bonds-frontend/` during planning — not committed):
  - React 18.3.1 + ReactDOM 18.3.1 + Babel-standalone 7.29.0 loaded from CDN with integrity hashes (no build step in the prototype).
  - Single network seam: `src/api/bondsApi.js`, `src/api/auctionsApi.js`. All UI components go through these, never `fetch` directly.
  - `src/api/httpClient.js` is the only place that calls `fetch`. Easy to extend with an auth-header injection point.
  - `window.AppConfig` global: `USE_MOCK`, `API_BASE_URL`, `MOCK_LATENCY_MS`.
  - Mock client in `src/api/mockClient.js` is shape-compatible with the real backend's response envelopes.
  - Frontend's `listBonds()` and `listAllAuctions()` call `/v1/bonds` and `/v1/auctions` respectively — both currently 404 against the real backend.
- **Live local checks (sandbox up, verified 2026-05-19):**
  - `kind get clusters` → `cluster-cbdc-monoledger`. `kubectl config current-context` → `kind-cluster-cbdc-monoledger`.
  - Namespaces present: `besu`, `blockscout`, `jupyterhub`, `nb-bond-api`, `nginx-gateway`, plus standard system namespaces.
  - All workload pods `1/1 Running`; `db-init-job` `Completed`.
  - `kubectl get gateway -A` → `gateway` in `nginx-gateway` namespace, `PROGRAMMED=True`.
  - `kubectl get httproute -A` → three routes today: `besu/besu` (`besu.cbdc-sandbox.local`), `blockscout/blockscout` (`blockscout.cbdc-sandbox.local`), `nb-bond-api/nb-bond-api` (`bond-api.cbdc-sandbox.local`). The new `nb-ui/nb-ui` HTTPRoute (Phase 3) follows the same pattern.
  - `curl http://bond-api.cbdc-sandbox.local/v1/openapi.json` confirms the 13 paths listed above — `/v1/bonds` and `/v1/auctions` absent, matching the gap.
  - `curl http://bond-api.cbdc-sandbox.local/v1/health` returns `{"status":"ok","bondManager":"0xe61...4eB97","bondAuction":"0xcd1...EDB9b","bondToken":"0x290...9563","sealingPublicKey":"0x02bb...71ea"}` — addresses are local-sandbox-only and public-safe (chain id 2018, predeployed genesis).
  - `curl http://bond-api.cbdc-sandbox.local/v1/bonds/<isin>` confirms the response shape the mock client expects: all detail fields are nullable strings; status is `"unknown"` until on-chain ingestion populates it. `GET /v1/bonds/<isin>/auctions` returns `{"auctions":[]}` when no auctions exist — confirms the envelope shape `/v1/auctions` should match.
  - `curl http://bond-api.cbdc-sandbox.local/v1/bonds` and `/v1/auctions` both return `404 Not Found` from the upstream Express, confirming the routes are missing (not a routing problem).
  - `curl -X OPTIONS -H "Origin: http://web.cbdc-sandbox.local" http://bond-api.cbdc-sandbox.local/v1/health` returns `200` with the Helmet-set CSP / COOP / CORP headers but **no `Access-Control-Allow-Origin`** — confirming CORS is absent.
  - `curl /api/v2/main-page/indexing-status` on Blockscout shows `finished_indexing: true`, `indexed_blocks_ratio: 1.00` — indexer caught up; aggregate endpoints can rely on full ingestion-DB content.
  - `kubectl -n nb-bond-api get pod` shows the live nb-bond-api image is `localhost:5001/node:25.6.0-kind` (Node 25.6.0 base). The frontend build image should use a compatible Node major to keep tooling pins consistent.
  - `grep cbdc-sandbox.local /etc/hosts` confirms entries for `besu`, `blockscout`, `bond-api`, `jupyterhub` on `127.0.0.1`. The new `web` hostname will need to be appended by Phase 3.
  - **Unrelated finding (does not block this plan):** `POST http://besu.cbdc-sandbox.local/` (JSON-RPC) returns `404 Not Found` from `nginx`, even though the `besu` HTTPRoute exists with `PathPrefix /` against backend port `8545`. The frontend never calls Besu directly so this does not affect the work, but it's worth a separate look. Captured here so it doesn't get lost.
- **Local validation entry points** the plan will use:
  - `cd contracts && forge test` (contract baseline)
  - `cd services/nb-bond-api && npm test` (existing TypeScript test suite)
  - `cd services/nb-ui && npm run build && npm run test` (after Phase 2 lands)
  - `helm template r services/nb-ui/helm ...` (new chart render)
  - `curl -sI http://web.cbdc-sandbox.local/` (end-to-end smoke)
  - `python3 scripts/verification/check-public-repo-hygiene.py`, `check-markdown-links.py`, `check-third-party-licenses.py`
- **Blocked or unverified checks:**
  - None at plan-write time. Pod readiness, gateway route acceptance, indexer status, OpenAPI surface, response shapes, and CORS state are all confirmed live above. Re-verify at the start of each phase since live state can drift.

## Scope

### In Scope

- New service folder `services/nb-ui/` containing the React frontend ported to Vite (build step), wired to talk to the real NB Bond API by default, with the mock available as an opt-in dev fallback.
- Two new aggregate endpoints in NB Bond API: `GET /v1/bonds` and `GET /v1/auctions`. Both read from the existing ingestion-DB tables.
- CORS middleware in NB Bond API, narrow-scoped to the configured frontend origin (default: `http://web.cbdc-sandbox.local`).
- Pluggable auth layer in the frontend: a small `AuthProvider` interface + two implementations: `none` (default) and `entra` (MSAL Browser). Selected at runtime by `window.AppConfig.AUTH_MODE`.
- Runtime-config injection so the same built bundle can be re-pointed (different `API_BASE_URL`, different `AUTH_MODE`, different OIDC client/tenant) without rebuilding. A `config.template.js` is rendered at container start from env vars.
- New helm chart `services/nb-ui/helm/` with an `nginxinc/nginx-unprivileged` pod (container named `web-server`) serving a Docker-image-baked `dist/`. Runtime config is overlaid from a chart ConfigMap onto `/usr/share/nginx/html/config.js`. Image is built and pushed to the local Kind registry by `./nb-ui.sh start` using a content-hash tag — see `services/nb-ui/Dockerfile`. (An earlier draft of this plan used a host-mounted `dist/` + init container; that was replaced with the image-baked approach in PR 3 to remove the Kind extra-mount and to match exactly what an Azure deployment will pull.)
- New `HTTPRoute` in `infra/gateway/templates/` for `web.cbdc-sandbox.local`.
- New `DEPLOY_NB_UI` flag in `sandbox.sh` (banner-comment block per root `AGENTS.md`).
- New service-scoped docs: `services/nb-ui/README.md`, `AGENTS.md`, `DEVELOPMENT.md`.
- Updates to root `README.md` hosts list, `services/README.md`, `docs/ARCHITECTURE.md` (add the frontend to the component diagram + narrative), `docs/DOCUMENTATION_INDEX.md`.

### Out Of Scope

- Any GitOps / cloud deployment wiring for the frontend. That lives in the separate deployment repo, not here. This plan does not produce Argo CD `Application` definitions, Bicep, Key Vault wiring, Application Gateway changes, or Entra app registrations.
- Tenant-specific Entra values (tenant ID, client ID, redirect URIs, scopes). The frontend reads those from runtime config; the values are supplied by whatever deploys the frontend in a non-local environment. The local sandbox runs with `AUTH_MODE=none` and never needs them.
- Backend token validation. NB Bond API stays unauthenticated in the local sandbox per `docs/ARCHITECTURE.md` "Trust Boundaries And Security Notes". When the API is deployed to a non-local environment and protected, the validation lives in whatever fronts it there — not in this repo's source. The frontend always sends the Bearer header when configured; the local backend just ignores it (CORS still allows the `Authorization` header).
- Adding bidder-side flows (`scripts/bid-encryption/`, `scripts/bid-submitter/` already exist as CLIs). The UI is operator-side only — same scope as NB Bond API itself.
- Adding contract changes. Existing `BondManager` / `BondAuction` / `BondToken` / `BondDvP` / `Wnok` semantics are unchanged.
- Brand-asset legal review. The Norges-Bank-affiliated logo SVG in the prototype is in line with the existing repo affiliation (`contracts/src/norges-bank/` is committed today), but the SVG itself is a new file that needs a license entry in `THIRD_PARTY_NOTES.md` / `THIRD_PARTY_LICENSES.md` — see "Decisions" below.

## Folder And File Placement

| Item | Path | Rationale |
|---|---|---|
| Frontend service folder | `services/nb-ui/` | Operator chose this name; mirrors `services/nb-bond-api/`. |
| Frontend source | `services/nb-ui/src/` | Ported from the zip's `src/` tree, adapted for Vite + JSX file extensions. |
| Frontend static assets | `services/nb-ui/public/` (or `services/nb-ui/src/assets/`) | Vite convention. The Norges Bank logo SVG goes here. |
| Vite config | `services/nb-ui/vite.config.js` | Standard. |
| Lifecycle script | `services/nb-ui/nb-ui.sh` | Matches the `services/<svc>/<svc>.sh` convention used by `nb-bond-api.sh`, `blockscout.sh`. |
| Helm chart | `services/nb-ui/helm/` | Matches `services/nb-bond-api/helm/`. |
| Service docs | `services/nb-ui/README.md`, `AGENTS.md`, `DEVELOPMENT.md` | Required by area convention. |
| Gateway route | `infra/gateway/templates/nb-ui.yaml` (or extend the existing template) | One HTTPRoute for `web.cbdc-sandbox.local`. |
| Hostname | `web.cbdc-sandbox.local` | Matches the short-name convention used by `besu` / `bond-api`. |
| Aggregate endpoint code | `services/nb-bond-api/src/index.ts` + `services/nb-bond-api/src/ingestion-db.ts` + `services/nb-bond-api/src/schemas.ts` | Routes + DB helpers + Zod + OpenAPI doc all live in nb-bond-api today. |
| Plan doc (this file) | `docs/nb-ui-frontend-plan.md` | Single-file plan, matches the existing `docs/jupyter-removal-plan.md` convention. |

## Decisions Already Made

| Decision | Choice | Note |
|---|---|---|
| Folder + name | `services/nb-ui/` | Operator-confirmed. |
| Hostname | `web.cbdc-sandbox.local` | Operator-confirmed. Folder stays `services/nb-ui/` (the npm-scope-style name); the URL is generic because the UI is expected to expand beyond bonds over time. |
| Build tooling | Vite | Operator-confirmed. Adds Vite + `@vitejs/plugin-react` as dev deps. |
| Aggregate endpoints | Add `GET /v1/bonds` and `GET /v1/auctions` server-side | Operator-confirmed. Backed by `auctions` + `partitions` tables in `ingestion-db.ts`. |
| Auth scope | Plugin interface + `none` + full Entra/MSAL plugin in this repo | Operator-confirmed. MSAL Browser added as a runtime dep (MIT, Apache-compatible). |
| Runtime config | `window.__APP_CONFIG__` injected by an nginx-side `config.js` rendered from env vars at container start | Same bundle ships everywhere; the deploying environment supplies the values. |
| Default `USE_MOCK` | `false` (real backend) | Mock kept available as `?mock=1` query param or `AppConfig.USE_MOCK=true` runtime override for dev debugging. |
| PR splitting | Three PRs: (1) backend additions, (2) frontend + auth, (3) chart + gateway + sandbox.sh + docs | Each has a self-contained verification story. |
| Backend new deps | `cors@^2.8.5` (MIT, runtime) + `@types/cors@^2.8.x` (MIT, devDep) | Standard Express CORS middleware; lockfile pin chosen at `npm install` time. |
| Frontend runtime deps | `react@18.3.1`, `react-dom@18.3.1` (MIT); `@azure/msal-browser@^3.x` (MIT) | React versions match the prototype zip. MSAL Browser is Microsoft's open-source SDK. |
| Frontend devDeps | `vite@^5.x` (MIT), `@vitejs/plugin-react@^4.x` (MIT), `vitest@^2.x` (MIT), `@testing-library/react@^16.x` (MIT), `@testing-library/jest-dom@^6.x` (MIT), `jsdom@^25.x` (MIT), `eslint`/`prettier`/related (MIT) | Vitest confirmed in scope. All MIT. Exact lockfile versions captured by `npm install` and reflected in the inventory. |
| `THIRD_PARTY_LICENSES.md` ownership | Every PR that adds, removes, or version-bumps a dep **in its own PR** must update the inventory; `python3 scripts/verification/check-third-party-licenses.py` is a mandatory exit gate for that PR | The script reconciles inventory rows against each tracked `package.json` + `package-lock.json` and validates license labels against the lockfile metadata. A drifted inventory breaks CI for everyone. |
| `docs/THIRD_PARTY_NOTES.md` ownership | The nginx runtime image (deployment-time component) lands in PR 3 with its note | Matches the existing pattern (Blockscout backend/frontend images, BENS swagger). The Norges Bank logo SVG is repository-owned and does **not** need a row. |

## Decisions Resolved (operator answers, 2026-05-19)

| Topic | Decision | Note |
|---|---|---|
| Hostname | `web.cbdc-sandbox.local` | Future-proofs the URL for a UI that may host more than bonds. Folder remains `services/nb-ui/`. |
| Norges Bank logo SVG | Repository-owned; no third-party license entry needed | Inherits the repo-default Apache-2.0. Do not add to `docs/THIRD_PARTY_NOTES.md`. |
| Frontend test framework | Vitest is in (devDep); tests must run in CI on any PR touching `services/nb-ui/` | Test style: **feature-level**, not micro. Cover whole user flows (e.g. bonds index renders + opens detail, auction lifecycle modal opens + submits) rather than per-prop / per-render assertions. |
| CI for UI tests | New GH Actions workflow `.github/workflows/nb-ui.yml` triggered on `services/nb-ui/**` paths | Mirrors the existing `nb-bond-api.yml` pattern. Required for merge. |
| Bundle browser target | Modern browsers only (Vite default `es2020`+) | No polyfills, no IE / legacy-Safari workarounds. |
| `DEPLOY_NB_UI` default | `true` in `sandbox.sh generate-config` | Operator can flip to `false` per existing `DEPLOY_*` flag pattern. |
| New `reopenAuction` action in the updated UI | Stub on the frontend; file a backend follow-up | `BondAuction` contract has no on-chain transition from `closed` back to `open`. `AuctionsApi.reopenAuction()` will throw a clear `NotImplementedError` in real mode (and still work in mock mode). The button stays visible in `AuctionLifecyclePanel.jsx` for prototype-fidelity; clicking it surfaces a "Backend does not support reopen yet" toast. Tracked as follow-up in `docs/KNOWN_ISSUES.md` (added in Phase 5). |

## Portability Flags (local-acceptable; surface for any future non-local deployment)

These are choices the plan makes that work fine locally but should be revisited if/when the frontend is later deployed elsewhere. They are **flagged only** — solving them is out of scope for this plan.

- **CORS allow-list** is exact-string `http://web.cbdc-sandbox.local` by default. A non-local deployment will need its own origin in the env-supplied list.
- **`API_BASE_URL`** defaults to `http://bond-api.cbdc-sandbox.local`. The same bundle in a non-local environment needs a different value — supplied via the runtime-config env injection mechanism this plan introduces, so no code change needed.
- **`AUTH_MODE=none`** is the local default. Flipping to `entra` requires runtime config (`AUTH_TENANT_ID`, `AUTH_CLIENT_ID`, `AUTH_AUTHORITY`, `AUTH_SCOPES`, `AUTH_REDIRECT_URI`) which is never committed here.
- **Backend token validation**. The local NB Bond API ignores the `Authorization` header. A non-local deployment must put a validating layer in front of the API. That layer is not this plan's concern.
- **Nginx image** in the helm chart is pinned in `common/images.yaml`. A non-local deployment may want a different image (e.g. a hardened distroless variant). Keep the pin overridable via chart values.
- **CSP / security headers** are intentionally permissive in the local nginx config to keep CDN-style script loading working during debug. A non-local deployment should tighten CSP; flag in `services/nb-ui/DEVELOPMENT.md`.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| `./sandbox.sh start` from a clean state brings the frontend up reachable at `http://web.cbdc-sandbox.local/` | Headline operator outcome | `curl -sI http://web.cbdc-sandbox.local/` returns `200 OK` and `Content-Type: text/html` | Current state after merge |
| Frontend renders the bonds index page using real backend data | Proves the mock→live switch + the new `/v1/bonds` endpoint | Browser loads `http://web.cbdc-sandbox.local/#/bonds`; the table is populated (or empty-state if no bonds exist yet) without any `404` in the browser network tab | Current state |
| Frontend renders an auction detail page with bids, allocation, and close/finalise/cancel buttons | Proves the per-auction wiring end-to-end | Click through `/#/auctions` → an auction; verify the bids list, allocation table, and action buttons all populate from `/v1/auctions/<id>/...` | Current state |
| Backend tests pass with the new aggregate endpoints + CORS | Confirms no regression to existing routes | `cd services/nb-bond-api && npm test` green | Current state |
| New aggregate endpoints documented in `services/nb-bond-api/openapi.json` | Spec stays the source of truth (the mock client and any external integrator depends on it) | `curl -s http://bond-api.cbdc-sandbox.local/v1/openapi.json | jq '.paths | keys'` includes `/v1/bonds` and `/v1/auctions`; `services/nb-bond-api/openapi.json` checked into git matches | Current state |
| CORS preflight succeeds from the frontend origin and fails from any other origin | Confirms the security boundary is real, not permissive | `curl -sI -H "Origin: http://web.cbdc-sandbox.local" -H "Access-Control-Request-Method: GET" -X OPTIONS http://bond-api.cbdc-sandbox.local/v1/bonds` returns `204` with `Access-Control-Allow-Origin: http://web.cbdc-sandbox.local`; with `Origin: http://evil.example` the header is absent | Current state |
| `AUTH_MODE=none` (default) — no login UI, no Bearer header on requests | Local default works without any Entra config | Browser dev-tools shows API requests with no `Authorization` header; no login button visible | Current state |
| `AUTH_MODE=entra` + dummy runtime config — login button appears, MSAL flow attempted | Confirms the plugin is wired without needing a real tenant | Reload the page with `window.__APP_CONFIG__.AUTH_MODE = "entra"` and any non-empty `AUTH_CLIENT_ID` / `AUTH_TENANT_ID`: a "Sign in" button renders and clicking it initiates a redirect (which will fail at the IdP — fine; the plugin is reachable) | Current state |
| Built bundle contains no hard-coded `localhost`, no hard-coded backend URL, no hard-coded tenant/client IDs | Portability — same bundle is re-pointable at runtime | `grep -E 'cbdc-sandbox.local|localhost|tenantId' services/nb-ui/dist/assets/*.js` returns nothing (the values live in the runtime-rendered `config.js` only) | Current state |
| Pluggable auth abstraction is one file | Future plugin additions don't require touching the UI | `services/nb-ui/src/auth/index.js` resolves `AuthProvider` from `window.__APP_CONFIG__.AUTH_MODE`; UI imports never reference `none`/`entra` directly | Current state |
| Public-repo hygiene scripts pass | Sandbox is public-safe | `python3 scripts/verification/check-public-repo-hygiene.py`, `check-markdown-links.py`, `check-third-party-licenses.py` all exit `0` | Current state |
| License inventory matches every tracked `package.json` + lockfile | Sandbox CI gate; broken inventory blocks every other PR until fixed | `python3 scripts/verification/check-third-party-licenses.py` exits `0` after **each** of PR 1, PR 2, PR 3 (not deferred to the last PR) | Current state after each PR |
| Docs updated: `docs/DOCUMENTATION_INDEX.md`, `services/README.md`, `docs/ARCHITECTURE.md`, root `README.md` hosts list | Repo's documentation about itself tracks the project | All four files include the frontend; index lists the new docs | Current state |

## Assumptions

These are safe to proceed with; anything risky lives in "Decisions Still Open" above.

- The ingestion DB's `auctions` and `partitions` tables are populated by the existing on-chain event ingester. The new aggregate endpoints read existing data; no new ingestion logic is needed.
- The frontend prototype's response-envelope shapes match the backend's existing responses for the per-ISIN and per-auctionId routes (the prototype README explicitly says "Mock is shape-compatible"). Phase 1's first task is to confirm this against real backend output for the routes that already exist.
- The Norges Bank affiliation is already present in the public repo (see `contracts/src/norges-bank/`), so the UI's "NB Government Bonds" title and Norges Bank logo do not introduce new affiliation that wasn't already in source.
- The local Kind cluster has enough headroom for an additional nginx pod serving static assets (small footprint; alpine-based nginx image).
- The operator is OK adding these runtime deps to the new frontend: `react@18.3.1`, `react-dom@18.3.1`, `@azure/msal-browser` (MIT). Vite + plugin-react + Vitest are dev-time only.

## Plan Order

```
Phase 0  Baseline verification (sandbox up, current backend OpenAPI, gateway routes, contract addresses)
Phase 1  NB Bond API additions  (PR 1)
  1a  Add ingestion-db aggregate helpers + Zod schemas + OpenAPI entries
  1b  Add GET /v1/bonds and GET /v1/auctions route handlers
  1c  Add CORS middleware with env-driven allow-list
  1d  npm test green; openapi.json regen
  1e  THIRD_PARTY_LICENSES.md ### services/nb-bond-api updated (cors + @types/cors rows);
      check-third-party-licenses.py passes
Phase 2  Frontend scaffolding (Vite + ported source + auth plugin)  (PR 2)
  2a  services/nb-ui/ scaffold with Vite + React
  2b  Port src/ from the prototype zip (JSX file extensions, ESM imports, remove window.* globals)
  2c  Build the AuthProvider plugin layer (interface + none + entra)
  2d  Wire HttpClient to call AuthProvider.getAuthHeader() per request
  2e  Add runtime-config injection (config.template.js)
  2f  npm run build green; vitest (if accepted) green
  2g  THIRD_PARTY_LICENSES.md new ### services/nb-ui section authored;
      THIRD_PARTY_NOTES.md updated with Norges Bank SVG row (if third-party);
      check-third-party-licenses.py + check-public-repo-hygiene.py + check-markdown-links.py pass
Phase 3  Chart + gateway + sandbox.sh wiring  (PR 3)
  3a  services/nb-ui/helm/ chart (nginx Deployment + Service + initContainer for config)
  3b  Pin nginx image in common/images.yaml
  3c  Add HTTPRoute for web.cbdc-sandbox.local in infra/gateway/templates/
  3d  Add DEPLOY_NB_UI flag + banner-comment in sandbox.sh
  3e  Update /etc/hosts append logic in sandbox.sh
  3f  Add nb-ui.sh lifecycle script
  3g  THIRD_PARTY_NOTES.md updated with nginx base image row;
      all three scripts/verification/check-*.py pass
Phase 4  Local apply + smoke tests  (operator-driven, after PR 3 merged)
  4a  ./infra/infra.sh registry-sync (pulls the new nginx pin)
  4b  ./sandbox.sh start (or narrower restart)
  4c  Reachability + readiness checks (per Acceptance Criteria above)
  4d  CORS positive + negative test
  4e  Auth-mode none + entra-with-dummy-config test
Phase 5  Documentation closeout  (folded into PR 3, since the docs change set is small)
  5a  services/nb-ui/README.md + AGENTS.md + DEVELOPMENT.md
  5b  Update services/README.md, root README.md hosts list
  5c  Update docs/ARCHITECTURE.md (diagram + narrative)
  5d  Update docs/DOCUMENTATION_INDEX.md
  5e  Re-run all three scripts/verification/check-*.py as a final sanity pass
```

---

## Phase 0: Baseline Verification

### Goal

Prove the starting state before any change lands.

### Steps

1. `kind get clusters` → expect `cluster-cbdc-monoledger`; if missing, run `./sandbox.sh start` (operator OK first).
2. `kubectl config current-context` → expect `kind-cluster-cbdc-monoledger`.
3. `docker ps | grep kind-registry` → registry up.
4. `grep cbdc-sandbox.local /etc/hosts` → existing 4 entries present.
5. `helm list -A` → existing releases healthy.
6. `kubectl get gateway,httproute -A` → existing 4 hostnames `Accepted=True`.
7. `cd services/nb-bond-api && npm test` → backend tests green at baseline.
8. `curl -s http://bond-api.cbdc-sandbox.local/v1/openapi.json | jq '.paths | keys'` — capture; expect `/v1/bonds` and `/v1/auctions` absent.
9. `cast call --rpc-url http://besu.cbdc-sandbox.local/ <global-registry-address> "lookup(string)(address)" "Bond Manager"` — confirm a non-zero address (chain is wired).
10. Capture all of the above to a baseline file (e.g. paste into PR 1 description).

### Verification Stop

All ten steps succeed; baseline captured. If any fail, fix or escalate to the operator before proceeding.

### Fix Iteration / Rollback

Sandbox down → `./sandbox.sh start` (operator OK). Registry container missing → `./infra/infra.sh registry-start`. Tests red → no plan execution until tests are restored on `development`.

### Exit Criteria

- Sandbox running.
- Baseline snapshot captured.
- nb-bond-api test suite green.

---

## Phase 1: NB Bond API additions

### Goal

Make `/v1/bonds` and `/v1/auctions` available with the response shapes the frontend's mock client already expects, and put CORS in front of NB Bond API.

### Scope

`services/nb-bond-api/` only. No frontend code yet.

### Steps

**1a — ingestion-db helpers + Zod + OpenAPI:**

- In `services/nb-bond-api/src/ingestion-db.ts`, add:
  - `listAllAuctionsFromDb(db)` → `SELECT auction_id, isin, type, created_block, created_tx, bond FROM auctions ORDER BY created_block DESC, auction_id`.
  - `listAllBondsFromDb(db)` → `SELECT DISTINCT isin, bond, MIN(created_block) AS created_block FROM partitions GROUP BY isin, bond ORDER BY created_block`.
- In `services/nb-bond-api/src/schemas.ts`:
  - Add `ListBondsResponse` and `ListAllAuctionsResponse` Zod schemas matching the mock shape: `{ bonds: BondSummary[] }`, `{ auctions: AuctionSummary[] }`.
  - Add the two routes to `openApiDocument`.
- The bond summary shape returned by `GET /v1/bonds` should match what `GET /v1/bonds/{isin}` returns today (re-use the same composer). Where the rich bond detail requires an on-chain call (e.g. `totalSupply`), fetch lazily per-bond OR document that `/v1/bonds` returns a thinner summary and `/v1/bonds/{isin}` returns the full detail — match whatever the prototype's mock expects (per `mockClient.js` `listBonds()`, it returns the same shape as `getBond()`).
- Decision point for the implementer: if the per-bond on-chain fan-out is too slow for a list view, return a summary + add a query param `?detail=full` (out of scope for v1 unless the page is unusable without it — verify in Phase 4).

**1b — route handlers:**

- In `services/nb-bond-api/src/index.ts`:
  - `app.get('/v1/bonds', async (_req, res) => { ... })` — read `listAllBondsFromDb`, hydrate each with the existing per-ISIN composer or a leaner summary, respond `{ bonds }`.
  - `app.get('/v1/auctions', async (_req, res) => { ... })` — read `listAllAuctionsFromDb`, hydrate via `ensureCached(auctionId)` (existing helper) to get summaries, respond `{ auctions }`.

**1c — CORS:**

- Add `cors` to `package.json` dependencies (operator OK per root `AGENTS.md` — `cors@^2.8.5`, MIT).
- In `index.ts`, after `helmet()`, add:
  ```ts
  app.use(cors({
    origin: envVariables.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));
  ```
- Add `CORS_ALLOWED_ORIGINS` to `env-vars.ts` with a default of `http://web.cbdc-sandbox.local`.
- Document the env var in `services/nb-bond-api/README.md`.

**1d — tests + OpenAPI regen:**

- Add unit tests covering: `/v1/bonds` empty, `/v1/bonds` populated, `/v1/auctions` empty, `/v1/auctions` populated, CORS allowed-origin preflight, CORS disallowed-origin preflight.
- `npm test` green.
- `services/nb-bond-api/openapi.json` regenerated and committed.

**1e — license inventory (same PR):**

- After `npm install cors @types/cors`, the lockfile pin will resolve to exact versions (e.g. `cors@2.8.5`, `@types/cors@2.8.x`).
- In `THIRD_PARTY_LICENSES.md`, under `### services/nb-bond-api`:
  - Add `cors` row to the **runtime** dependency table (alphabetical position) — Version = lockfile version, License = lockfile license field (expect `MIT`).
  - Add `@types/cors` row to the **devDependencies** table (alphabetical position) — same source.
- Run `python3 scripts/verification/check-third-party-licenses.py` locally. If it fails:
  - The most common cause is the lockfile reporting a license value different from what we typed (e.g. `MIT` vs `ISC`). Read the script error, trust the lockfile, edit the table.
  - Do NOT add `cors` to the devDeps table by mistake — the script enforces the runtime/dev split.

### Verification Stop

- `npm test` green.
- `npm run lint && npm run format:check` green.
- `curl -s http://bond-api.cbdc-sandbox.local/v1/openapi.json | jq '.paths | keys'` includes `/v1/bonds` and `/v1/auctions`.
- `curl -sI -H "Origin: http://web.cbdc-sandbox.local" -X OPTIONS http://bond-api.cbdc-sandbox.local/v1/bonds` returns `Access-Control-Allow-Origin: http://web.cbdc-sandbox.local`.
- `curl -sI -H "Origin: http://evil.example" -X OPTIONS http://bond-api.cbdc-sandbox.local/v1/bonds` does NOT return that header.
- **`python3 scripts/verification/check-third-party-licenses.py` passes** (exit 0). This is a mandatory gate.
- `python3 scripts/verification/check-public-repo-hygiene.py` passes (it's cheap to run; failures here are usually unrelated regressions but worth catching early).

### Fix Iteration / Rollback

Backend test red → fix in the same PR. Routes returning unexpected shape → align with the mock-client shape exactly (the frontend is shape-strict). CORS rejecting valid origin → check env var precedence + helmet ordering.

### Exit Criteria

PR 1 reviewable in isolation: aggregate endpoints + CORS land, every existing test passes, OpenAPI spec reflects the new routes. The frontend doesn't exist yet — `bond-api` users see only added surface.

---

## Phase 2: Frontend scaffolding (Vite + ported source + auth plugin)

### Goal

Bring the prototype into the repo as a real Vite project with the mock-to-real network seam already pointing at the real backend by default, and ship a working pluggable auth layer.

### Scope

`services/nb-ui/` only. Backend already has the routes from Phase 1.

### Steps

**2a — Vite scaffold:**

```
cd services
npm create vite@latest nb-ui -- --template react
cd nb-ui
npm install
```

Then:
- Pin React versions: `react@18.3.1`, `react-dom@18.3.1` (match the prototype).
- Add `@azure/msal-browser@^3.x` as a runtime dep (MIT).
- Add `vitest` + `@testing-library/react` as dev deps if Vitest is approved (see "Decisions Still Open").
- `npm run build` should succeed on the unmodified template before any porting.

**2b — Port `src/` from the prototype zip:**

- File-by-file rename: `.js` UI files → `.jsx`. `.js` non-UI files (`config.js`, `httpClient.js`, `mockClient.js`, `bondsApi.js`, `auctionsApi.js`, `utils/format.js`) stay `.js`.
- Replace IIFE + `window.X = ...` pattern with ES module `export`s. Each consumer uses `import`.
- `app.jsx` becomes the standard `main.jsx` + `App.jsx` pair; `ReactDOM.createRoot` goes into `main.jsx`.
- `config.js` becomes a thin reader: `export const AppConfig = window.__APP_CONFIG__ ?? defaults` so runtime injection works.
- Default `AppConfig`: `USE_MOCK=false`, `API_BASE_URL='http://bond-api.cbdc-sandbox.local'`, `AUTH_MODE='none'`, `MOCK_LATENCY_MS=0`.
- Keep the single-network-seam architecture exactly as the prototype README describes (UI → `bondsApi`/`auctionsApi` → `HttpClient` or `MockClient`).
- The mock client stays in the codebase — useful for dev work when the backend is down. Toggle via `USE_MOCK` at runtime.
- The `?mock=1` query-string toggle is a nice-to-have; defer if it complicates Vite routing.

**2c — AuthProvider plugin layer:**

Create `services/nb-ui/src/auth/`:

```
auth/
  index.js          - resolveAuthProvider(mode) → returns one of the implementations
  AuthProvider.js   - the interface (jsdoc-typed): { init(), login(), logout(), getAccount(), getAuthHeader() }
  noneAuth.js       - returns no-op + null Authorization header
  entraAuth.js      - MSAL Browser implementation
```

- `noneAuth.js`: every method is a no-op. `getAuthHeader()` returns `null`.
- `entraAuth.js`:
  - Lazy-loads `@azure/msal-browser` (dynamic `import()`) so the no-auth bundle path doesn't pay the MSAL bytes.
  - Reads `AppConfig.AUTH_TENANT_ID`, `AUTH_CLIENT_ID`, `AUTH_AUTHORITY`, `AUTH_SCOPES`, `AUTH_REDIRECT_URI` from `window.__APP_CONFIG__`.
  - On `login()`: redirect or popup MSAL flow.
  - On `getAuthHeader()`: returns `Bearer <accessToken>` from MSAL's silent token cache; triggers re-login if expired.
- Update `App.jsx` to call `AuthProvider.init()` on mount and render a `LoginButton` / `UserBadge` in the layout when `AUTH_MODE !== 'none'`. With `AUTH_MODE='none'`, neither shows.

**2d — wire HttpClient:**

In `httpClient.js`:
```js
async function authHeaders() {
  const v = await AuthProvider.getAuthHeader();
  return v ? { Authorization: v } : {};
}
```

…and merge into every request's headers. No other UI code touches auth.

**2e — runtime-config injection:**

- `services/nb-ui/public/config.template.js`:
  ```js
  window.__APP_CONFIG__ = {
    USE_MOCK: __USE_MOCK__,
    API_BASE_URL: "__API_BASE_URL__",
    AUTH_MODE: "__AUTH_MODE__",
    AUTH_TENANT_ID: "__AUTH_TENANT_ID__",
    AUTH_CLIENT_ID: "__AUTH_CLIENT_ID__",
    AUTH_AUTHORITY: "__AUTH_AUTHORITY__",
    AUTH_SCOPES: "__AUTH_SCOPES__",
    AUTH_REDIRECT_URI: "__AUTH_REDIRECT_URI__",
  };
  ```
- At runtime, the nginx pod's init container runs `envsubst` over the template into `config.js` and serves it from `/config.js`.
- `index.html` loads `<script src="/config.js"></script>` before the React bundle, so `window.__APP_CONFIG__` is populated by the time `main.jsx` reads it.

**2f — tests + build:**

- `npm run build` green; output goes to `services/nb-ui/dist/`.
- `vitest` (if approved) covers: `auth/index.js` mode resolution, `noneAuth.getAuthHeader()` returns null, `entraAuth` lazy-loads MSAL, `httpClient` includes Authorization when AuthProvider returns one, mock client API shape parity with `services/nb-bond-api/openapi.json` for the routes the frontend uses.
- ESLint + Prettier configured per Vite defaults; `npm run lint` green.

**2g — license inventory + in-tree third-party (same PR):**

- Open `THIRD_PARTY_LICENSES.md` and add a **new** section `### services/nb-ui` with two tables:
  - **Runtime dependencies** — every entry under `dependencies` in `services/nb-ui/package.json`, lockfile version, lockfile license. Expected: `@azure/msal-browser`, `react`, `react-dom` (and `@azure/msal-browser`'s transitive sibling `@azure/msal-common` only if it shows up as a direct dep, which it normally doesn't).
  - **Dev dependencies** — every entry under `devDependencies` in `services/nb-ui/package.json`, lockfile version, lockfile license. Expected base set: `vite`, `@vitejs/plugin-react`, `eslint`, `eslint-config-prettier`, `prettier`, `@types/react`, `@types/react-dom`. If Vitest is approved: add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
  - Cross-check both tables by running `python3 scripts/verification/check-third-party-licenses.py` — it enumerates package.json + lockfile and reports any mismatch.
- In `docs/THIRD_PARTY_NOTES.md`, add a row under "In-Tree Third-Party Material" for the Norges Bank logo SVG (path: `services/nb-ui/public/<filename>.svg` or wherever it lands; Provenance: bundled with the operator-supplied frontend prototype; License: per "Open Questions" item #2). If the SVG turns out to be repository-owned (not third-party), it does NOT belong in this table — but it then needs to inherit the repo-default Apache-2.0 (see the SPDX guidance in root `README.md` / `AGENTS.md`).
- Re-run both verification scripts:
  - `python3 scripts/verification/check-third-party-licenses.py`
  - `python3 scripts/verification/check-public-repo-hygiene.py`

### Verification Stop

- `npm run build` succeeds.
- `npm run lint` succeeds.
- `npm test` (Vitest) succeeds if added.
- `grep -E 'cbdc-sandbox.local|localhost' dist/assets/*.js` returns nothing (only the runtime-config has them).
- **`python3 scripts/verification/check-third-party-licenses.py` passes** (exit 0).
- **`python3 scripts/verification/check-public-repo-hygiene.py` passes** (exit 0).
- **`python3 scripts/verification/check-markdown-links.py` passes** (in case docs were added under `services/nb-ui/`).

### Fix Iteration / Rollback

If MSAL lazy-loading fails under Vite's chunking, fall back to a normal `import` and accept the bundle-size cost — flag in DEVELOPMENT.md. If the auth plugin abstraction leaks into UI files, refactor before merging Phase 2.

### Exit Criteria

PR 2 reviewable in isolation: complete frontend codebase including the auth plugin, builds cleanly, runs (`npm run dev`) against a manually-started local backend. Not yet deployable through `./sandbox.sh start` — that's Phase 3.

---

## Phase 3: Chart + gateway + sandbox.sh wiring

### Goal

Deploy the built frontend in the Kind cluster behind the gateway, controllable by a `DEPLOY_NB_UI` flag, with runtime config injected from chart values.

### Scope

`services/nb-ui/helm/`, `infra/gateway/templates/`, `common/images.yaml`, `sandbox.sh`, new `services/nb-ui/nb-ui.sh`.

### Steps

**3a — Helm chart:**

`services/nb-ui/helm/` containing:
- `Chart.yaml`
- `values.yaml` — image, replicas, resources, the runtime-config block:
  ```yaml
  runtimeConfig:
    apiBaseUrl: "http://bond-api.cbdc-sandbox.local"
    useMock: false
    authMode: "none"
    authTenantId: ""
    authClientId: ""
    authAuthority: ""
    authScopes: ""
    authRedirectUri: ""
  ```
- `templates/deployment.yaml` — nginx Deployment with:
  - `initContainers[0]`: `image: busybox`, runs `envsubst < /config-template/config.template.js > /config-out/config.js` from envs derived from `runtimeConfig`.
  - `containers[0]`: nginx serving `/usr/share/nginx/html/` (the built bundle) + the rendered `config.js`.
  - `volumes`: `emptyDir` for `config-out`; `configMap` for the bundle (or bake it into the image — preferred for image immutability).
- `templates/service.yaml` — ClusterIP on port 80.
- `templates/configmap.yaml` — only the runtime-config template, not the bundle.

Decision in 3a: bake the static bundle into the image or load via ConfigMap? Bake-into-image is cleaner (immutable, smaller chart) but requires an image build step. Loading via ConfigMap keeps the chart self-contained but the bundle is large for a ConfigMap (typically a few hundred KB after Vite). **Recommend bake-into-image**: build the bundle as part of the image build, then the chart only injects runtime-config. This adds an image build step — a Dockerfile under `services/nb-ui/Dockerfile`.

**3b — Image pin:**

- Add to `common/images.yaml`:
  ```yaml
  nb-ui:
    nginx: nginxinc/nginx-unprivileged:1.27-alpine
  ```
- For the `nb-ui` runtime image itself (the one built from `services/nb-ui/Dockerfile`), pin its tag in `services/nb-ui/helm/values.yaml`. Initial tag = git short-sha at build time; the local registry-sync step builds + pushes it.

**3c — Gateway route:**

- New `infra/gateway/templates/nb-ui-httproute.yaml`:
  ```yaml
  apiVersion: gateway.networking.k8s.io/v1
  kind: HTTPRoute
  metadata:
    name: nb-ui
    namespace: <gateway-ns>
  spec:
    parentRefs:
      - name: <gateway-name>
    hostnames:
      - web.cbdc-sandbox.local
    rules:
      - backendRefs:
          - name: nb-ui
            namespace: nb-ui
            port: 80
  ```

**3d — `DEPLOY_NB_UI` flag:**

- Extend the banner-comment block in `sandbox.sh` to document `DEPLOY_NB_UI` (per root `AGENTS.md` "Flag documentation").
- Default `true`.
- Wire `./sandbox.sh start` to call `./services/nb-ui/nb-ui.sh start` when enabled.

**3e — `/etc/hosts` append:**

- Extend the existing hosts-append logic in `sandbox.sh` to add `web.cbdc-sandbox.local`.
- Mirror in `README.md` "Quick Setup" hosts list.

**3f — Lifecycle script:**

- `services/nb-ui/nb-ui.sh start|stop` matching `nb-bond-api.sh` shape. Handles registry-sync for the new image + `helm upgrade --install`.

**3g — Deployment-time third-party note (same PR):**

- `docs/THIRD_PARTY_NOTES.md` currently lists Blockscout backend/frontend images and the JupyterHub chart-templates origin as deployment-time third-party references. Add the same kind of note for the new nginx runtime image (`nginxinc/nginx-unprivileged:1.27-alpine`, BSD-2-Clause).
- The `services/nb-ui` runtime image (built from the local `Dockerfile`, based on Node + nginx) is a **repository-built** artefact, not a third-party image, so it does not need its own row — but the **base images** the Dockerfile uses do. List each base image once.
- Run:
  - `python3 scripts/verification/check-third-party-licenses.py`
  - `python3 scripts/verification/check-public-repo-hygiene.py`
  - `python3 scripts/verification/check-markdown-links.py`

### Verification Stop

- `helm template r services/nb-ui/helm --values services/nb-ui/helm/values.yaml` renders cleanly; diff against any previous render captured.
- `helm template ...` shows the runtime-config envs propagating into the init container env block.
- No other release's rendered manifest changes.
- **All three `scripts/verification/check-*.py` scripts pass** (exit 0). This is a mandatory gate before merge — any inventory or hygiene regression must be fixed here, not deferred.

### Fix Iteration / Rollback

Helm template fails → fix template syntax. Image build fails → check the Dockerfile and the build context. Gateway route not picked up → confirm Gateway listener allows additional hostnames (it usually does; if not, that's an existing gateway-chart change).

### Exit Criteria

PR 3 reviewable: chart, image build, gateway route, `DEPLOY_NB_UI` flag, hosts append, lifecycle script. Nothing applied to the cluster yet — that's Phase 4.

---

## Phase 4: Local apply + smoke tests

### Goal

Bring the full stack up locally and verify every Acceptance Criterion.

### Scope

Mutates local state. Operator must confirm before each mutating step. No code change in this phase.

### Steps

1. Capture current sandbox state (the `sandbox-stack-verifier` `pre-change.md` checklist).
2. `./infra/infra.sh registry-sync` — pulls the new nginx pin and the new nb-ui image.
3. `./sandbox.sh start` (or a narrower restart: `./services/nb-ui/nb-ui.sh start` after `./services/nb-bond-api/nb-bond-api.sh start` for the new endpoints).
4. Wait for `Ready`: `kubectl -n nb-ui get pods -w` until `Running 1/1`.
5. Reachability: `curl -sI http://web.cbdc-sandbox.local/` → `200 OK`.
6. Browser smoke test (operator-driven):
   - Open `http://web.cbdc-sandbox.local/#/bonds` — bonds index loads, no console errors.
   - Click a bond — detail page loads with auctions + holders.
   - Open `http://web.cbdc-sandbox.local/#/auctions` — auctions index loads.
   - Click an auction — bids + allocation render.
   - Create-bond modal opens.
   - Create-auction modal opens.
7. CORS positive: `curl -sI -H "Origin: http://web.cbdc-sandbox.local" -X OPTIONS http://bond-api.cbdc-sandbox.local/v1/bonds` → ACAO header matches.
8. CORS negative: same with `Origin: http://evil.example` → no ACAO header.
9. Auth mode none: confirm in browser dev-tools that no `Authorization` header is sent.
10. Auth mode entra (dummy):
    - `kubectl -n nb-ui edit deploy nb-ui` to set env `AUTH_MODE=entra`, `AUTH_CLIENT_ID=00000000-0000-0000-0000-000000000000`, `AUTH_TENANT_ID=00000000-0000-0000-0000-000000000000`, `AUTH_AUTHORITY=https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000`.
    - Pod restarts; refresh the browser.
    - Confirm a "Sign in" button is visible.
    - Click it — expect a redirect attempt to login.microsoftonline.com (will fail at IdP — that's fine; the plugin is reachable and the integration is wired).
    - Revert the env vars; pod restarts; "Sign in" button gone.
11. Bundle-bare-of-config grep: `kubectl -n nb-ui exec <pod> -- grep -E 'cbdc-sandbox.local|localhost' /usr/share/nginx/html/assets/*.js | wc -l` → `0`.

### Verification Stop

All ten checks pass. The `sandbox-stack-verifier` `post-change.md` checklist is fully green.

### Fix Iteration / Rollback

Pod `ImagePullBackOff` → registry didn't get the new image; re-run `./infra/infra.sh registry-sync`. Gateway route not `Accepted` → re-check `parentRefs` and listener allowed hostnames. CORS rejecting everything → check env var parsing in `index.ts`. Auth-mode flip doesn't change UI → confirm `window.__APP_CONFIG__` was re-rendered (init container ran on pod restart).

### Exit Criteria

End-to-end smoke green. Operator decides whether to keep `DEPLOY_NB_UI=true` as the default in `.env.sandbox` or document the toggle.

---

## Phase 5: Documentation + public-repo hygiene

### Goal

Leave the repo's documentation in a maintainable, public-safe state matching the new component.

### Scope

Documentation files only. No source / chart / config changes.

### Steps

**5a — Service docs:**

- `services/nb-ui/README.md` — what it is, how to run locally, `npm run dev` instructions, env-var surface, mock vs real, default hostname, link to `DEVELOPMENT.md`.
- `services/nb-ui/AGENTS.md` — inherits root; folder-specific structure, run commands, style, safety checklist (don't paste tenant IDs, runtime config is env-driven, CORS allow-list is exact-string).
- `services/nb-ui/DEVELOPMENT.md` — Vite dev server, debugging the auth plugin, swapping between mock and real backend, the runtime-config injection mechanism, CSP / security headers note (currently permissive; flag for hardening).

**5b — Cross-cutting docs:**

- `services/README.md` — add a one-line entry for `nb-ui/`.
- `README.md` (root) — add `web.cbdc-sandbox.local` to the `/etc/hosts` list under "Quick Setup".

**5c — Architecture:**

- `docs/ARCHITECTURE.md`:
  - Add the frontend to the component diagram (it sits in the host/browser column, talking to NB Bond API via the gateway).
  - Add a section under "Off-Chain Architecture" describing the frontend, the pluggable auth model, and the trust posture (local: no auth; non-local: pluggable).
  - Update "Trust Boundaries And Security Notes" to mention the frontend is also trusted-local with no auth by default.

**5d — Index:**

- `docs/DOCUMENTATION_INDEX.md`:
  - Add `docs/nb-ui-frontend-plan.md` (this file) under "Core entrypoints" or "Operations and reports".
  - Add `services/nb-ui/README.md`, `services/nb-ui/AGENTS.md`, `services/nb-ui/DEVELOPMENT.md` under "Infra and services".

**5e — Hygiene + license re-check (sanity):**

The license-inventory updates already landed in PR 1, PR 2, PR 3 alongside the dep introductions. Phase 5 only re-runs the scripts to confirm nothing slipped during doc edits:

- `python3 scripts/verification/check-public-repo-hygiene.py` — pass.
- `python3 scripts/verification/check-markdown-links.py` — pass.
- `python3 scripts/verification/check-third-party-licenses.py` — pass.

If any script reports a regression here, fix in PR 3 before merge — do not split into a fourth PR.

### Verification Stop

All three verification scripts pass. All cross-references in `docs/DOCUMENTATION_INDEX.md` resolve. Architecture diagram renders correctly in GitHub's Markdown viewer.

### Fix Iteration / Rollback

Hygiene script catches a real-looking secret in committed text → remove it, rotate it if relevant. Markdown link broken → fix the path.

### Exit Criteria

PR 3 also carries the docs changes. After merge, a new reader can go `README.md` → `docs/ARCHITECTURE.md` → `services/nb-ui/README.md` and understand the frontend.

---

## Documentation And PR Plan

Each PR is **self-contained for license + hygiene checks**: any PR that adds, removes, or version-bumps a dep also updates `THIRD_PARTY_LICENSES.md` (and, for in-tree third-party material, `docs/THIRD_PARTY_NOTES.md`) in the same change set, and passes `python3 scripts/verification/check-*.py` before merge. License updates are **not** allowed to slip across PR boundaries — the verification scripts run in CI and a drifted inventory blocks every subsequent PR.

- **PR 1** (`feature-frontend/nb-ui` → `development`): NB Bond API additions — `/v1/bonds`, `/v1/auctions`, `cors` + `@types/cors` deps, CORS middleware, `openapi.json` regen, tests, `services/nb-bond-api/README.md` env-var update, **`THIRD_PARTY_LICENSES.md` `### services/nb-bond-api` table updated with the two new rows**.
- **PR 2** (depends on PR 1 merged): Frontend scaffold (`services/nb-ui/`) including the pluggable auth layer. **`THIRD_PARTY_LICENSES.md` new `### services/nb-ui` section authored from scratch** (runtime + dev tables). **`docs/THIRD_PARTY_NOTES.md` updated** with the Norges Bank logo SVG row (if classed as third-party — see open question). Backend dependency reason: the Phase 2 dev workflow (`npm run dev` pointed at the local backend) is much smoother once `/v1/bonds` and `/v1/auctions` exist.
- **PR 3** (depends on PR 2 merged): Helm chart, `Dockerfile`, gateway HTTPRoute, `DEPLOY_NB_UI` flag, hosts append, lifecycle script, all docs (`services/nb-ui/*.md`, `services/README.md`, root `README.md`, `docs/ARCHITECTURE.md`, `docs/DOCUMENTATION_INDEX.md`). **`docs/THIRD_PARTY_NOTES.md` updated** with the nginx base image row (deployment-time component).

Each PR body should include:

- Link back to this plan doc.
- Phase(s) it covers.
- Evidence captured during verification stops:
  - `kubectl get pods,svc,gateway,httproute -A` snapshot
  - `helm -n nb-ui get values nb-ui` for PR 3
  - `npm test` output snippet for PR 1 + PR 2
  - `curl -sI` output snippets for the relevant endpoints
  - **All three `scripts/verification/check-*.py` exit codes — required to be `0`** (not "we'll fix licenses in the next PR")
- For PR 1: explicit before/after of `services/nb-bond-api/openapi.json`'s `paths` keys list, plus the diff of the `### services/nb-bond-api` inventory table.
- For PR 2: the full new `### services/nb-ui` inventory table pasted into the PR body so reviewers can compare against the lockfile without checking out the branch.
- For PR 3: confirmation `kubectl get pods -A | grep -Ev 'Running|Completed'` is empty for the new namespace, plus the diff of `docs/THIRD_PARTY_NOTES.md`.

## Residual Risks

- **MSAL lazy-loading under Vite** — Vite splits dynamic imports into separate chunks. If hosting from a sub-path or a weird base-URL config breaks the lazy chunk URL, the Entra plugin will fail to load at runtime. Mitigation: keep `base: '/'` in `vite.config.js` until proven otherwise; document the constraint in `services/nb-ui/DEVELOPMENT.md`.
- **CORS over `Authorization`** — when an Entra-mode browser sends a Bearer token, the backend doesn't validate it but the preflight must still allow `Authorization` in `Access-Control-Allow-Headers`. The plan does this; flag if any tightening of the CORS config drops it.
- **Bundle bloat** — MSAL Browser is ~150 KB minified. The lazy-load keeps the no-auth bundle clean, but the entra-mode bundle inflates. Acceptable for an operator UI; flag if local performance becomes a concern.
- **Aggregate-endpoint perf** — if `GET /v1/bonds` fans out to per-bond on-chain calls (for `totalSupply` etc.), large-bond-count cases get slow. Initial implementation returns a summary; full detail only on `GET /v1/bonds/{isin}`. Re-evaluate if/when the bond count grows.
- **nginx as static file server** — adds a dependency on a third-party image. Pinned in `common/images.yaml` like every other base image; same supply-chain posture as the rest of the sandbox.
- **The mock client lives on** — easy to accidentally ship `USE_MOCK=true` in a non-local deployment. Mitigation: the layout already renders a visible "MOCK" pill in the top bar when `USE_MOCK=true`; carry that through. Also: the default in `values.yaml` is `useMock: false`.
- **Sandbox baseline drift** — the local Besu chain baseline (Clique + London + PUSH0-disabled per `docs/KNOWN_ISSUES.md`) is unchanged by this plan. If a future iteration moves to QBFT + newer milestone, the frontend itself doesn't care, but `Phase 0`'s baseline-capture step will surface any drift.
- **Lockfile-vs-inventory drift** — `check-third-party-licenses.py` enforces that every direct dependency in each tracked `package.json` is listed in `THIRD_PARTY_LICENSES.md` with the **exact** lockfile version and **exact** lockfile license label. Common foot-guns: (a) adding a dep with `npm install` but forgetting to update the inventory; (b) a later transitive resolver bump shifting a license label; (c) hand-typing the license as `MIT` when the lockfile actually says `Apache-2.0` (TypeScript is one). Mitigation: run the check locally before pushing each PR, and treat the first script failure as the source of truth — read its output and adjust the table, not the lockfile.
- **PR 1 / PR 2 license land separately** — the `### services/nb-ui` section is added in PR 2. Between PR 1 merge and PR 2 merge, `THIRD_PARTY_LICENSES.md` won't mention nb-ui — that's fine, because no `services/nb-ui/package.json` exists yet. The script only validates sections that have a matching tracked manifest. **Order matters**: if PR 2 lands a `package.json` without the matching inventory section, CI breaks for everyone. The PR 2 author owns this.
- **Unrelated finding — `besu.cbdc-sandbox.local` JSON-RPC POST returns 404** — captured in current-state evidence. Does not affect this plan (frontend never calls Besu directly) but worth investigating separately. Filed here so it doesn't get lost in the PR series.

## Done Criteria

- All three PRs merged into `development`.
- Acceptance Criteria table fully green from a fresh `./sandbox.sh delete && ./sandbox.sh start`.
- `scripts/verification/check-*.py` all green on `development` after merge.
- `docs/DOCUMENTATION_INDEX.md` lists every new doc.
- Operator confirms the browser smoke test works against the running sandbox.
- Portability flags captured in this plan are visible in `services/nb-ui/DEVELOPMENT.md` so a future operator considering a non-local deployment has the list in one place.

---

## Closeout: what landed vs what carried forward (2026-05-19)

**Status: feature branch implementation complete and live-verified.** The branch `feature-frontend/nb-ui` shipped seven commits on top of `development`:

1. Plan doc + index entry.
2. `services/nb-bond-api`: `GET /v1/bonds`, `GET /v1/auctions`, CORS middleware, OpenAPI regen script + tests + license inventory.
3. `services/nb-ui/`: Vite + React frontend with pluggable auth (`none` + `entra-MSAL`), 18 Vitest tests, GH Actions workflow, license inventory.
4. Chart + gateway listener + Kind cluster-config mount + `DEPLOY_NB_UI` flag + lifecycle script + per-service docs + cross-cutting docs.
5. Merge from `development` (picked up the Blockscout `v2.7.3` / `v10.0.8` pin updates that yanked `v2.6.0` upstream).
6. **Design change**: replaced the host-mount-and-init-container deploy with a multi-stage Dockerfile (Node builder → nginx-unprivileged runtime). `deployNBUI` computes a content-hash tag, pushes to the local Kind registry, helm-installs with that image. The Kind extra-mount for `services/nb-ui` was removed entirely. The pod's main container was also renamed from `nginx` to `web-server` so it doesn't read as a second cluster gateway in `kubectl get pods`.
7. Bug fix: `image=kind-registry:5001/...` → `image=localhost:5001/...` (matches the existing convention — containerd `hosts.toml` rewrites `localhost:5001` to the in-network registry).

Final live state verified end-to-end:

- `kubectl -n nb-ui get pod` → `1/1 Running` with image `localhost:5001/nb-ui:<bundle-hash>`.
- `curl -sI http://web.cbdc-sandbox.local/` → `200 OK`, `text/html`.
- `/config.js` returns the chart-rendered runtime config (`USE_MOCK: false`, `API_BASE_URL: http://bond-api.cbdc-sandbox.local`, `AUTH_MODE: none`).
- CORS preflight from `web.cbdc-sandbox.local` against `bond-api.cbdc-sandbox.local` returns `Access-Control-Allow-Origin` correctly.
- Browser smoke: bonds index + auctions index + bond / auction detail pages all render.

### Carried forward (tracked in `docs/KNOWN_ISSUES.md`)

1. **`reopenAuction` has no backend / on-chain support** — frontend throws `NotImplementedError` (501) in real mode, mock fakes it.
2. **`finaliseAuction` `winners` field is ignored server-side** — open design question whether operator-selectable winners are intended.
3. **Create-auction from the running UI fails** — discovered after final smoke; root cause not yet diagnosed. Reproduce against `nb-bond-api` directly to capture the response and decide whether it's a payload-shape mismatch on the frontend or a missing chain-side precondition.
4. **`nb-bond-api` still uses the older host-mount + pod-side-`npm-build` deploy.** Now that `nb-ui` works image-baked, migrating `nb-bond-api` the same way is a small refactor (Dockerfile + replace `deployNBBondAPI` body + drop the Kind extra-mount). After that migration, the Kind cluster-config has zero per-service extra-mounts and adding any future service stops requiring a sandbox delete + start.
5. **`./sandbox.sh build-images` is Blockscout-only** — open whether to grow it into an "every per-service Docker build" entry point or leave it as a Blockscout escape hatch.

### Design decisions that landed (no longer "open questions")

- **Deploy shape: image-baked, pushed to local Kind registry.** Not host-mount-plus-init-container as the original plan had it. This matches what an Azure deployment will look like, removes Kind cluster-config coupling, and gives a content-hash cache key that skips rebuilds on no-op runs.
- **Hostname: `web.cbdc-sandbox.local`** (folder still `services/nb-ui/`).
- **Vite + Vitest + ESLint + Prettier**, all confirmed in scope and tracked in `THIRD_PARTY_LICENSES.md`.
- **Modern-browsers-only target** (Vite `target: 'es2020'`).
- **`DEPLOY_NB_UI=true` is the default**, flippable via `.env.sandbox`.
- **Norges Bank logo SVG is repo-owned** — no `THIRD_PARTY_NOTES.md` row.
- **The container is named `web-server`, not `nginx`** — disambiguates from NGINX Gateway Fabric in pod listings.
- **MSAL is in the main bundle (not lazy-loaded)** — the deployment expectation for the Entra-mode case is a per-environment image rebuild with the right runtime config, so the lazy-load complexity isn't paying for itself.
