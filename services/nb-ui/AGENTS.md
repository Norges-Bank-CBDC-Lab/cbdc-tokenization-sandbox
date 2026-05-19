## NB UI Agent Guide

Inherits the root `AGENTS.md` and the services-level `services/AGENTS.md`.
This file covers the React + Vite operator frontend specifically.

### Structure

- `src/api/` — single network seam. `bondsApi.js` + `auctionsApi.js` are the
  only modules UI code imports for data access. Each dispatches to
  `HttpClient` (real backend) or `MockClient` (in-memory fixtures) based on
  `AppConfig.USE_MOCK`. `httpClient.js` is the only place that calls `fetch`
  and the only place that attaches the `Authorization` header — both
  intentional, so swapping transport or auth never ripples into pages.
- `src/auth/` — pluggable auth layer. `AuthProvider.js` is the jsdoc-typed
  interface every plugin implements. `noneAuth.js` is the default (no-op,
  no `Authorization` header). `entraAuth.js` wraps MSAL Browser. The
  resolver in `auth/index.js` picks one at module-load time from
  `AppConfig.AUTH_MODE`.
- `src/components/` — UI primitives (`ui.jsx`), layout (`Layout.jsx`), logo
  (`NorgesBankLogo.jsx`).
- `src/hooks/` — `useApi` / `useMutation` for data fetching;
  `useRoute` for the hash-based router.
- `src/pages/` — one file per page / modal.
- `src/utils/format.js` — pure formatters for `BigIntString`, `BpsString`,
  unix seconds, hex.
- `public/config.js` — local-dev runtime config served verbatim by Vite.
- `public/config.template.js` — placeholders for envsubst at container start
  in deployed environments. Not loaded by `vite dev`.
- `helm/` — chart used by `./nb-ui.sh start` and `./sandbox.sh start`.
- `tests/` — Vitest + Testing Library. Feature-level: real mock client +
  rendered components, not micro-mocked.

### How to run

- Install once after clone or after `package.json` changes: `npm install`
- Dev server (hot reload, talks to the running sandbox's NB Bond API):
  `npm run dev` → `http://localhost:5173/`
- Production build: `npm run build` → `dist/`
- Lint / format / test: `npm run lint`, `npm run format:check`, `npm test`
- Deploy into the local Kind cluster: `./nb-ui.sh start` (called by
  `./sandbox.sh start` when `DEPLOY_NB_UI=true`)
- Stop the helm release: `./nb-ui.sh stop`

### Style and conventions

- ES modules + JSX. No IIFE wrappers, no `window.X = X` exports — components
  and helpers are imported by path.
- React 18 functional components. No class components.
- Don't reach for a UI kit. The existing `components/ui.jsx` primitives
  (Button, Modal, Field, Input, RadioGroup, StatusBadge, ToastProvider,
  …) cover everything the operator UI needs.
- Don't put `fetch` calls anywhere except `src/api/httpClient.js`.
- Don't put `Authorization` header logic anywhere except `httpClient.js`
  and `src/auth/*`.
- Don't read `AppConfig` deeply in components — pass values down or use the
  appropriate hook. Direct reads belong in api/, auth/, and the runtime-
  config seam in `config.js`.
- Never commit values into `public/config.js` that would not be safe in a
  public repo: real tenant IDs, real client IDs, real authority URLs for a
  non-sandbox tenant.

### Safety checklist (nb-ui)

- After adding or version-bumping any npm dependency, update the
  `### services/nb-ui` table in `THIRD_PARTY_LICENSES.md` with the exact
  lockfile version + license and run
  `python3 scripts/verification/check-third-party-licenses.py` before
  merging.
- After touching public-facing doc files, run
  `python3 scripts/verification/check-public-repo-hygiene.py` and
  `python3 scripts/verification/check-markdown-links.py`.
- If you change the build output shape (e.g. add a new asset folder or
  change the entrypoint), update `services/nb-ui/helm/templates/deployment.yaml`
  init container accordingly — it stages `dist/*` into nginx's html dir.
- Don't introduce a backend dependency that doesn't yet exist on the NB
  Bond API side. If you have to, throw `NotImplementedError` in the real
  client path and add a follow-up entry to `docs/KNOWN_ISSUES.md`
  (matching the existing `reopenAuction` pattern).
