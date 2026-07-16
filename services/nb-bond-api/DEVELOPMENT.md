# NB Bond API (OpenAPI), F5.6 Bond Lifecycle

This document describes the HTTP API exposed by `services/nb-bond-api`. It is intended for senior developers who need to operate the full F5.6 bond lifecycle (issuance, extension, buyback, coupon payments, and redemption) against a running sandbox deployment.

The API is defined by the OpenAPI 3.1 document in `services/nb-bond-api/openapi.json` and is served at runtime from:

- `GET /docs` (JSON OpenAPI document)
- `GET /v1/openapi.json` (JSON OpenAPI document)

## 1. What this service does (and does not do)

### 1.1 What it does

`services/nb-bond-api` is an operator service that:

- Sends issuer-side transactions to the on-chain `BondManager` contract (it holds `BOND_ADMIN_ROLE` off-chain via a private key).
- Provides an operational interface to start and manage sealed-bid auctions (RATE, PRICE, BUYBACK).
- Unseals encrypted bids off-chain (it owns the auction sealing keypair), recomputes allocations off-chain over the operator-selected winning bids, and finalises auctions on-chain after explicit approval.
- Provides read endpoints for bond state, auctions, holders, and an event history view backed by an ingestion database.

### 1.2 What it does not do

- It does not provide endpoints for dealers/investors to place bids. Bids are submitted on-chain to `BondAuction` using the CLIs under `scripts/` (see §5).
- It does not provide endpoints for secondary-market order placement. Scenario 3 trading is implemented on-chain via bond order book contracts, but is not driven through this OpenAPI surface.
- It implements two configurable auth modes — `none` (sandbox default, header accepted but ignored) and `entra` (JWT validated against a Microsoft Entra ID tenant). See §7.7. The OpenAPI document always declares `bearerAuth`; the `none` mode is a runtime override for the sandbox.

## 2. Quickstart (run the service)

### 2.1 Prerequisites

- A running EVM JSON-RPC endpoint (sandbox chain).
- Bond contracts deployed, specifically a deployed `BondManager` address.
- Node.js tooling (npm) and TypeScript.

### 2.2 Configure environment

Create an environment file from `services/nb-bond-api/.env.example` and set at minimum:

- `RPC_URL`: JSON-RPC endpoint. In the local sandbox this must be the
  archive/RPC service (`http://besu-archive.besu:8545`), not the validator.
- `GLOBAL_REGISTRY_ADDRESS`: deployed `GlobalRegistry` used to resolve `BondManager`.
- `BOND_MANAGER_CONTRACT_NAME`: registry key for `BondManager` (default: "Bond Manager").
- `BOND_ADMIN_PK`: private key for the API operator, this address must have the relevant on-chain admin role(s).

Important optional settings:

- `AUCTION_OWNER_SEAL_PK`: private key for unsealing bids. If omitted, a new key is generated on each boot.
  - If you omit it, the service will not be able to unseal bids created with a previous boot's sealing public key.
  - For any environment where auctions may span restarts, set `AUCTION_OWNER_SEAL_PK` and treat it as sensitive.
- `DB_PATH`: path to SQLite database used for ingestion (default `data/ingestion.sqlite`).
- `START_BLOCK`: initial backfill block for ingestion (default `0`).
- `POLL_INTERVAL_MS`: ingestion polling interval (default `3000`).
- `NB_BOND_API_SSE_HEARTBEAT_MS`: authenticated SSE comment-heartbeat interval
  in milliseconds (default `15000`). Gateway idle timeouts must be higher.
- `EXPRESS_PORT`: listen port (default `8080`).
- `CORS_ALLOWED_ORIGINS`: comma-separated list of origins the CORS middleware accepts. Defaults to `http://web.cbdc-sandbox.local` (the local sandbox frontend at `services/nb-ui/`). Override (with multiple comma-separated origins if needed) for a non-local deployment.
- `NB_BOND_API_AUTH_MODE`: `none` (default) or `entra`. See §7.7.
- `NB_BOND_API_AUTH_ENTRA_TENANT_ID` / `NB_BOND_API_AUTH_ENTRA_AUDIENCE`: required when `NB_BOND_API_AUTH_MODE=entra`.
- `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` / `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES`: comma-separated Entra App Role values for role-based access (operator gates `/v1/central-bank/*`; recognised = operator ∪ tester). Operator roles required in `entra` mode. See §7.7.

### 2.3 Start commands

From `services/nb-bond-api/`:

```bash
npm install
npm run dev
```

The service starts an ingestion loop in-process (see §6.4).

For sandbox Helm deployment through `./nb-bond-api.sh start`, create
`services/nb-bond-api/helm/values.local.yaml` from
`services/nb-bond-api/helm/values.local.example.yaml` by running:

```bash
node scripts/generate-local-sandbox-fixtures.mjs
```

The sandbox and service start scripts also generate the local Helm values file
automatically if it is missing.

## 3. Data model and field conventions

These conventions come directly from `services/nb-bond-api/openapi.json`, the
feature contracts and path fragments under
`services/nb-bond-api/src/contracts/`, shared responses under
`services/nb-bond-api/src/openapi/shared-responses.ts`, and the document
assembly in `services/nb-bond-api/src/openapi/document.ts`.

### 3.1 Common types

- `Isin`: string identifying the bond series, for example `NO0012345678`.
- `AuctionId`: bytes32 as hex string, for example `0x...` with 64 hex chars after `0x`.
- `Address`: EVM address, `0x` plus 40 hex chars.
- `HexString`: `0x` prefixed hex.

### 3.2 Integer encoding (`BigIntString`)

Many numeric fields are returned as a decimal string (`BigIntString`) to avoid JavaScript integer precision issues.

Examples:

- `"end": "1735689600"` (unix seconds)
- `"size": "100"` (bond units, see below)

### 3.3 Bps encoding (`BpsString`)

Rates and prices use a basis-points string (`BpsString`) with 1e4 precision.

Examples:

- `"425"` means 4.25%
- `"9875"` means 98.75

Important: the same field name `rate` is reused across auction types:

- In `RATE` auctions, `rate` means yield in bps.
- In `PRICE` and `BUYBACK` auctions, `rate` represents a price per 100 nominal (expressed in bps precision).

### 3.4 Bond unit sizing (`size`, `units`)

The API treats bond quantities as whole "units". In this sandbox, `size` and
`units` are expressed in whole 1,000 NOK nominal units (see the generated
`CreateAuctionRequest.size` description in `services/nb-bond-api/openapi.json`).

### 3.5 Rate vs yield (naming convention)

The DTO uses **rate** for any contractually fixed-at-issuance value and reserves **yield** for market-derived returns. Concretely:

- `Bond.coupon.rateBps` — contractual annual coupon rate, fixed when the bond is issued.
- `Auction.bids[].rate` and `Auction.allocation.clearingRate` — bidder-quoted / cleared rate for the auction; in a RATE auction this is a yield in bps, in PRICE / BUYBACK it's a price per 100 nominal in bps precision (see §3.3).

The sandbox has no secondary-market price discovery, so at par issuance the coupon rate equals the buyer's yield-to-maturity. Once secondary trading is added, **yield** can re-enter the surface as a derived field on holder views; until then no DTO uses `yield*` keys.

## 4. Endpoint reference (v2)

Base path is `/v1`. All request and response bodies are JSON. The full
v2 design (rationale + DTO catalog) lives in
[`docs/openapi-v2-plan.md`](../../docs/plans/archive/openapi-v2-plan.md).

Two architectural rules apply across the surface:

- **Bulky resource tree.** A `GET /v1/bonds` returns every bond with
  its nested `auctions[]` (each with `bids[]`, `allocation`, `txs`)
  and `holders[]`. Single-resource GETs (`GET /v1/bonds/{isin}`,
  `GET /v1/auctions/{id}`) return the same DTO sub-shape so the UI
  can deep-link without first fetching the parent.
- **Mutations return the updated parent.** Coupon / redeem /
  createAuction respond with the new `Bond`. Close / cancel /
  finalise respond with the new `Auction`. The caller swaps its
  cache atomically — no follow-up GET needed.

Errors are RFC 7807 `application/problem+json` documents (`type`,
`title`, `status`, `detail`, `instance`, `errors[]`). Validation
failures populate `errors[]` with `{ field, message }` entries.

### 4.1 Health and OpenAPI

- `GET /v1/health`
  - Purpose: health check, discovery of contract addresses and sealing public key, and runtime visibility into chain reachability + ingestion-loop liveness for the operator UI's `HealthBadge`.
  - Public — bypasses the auth gate (`security: []` in the OpenAPI document).
  - Never 5xx: each chain read is wrapped individually so a Besu outage surfaces as `status: "down"` with zero-address contract fields rather than as an upstream error. See [§7.8](#78-health-payload-and-status-derivation).
  - Response: `Health` — `{ status: "ok" | "degraded" | "down", contracts, sealingPubKey, chain, ingestion }`.
- `GET /docs` and `GET /v1/openapi.json`
  - Purpose: fetch the OpenAPI JSON. Public.
  - On-disk snapshot: [`openapi.json`](openapi.json). Regenerate after any schema change with `npm run regen:openapi`.

### 4.2 Bonds

- `GET /v1/bonds` (`operationId: listBonds`)
  - Returns `Bond[]` — the canonical "one call for everything" that primes the UI cache.
  - Each `Bond` carries `contracts`, nested `maturity` / `coupon` blocks, `holders[]`, and the full `auctions[]` subtree (with bids and allocations).
- `GET /v1/bonds/{isin}` (`operationId: getBond`)
  - Returns one `Bond` — same shape as a list element.
- `POST /v1/bonds/{isin}/coupon-payments` (`operationId: payCoupon`)
  - Body: `HoldersBody` (`{ holders: Address[] | null }`); `null` defaults to all current holders.
  - Returns the updated `Bond` (response replaces the cached parent).
- `POST /v1/bonds/{isin}/redemptions` (`operationId: redeem`)
  - Body: `HoldersBody`. Returns the updated `Bond`.
- `GET /v1/bonds/{isin}/history` (`operationId: listBondHistory`)
  - Returns `HistoryEvent[]` directly (no wrapper). Combines auction and bond events for the ISIN.
  - Query: `before` (cursor block, exclusive), `limit` (default 100, max 500).
  - Kept as a separate paginated resource because event volume grows unboundedly and would defeat the ETag freshness of the parent `Bond`.

### 4.3 Auctions

- `POST /v1/bonds/{isin}/auctions` (`operationId: createAuction`)
  - Body: `CreateAuctionBody` — `{ type, end (BigIntString), size (BigIntString), maturityDuration (BigIntString | null) }`.
  - Behavioural rules: first auction for an ISIN must be `RATE`; subsequent auctions cannot be `RATE`; `maturityDuration` is required for `RATE`.
  - Returns the updated `Bond` with the new auction in its `auctions[]`.
- `GET /v1/auctions` (`operationId: listAuctions`)
  - Returns `Auction[]` across all bonds — flat view of the same tree (each auction is identical to its nested counterpart). Useful for "auctions by status" filtering without going through bonds.
- `GET /v1/auctions/{auctionId}` (`operationId: getAuction`)
  - Returns one `Auction` with its `bids[]`, `allocation`, and `txs`.
- `PATCH /v1/auctions/{auctionId}` (`operationId: closeAuction`)
  - Body: `CloseAuctionBody` — `{ status: "closed" }` (only valid transition target today; enum extensible later).
  - Effects: sends `BondManager.closeAuction(isin)`, unseals bids, computes the allocation (uniform for `RATE`/`PRICE`, pay-as-bid for `BUYBACK`).
  - Returns the updated `Auction` with `status: "closed"` and the computed `allocation`.
- `DELETE /v1/auctions/{auctionId}` (`operationId: cancelAuction`)
  - No body. Soft-delete: the auction remains on-chain with `status: "cancelled"`.
  - Effects: sends `BondManager.cancelAuction(isin)`.
  - Returns the cancelled `Auction`.
- `PUT /v1/auctions/{auctionId}/finalisation` (`operationId: finaliseAuction`)
  - Body: `FinaliseBody` — `{ approve: true, winningBidIndexes, expectedClearingRate }`. Both selection fields are required.
  - Re-fetches the sealed bids from chain, recomputes the uniform-price allocation + clearing rate over **exactly the selected bids**, rejects (`400`) if the recomputed rate differs from `expectedClearingRate`, rebuilds per-allocation proofs (paired to bids by `bidIndex`), and sends `BondManager.finaliseAuction(isin, allocations, proofs).`
  - There is no local-only reject state. Use the durable cancel transition when the allocation must not be issued.
  - Returns the updated `Auction`.

### 4.4 Admin

- `POST /v1/admin/restart-ingestion` (`operationId: restartIngestion`)
  - Operator-only: sits under the standard auth gate (no-op in `none` mode, JWT-validated in `entra` mode) plus an operator-role check in `entra` mode (`403` otherwise). See [§7.9](#79-admin-restart-ingestion).
  - `POST /v1/admin/restart-ingestion` — plain restart. Tears down the running ingestion loop and starts a fresh one via the same retry-with-backoff helper used at boot. Projection survives.
  - `POST /v1/admin/restart-ingestion?fromBlock=0` — destructive reset. Drops every table listed in `PROJECTION_TABLE_NAMES` and restarts the loop from `START_BLOCK`. The `bidders`, `banks`, and `operation_attempts` system-of-record tables are preserved.
  - Returns `RestartOutcome` — `{ restarted: boolean, status: HealthIngestion }`. `200` when the loop confirmed `loopRunning=true` within the 5s timeout, `202` when it's still coming up (e.g. Besu still unreachable). The operator UI polls `/v1/health` to track the rest of the rebuild either way.

## 5. Bid submission (dealer workflow, CLIs)

The NB Bond API does not accept bids over HTTP. Dealers submit bids directly to the on-chain `BondAuction` contract. Two CLIs are provided:

- `scripts/bid-encryption`: produces ciphertext and plaintext hash compatible with the on-chain auction, and can embed bid intent signature material.
- `scripts/bid-submitter`: submits sealed bids on-chain to `BondAuction.submitBid`.

### 5.1 Dealer bid creation (encrypt)

From `scripts/bid-encryption/`:

```bash
npm install
node ../generate-local-sandbox-fixtures.mjs
npm run encrypt ../../.tmp/bid-encryption/examples/basic/seal.example.json ../../.tmp/bid-encryption/examples/basic/sealed.json --chainId 2018 --verifyingContract 0x... --auctionId 0x...
```

Notes:

- `--verifyingContract` is the deployed `BondAuction` address (discover it via `GET /v1/health` or the `CreateAuctionResponse`).
- `--auctionId` is returned from `POST /v1/bonds/{isin}/auctions`.
- The encryption input format supports embedding `bidderSig` and `bidderNonce` under a `signing` object. These values are used by the API when it finalises an auction (it constructs proof tuples from unsealed plaintext).

### 5.2 Dealer bid submission (on-chain)

From `scripts/bid-submitter/`:

```bash
npm install
node ../generate-local-sandbox-fixtures.mjs
npm run submit --sealed-bids ../../.tmp/bid-encryption/examples/basic/sealed.json --keys ./examples/bids.keys.json --bond-auction 0x... --auction-id 0x... --rpc-url http://besu.cbdc-sandbox.local:8545
```

`--bond-auction` is the deployed `BondAuction` address. `--auction-id` is the bytes32 auction ID.

## 6. Lifecycle walkthroughs (how to run F5.6 via the API)

This section provides step-by-step "operator runbooks" that use only this OpenAPI surface (plus the bid CLIs for bid submission).

### 6.1 Scenario 1, issuance (RATE auction)

1. Create the auction:
   - `POST /v1/bonds/{isin}/auctions` with `type=RATE`, `end`, `size`, and `maturityDuration`.
   - Response is the updated `Bond` with the new auction in `auctions[0]`.
2. Distribute auction parameters to dealers:
   - `id` and `sealingPubKey` from the new `Auction`.
   - `contracts.auction` (bond-auction contract address) for signing and submission.
3. Dealers submit sealed bids on-chain using the CLIs (see §5).
4. Close and compute:
   - `PATCH /v1/auctions/{auctionId}` body `{ "status": "closed" }`.
   - Response is the updated `Auction`. Review `bids[]` (each carries its on-chain `bidIndex`), `allocation.entries`, and `allocation.clearingRate`.
5. Finalise or cancel:
   - `PUT /v1/auctions/{auctionId}/finalisation` body `{ "approve": true, "winningBidIndexes": [0, 1, 3], "expectedClearingRate": "<bps>" }` to submit on-chain. Send the `bidIndex` of each winning bid plus the clearing rate you expect; the server recomputes over that selection and rejects (`400`) on mismatch.
   - If the operator does not approve the outcome, cancel the auction. Rejection is not advertised because the contracts emit no durable rejection transition that projection replay could recover.
6. Verify: subsequent `GET /v1/auctions/{auctionId}` (or `GET /v1/bonds/{isin}`) reflects the new status.

### 6.2 Issuance extension (PRICE auction)

The flow matches §6.1, except create with `type=PRICE`.

Operational note: the API enforces that `PRICE` is not valid as the first auction for an ISIN, so this must follow a `RATE` issuance auction.

### 6.3 Scenario 4, buyback (BUYBACK auction)

The flow matches §6.1, except create with `type=BUYBACK` and `size` representing the buyback target in bond units.

Buyback-specific notes:

- Bids represent offers from holders to sell back to the issuer at a quoted price per 100, represented in `rate` (bps precision).
- Allocation is computed by taking the cheapest offers first until the target is filled. The allocation is pay-as-bid (each accepted offer can have its own price).

### 6.4 Scenario 5, coupon payments and redemption

Coupon payment:

1. Determine holders:
   - Option A: let the API resolve holders, call `POST /v1/bonds/{isin}/coupon-payments` with `{ "holders": null }`.
   - Option B: call `GET /v1/bonds/{isin}` and submit a subset from `bond.holders[].holder` explicitly.
2. Submit: `POST /v1/bonds/{isin}/coupon-payments`. The response is the updated `Bond` — its `coupon.payments.{made,remaining}` counters reflect the new payment.
3. Verify via `GET /v1/bonds/{isin}/history` for the `COUPON_PAID` event.

Redemption:

1. Determine holders as above.
2. Submit: `POST /v1/bonds/{isin}/redemptions`. The response is the updated `Bond`.
3. Verify: `GET /v1/bonds/{isin}` should report `status: "redeemed"` once total supply reaches zero.

### 6.5 Scenario 3, secondary trading (note)

Scenario 3 trading is implemented on-chain (bond order book and settlement logic), but is not exposed through this OpenAPI service. If you need an HTTP interface for secondary trading, it should be designed as a separate work package (for example, an order placement API that wraps the on-chain `BondOrderBook` and enforces the correct authorisations and cash-token semantics).

## 7. Operational notes and troubleshooting

### 7.1 Sealing key persistence

The sealing public key used by bidders is returned from:

- `GET /v1/health` (`sealingPublicKey`)
- `POST /v1/bonds/{isin}/auctions` (`auctionPubKey`)

If the service generates a new sealing key on boot (because `AUCTION_OWNER_SEAL_PK` is unset), then bids encrypted to the previous public key cannot be unsealed by the restarted service. For stable environments, set `AUCTION_OWNER_SEAL_PK` explicitly.
The local sandbox fixture generator does this for the Helm-based sandbox flow.

### 7.2 Allocation approval safety

Finalisation recomputes the allocation server-side over the operator-selected `winningBidIndexes` and rejects if the recomputed clearing rate does not match the submitted `expectedClearingRate`. The server is the sole authority for the economic terms; the UI's figures are display-only. This cross-check guarantees the minted coupon cannot silently diverge from what the operator confirmed.

Typical 4xx errors:

- `400 end must be in the future`: the `end` timestamp is not valid.
- `400 maturityDuration is required for RATE`: missing field for `RATE`.
- `400 first auction for ISIN must be RATE`: you attempted `PRICE` or `BUYBACK` for an ISIN with no prior issuance.
- `409 auction must be closed to finalise`: you called finalisation before closing the auction.
- `400 clearing-rate mismatch`: the clearing rate the server recomputed over `winningBidIndexes` differs from the submitted `expectedClearingRate`; no allocation was submitted.
- `400 unknown/duplicate winning bidIndex`: a `winningBidIndexes` entry does not exist on the auction or repeats.

### 7.3 Security posture

The local sandbox pod runs hardened by default:

- the container image (`services/nb-bond-api/Dockerfile`) declares
  `USER node`, so the runtime process runs as the unprivileged `node` user
  (uid 1000) shipped by the upstream Node image, not as root;
- the pod's `securityContext` sets `fsGroup: 1000` so the `/app/data`
  emptyDir mount (the only writable runtime path; holds
  `ingestion.sqlite` + its WAL sidecars) is group-writable for uid 1000;
- the container's `securityContext` sets `runAsNonRoot: true`,
  `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, and
  `seccompProfile.type: RuntimeDefault`.

Both blocks are surfaced via `services/nb-bond-api/helm/values.local.example.yaml`
under `podSecurityContext` and `securityContext`, so non-local deployments
can override them (e.g. to also set `readOnlyRootFilesystem: true` with
appropriate writable tmp mounts — deliberately deferred from the sandbox
default since it requires per-platform validation of any transitive write
paths under `/tmp` or `~/.npm`).

The local default uses `NB_BOND_API_AUTH_MODE=none`. Deployed environments may
use `entra`, which validates Entra bearer tokens and app roles. This remains a
privileged sandbox service: authentication does not make plaintext fixture keys
or sandbox diagnostics suitable for real funds.

### 7.4 Ingestion database behaviour

The service maintains an SQLite database (default `data/ingestion.sqlite`) which it writes to in-process. This is used for:

- `GET /v1/bonds/{isin}/holders`
- `GET /v1/bonds/{isin}/history`

If `DB_PATH` is unwritable, or ingestion cannot reach `RPC_URL`, these endpoints may return empty data or become stale, even if the on-chain contracts are operating correctly.

In the sandbox Helm deployment, the database lives on an `emptyDir` volume
mounted at `/app/data`, so its contents are reset whenever the pod is
recreated. The image entrypoint touches `/app/data/ingestion.sqlite` on
start so the read-side connection (opened in readonly mode at module load)
does not race the writer-side schema creation.

The ingestion loop polls every `POLL_INTERVAL_MS` (default 3 s) and
processes blocks `[nextBlock, latest]` inclusive. The single-block case is
handled in `computeIngestionWindow` so the current head is never silently
dropped, independent of consensus or empty-block policy. The QBFT sandbox
advances its idle head every five minutes; transaction-bearing blocks retain
the one-second period. The live-update stream
publishes bond and auction resource keys only after the projection transaction and
checkpoint save complete, so clients no longer need a delayed second reload
to race the ingestion tick.

The schema is versioned via `PRAGMA user_version` (current version `6`).
Before accepting an ingestion checkpoint, the writer also binds the database to
the RPC chain ID and genesis hash in `chain_identity`. A legacy unbound
checkpoint or a different genesis is fatal and requires deleting the database
or recreating the sandbox; retaining chain ID 2018 is not sufficient identity.
When the on-disk value is lower than the current `SCHEMA_VERSION` in
`src/ingestion-db.ts`, `openDatabase` runs a one-shot migration that
drops the full projection through the central `PROJECTION_TABLE_NAMES` list,
recreates it, and stamps the new version in one transaction. The polling loop
then rebuilds every projection table from chain on its next tick. This is
necessary when reducer semantics change; an additive migration would retain
incorrect derived rows. The migration logs `ingestion DB schema migrated from
v<old> to v<new>` once at startup.

Persistent-volume deployments must take and verify a database backup before
upgrading. The migration preserves `bidders`, `banks`, and
`operation_attempts`, but rolling back to a binary with an older projection
schema requires restoring the pre-upgrade database. Do not open a rebuilt
database with older projection code and assume that is a supported downgrade.

Event-table writes are idempotent. Each of `auction_events`,
`balance_events`, and `bond_events` carries a `log_index` column and a
unique constraint on `(tx_hash, log_index, …)`, so re-processing the
same chain log is a no-op. `applyBalanceDelta` only mutates `balances`
when the corresponding event row was actually written, so a replay
never double-counts the delta. This guarantee is the precondition for
any future move to event-driven ingestion (WebSocket + watchdog) where
the same log can legitimately be delivered more than once.

`TransferByPartition` is the sole balance movement source. The token also emits
high-level `IsinMinted` and `IsinRedeemed` events for the same operations; those
events must not be reduced as additional deltas. Mint and burn transfers apply
only the non-zero side, and self-transfers are net-zero. Schema version 4 forces
a projection rebuild so older doubled deltas and zero-address pseudo-holders
cannot survive the reducer correction. Schema version 5 adds the `bond_state`
projection, which reduces chain-reproducible lifecycle, offering, coupon,
maturity, supply, and redemption facts without mixing them into the HTTP DTO.
Schema version 6 adds `auction_bids`, `auction_allocations`, and full auction
metadata columns. BondAuction owns metadata and sealed-bid facts; BondManager
continues to own business lifecycle and DvP outcome history. Final allocations
are enriched with a block-tagged read at the `AuctionFinalized` source block so
a full resync remains deterministic.

### 7.5 Cache behaviour

Bond and auction DTOs are composed from synchronous SQLite snapshot loaders in
[`src/projection/snapshots.ts`](src/projection/snapshots.ts). No request-path RPC
read contributes lifecycle, supply, holder, bid, or allocation state. Each
response exposes the snapshot checkpoint as `X-Projection-Block`.

The polling loop and mutations share one serialized ingestion coordinator.
After a mutation mines, `advanceProjectionTo(receipt.blockNumber)` processes
missing ranges before composing the updated resource. If bounded catch-up does
not finish, the API returns `202 MutationAccepted` with the public transaction
reference, resource identity, and `projectionPending:true`; it never returns a
stale success DTO or a false post-commit failure.

For durable audit artefacts, use the on-chain allocations and the
ingestion-backed history endpoints rather than client-side caches.

### 7.6 ETag / md5 caching protocol

Projection-backed Bond/Auction responses set:

- `ETag: "<md5>"` — md5 of canonical (key-sorted) JSON of the response body.
- `X-Projection-Block: <number>` — highest chain block represented by the snapshot.
- `Cache-Control: no-cache, must-revalidate`.

Each cacheable DTO (`Bond`, `Auction`, `Bid` variants, `Allocation`,
`HolderBalance`) also carries an `md5` field stamped server-side over
its own subtree. Clients can compare per-DTO `md5` values to skip
re-rendering unchanged subtrees without diffing fields.

Polling: send `If-None-Match: "<etag>"` on subsequent GETs. When the
server-computed ETag matches, the response is `304 Not Modified` with
an empty body — the client serves the cached body. At sandbox scale
this is the difference between shipping ~50 KB per poll and ~200 B.

Mutations always return the updated parent DTO with a fresh `ETag`.
Clients use the response body as the new cache state for that
resource. The frontend's [`httpClient.js`](../nb-ui/src/api/httpClient.js)
clears its full cache on any mutation; subsequent GETs re-prime
naturally.

The md5 is server-computed only. Clients treat it as an opaque cache
key — they never recompute it.

### 7.7 Authentication modes

`NB_BOND_API_AUTH_MODE` selects one of two enforcement modes at
startup. The OpenAPI document always declares `bearerAuth` on every
secured operation; the runtime decides whether to enforce.

- `none` (default for the local sandbox) — the `Authorization` header
  is accepted but not validated. All requests pass.
- `entra` — bearer tokens are validated as JWTs issued by Microsoft
  Entra ID. The middleware (`src/auth.ts`) verifies signature against
  the tenant's JWKS, plus `iss` and `aud` claims. Required env:
  `NB_BOND_API_AUTH_ENTRA_TENANT_ID`, `NB_BOND_API_AUTH_ENTRA_AUDIENCE`,
  and `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` (see below).
  Misconfiguration (e.g. `entra` mode without a tenant id, or without any
  operator role) fails fast at startup — there is no silent fallback.

**Role-based authorization (entra mode only).** Beyond authenticating the
token, `entra` mode authorizes it against the `roles` claim (Entra App Roles):

- `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` — comma-separated App Role values
  granting operator access. These gate `/v1/central-bank/*` (mint, burn,
  allowlist, transfer). Required in `entra` mode.
- `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES` — comma-separated App Role values
  granting baseline access without Central Bank. Optional.
- Every authenticated endpoint requires at least one _recognised_ role
  (operator ∪ tester); a valid token carrying none is rejected with `403`.
  `/v1/central-bank/*` additionally requires an operator role (`403`
  otherwise). `none` mode performs no role checks. The values must match the
  nb-ui `AUTH_OPERATOR_ROLES` / `AUTH_TESTER_ROLES` and the App Role values
  defined in Entra.

`/v1/health`, `/docs`, and `/v1/openapi.json` are mounted before the
auth gate and stay public in both modes. Every other endpoint goes
through the middleware.

ArgoCD-managed deployments must keep `NB_BOND_API_AUTH_MODE` and the
nb-ui `AUTH_MODE` in sync. A mismatch (e.g. backend `entra`, frontend
`none`) produces clear 401s rather than silent partial behaviour.

#### Authenticated live-update stream

`GET /v1/events` is below the baseline auth and recognised-role middleware.
In `none` mode those checks no-op; in `entra` mode the request needs the same
valid bearer token and operator-or-tester role as protected reads. The stream
emits `changed` events containing only coarse resource keys and comment
heartbeats at `NB_BOND_API_SSE_HEARTBEAT_MS`; it never sends domain data or a
health snapshot. There is no replay buffer, so clients reconcile mounted
queries whenever a new connection opens.

For Azure, response buffering must be disabled, the gateway idle timeout must
exceed the heartbeat interval, and the bearer header must reach the API. Keep
one API replica until shared fan-out is designed; the broadcaster is
in-process. See [`docs/AZURE_BOUNDARY.md`](../../docs/AZURE_BOUNDARY.md).

### 7.8 Health payload and status derivation

`GET /v1/health` returns a three-state `status` plus two diagnostic
blocks. The operator UI's [`HealthBadge`](../nb-ui/src/components/HealthBadge.jsx)
polls this every 7s and renders the colour from `status`. The full
shape:

```jsonc
{
  "status": "ok" | "degraded" | "down",
  "contracts": { "bondManager", "bondAuction", "bondToken", "wnok" },
  "sealingPubKey": "0x…",
  "chain": {
    "rpcUrl": "http://besu-archive.besu:8545",  // sanitised — protocol://host[:port] only
    "chainId": 2018,
    "head": 12345,
    "headReachable": true
  },
  "ingestion": {
    "loopRunning": true,
    "lastBlockProcessed": 12345,
    "lag": 0,                          // chain.head - ingestion.lastBlockProcessed
    "pollIntervalMs": 3000,
    "lastTickAt": 1716387245123,       // unix-epoch ms
    "lastEventTxHash": "0x…",          // most-recent ingested log (null pre-first-event)
    "consecutiveFailures": 0,
    "recentErrors": [                  // ring buffer, newest first, max 10
      { "ts": 1716387243111, "message": "rpc timeout", "code": "TIMEOUT" }
    ]
  }
}
```

Status derivation lives in
[`src/health.ts`](src/health.ts) as a pure function so it can be unit-tested
without spinning up the express app:

- `down` — chain unreachable, OR loop has never started, OR last tick > 60s ago.
- `degraded` — on-chain healthy but ingestion lag > 5 blocks, OR consecutive
  failures > 0, OR last tick 30–60s old.
- `ok` — everything inside thresholds.

`chain.rpcUrl` is rendered via `sanitiseRpcUrl()` to strip credentials,
query, and path before exposure. In the sandbox this is cosmetic; for
future non-local deployments it's the minimum surface.

Self-heal: the ingestion loop boot is wrapped in
[`startIngestionLoopWithRetry()`](src/ingestion.ts) (exponential backoff
1s → 2s → … → 30s, retries forever) so a transient `getaddrinfo
EAI_AGAIN` at PC/Docker restart no longer leaves the API silently
serving stale data.

### 7.9 Admin restart-ingestion

`POST /v1/admin/restart-ingestion` exposes the same lifecycle the
self-heal path uses, but operator-driven from the
[`NetworkHealthModal`](../nb-ui/src/pages/NetworkHealthModal.jsx).

Two modes, dispatched in [`src/admin.ts`](src/admin.ts):

| Mode            | Query          | Behaviour                                                                                                                                                                                                                                                 |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain restart   | `?` (none)     | `stopIngestionLoop()` clears the interval, then `startIngestionLoopWithRetry()` boots a fresh loop. Projection survives.                                                                                                                                  |
| Reset + restart | `?fromBlock=0` | Plain restart, plus drops every projection table via `dropProjectionTables()` from [`ingestion-db.ts`](src/ingestion-db.ts). On restart, `createTables` re-creates the empty shells and the loop rebuilds from `START_BLOCK`. **`bidders` is preserved.** |

The projection table list is centralised in
`PROJECTION_TABLE_NAMES` (ingestion-db.ts) and reused by both the
schema migration and the admin reset path. **Adding a new projection
table?** Append its name to that constant — both paths pick it up.
**Adding a new system-of-record table?** Do NOT add it to that
constant; document it next to the `bidders` exception.

Auth: the endpoint sits under the standard `authMiddleware` (no-op in
`none` mode, JWT-validated in `entra` mode) and is **operator-only** in
`entra` mode — `/v1/admin/*` requires an operator App Role
(`NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES`) and returns `403` otherwise.
An audit-log entry on every destructive `?fromBlock=0` fire is still a
recommended follow-up before a non-local deployment.

### 7.10 Data persistence (/app/data PVC)

The SQLite database under `/app/data` holds two very different things:

- **Chain projection** — every table in `PROJECTION_TABLE_NAMES`, including
  bond state, auction metadata/bids/allocations, balances, events, checkpoint,
  and static projection context. These
  are derivable from chain logs; the ingestion loop rebuilds them on
  next tick after a wipe.
- **System-of-record** — `bidders`, `banks`, and `operation_attempts` are
  deliberately excluded from projection resets. Bidder keypairs are plaintext,
  sandbox-only, and **cannot be recovered from chain**. If this is wiped the canonical fixture
  bidders re-seed but any operator-added bidder is permanently gone.

To prevent that, the helm chart mounts a `PersistentVolumeClaim`
(`nb-bond-api-data`) on `/app/data`. Defaults:

| Knob                       | Default                 | Notes                                                                        |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `persistence.enabled`      | `true`                  | Disable to fall back to `emptyDir` for environments without a storage class. |
| `persistence.size`         | `256Mi`                 | Way more than the sandbox SQLite needs; safe headroom.                       |
| `persistence.accessModes`  | `[ReadWriteOnce]`       | Matches a single-replica deployment.                                         |
| `persistence.storageClass` | unset (cluster default) | Local Kind uses `standard` (local-path-provisioner).                         |

The Kind local-path-provisioner stores the backing directory under the
Kind node's filesystem. **Survives** helm upgrades, `./nb-bond-api.sh
start`, `kubectl rollout restart`. **Does not survive** `kind delete
cluster` — bidders will need to be re-added (or wait for re-seeding of
the fixtures) after a full sandbox tear-down.
