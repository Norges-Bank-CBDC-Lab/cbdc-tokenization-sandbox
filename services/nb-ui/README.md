# NB UI

React + Vite operator frontend for the NB Bond Auction Service. Served at
`http://web.cbdc-sandbox.local/` when the sandbox is up.

## Scripts

From `services/nb-ui/`:

- `npm install` – install deps (run once after clone or after `package.json`
  changes).
- `npm run dev` – Vite dev server on `http://localhost:5173/`, with a
  hot-reload pipeline. Talks to the runtime config in `public/config.js`.
- `npm run build` – production build into `dist/`. The sandbox deploy path
  does this inside Docker, so you only need this for local Vite work.
- `npm test` – Vitest unit + feature tests.
- `npm run lint` / `npm run format:check` – static checks (also run in CI by
  `.github/workflows/nb-ui.yml`).

## Deploying into the local sandbox

`./nb-ui.sh start` (called by `./sandbox.sh start` when `DEPLOY_NB_UI=true`)
builds the bundle inside a `services/nb-ui/Dockerfile` multi-stage image,
tags it with a content hash of the build inputs, pushes to the local Kind
registry, and helm-installs the chart pointing at it. A second run with no
changes is a no-op — the registry cache key is the bundle hash itself.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full deploy shape.

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

The single network seam is `src/api/bondsApi.js`, `src/api/auctionsApi.js`,
`src/api/biddersApi.js`, and `src/api/centralBankApi.js`. Components and
hooks call those modules; the modules dispatch to `MockClient` or
`HttpClient` based on `USE_MOCK`. `HttpClient` injects
`Authorization: Bearer …` per request using whichever `AuthProvider` was
resolved at startup (`src/auth/index.js`).

## Pages

| Route             | Purpose                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `#/bonds`         | Bond registry — list + filter, opens "issue new bond" modal.                                                           |
| `#/bonds/{isin}`  | Single bond — coupon, maturity, holders, auction history.                                                              |
| `#/auctions`      | Flat list of every auction across bonds.                                                                               |
| `#/auctions/{id}` | Single auction — bids, allocation, lifecycle actions. "Place bid" button is visible while the auction is in `BIDDING`. |
| `#/bidders`       | Sandbox bidder roster. Add / remove bidders, reveal stored keys, launch the impersonated-bid modal.                    |
| `#/central-bank`  | Norges Bank operator surface against WNOK — allowlist editor, mint / burn / transfer modals.                           |

Both `#/bidders` and `#/central-bank` carry a visible **sandbox-only**
banner; private keys are stored in plaintext server-side and these
pages must never be enabled outside the local sandbox.

See `docs/plans/archive/nb-ui-frontend-plan.md` for the original frontend plan
and `docs/plans/archive/bidders-and-central-bank-plan.md` for the bidders +
Central Bank iteration. Follow-ups are tracked in
`docs/KNOWN_ISSUES.md`.
