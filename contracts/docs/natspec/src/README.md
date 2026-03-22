# Contracts

This folder contains the Solidity contracts, Foundry configuration, deployment
helpers, verification helpers, and test suites for the sandbox.

## Current Status

As of March 12, 2026, this repository does not publish an external smart
contract audit or a formal security review statement in-tree for the contracts
in this folder. Treat this contract set as experimental and sandbox-oriented,
not production-ready.

## What Lives Here

- `src/`: production contracts
- `test/`: Foundry test suites
- `script/`: Foundry deployment/setup scripts
- `docs/`: contracts-specific deep documentation and design notes
- `contracts.sh`: full deployment and verification helper used by the sandbox
- `deploy.sh`: single-contract deployment helper
- `foundry.toml`: Foundry configuration
- `.env`: local contract deployment accounts and RPC configuration

## Foundry documentation:

- [Foundry Book](https://book.getfoundry.sh/)
- [Writing tests](https://book.getfoundry.sh/forge/writing-tests)
- [Running scripts with `forge script`](https://book.getfoundry.sh/reference/forge/forge-script)
- [Best practices](https://book.getfoundry.sh/guides/best-practices)

## Start Here

- Use the root workflow when you want the full sandbox:
  `./sandbox.sh start`
- Work from `contracts/` directly when infra and Besu are already running and
  you only want to build, test, deploy, or verify contracts.

Before running Foundry commands, install the contract dependencies:

```console
cd contracts
forge soldeer install
```

## Common Foundry Commands

From `contracts/`:

```console
forge build
forge test
forge fmt
forge doc --out docs/natspec
anvil
```

Use these when iterating locally:

- `forge build` builds the contracts.
- `forge test` runs the Foundry test suite.
- `forge fmt` formats Solidity sources.
- `forge doc --out docs/natspec` regenerates the NatSpec reference pages.
- `anvil` starts a local EVM node outside the sandbox.

Recent coverage additions include:

- invariant checks for `BondToken` partition supply, tracked holder balances,
  coupon configuration, and maturity state in
  `test/invariant/BondToken.invariant.t.sol`
- property-style tests for auction finalisation, issuance cash-leg failure,
  coupon distribution, and redemption flow in
  `test/norges-bank/BondAuction.t.sol` and
  `test/norges-bank/BondManager.t.sol`

## Deploy And Verify

The sandbox uses `contracts.sh` to deploy and verify the contract set against
the local Besu chain.

Deploy the full contract set:

```console
./contracts.sh start
```

Deploy and verify in Blockscout:

```console
./contracts.sh start --verify
```

Stop only the registry/configmap side of the contract deployment integration:

```console
./contracts.sh stop
```

Verify the latest full deployment:

```console
./contracts.sh verify-latest --watch
```

`verify-latest` does not inspect the chain generically. It verifies the latest
deployment records that already exist in this folder, by reading
`broadcast/*/<chain-id>/run-latest.json`, collecting `CREATE` transactions, and
matching each contract name to a source identifier in `contracts.sh`.

That means `verify-latest` expects:

- the contracts to have been compiled so the local Foundry artifacts and source
  metadata are present;
- the contracts to have been deployed already, typically via
  `./contracts.sh start` or a Foundry deployment script that wrote the
  corresponding `broadcast/.../run-latest.json` files;
- the contract type to be covered by the `resolveContractIdentifier()`
  mapping in `contracts.sh`.

If the current compiled artifacts or deployment records are missing or stale,
`verify-latest` will either fail or verify an older deployment set than you
intend.

Verify one deployed contract:

```console
./contracts.sh verify \
  --address <deployed-address> \
  --contract <path:ContractName> \
  --watch
```

For one-off deployments of a single contract, use `deploy.sh` or `forge create`
directly after loading `.env`.

## Reuse Guidance

| Contract area | Reuse fit | Notes |
| --- | --- | --- |
| `common/Errors.sol`, `common/Roles.sol`, `common/Allowlist*.sol` | Shared helpers | Small building blocks, but still shaped by this repo's role and allowlist conventions. |
| `norges-bank/BondToken.sol` | Reusable with adaptation | Best fit if you want a partitioned bond token and accept the repo's ERC1410-inspired lifecycle and role model. |
| `norges-bank/BondAuction.sol` | Reusable with adaptation | Works if your operating model accepts off-chain bid decryption, allocation calculation, and proof submission. |
| `csd/BaseSecurityToken.sol`, `csd/DvP.sol`, `csd/OrderBook.sol` | Reusable as a stack | These are tightly coupled through custodial transfer, bank-money settlement, and shared roles. |
| `norges-bank/BondManager.sol`, `norges-bank/BondDvP.sol`, `norges-bank/Wnok.sol`, `private-bank/Tbd.sol`, `common/GlobalRegistry.sol` | Repo-specific or sandbox-specific | These encode the current sandbox lifecycle, cash model, or test-environment assumptions and are not good drop-in components. |

## Standards And Repo-Specific Behavior

| Area | Standard-aligned basis | Repo-specific behavior to review |
| --- | --- | --- |
| `BondToken` | ERC1410-inspired partitioned security token model | ISIN partition lifecycle, coupon state, maturity handling, and controller roles are specific to this repo. |
| `Wnok` | ERC20 base plus one ERC1363-style callback helper | It is not a full IERC1363 implementation, and allowlist plus role-gated transfer behavior are custom. |
| `Tbd` | ERC20-style tokenized bank-money contract | `cctFrom`, `cctSetToAddr`, reserve-backed minting, and cross-bank flow assumptions are repo-specific. |
| `BondAuction` | EIP-712 signatures and a standard sealed-bid concept | Bid decryption and allocation calculation happen off-chain, and the finalisation model is specific to this project. |
| `BondDvP` and `csd/DvP` | DvP as a financial settlement concept | Settlement payloads, failure mapping, and contract-to-contract coupling are specific to this repo's runtime stack. |
| `BaseSecurityToken` | OpenZeppelin upgradeable ERC20 and AccessControl foundations | `custodialTransfer`, role conventions, and allowlist-driven transfer constraints are project-specific. |

## Read Next

- [AGENTS.md](../../../AGENTS.md) for repo-specific contract guidance used by AI coding
  agents
- [../docs/ARCHITECTURE.md](../../../../docs/ARCHITECTURE.md) for how the contracts fit
  into the sandbox
- [./docs/contracts-security.md](../../contracts-security.md) for the
  current trust model, role model, and security assumptions
- [./docs/contracts-reference.md](../../contracts-reference.md) for a
  curated reference to the main runtime contracts and lifecycle
- [./docs/natspec/README.md](../README.md) for the generated
  function-by-function NatSpec reference
- [./docs/bond-lifecycle-walkthrough.md](../../bond-lifecycle-walkthrough.md)
  for a minimal deploy -> bid -> finalise -> coupon -> redeem flow
- [./docs/contracts-versioning.md](../../contracts-versioning.md) for ABI and
  interface stability expectations
- [../docs/KNOWN_ISSUES.md](../../../../docs/KNOWN_ISSUES.md) for sandbox
  limitations that can affect local deployment or contract interaction
