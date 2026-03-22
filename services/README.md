# Services

This folder contains the in-cluster services that sit on top of the local
infrastructure and deployed contracts.

## Services In This Repo

- `blockscout/`: explorer stack with Postgres and optional BENS name service
- `nb-bond-api/`: privileged operator API for the bond lifecycle
- `script-runner/`: JupyterHub-based notebook environment

## Start Here

- Use the root workflow when you want the full sandbox:
  `./sandbox.sh start`
- Use service-specific scripts only when you are working on one area in
  isolation and the infra layer is already running.

## Common Entrypoints

From the repository root:

```console
cd services/blockscout && ./blockscout.sh start
cp services/nb-bond-api/helm/values.local.example.yaml services/nb-bond-api/helm/values.local.yaml
cd services/nb-bond-api && ./nb-bond-api.sh start
```

For `script-runner`, prefer the root sandbox workflow unless you are already
working in that area specifically.

## Local-Only Notes

### Blockscout

Blockscout is configured conservatively for local use. The values files under
`services/blockscout/` are sandbox-only defaults and are not production or
internet-facing deployment templates.

The default sandbox path uses published GHCR Blockscout images pinned in
`services/blockscout/values.yaml`. The local source-build helper
`services/blockscout/build-images.sh` is optional and intended only for
deliberate local debugging of upstream Blockscout changes.
### NB Bond API

The service controls issuer-side workflows, unseals bids, computes allocations
off-chain, and finalises auctions on-chain. Its local Helm values file is
intentionally untracked and must be created from the example file.

### Script Runner

The hosted notebook environment is optional. Some notebook flows assume
Blockscout is running and contracts have already been verified.

## Read Next

- [DEVELOPMENT.md](DEVELOPMENT.md) for detailed service operations
- [nb-bond-api/README.md](nb-bond-api/README.md) for the operator API
- [blockscout/debugging.md](blockscout/debugging.md) for explorer diagnostics
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the services fit
  into the sandbox
- [../docs/KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md) for active sandbox
  limitations
