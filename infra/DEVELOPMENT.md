# Infra Development

This document captures maintainer-facing notes for the local infrastructure
layer: Kind, the local registry workflow, Besu, and the gateway.

## Lifecycle Commands

From `infra/`:

- start infra and create the Kind cluster if needed: `./infra.sh start`
- stop infra workloads but keep the cluster and cached images:
  `./infra.sh stop`
- delete the Kind cluster while retaining the separate local-registry
  container and its cached images: `./infra.sh delete`
- start the local registry container: `./infra.sh registry-start`
- push pinned images into the local registry: `./infra.sh registry-sync`

If you want to preserve the Kind node's own image cache, prefer `stop` over
`delete`. The separate local-registry cache survives either command.

## Local Registry Workflow

The sandbox uses a local registry for Kind to avoid image import drift and to
keep the startup path repeatable.

Current layout:

- host address: `localhost:5001`
- Kind-network address: `kind-registry:5000`
- registry image: pinned in `common/images.yaml`

Important behavior:

- `./infra.sh registry-start` creates or reuses the persistent registry
  container;
- `./infra.sh registry-sync` pushes the image versions referenced by the
  sandbox;
- sandbox deploy/build image pins live in `common/images.yaml`, including
  Blockscout backend/frontend and shared base images;
- chart versions are pinned separately in `common/versions.yaml`;
- deleting the Kind cluster does not delete the registry container.

Mount behavior worth keeping explicit:

- `infra/cluster/cluster-config.yaml` mounts
  `infra/cluster/containerd-certs.d` into the Kind node;
- the mount path is relative to `infra/`, because the sandbox helper invokes
  `kind create cluster` from that directory.

If sandbox startup fails with missing digest or image-pull errors, run
`registry-start`, populate missing Blockscout source-built images with
`./sandbox.sh build-images`, and then run `registry-sync` before retrying.

Offline builds and `FORCE_IMAGE_PULL`:

- When a locally-built service (nb-ui, nb-bond-api, bens-microservice) needs a
  Dockerfile base image (e.g. `node:26.5.0`) that isn't in the host Docker
  cache, the build reuses the copy already in the local registry and retags it
  to the upstream ref — it does **not** pull from the internet. The Dockerfile
  `FROM` stays an upstream ref, so built images keep a portable lineage.
- `FORCE_IMAGE_PULL=true` forces base and third-party images to be re-pulled
  from upstream (requires network), bypassing the registry/local cache; the run
  prints a warning when it does so. This affects only the base/third-party
  image load path — it does **not** rebuild the repo-owned content-hash images
  (nb-ui, nb-bond-api, bens-microservice), which rebuild only when their source
  changes.

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

- Besu 26.7.0 with QBFT consensus
- one validator using Bonsai and one non-validator archive/RPC node using
  `FULL` sync with Forest storage
- 1-second transaction blocks and a 300-second idle empty-block period
- London, Shanghai, Cancun, Prague, and Osaka active from genesis
- `zeroBaseFee: true` in the genesis config
- `evm_version = "osaka"` and Solidity 0.8.36 in `contracts/foundry.toml`
- sequenced transaction pools on both nodes for unfunded zero-fee accounts

The sole validator is not Byzantine fault tolerant. Applications and Blockscout
must use `besu-archive.besu:8545`; `besu-validator` is operator-only.
The public local hostname `besu.cbdc-sandbox.local:8545` also routes to the
archive/RPC service, never to the validator.

The five-minute idle period deliberately trades a latest-block timestamp that
can lag wall clock by up to roughly five minutes for substantially less empty
history. A pending transaction returns block production to the one-second
period and its mined block advances chain time. Code deciding whether a
time-gated contract action is currently valid must still use the latest chain
timestamp rather than `Date.now()`.

## GlobalRegistry Predeploy

`GlobalRegistry` is predeployed in the Besu genesis `alloc` so its address
stays stable across local runs.

Current references:

- local config value: `REGISTRY_ADDR` in `contracts/.env.example`, copied into
  `contracts/.env` for local use
- current address: `0x700b6A60ce7EaaEA56F065753d8dcB9653dbAD35`
- current owner: `PK_NORGES_BANK` address
  (`0xf4E18004902a34499bB6E5b23ff4CD99a864Dcd0`)
- current QBFT validator: `BESU_SIGNER_KEY` address
  (`0xc777bfE2C2398BEB62CD6897F913F1b64eE57EA6`)
- archive node identity: `BESU_ARCHIVE_KEY` (not a validator or transaction
  signing account)
- genesis source: `infra/besu/config/genesis.json`

If you change the registry bytecode or owner, update both the genesis `alloc`
entry, the QBFT validator in `extraData`, and the local contracts config so the
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
  --gas-limit 10000000 \
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

## Chain Replacement And Node Operations

The Clique-to-QBFT transition was a clean-chain replacement. A working copy
that still has the legacy `besu-pvc` must run `./sandbox.sh delete` before its
first upgraded start; the deploy helper rejects that PVC rather than attempting
to reuse incompatible chain data.

The archive and validator have separate PVCs and keys. Stopping the archive
must not stop block production; stopping the only validator stops new blocks
while archive history remains readable. Do not create additional replicas with
the same validator key. A beacon client is not used with QBFT.

Osaka limits an individual transaction to 16,777,216 gas even though the local
block gas limit is 60,000,000.

## Security

In the current sandbox setup, the Besu JSON-RPC HTTP endpoint is exposed
without authentication for local development:

- `http://besu.cbdc-sandbox.local:8545/`

Treat the infra layer as local-only. Do not expose it outside a trusted local
development environment.

Besu WebSocket (`ws://...:8546`) is not currently routed through the
gateway: `infra/gateway/templates/gateway.yaml` defines no listener for
port 8546, and the NodePort exposed by `infra/gateway/templates/nodeport-config.yaml`
on host port 8546 maps to a gateway pod port the nginx-gateway pod does
not bind. If WebSocket access is needed, either add a Gateway listener +
HTTPRoute pair for port 8546, or use `kubectl port-forward` against the
Besu service directly.
