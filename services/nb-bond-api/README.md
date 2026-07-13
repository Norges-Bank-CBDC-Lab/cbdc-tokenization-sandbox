# NB Bond API

Express service that drives BondManager/BondAuction via a single signer holding `BOND_ADMIN_ROLE`. The service owns the sealing keypair, unseals bids, computes a uniform-price allocation over the operator-selected winning bids (cross-checking the operator's expected clearing rate), and submits `finaliseAuction` once approved.

## Endpoints & Usage

See `DEVELOPMENT.md` for API-focused runbooks and `../README.md` for the wider
service-layer overview.

When running inside the sandbox, the API is reachable via the gateway at `http://bond-api.cbdc-sandbox.local/` (the start scripts add the `/etc/hosts` entry).

The HTTP surface is the v2 bulky-tree contract described in
[`docs/openapi-v2-plan.md`](../../docs/plans/archive/openapi-v2-plan.md): a single
`GET /v1/bonds` returns every bond with its nested auctions, bids,
allocations, and holders, and mutations return the updated parent
resource so the UI can swap its cache atomically. Each cacheable DTO
carries an `md5` field, and every successful response sets an `ETag`
header — clients send `If-None-Match` to get a `304` short-circuit
during polling. See `DEVELOPMENT.md` §7.6 for the caching protocol
and §7.7 for the two auth modes (`none`, `entra`).

Two sandbox-only resource families sit alongside the bond tree:

- **`bidders`** — sandbox impersonable bidder roster. `GET /v1/bidders`
  lists the roster, `POST /v1/bidders` creates a bidder (generating a
  fresh secp256k1 keypair, or importing one), `DELETE /v1/bidders/{address}`
  removes a bidder (hard-blocked when the bidder has unrevealed bids on
  an open auction), and `POST /v1/bidders/{address}/bids` submits a
  sealed bid on the bidder's behalf — the API constructs the plaintext,
  signs the EIP-712 `BidIntent`, dual-wraps with the auctioneer sealing
  key, and submits on-chain from a wallet bound to the bidder's stored
  key. Private keys are stored in plaintext in the local SQLite DB;
  see [`docs/plans/archive/bidders-and-central-bank-plan.md`](../../docs/plans/archive/bidders-and-central-bank-plan.md).
- **`central-bank`** — Norges Bank operator surface against the WNOK
  contract. `GET /v1/central-bank` returns the CB summary (address,
  balance, allowlist size, `available` flag); `GET/PUT/DELETE
/v1/central-bank/allowlist[/{address}]` manage the allowlist; and
  `POST /v1/central-bank/wnok/{mint,burn,transfer}` drive WNOK
  operations from the CB account. All `central-bank` endpoints respond
  `503 Service Unavailable` when `CENTRAL_BANK_PK` is unset or WNOK
  isn't registered in `GlobalRegistry`.
- **`banking`** — surface over the per-bank TBD (tokenized bank
  deposit) tokens. `GET /v1/banking/banks` lists the configured banks (the
  signer selector); `GET /v1/banking/tbd[/{address}]` returns each TBD with its
  owning bank, supply, WNOK reserve backing, government-nomination, and holders;
  `PUT/DELETE /v1/banking/tbd/{address}/allowlist/{holder}` and
  `POST /v1/banking/tbd/{address}/{mint,burn,transfer}` mutate it, signed by the
  token's owning bank. Open to both operator and tester roles (Central Bank
  is the only operator-locked surface).
- **`operations`** — the operator audit trail. Every operator-initiated
  on-chain operation attempted through this API (bond lifecycle, auctions,
  bids, WNOK and TBD operations) is recorded in the preserved
  `operation_attempts` table with its outcome: `SUCCEEDED` with the
  transaction hash, `REVERTED` with the decoded custom-error reason, or
  `FAILED` for transport errors. Failed sends are usually rejected at gas
  estimation and never reach the chain, so this trail is their only durable
  record. `GET /v1/operations` lists attempts newest-first (optional
  `?limit`, default 200); the NB UI renders it at System → Operations. See
  [`docs/plans/operator-audit-trail-design.md`](../../docs/plans/operator-audit-trail-design.md).

### Projection-purity rule (SQLite tables)

The local SQLite database mixes two kinds of tables with opposite
durability rules. **Projection tables** (`auctions`, `auction_events`,
`partitions`, `balances`, `balance_events`, `bond_events`,
`ingestion_state`) hold only rows reproducible from chain logs — they are
dropped and rebuilt from chain on every schema bump and on
`POST /v1/admin/restart-ingestion?fromBlock=0`. **System-of-record tables**
(`bidders`, `banks`, `operation_attempts`) hold data the chain cannot
reproduce (generated keypairs, failed-attempt records) — they are created
additively via `CREATE TABLE IF NOT EXISTS` and must never join the
migration drop list. Never store locally-generated rows in a projection
table: the next resync silently erases them.

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
- `WNOK_CONTRACT_NAME` – registry key for the WNOK contract (default: "Wholesale NOK")
  Used by the Central Bank endpoints; matches `WNOK_CONTRACT_NAME` in `contracts/.env`.
- `BOND_ADMIN_PK` – hex key with `BOND_ADMIN_ROLE`
- `AUCTION_OWNER_SEAL_PK` – optional; generated on boot if omitted
  The local sandbox generator sets this to a stable fixture value in the Helm secret.
- `CENTRAL_BANK_PK` – optional; Central Bank operator key that must hold
  `MINTER_ROLE`, `BURNER_ROLE`, and `ALLOWLIST_ADMIN_ROLE` on WNOK. The local fixture
  maps this to `PK_NORGES_BANK`. When unset, every `/v1/central-bank/*` endpoint
  responds `503 Service Unavailable`. Sandbox-only — never deploy this key path
  against real funds.
- `LOG_LEVEL` – defaults to `info`
- `EXPRESS_PORT` – defaults to `8080`
- `NB_BOND_API_SSE_HEARTBEAT_MS` – SSE comment-heartbeat interval in
  milliseconds (default `15000`). Keep any gateway idle timeout above it.
- `CORS_ALLOWED_ORIGINS` – comma-separated list of origins the CORS middleware accepts.
  Defaults to `http://web.cbdc-sandbox.local` (the local sandbox frontend).
  Override (with multiple comma-separated origins if needed) for a non-local deployment.
- `NB_BOND_API_AUTH_MODE` – `none` (sandbox default, header accepted but
  ignored) or `entra` (JWT validated against the configured Entra ID tenant).
- `NB_BOND_API_AUTH_ENTRA_TENANT_ID` / `NB_BOND_API_AUTH_ENTRA_AUDIENCE` –
  required when `NB_BOND_API_AUTH_MODE=entra`. ArgoCD must keep these in
  sync with the nb-ui frontend AUTH_MODE; mismatches fail fast at startup.
- `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` / `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES` –
  comma-separated Entra App Role values for role-based access in `entra` mode.
  Operator roles gate the Central Bank endpoints (`/v1/central-bank/*`) and are
  required; any recognised role (operator or tester) is needed for other
  authenticated endpoints. Must match the nb-ui `AUTH_OPERATOR_ROLES` /
  `AUTH_TESTER_ROLES`.

## Live updates

`GET /v1/events` is a notification-only SSE stream. It is open in local
`none` auth mode and requires a valid bearer token with a recognised operator
or tester role in `entra` mode. `changed` events contain only coarse resource
keys (`auctions`, `banking`, `bidders`, `bonds`, `central-bank`, `operations`,
or `registry`); clients retrieve current data through the normal API. There is
no replay buffer or `Last-Event-ID` contract.

Projected bond and auction notifications are emitted only after ingestion
commits and advances its checkpoint. Other supported API mutations publish
after their receipt or local system-of-record write is readable. Comment
heartbeats keep idle streams active and carry no health data.

## Scripts

- `npm run dev` – run ts-node via tsx
- `npm run build` – emit compiled JS to `dist/`
- `npm start` – run compiled server (entry `dist/index.js`)
- `npm run clean:db` – reset database for fresh deployment.
- `npm test` – run jest tests.

## OpenAPI

An OpenAPI 3.1 spec is served at `GET /docs` and `GET /v1/openapi.json`.
The on-disk snapshot at [`openapi.json`](openapi.json) is regenerated from
the Zod contracts under [`src/contracts/`](src/contracts/) and the document
assembly in [`src/schemas.ts`](src/schemas.ts) via `npm run regen:openapi`;
keep them in sync after every schema change.
