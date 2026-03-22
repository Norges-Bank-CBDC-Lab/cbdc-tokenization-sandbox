# NB Bond API

Express service that drives BondManager/BondAuction via a single signer holding `BOND_ADMIN_ROLE`. The service owns the sealing keypair, unseals bids, computes a uniform-price allocation, and submits `finaliseAuction` once approved.

## Endpoints & Usage

See `DEVELOPMENT.md` for API-focused runbooks and `../README.md` for the wider
service-layer overview.

When running inside the sandbox, the API is reachable via the gateway at `http://bond-api.cbdc-sandbox.local/` (the start scripts add the `/etc/hosts` entry).

## Sandbox Helm Config

Before deploying the service through `./nb-bond-api.sh start` or
`./sandbox.sh start`, create the local Helm values file:

```console
cp services/nb-bond-api/helm/values.local.example.yaml services/nb-bond-api/helm/values.local.yaml
```

Then replace the placeholder `secret.BOND_ADMIN_PK` with a base64-encoded
private key for a local-only sandbox account. Do not commit or reuse real keys
outside local development.

## Env

- `RPC_URL` – JSON-RPC endpoint
- `GLOBAL_REGISTRY_ADDRESS` – deployed GlobalRegistry used to resolve BondManager
- `BOND_MANAGER_CONTRACT_NAME` – registry key for BondManager (default: "Bond Manager")
- `BOND_ADMIN_PK` – hex key with `BOND_ADMIN_ROLE`
- `AUCTION_OWNER_SEAL_PK` – optional; generated on boot if omitted
- `LOG_LEVEL` – defaults to `info`
- `EXPRESS_PORT` – defaults to `8080`

## Scripts

- `npm run dev` – run ts-node via tsx
- `npm run build` – emit compiled JS to `dist/`
- `npm start` – run compiled server (entry `dist/index.js`)
- `npm run clean:db` – reset database for fresh deployment.
- `npm test` – run jest tests.

## OpenAPI

An OpenAPI 3.1 spec is served at `GET /docs`.
