# NB Bond API

Express service that drives BondManager/BondAuction via a single signer holding `BOND_ADMIN_ROLE`. The service owns the sealing keypair, unseals bids, computes a uniform-price allocation, and submits `finaliseAuction` once approved.

## Endpoints & Usage

See `DEVELOPMENT.md` for API-focused runbooks and `../README.md` for the wider
service-layer overview.

When running inside the sandbox, the API is reachable via the gateway at `http://bond-api.cbdc-sandbox.local/` (the start scripts add the `/etc/hosts` entry).

The HTTP surface is the v2 bulky-tree contract described in
[`docs/openapi-v2-plan.md`](../../docs/plans/openapi-v2-plan.md): a single
`GET /v1/bonds` returns every bond with its nested auctions, bids,
allocations, and holders, and mutations return the updated parent
resource so the UI can swap its cache atomically. Each cacheable DTO
carries an `md5` field, and every successful response sets an `ETag`
header — clients send `If-None-Match` to get a `304` short-circuit
during polling. See `DEVELOPMENT.md` §7.6 for the caching protocol
and §7.7 for the two auth modes (`none`, `entra`).

## Sandbox Helm Config

Before deploying the service through `./nb-bond-api.sh start` or
`./sandbox.sh start`, generate the local fixture files:

```console
node scripts/generate-local-sandbox-fixtures.mjs
```

This creates `services/nb-bond-api/helm/values.local.yaml` with deterministic
local-only fixture keys. The sandbox and service start scripts also generate it
automatically if it is missing. Do not commit or reuse real keys outside local
development.

## Local Deployment Model

`./nb-bond-api.sh start` builds the service as a self-contained Docker image
from `services/nb-bond-api/Dockerfile` (multi-stage: builder runs `npm ci` +
`npm run build`, runtime ships only `dist/` plus production `node_modules`).
The image is tagged with a content hash over `src/`, `package.json`,
`package-lock.json`, `tsconfig.json`, and the `Dockerfile`, pushed to the
local Kind registry at `localhost:5001/nb-bond-api:<hash>`, and the Helm
chart is installed with `--set image=<that tag>`. Re-runs skip the build
when the content hash matches an existing registry tag.

The pod mounts an `emptyDir` at `/app/data` for the SQLite ingestion DB; no
host source mount is required and the chart no longer runs `npm ci` /
`npm run build` at container start.

## Env

- `RPC_URL` – JSON-RPC endpoint
- `GLOBAL_REGISTRY_ADDRESS` – deployed GlobalRegistry used to resolve BondManager
- `BOND_MANAGER_CONTRACT_NAME` – registry key for BondManager (default: "Bond Manager")
- `BOND_ADMIN_PK` – hex key with `BOND_ADMIN_ROLE`
- `AUCTION_OWNER_SEAL_PK` – optional; generated on boot if omitted
  The local sandbox generator sets this to a stable fixture value in the Helm secret.
- `LOG_LEVEL` – defaults to `info`
- `EXPRESS_PORT` – defaults to `8080`
- `CORS_ALLOWED_ORIGINS` – comma-separated list of origins the CORS middleware accepts.
  Defaults to `http://web.cbdc-sandbox.local` (the local sandbox frontend).
  Override (with multiple comma-separated origins if needed) for a non-local deployment.
- `NB_BOND_API_AUTH_MODE` – `none` (sandbox default, header accepted but
  ignored) or `entra` (JWT validated against the configured Entra ID tenant).
- `NB_BOND_API_AUTH_ENTRA_TENANT_ID` / `NB_BOND_API_AUTH_ENTRA_AUDIENCE` –
  required when `NB_BOND_API_AUTH_MODE=entra`. ArgoCD must keep these in
  sync with the nb-ui frontend AUTH_MODE; mismatches fail fast at startup.

## Scripts

- `npm run dev` – run ts-node via tsx
- `npm run build` – emit compiled JS to `dist/`
- `npm start` – run compiled server (entry `dist/index.js`)
- `npm run clean:db` – reset database for fresh deployment.
- `npm test` – run jest tests.

## OpenAPI

An OpenAPI 3.1 spec is served at `GET /docs` and `GET /v1/openapi.json`.
The on-disk snapshot at [`openapi.json`](openapi.json) is regenerated from
[`src/schemas.ts`](src/schemas.ts) via `npm run regen:openapi`; keep them in
sync after every schema change.
