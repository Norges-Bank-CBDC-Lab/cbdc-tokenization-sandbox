# NB UI

React + Vite operator frontend for the NB Bond Auction Service. Served at
`http://web.cbdc-sandbox.local/` when the sandbox is fully wired (see
`docs/nb-ui-frontend-plan.md`, PR 3 phase).

## Scripts

From `services/nb-ui/`:

- `npm install` – install deps (run once after clone or after `package.json`
  changes).
- `npm run dev` – Vite dev server on `http://localhost:5173/`, with a
  hot-reload pipeline. Talks to the runtime config in `public/config.js`.
- `npm run build` – production build into `dist/`.
- `npm test` – Vitest unit + feature tests.
- `npm run lint` / `npm run format:check` – static checks (also run in CI by
  `.github/workflows/nb-ui.yml`).

## Talking to the backend

By default the dev config (`public/config.js`) points at
`http://bond-api.cbdc-sandbox.local`. With the local sandbox running and your
`/etc/hosts` populated, `npm run dev` works end-to-end against the real NB
Bond API immediately.

To work offline (e.g. on a plane), flip `USE_MOCK: true` in
`public/config.js`. The mock client lives in `src/api/mockClient.js` and is
shape-compatible with the OpenAPI envelopes in
`services/nb-bond-api/openapi.json`.

## Auth

`AUTH_MODE: 'none'` (default) means no Bearer headers and no login UI. To try
the Entra (Microsoft OIDC) plugin locally, set `AUTH_MODE: 'entra'` in
`public/config.js` along with the relevant `AUTH_*` runtime config — see
`src/auth/entraAuth.js` for the env-var contract. **Do not commit real
tenant / client IDs.**

## Architecture

The single network seam is `src/api/bondsApi.js` + `src/api/auctionsApi.js`.
Components and hooks call those modules; the modules dispatch to
`MockClient` or `HttpClient` based on `USE_MOCK`. `HttpClient` injects
`Authorization: Bearer …` per request using whichever `AuthProvider` was
resolved at startup (`src/auth/index.js`).

See `docs/nb-ui-frontend-plan.md` for the full implementation plan and the
follow-up items tracked in `docs/KNOWN_ISSUES.md`.
