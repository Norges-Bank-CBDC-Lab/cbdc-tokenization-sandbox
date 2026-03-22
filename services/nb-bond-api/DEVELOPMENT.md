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
- Unseals encrypted bids off-chain (it owns the auction sealing keypair), computes allocations off-chain, and finalises auctions on-chain after explicit approval.
- Provides read endpoints for bond state, auctions, holders, and an event history view backed by an ingestion database.

### 1.2 What it does not do

- It does not provide endpoints for dealers/investors to place bids. Bids are submitted on-chain to `BondAuction` using the CLIs under `scripts/` (see §5).
- It does not provide endpoints for secondary-market order placement. Scenario 3 trading is implemented on-chain via bond order book contracts, but is not driven through this OpenAPI surface.
- It does not implement authentication. It must be treated as a privileged internal service and deployed behind appropriate network controls.

## 2. Quickstart (run the service)

### 2.1 Prerequisites

- A running EVM JSON-RPC endpoint (sandbox chain).
- Bond contracts deployed, specifically a deployed `BondManager` address.
- Node.js tooling (npm) and TypeScript.

### 2.2 Configure environment

Create an environment file from `services/nb-bond-api/.env.example` and set at minimum:

- `RPC_URL`: JSON-RPC endpoint.
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
- `EXPRESS_PORT`: listen port (default `8080`).

### 2.3 Start commands

From `services/nb-bond-api/`:

```bash
npm install
npm run dev
```

The service starts an ingestion loop in-process (see §6.4).

For sandbox Helm deployment through `./nb-bond-api.sh start`, create
`services/nb-bond-api/helm/values.local.yaml` from
`services/nb-bond-api/helm/values.local.example.yaml` and replace the
placeholder `secret.BOND_ADMIN_PK` before deploying.

## 3. Data model and field conventions

These conventions come directly from `services/nb-bond-api/openapi.json` and `services/nb-bond-api/src/schemas.ts`.

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

The API treats bond quantities as whole "units". In this sandbox, `size` and `units` are expressed in whole 1,000 NOK nominal units (see `CreateAuctionRequest.size` description in `services/nb-bond-api/src/schemas.ts`).

## 4. Endpoint reference (v1)

Base path is `/v1`. All request and response bodies are JSON.

### 4.1 Health and OpenAPI

- `GET /health` and `GET /v1/health`
  - Purpose: health check and discovery of contract addresses and sealing public key.
  - Response includes: `bondManager`, `bondAuction`, `bondToken`, `sealingPublicKey`.
- `GET /docs` and `GET /v1/openapi.json`
  - Purpose: fetch OpenAPI JSON.

### 4.2 Bond and lifecycle status

- `GET /v1/bonds/{isin}`
  - Purpose: summary view of bond lifecycle state, maturity and coupon progress.
  - Notes: derived from on-chain state, plus ingestion-derived balances/events where available.

- `GET /v1/bonds/{isin}/holders`
  - Purpose: list active holders and their current partition balances.
  - Notes: uses an ingestion-derived holder set, then filters by live on-chain balance, so ingestion must be running.

- `GET /v1/bonds/{isin}/history`
  - Purpose: returns a combined stream of auction and bond lifecycle events for the ISIN.
  - Notes: backed by the ingestion database.

### 4.3 Auctions by ISIN

- `POST /v1/bonds/{isin}/auctions`
  - Purpose: create an auction for an ISIN.
  - Request: `CreateAuctionRequest`
    - `type`: `RATE` | `PRICE` | `BUYBACK`
    - `end`: unix seconds (number or `BigIntString`), must be in the future
    - `size`: offering size (RATE, PRICE) or buyback size (BUYBACK), in bond units
    - `maturityDuration`: required for `RATE`, seconds from distribution until maturity
  - Behavioural constraints enforced by the API:
    - First auction for an ISIN must be `RATE`.
    - Subsequent auctions cannot be `RATE`.
  - Response: `CreateAuctionResponse`
    - Includes `auctionId`, `auctionPubKey` (the sealing public key bidders must use), contract addresses, and `txHash`.

- `GET /v1/bonds/{isin}/auctions`
  - Purpose: list cached and discovered auctions for an ISIN.
  - Query (optional): `status` and `type`.
  - Notes: the service maintains an in-memory cache, and also attempts to hydrate the latest on-chain auction for the ISIN.

### 4.4 Auction operations by auctionId

- `GET /v1/auctions/{auctionId}`
  - Purpose: combined view of on-chain metadata plus cached derived state.
  - Returns:
    - `metadata` (owner, end, offering, auctionPubKey, bond address, auctionType)
    - `allocations` (on-chain allocation tuples, if finalised)
    - `cached` (sealed/unsealed counts, allocationHash, flags)

- `POST /v1/auctions/{auctionId}/close`
  - Purpose: close the auction on-chain and compute an allocation off-chain.
  - Side effects:
    - Sends `BondManager.closeAuction(isin)` transaction.
    - Fetches sealed bids from `BondManager.getSealedBids(isin)`.
    - Unseals bids using the service sealing keypair.
    - Computes allocation:
      - `RATE` and `PRICE`: uniform allocation with a single clearing rate.
      - `BUYBACK`: fills cheapest offers first and produces a pay-as-bid allocation; `clearingRate` is the lowest accepted price.
    - Caches sealed bids, unsealed bids, and `allocationResult` in memory.
  - Response: `CloseResponse`
    - Includes unsealed bid summary and `allocation.allocationHash` (used for the approval step).

- `GET /v1/auctions/{auctionId}/bids?state=sealed|unsealed`
  - Purpose: retrieve sealed or unsealed bids, plus any cached allocation result.
  - Notes:
    - `sealed` includes ciphertext and plaintext hashes.
    - `unsealed` returns only `bidder`, `rate`, and `units` (not the full plaintext).

- `GET /v1/auctions/{auctionId}/allocations`
  - Purpose: retrieve the computed allocation result (if available in cache or recomputable from chain).

- `PUT /v1/auctions/{auctionId}/finalisation`
  - Purpose: finalise (approve) or reject an allocation.
  - Request: `FinaliseRequest`
    - `allocationHash`: must match the cached allocation hash
    - `approve`: `true` to finalise on-chain, `false` to mark the allocation as rejected in the API state
  - Side effects when `approve=true`:
    - Builds per-allocation proofs from unsealed bid plaintext (bid intent signature and nonce).
    - Sends `BondManager.finaliseAuction(isin, allocations, proofs)` transaction.
  - Response: `FinaliseResponse`
    - On approval includes `txHash` and the allocation result.
    - On rejection returns status `rejected` without an on-chain transaction.

- `POST /v1/auctions/{auctionId}/cancel`
  - Purpose: cancel the active auction for the ISIN on-chain.
  - Side effects:
    - Sends `BondManager.cancelAuction(isin)` transaction.

## 5. Bid submission (dealer workflow, CLIs)

The NB Bond API does not accept bids over HTTP. Dealers submit bids directly to the on-chain `BondAuction` contract. Two CLIs are provided:

- `scripts/bid-encryption`: produces ciphertext and plaintext hash compatible with the on-chain auction, and can embed bid intent signature material.
- `scripts/bid-submitter`: submits sealed bids on-chain to `BondAuction.submitBid`.

### 5.1 Dealer bid creation (encrypt)

From `scripts/bid-encryption/`:

```bash
npm install
npm run encrypt examples/basic/seal.example.json ./sealed.json --chainId 1 --verifyingContract 0x... --auctionId 0x...
```

Notes:

- `--verifyingContract` is the deployed `BondAuction` address (discover it via `GET /v1/health` or the `CreateAuctionResponse`).
- `--auctionId` is returned from `POST /v1/bonds/{isin}/auctions`.
- The encryption input format supports embedding `bidderSig` and `bidderNonce` under a `signing` object. These values are used by the API when it finalises an auction (it constructs proof tuples from unsealed plaintext).

### 5.2 Dealer bid submission (on-chain)

From `scripts/bid-submitter/`:

```bash
npm install
cp ./examples/bids.keys.example.json ./examples/bids.keys.json
npm run submit --sealed-bids ./sealed.json --keys ./examples/bids.keys.json --bond-auction 0x... --auction-id 0x... --rpc-url http://localhost:8545
```

`--bond-auction` is the deployed `BondAuction` address. `--auction-id` is the bytes32 auction ID.

## 6. Lifecycle walkthroughs (how to run F5.6 via the API)

This section provides step-by-step "operator runbooks" that use only this OpenAPI surface (plus the bid CLIs for bid submission).

### 6.1 Scenario 1, issuance (RATE auction)

1. Create the auction:
   - `POST /v1/bonds/{isin}/auctions` with `type=RATE`, `end`, `size`, and `maturityDuration`.
2. Distribute auction parameters to dealers:
   - `auctionId` and `auctionPubKey` from the response.
   - `bondAuction` address from the response (for signing and submission).
3. Dealers submit sealed bids on-chain using the CLIs (see §5).
4. Close and compute:
   - `POST /v1/auctions/{auctionId}/close`
   - Review `allocation.allocations`, `allocation.clearingRate`, and `allocation.allocationHash`.
5. Finalise (or reject):
   - `PUT /v1/auctions/{auctionId}/finalisation` with `allocationHash` and `approve=true` to submit the on-chain finalisation.
   - If the operator does not approve the computed outcome, set `approve=false` to record rejection (no on-chain transaction is sent).
6. Verify:
   - `GET /v1/auctions/{auctionId}` for on-chain status and allocations.
   - `GET /v1/bonds/{isin}` for bond summary.

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
   - Option A: let the API resolve holders, call `POST /v1/bonds/{isin}/coupon-payments` with `{}`.
   - Option B: call `GET /v1/bonds/{isin}/holders` and submit those addresses explicitly as `holders` in the request body.
2. Submit coupon payment:
   - `POST /v1/bonds/{isin}/coupon-payments`
3. Verify via:
   - `GET /v1/bonds/{isin}/history` for bond events.
   - `GET /v1/bonds/{isin}` for coupon counters and maturity estimate.

Redemption:

1. Determine holders as above.
2. Submit redemption:
   - `POST /v1/bonds/{isin}/redemptions`
3. Verify:
   - `GET /v1/bonds/{isin}` should progress to `status=redeemed` once total supply is observed as zero.

### 6.5 Scenario 3, secondary trading (note)

Scenario 3 trading is implemented on-chain (bond order book and settlement logic), but is not exposed through this OpenAPI service. If you need an HTTP interface for secondary trading, it should be designed as a separate work package (for example, an order placement API that wraps the on-chain `BondOrderBook` and enforces the correct authorisations and cash-token semantics).

## 7. Operational notes and troubleshooting

### 7.1 Sealing key persistence

The sealing public key used by bidders is returned from:

- `GET /v1/health` (`sealingPublicKey`)
- `POST /v1/bonds/{isin}/auctions` (`auctionPubKey`)

If the service generates a new sealing key on boot (because `AUCTION_OWNER_SEAL_PK` is unset), then bids encrypted to the previous public key cannot be unsealed by the restarted service. For stable environments, set `AUCTION_OWNER_SEAL_PK` explicitly.

### 7.2 Allocation approval safety

Finalisation requires `allocationHash` to match the cached computed allocation. This is an intentional operator safety check.

Typical 4xx errors:

- `400 end must be in the future`: the `end` timestamp is not valid.
- `400 maturityDuration is required for RATE`: missing field for `RATE`.
- `400 first auction for ISIN must be RATE`: you attempted `PRICE` or `BUYBACK` for an ISIN with no prior issuance.
- `409 no allocation result available`: you called finalisation before closing and computing an allocation.
- `400 allocationHash mismatch`: you attempted to finalise a different allocation than the one currently cached/computed.

### 7.3 Ingestion database behaviour

The service maintains an SQLite database (default `data/ingestion.sqlite`) which it writes to in-process. This is used for:

- `GET /v1/bonds/{isin}/holders`
- `GET /v1/bonds/{isin}/history`

If `DB_PATH` is unwritable, or ingestion cannot reach `RPC_URL`, these endpoints may return empty data or become stale, even if the on-chain contracts are operating correctly.

### 7.4 Cache behaviour

Auction bid sets and computed allocations are cached in memory. On restart, the service attempts to hydrate auctions from chain by reading:

- on-chain auction metadata and on-chain allocations (if already finalised),
- sealed bids from `BondManager.getSealedBids(isin)`,
- and recomputing unsealed bids and allocation results if it can unseal bids with the current sealing key.

If you need durable audit artefacts, use the on-chain allocations and the ingestion-backed history endpoints, rather than relying on in-memory state.
