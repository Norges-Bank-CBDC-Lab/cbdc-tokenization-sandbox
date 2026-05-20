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

By default the dev config talks to the real NB Bond API at
`http://bond-api.cbdc-sandbox.local`. With the sandbox up (and the four
`*.cbdc-sandbox.local` host entries in `/etc/hosts`), the dev server is
fully functional end-to-end.

To work without the sandbox running:

```js
// public/config.js
window.__APP_CONFIG__ = {
  USE_MOCK: true,
  // ...
};
```

The mock client in `src/api/mockClient.js` is shape-compatible with the
real backend — it returns the exact response envelopes defined in
`services/nb-bond-api/openapi.json`.

## Tests

```bash
npm test          # one-shot
npm run test:watch
```

Vitest + `@testing-library/react` + `jsdom`. Tests are intentionally
**feature-level**: they exercise the real mock client and render whole
pages rather than per-prop / per-call assertions. CI runs the same tests
on any PR touching `services/nb-ui/**` via
`.github/workflows/nb-ui.yml`.

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
`public/config.template.js` ships placeholders (`__USE_MOCK__`,
`__API_BASE_URL__`, etc.) that an `envsubst`-running init container can
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
  flagged in `docs/nb-ui-frontend-plan.md` Portability Flags.

## Follow-ups

See `docs/KNOWN_ISSUES.md` for `reopenAuction` (no backend / on-chain
support yet) and operator-selectable winners (backend currently ignores
the `winners` field).
