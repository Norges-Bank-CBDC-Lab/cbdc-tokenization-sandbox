# Infra

This folder contains the local infrastructure layer for the sandbox:

- Kind cluster bootstrap and registry wiring
- Hyperledger Besu deployment and genesis config
- NGINX gateway resources and local routing

Everything here is tuned for a trusted local sandbox. It is not intended as a
production deployment baseline.

## Start Here

- Use the root workflow when you want the full sandbox:
  `./sandbox.sh start`
- Use `infra/` directly when you are working only on the infra layer:
  `cd infra`
  `./infra.sh start`

## Common Commands

From `infra/`:

```console
./infra.sh start
./infra.sh stop
./infra.sh delete
./infra.sh registry-start
./infra.sh registry-sync
```

`registry-start` creates or reuses the persistent local registry container, and
`registry-sync` pushes the sandbox's pinned images into that registry for Kind
to pull. Shared base images are pinned in `common/images.yaml`, while
Blockscout backend and frontend images are pinned in
`services/blockscout/values.yaml`.

## Current Sandbox Baseline

The currently documented local baseline is:

- single-node Kind cluster
- single-node Besu deployment
- Clique proof-of-authority consensus
- London EVM milestone
- `zeroBaseFee: true` in the Besu genesis
- predeployed `GlobalRegistry` at a stable local address

These settings are deliberate. They reflect the currently validated local path,
not the desired long-term production architecture.

## Registry And Cluster Wiring

The local registry is exposed as:

- `localhost:5001` on the host
- `kind-registry:5000` inside the Kind network

The registry mapping is implemented through the tracked
`infra/cluster/containerd-certs.d/localhost:5001/hosts.toml` mount.

Important nuance:

- the `hostPath` in `infra/cluster/cluster-config.yaml` is resolved from the
  `infra/` directory, because the sandbox helper invokes `kind` from there;
- that means the mount points at `infra/cluster/containerd-certs.d`, not a
  repo-root `cluster/` folder.

## What Lives Here

- `cluster/`: Kind cluster definition and registry mount wiring
- `besu/`: Helm chart and config for the local Besu node
- `gateway/`: Helm chart for the HTTP gateway and routing
- `infra.sh`: infra entrypoint used by the root sandbox workflow

## Read Next

- [DEVELOPMENT.md](DEVELOPMENT.md) for detailed registry behavior, Besu caveats,
  and manual deployment notes
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how infra fits into the
  sandbox as a whole
- [../docs/KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md) for current sandbox
  limitations around the chain baseline
