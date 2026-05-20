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
- Docker Distribution Registry
- Node.js runtime images
- Python runtime images
- PostgreSQL images
- JupyterHub / Jupyter Docker Stacks
- Blockscout charts and images
- BusyBox image references in Helm templates
- `nginxinc/nginx-unprivileged` (BSD-2-Clause), used as the runtime stage
  of the `services/nb-ui/Dockerfile` multi-stage build (and pinned in
  `common/images.yaml` under `nb_ui.nginx`).
- `node` (MIT), used as the builder stage of `services/nb-ui/Dockerfile`
  and as the builder + runtime stages of `services/nb-bond-api/Dockerfile`
  (pinned in `common/node-version.env`).
- `python` (PSF-2.0), used as the builder + runtime stages of
  `services/blockscout/bens-microservice/Dockerfile` (pinned in
  `common/images.yaml` under `blockscout.bens`). The pinned wheels
  (FastAPI, Uvicorn, asyncpg, Pydantic, typing-extensions) are listed
  with their license under "Direct Python Dependencies →
  `services/blockscout/bens-microservice`" in `THIRD_PARTY_LICENSES.md`.

> ### Warning
> **Users deploying the sandbox are responsible for complying with the
> upstream licenses of those external components.**

## Notable Caveats

- `caniuse-lite` appears as a transitive dev dependency in
  `services/nb-bond-api/package-lock.json` and `services/nb-ui/package-lock.json`
  and is labeled `CC-BY-4.0` in npm metadata.
- `lightningcss` appears as a transitive dev/build dependency in
  `services/nb-ui/package-lock.json` after the Vite 8 toolchain upgrade and is
  labeled `MPL-2.0` in npm metadata. Its platform-specific optional packages
  carry the same license.
- Third-party deployment-time software keeps its upstream license terms even
  when this repository is Apache-2.0.
