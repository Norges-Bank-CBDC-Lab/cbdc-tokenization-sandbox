# CBDC Sandbox Monoledger Architecture

This repository is a local development sandbox for a CBDC-oriented monoledger
prototype. It combines:

- a local Kubernetes environment (Kind) running Hyperledger Besu, Blockscout,
  and supporting services
- Solidity contracts managed with Foundry
- off-chain services and CLIs that drive the bond lifecycle and interact with
  the chain

It is explicitly a sandbox. Defaults favor repeatable local development,
observability, and operator workflows over hardening or production isolation.

## Goals And Non-Goals

Goals:

- provide a repeatable local environment for deploying contracts and exercising
  end-to-end workflows
- make the bond lifecycle operable through a privileged operator API and
  reference CLIs for bidder-side flows
- keep image and chart versions explicit for consistent local deployments
- prefer simplicity and debuggability over optimization

Non-goals:

- production-grade security posture, including full authentication,
  authorization, network isolation, and secret management
- highly available or multi-node chain configuration
- fully automated OpenAPI generation for every generated component
- performance benchmarking or production tuning

## Repository Layout

- `infra/`: Kind bootstrap, Besu, gateway, and shared deployment plumbing
- `services/`: in-cluster applications such as Blockscout, NB Bond API, and
  script runner
- `contracts/`: Solidity contracts, Foundry configuration, and deploy/verify
  helpers
- `scripts/`: reference CLIs and repository verification utilities
- `common/images.yaml`: shared base image versions for local deployments
- `common/versions.yaml`: pinned chart versions for local deployments
- `services/blockscout/values.yaml`: Blockscout backend/frontend image pins and
  local chart overrides
- `docs/`: architecture notes, diagrams, known issues, and reports

## Runtime Architecture

At runtime, `./sandbox.sh start` orchestrates the local sandbox in roughly this
order:

1. **Infra (`infra/infra.sh`)**
   - creates or reuses the Kind cluster (`cluster-cbdc-monoledger`)
   - deploys the gateway layer and routing resources
   - deploys the Besu node and JSON-RPC/WS endpoints
2. **Explorer (`services/blockscout`)**
   - deploys Blockscout with local, sandbox-oriented values
   - deploys the Postgres dependency
   - optionally deploys the BENS name service microservice
3. **Contracts (`contracts/contracts.sh`)**
   - deploys the core contracts to Besu
   - optionally verifies them in Blockscout
4. **Operator API (`services/nb-bond-api`)**
   - deploys the privileged service that drives issuer-side workflows and
     off-chain auction computation
5. **Script runner (`services/script-runner`, optional)**
   - deploys the JupyterHub-based notebook environment for interactive sandbox
     use

Ingress and routing are hostname-based through `*.cbdc-sandbox.local` host
entries:

- `besu.cbdc-sandbox.local` for JSON-RPC and WS
- `blockscout.cbdc-sandbox.local` for the explorer
- `bond-api.cbdc-sandbox.local` for the NB Bond API
- `jupyterhub.cbdc-sandbox.local` for the script runner

### Component Diagram

```text
                   (host / browser / curl)
                            |
                            |  *.cbdc-sandbox.local
                            v
                    [NGINX Gateway API]
                      |     |      |
                      |     |      +--> [NB Bond API] ----+
                      |     |                             |
                      |     +--> [Blockscout] ----+       | JSON-RPC
                      |                           |       v
                      +--> [Besu JSON-RPC/WS] <---+   [Besu node]
                            |
                            +--> [Deployed Solidity contracts]

  (optional) [JupyterHub script runner] -> calls Blockscout / Besu / NB Bond API
  (optional) [scripts/* CLIs] ----------> submit on-chain bids via Besu JSON-RPC
```

## Current Local Chain Baseline

The currently documented local chain baseline is:

- single-node Besu deployment on Kind
- Clique proof-of-authority consensus
- London EVM milestone
- `zeroBaseFee: true` in the genesis config
- predeployed `GlobalRegistry` address baked into the local genesis

This is the repo's current known-good baseline. It is not meant to imply that
Clique and London are the long-term target architecture. Planned movement to a
newer milestone and QBFT is tracked separately in `docs/KNOWN_ISSUES.md`.

## On-Chain Architecture

The contracts live under `contracts/` and are developed and deployed with
Foundry. Key components include:

- `GlobalRegistry` (`contracts/src/common/GlobalRegistry.sol`)
  - name-to-address registry for important contracts
  - predeployed in the Besu genesis so its address stays stable in the local
    sandbox
- bond lifecycle contracts under `contracts/src/norges-bank/`
  - `BondManager`: issuer-controlled entrypoint for creating bonds and auctions
    and for finalising auctions with DvP settlement
  - `BondAuction`: sealed-bid auction contract that accepts encrypted bids and
    publishes allocations during finalisation
  - `BondToken`: partitioned bond token keyed by ISIN
  - `BondDvP`: settlement component that coordinates the cash leg against the
    bond leg
- cash-side token
  - `Wnok` (`contracts/src/norges-bank/Wnok.sol`): mock cash token used for
    local settlement flows

Simplified trust model:

- the issuer or operator role (Norges Bank in the sandbox) controls
  `BondManager` operations
- dealers or bidders submit sealed bids directly to `BondAuction`
- bid unsealing and uniform-price allocation computation happen off-chain in
  the operator service

## Off-Chain Architecture

### NB Bond API (`services/nb-bond-api`)

The NB Bond API is the privileged operator service. It:

- holds the issuer-side private key used to send privileged transactions to
  `BondManager`
- owns or generates the auction sealing keypair used to unseal bids
- computes auction allocations off-chain and finalises auctions on-chain using
  bidder proofs
- maintains a local SQLite database for ingestion and operational views such as
  holders and history

Operational caveat:

- because bid unsealing is off-chain, the sealing private key must be treated
  as a secret
- if the service generates a new key on every boot, auctions cannot span
  restarts unless bidders used the current key

### Blockscout (`services/blockscout`)

Blockscout provides chain exploration and optional contract verification. In
this sandbox it is configured conservatively for local use:

- Postgres-backed local deployment
- sandbox-only values files and hostnames
- several heavier indexer paths reduced or disabled to keep local behavior more
  predictable
- optional BENS microservice for name resolution

### Script Runner (`services/script-runner`)

The script runner is a JupyterHub-based notebook environment used as an
interactive UI and workflow runner. It typically assumes:

- contracts are already deployed
- Blockscout is available for exploration and, in some notebook flows,
  contract verification
- Besu and NB Bond API are reachable through the gateway hostnames

### Dealer And Bidder CLIs (`scripts/`)

The repository also includes reference tools for client-side workflows:

- `scripts/bid-encryption`: creates sealed bid payloads and related hashes or
  proofs that are compatible with on-chain submission
- `scripts/bid-submitter`: submits sealed bids to `BondAuction` via JSON-RPC

These CLIs are reference implementations for the sandbox, not production
tooling.

## Key Workflows

### 1. Start the sandbox

Primary entrypoint:

- `./sandbox.sh start`

Recommended prerequisite on Kind, especially on Docker Desktop:

- `./infra/infra.sh registry-start`
- `./infra/infra.sh registry-sync`

### 2. Deploy and verify contracts

Contracts are deployed as part of `./sandbox.sh start` unless disabled, or
manually through the scripts under `contracts/`.

Verification is performed against Blockscout so explorers and notebooks can
decode transactions and logs by ABI.

### 3. Run a sealed-bid auction

At a high level:

1. The issuer creates an auction through the NB Bond API.
2. Dealers seal bids off-chain and submit them on-chain to `BondAuction`.
3. The issuer closes the auction through the NB Bond API.
4. The NB Bond API unseals bids, computes allocations off-chain, and returns
   an allocation hash for approval.
5. The issuer approves the result, and the NB Bond API finalises the auction
   on-chain through `BondManager`, including DvP settlement.

For concrete sequences, see:

- `docs/diagrams/processes/auction-sequence.md`
- `docs/diagrams/processes/coupon-redemption-sequence.md`

## Configuration And Versioning

- shared base image tags are pinned in `common/images.yaml`
- Blockscout backend/frontend image tags are pinned in `services/blockscout/values.yaml`
- chart versions are centralized in `common/versions.yaml`
- deploy toggles are generated into `.env.sandbox` by
  `./sandbox.sh generate-config` and consumed by `./sandbox.sh start`
- local-only example files for contract and service config live under
  `contracts/` and `services/nb-bond-api/helm/`

## Trust Boundaries And Security Notes

This sandbox intentionally exposes several endpoints without authentication for
local development, including:

- Besu JSON-RPC and WS
- Blockscout HTTP endpoints
- NB Bond API
- JupyterHub

Treat the entire environment as trusted-local only. Do not reuse keys,
credentials, or example values outside local development.

## Read Next

- `README.md` for local setup and sandbox lifecycle
- `infra/README.md` and `infra/DEVELOPMENT.md` for the infra baseline,
  registry behavior, and Besu caveats
- `services/README.md` and `services/DEVELOPMENT.md` for service-specific
  operational notes
- `contracts/README.md` for Foundry workflows
- `scripts/README.md` for bidder-side CLIs and repository verification tools
- `docs/KNOWN_ISSUES.md` for active sandbox limitations
- `docs/DOCUMENTATION_INDEX.md` for the docs most likely to need follow-up when
  behavior changes
