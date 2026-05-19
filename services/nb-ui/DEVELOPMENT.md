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
local sandbox renders that file from the chart's `runtimeConfig` block —
see `services/nb-ui/helm/templates/configmap.yaml`.

For a non-local nginx deployment the recommended pattern is an init
container that runs `envsubst` over `public/config.template.js` into the
served `/config.js`, with env vars supplied by chart values. The
placeholders (`__USE_MOCK__`, `__API_BASE_URL__`, etc.) match the
template variable shape.

## Hostname

Served at `web.cbdc-sandbox.local` (mapped to `127.0.0.1` by the
sandbox's `/etc/hosts` append step). The chart's HTTPRoute attaches to
the `nb-ui-http` listener on the `nginx-gateway/gateway` Gateway.

## Deployment shape

- `nginxinc/nginx-unprivileged:1.27-alpine` runtime (pinned in
  `common/images.yaml`).
- An init container stages the pre-built `dist/` plus the rendered
  `config.js` (from the chart's `ConfigMap`) into an emptyDir that nginx
  serves read-only.
- `npm run build` runs on the host before deploy. The host path
  `services/nb-ui/dist/` is mounted into the Kind node via
  `infra/cluster/cluster-config.yaml`, then re-mounted into the init
  container.

If `dist/` is missing the init container fails fast with a clear error
telling the operator to run `npm run build`. The lifecycle script
`./nb-ui.sh start` rebuilds automatically when `dist/` is absent.

## Known gotchas

- The Kind cluster config carries an explicit `extraMounts` entry for
  `services/nb-ui`. After pulling changes that add or remove a mount,
  `./sandbox.sh delete && ./sandbox.sh start` is required to pick the new
  mount up — Kind cannot hot-reload mounts.
- The chart sets `repoPath: /services/nb-ui` for the in-Kind container
  path. If you change the Kind mount target, change the chart value too.
- The init container runs as the nginx user. The chart uses an emptyDir
  for the html mount precisely so the unprivileged nginx process can read
  from it without filesystem permission gymnastics.
- The CSP / security headers in the dev nginx config are intentionally
  permissive for the trusted-local sandbox. A non-local deployment
  should tighten CSP — flagged in `docs/nb-ui-frontend-plan.md` Portability
  Flags.

## Follow-ups

See `docs/KNOWN_ISSUES.md` for `reopenAuction` (no backend / on-chain
support yet) and operator-selectable winners (backend currently ignores
the `winners` field).
