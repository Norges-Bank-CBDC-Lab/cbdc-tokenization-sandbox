# Third-Party Notes

This repository is licensed under Apache-2.0 unless a file-level SPDX
identifier or attribution note states otherwise.

For the current curated dependency and deployment-time license inventory, see
`../THIRD_PARTY_LICENSES.md`.

## File-level exceptions kept in-tree

The following tracked files are retained with upstream attribution or
provenance notes:

- `services/blockscout/bens-microservice/swagger/bens.swagger.yaml`
  Copied from the `blockscout/blockscout-rs` repository and retained under its
  upstream `MIT` notice.
- `services/script-runner/templates/NOTES.txt`
  Adapted from the JupyterHub Helm chart `templates/NOTES.txt`, whose upstream
  repository carries `BSD-3-Clause` and `Apache-2.0`.

## Generated code

The Blockscout BENS Python server under
`services/blockscout/bens-microservice/src/openapi_server/` is generated from
the local Swagger spec via OpenAPI Generator. The copied upstream notice is
preserved on the Swagger file itself, while the generated server code and local
metadata under `services/blockscout/bens-microservice/` are tracked as
repository code. See `services/blockscout/bens-microservice/README.md` for the
local provenance note.

The checked-in ABI artifacts under `services/nb-bond-api/src/abi/`,
`scripts/bid-submitter/src/abi/`, and `contracts/out/` are generated from the
Solidity sources and should be refreshed whenever SPDX identifiers or compiler
metadata change.

## Deployment-time third-party software

This source repository does not relicense software that is only referenced or
pulled at build/deploy time. Current examples include:

- Hyperledger Besu
- NGINX Gateway Fabric
- JupyterHub / Jupyter Docker Stacks
- Blockscout charts and images
- BusyBox image references in Helm templates

> ### Warning
> **Users deploying the sandbox are responsible for complying with the
> upstream licenses of those external components.**

## Notable Caveats

- `caniuse-lite` appears as a transitive dev dependency in
  `services/nb-bond-api/package-lock.json` and is labeled `CC-BY-4.0` in npm
  metadata.
- Third-party deployment-time software keeps its upstream license terms even
  when this repository is Apache-2.0.
