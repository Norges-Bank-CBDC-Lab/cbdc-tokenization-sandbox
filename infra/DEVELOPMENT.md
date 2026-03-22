# Infra Development

This document captures maintainer-facing notes for the local infrastructure
layer: Kind, the local registry workflow, Besu, and the gateway.

## Lifecycle Commands

From `infra/`:

- start infra and create the Kind cluster if needed: `./infra.sh start`
- stop infra workloads but keep the cluster and cached images:
  `./infra.sh stop`
- delete the Kind cluster and cached images: `./infra.sh delete`
- start the local registry container: `./infra.sh registry-start`
- push pinned images into the local registry: `./infra.sh registry-sync`

If you want to preserve image caches across runs, prefer `stop` over `delete`.

## Local Registry Workflow

The sandbox uses a local registry for Kind to avoid image import drift and to
keep the startup path repeatable.

Current layout:

- host address: `localhost:5001`
- Kind-network address: `kind-registry:5000`
- registry image: `registry:2`

Important behavior:

- `./infra.sh registry-start` creates or reuses the persistent registry
  container;
- `./infra.sh registry-sync` pushes the image versions referenced by the
  sandbox;
- shared base image pins live in `common/images.yaml`;
- Blockscout backend and frontend image pins live in
  `services/blockscout/values.yaml`;
- chart versions are pinned separately in `common/versions.yaml`;
- deleting the Kind cluster does not delete the registry container.

Mount behavior worth keeping explicit:

- `infra/cluster/cluster-config.yaml` mounts
  `infra/cluster/containerd-certs.d` into the Kind node;
- the mount path is relative to `infra/`, because the sandbox helper invokes
  `kind create cluster` from that directory.

If sandbox startup fails with missing digest or image-pull errors, run
`registry-start` and `registry-sync` before retrying.

## Validate Besu Connectivity

To confirm that the local Besu JSON-RPC endpoint is reachable:

```console
curl -X POST \
  --data '{"jsonrpc":"2.0","id":"1","method":"eth_blockNumber","params":[]}' \
  http://besu.cbdc-sandbox.local:8545/ \
  -H "Content-Type: application/json"
```

## Current Besu Baseline

The currently supported local Besu baseline is:

- Clique proof-of-authority consensus
- `londonBlock: 0` in `infra/besu/config/genesis.json`
- `zeroBaseFee: true` in the genesis config
- `evm_version = "london"` in `contracts/foundry.toml`

Treat this as the known-good local baseline before experimenting with QBFT or
later EVM milestones.

## GlobalRegistry Predeploy

`GlobalRegistry` is predeployed in the Besu genesis `alloc` so its address
stays stable across local runs.

Current references:

- local config value: `REGISTRY_ADDR` in `contracts/.env.example`, copied into
  `contracts/.env` for local use
- current address: `0x700b6A60ce7EaaEA56F065753d8dcB9653dbAD35`
- current owner: `PK_NORGES_BANK` address
  (`0xf4E18004902a34499bB6E5b23ff4CD99a864Dcd0`)
- current clique signer: `BESU_SIGNER_KEY` address
  (`0xc777bfE2C2398BEB62CD6897F913F1b64eE57EA6`)
- genesis source: `infra/besu/config/genesis.json`

If you change the registry bytecode or owner, update both the genesis `alloc`
entry, the clique signer in `extraData`, and the local contracts config so the
addresses stay in sync.

## Contract Deployment Caveats

Raw Foundry deploy commands against the local Besu node can require explicit
gas parameters even though the sandbox runs with zero base fee.

The deploy helper scripts already account for this in `contracts/deploy.sh`,
but if you run `forge create` manually, use the working local pattern:

```console
forge create \
  --rpc-url besu-local \
  --private-key <private-key> \
  src/norges-bank/Wnok.sol:Wnok \
  --broadcast \
  --gas-price 0 \
  --priority-gas-price 0 \
  --gas-limit "0x1ffffffffffffe" \
  --constructor-args <account-address>
```

Common failure modes:

- `Upfront cost exceeds account balance`
  - the selected account does not have enough funds, or the gas parameters were
    not forced onto the zero-fee local path
- `Invalid opcode: 0x5f`
  - the chain or compiler configuration is mismatched with the active EVM
    milestone
- `Failed to estimate EIP1559 fees`
  - Besu and Foundry are not aligned on the fee model implied by the current
    genesis configuration

Recommendation:

- prefer the repository deploy scripts unless you are debugging the underlying
  Besu or Foundry interaction;
- if you run manual deploy commands, keep them aligned with the zero-fee local
  baseline above.

## When Revisiting The Chain Baseline

The long-form debugging history that led to the current configuration has been
trimmed from this document. The important takeaways are:

- later milestone experiments produced unstable local behavior in this sandbox;
- alternative consensus settings need to be revalidated together with contract
  deployment, fee estimation, and Blockscout behavior;
- the stable local combination for this repo is still Clique plus the London
  EVM baseline and the explicit zero-gas-price deploy path.

If you revisit those decisions, re-test the full local workflow before
assuming previous workarounds still apply.

## Security

In the current sandbox setup, the following Besu endpoints are exposed without
authentication for local development:

- `http://besu.cbdc-sandbox.local:8545/`
- `ws://besu.cbdc-sandbox.local:8546/`

Treat the infra layer as local-only. Do not expose it outside a trusted local
development environment.
