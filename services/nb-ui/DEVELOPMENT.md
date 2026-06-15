# NB UI Development

Operator notes for `services/nb-ui/` — the React + Vite frontend served at
`http://web.cbdc-sandbox.local/` in the local sandbox.

## Build target

Modern browsers only (Vite `target: 'es2020'`). No polyfills, no
legacy-Safari workarounds. The audience is whoever can already run the rest
of the sandbox.

## Local development

```bash
cd services/nb-ui
npm install
npm run dev
```

`npm run dev` starts Vite on `http://localhost:5173/`. The dev server
serves `public/config.js` verbatim — flip values there to change behaviour
without rebuilding.

The dev config talks to the real NB Bond API at
`http://bond-api.cbdc-sandbox.local`. With the sandbox up (and the four
`*.cbdc-sandbox.local` host entries in `/etc/hosts`), the dev server is
fully functional end-to-end. Start the backend first with
`./sandbox.sh start` from the repo root if it isn't already running.

## API surface and cache-first data flow

The backend serves a bulky resource tree (see
[`docs/openapi-v2-plan.md`](../../docs/plans/archive/openapi-v2-plan.md)). A single
`BondsApi.listBonds()` call returns every bond with its nested
`auctions[]`, `bids[]`, `allocation`, and `holders[]`. Pages slice
that tree client-side via selectors in
[`src/api/selectors.js`](src/api/selectors.js) — there are no
per-feature endpoints like `getBondHolders` or `getAuctionBids` in v2.

`src/api/httpClient.js` maintains a path-keyed ETag cache:

- GETs send `If-None-Match` from cache; a `304` response serves the
  cached body.
- Mutations (POST / PUT / PATCH / DELETE) clear the cache and return
  the updated parent DTO — components swap their local state with the
  response body and the next GET re-primes naturally.
- Per-DTO `md5` fields (on `Bond`, `Auction`, `Bid`, `Allocation`,
  `HolderBalance`) let components compare subtree identity without
  diffing fields — useful for React keys and partial re-render
  short-circuits.

When adding a new page:

1. Fetch the bulky parent (`listBonds` or `getBond` / `getAuction`)
   via `useApi`.
2. Slice with `selectBond` / `selectAuction` / `selectBids` /
   `selectHolders` rather than calling a feature endpoint.
3. Mutations should use `useMutation` and either reload the parent
   via the hook's `reload()` or splice the returned DTO into local
   state directly.

## Tests

```bash
npm test          # one-shot
npm run test:watch
```

Vitest + `@testing-library/react` + `jsdom`. Page-level tests use
`vi.mock('../src/api/<name>Api.js', …)` to inject deterministic
fixtures at the API-module boundary, then render the whole page and
assert against the rendered DOM. CI runs the same tests on any PR
touching `services/nb-ui/**` via `.github/workflows/nb-ui.yml`.

## Pluggable auth

The auth seam is `src/auth/index.js`. It resolves one of:

- `noneAuth` — no `Authorization` header, no sign-in UI. Default; the
  local sandbox runs this way because the NB Bond API has no auth (per
  `docs/ARCHITECTURE.md` "Trust Boundaries And Security Notes").
- `entraAuth` — Microsoft Entra (Azure AD) OIDC via MSAL Browser. Reads
  `AUTH_TENANT_ID`, `AUTH_CLIENT_ID`, `AUTH_AUTHORITY`, `AUTH_SCOPES`,
  `AUTH_REDIRECT_URI` from runtime config. **Tenant / client / scopes
  are never committed to this repo** — they come from the runtime
  `config.js` rendered by whatever deploys the bundle.

### Role-based access (entra mode)

When `AUTH_MODE=entra`, the UI gates pages on the signed-in account's Entra
**App Roles** (the `roles` claim), resolved by `src/auth/entraAuth.js` (ID-token
claims first, access-token decode as a fallback) and mapped to capabilities by
`src/auth/capabilities.js`:

- `AUTH_OPERATOR_ROLES` — comma-separated App Role values granting full access
  including the Central Bank page.
- `AUTH_TESTER_ROLES` — comma-separated App Role values granting the UI without
  Central Bank.
- A signed-in user with **no** recognised role sees a full-page "access denied"
  screen (`src/components/AccessDeniedPage.jsx`) instead of the app.
- The Central Bank nav item is hidden for non-operators and the
  `#/central-bank` route is guarded, so the page never mounts for them.

This is UX only — the NB Bond API independently enforces the same roles and is
the real boundary. `none` mode is never gated (the local sandbox is fully open).
The values must match the API's `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` /
`..._TESTER_ROLES` and the App Role values defined in Entra.

To try the Entra plugin locally (no real tenant needed — just enough to
prove the seam is reachable):

```js
// public/config.js
window.__APP_CONFIG__ = {
  AUTH_MODE: 'entra',
  AUTH_TENANT_ID: '00000000-0000-0000-0000-000000000000',
  AUTH_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
  AUTH_AUTHORITY: '',
  AUTH_SCOPES: '',
  AUTH_REDIRECT_URI: '',
  // ...
};
```

Reload. A "Sign in" button appears in the top bar. Clicking it triggers an
MSAL redirect that will fail at `login.microsoftonline.com` — that's
expected and proves the plugin path is reachable.

### Build-time bundling vs runtime resolution

Today both `noneAuth` and `entraAuth` are statically imported by the
resolver, so MSAL is in the main bundle even when `AUTH_MODE=none`. That
is intentional: the cost (~150 KB minified, ~50 KB gzipped) is small for an
operator UI, and a non-local deployment that wants `AUTH_MODE=entra`
typically rebuilds with environment-specific config anyway, so a fully
configurable runtime-switch isn't a hard requirement. Lazy-loading MSAL
behind a dynamic `import()` in the resolver is a clean follow-up if the
bundle size becomes a concern, or if a deployment wants a truly
build-time-agnostic bundle.

## Runtime config injection

The same built bundle is re-pointable at runtime via `/config.js`. The
local sandbox renders that file from the chart's `runtimeConfig` block
(`services/nb-ui/helm/templates/configmap.yaml`) and overlays it onto
`/usr/share/nginx/html/config.js` via a ConfigMap mount with `subPath`.

For a non-local nginx deployment the same image works unchanged — the
deploying environment just supplies a different ConfigMap. If you need
env-var-style placeholder substitution at container start instead,
`public/config.template.js` ships placeholders (`__API_BASE_URL__`,
`__AUTH_MODE__`, etc.) that an `envsubst`-running init container can
consume.

## Hostname

Served at `web.cbdc-sandbox.local` (mapped to `127.0.0.1` by the
sandbox's `/etc/hosts` append step). The chart's HTTPRoute attaches to
the `nb-ui-http` listener on the `nginx-gateway/gateway` Gateway.

The pod's `web-server` container runs `nginxinc/nginx-unprivileged`
internally to serve static files — that's a pod-local static server,
_not_ a second cluster gateway. The cluster Gateway (NGINX Gateway
Fabric, in the `nginx-gateway` namespace) is the only ingress; it routes
to the pod's Service like any other backend.

## Deployment shape

- `services/nb-ui/Dockerfile`: multi-stage build. The Node.js builder from
  `common/node-version.env` runs `npm ci && npm run build`; the result is
  COPYed into the `nginxinc/nginx-unprivileged:1.27-alpine` runtime image.
  The nginx runtime base is pinned in `common/images.yaml` under `nb_ui.nginx`.
- `./nb-ui.sh start` (or `./sandbox.sh start`) calls `deployNBUI` in
  `common/helpers.sh`, which:
  1. Pulls both stage bases through Docker (`loadImageToKind`) so the
     build works offline.
  2. Computes a short content-hash over `src/`, `public/`, `package*.json`,
     `index.html`, `vite.config.js`, `Dockerfile` → the image tag.
  3. Checks the local Kind registry; if `nb-ui:<hash>` already exists
     there, skips the build entirely (cache key = bundle content).
  4. Otherwise: `docker build` → `docker tag → docker push` to
     `localhost:5001/nb-ui:<hash>`.
  5. `helm upgrade --install` with `image=kind-registry:5000/nb-ui:<hash>`.
- The chart deploys: one `web-server` container (nginx-unprivileged
  bundled with the React `dist/`), one ConfigMap mounted onto
  `/usr/share/nginx/html/config.js` via `subPath`. No init container, no
  hostPath, no Kind extra-mounts.

The image is the entire bundle. Editing `src/*` produces a new content
hash, which triggers a fresh build + push + helm upgrade automatically.
Editing only test files / docs (matched by `.dockerignore`) intentionally
_doesn't_ bust the cache.

## Known gotchas

- The cache key is `services/nb-ui/{src,public,package.json,package-lock.json,index.html,vite.config.js,Dockerfile}`.
  If you add a new build input that legitimately affects `dist/`, extend
  `nbUIBundleHash` in `common/helpers.sh` accordingly.
- nginx-unprivileged listens on port `8080`, not `80`. The chart's
  Service maps port `80` → `8080`. Don't paste an `80` into the container
  spec.
- The CSP / security headers from nginx-unprivileged's defaults are
  permissive enough to load the React bundle in a sandbox context. A
  non-local deployment should tighten CSP via a custom nginx config —
  flagged in `docs/plans/archive/nb-ui-frontend-plan.md` Portability Flags.

## Portability Flags

Local-acceptable defaults a non-local deployment must set explicitly:

- **Auth role values are runtime config, not constants.** `AUTH_OPERATOR_ROLES`
  / `AUTH_TESTER_ROLES` (and the matching nb-bond-api role env) must be set to
  the deployment's Entra App Role values. The chart defaults (`Sandbox.Operator`
  / `Sandbox.Tester`) are only consulted in `entra` mode.
- **Roles are read from the ID token first.** This assumes the App Roles are
  assigned on the app the ID token is issued for (a single SPA+API app
  registration — the simplest setup). With a separate API app registration the
  provider falls back to decoding the access token; if neither carries the
  roles, sign-in lands on the access-denied screen.
- **CSP** — see "Known gotchas"; a non-local deployment should tighten the nginx
  CSP (also flagged in `docs/plans/archive/nb-ui-frontend-plan.md`).

## Follow-ups

See `docs/KNOWN_ISSUES.md` for `reopenAuction` (no backend / on-chain
support yet) and operator-selectable winners (backend currently ignores
operator selections; the UI's winners-selection workflow is informational).
