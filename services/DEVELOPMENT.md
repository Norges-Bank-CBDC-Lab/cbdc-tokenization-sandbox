# Services Development

This document captures service-specific operational notes for the local
sandbox. It assumes the infrastructure layer is already running. For the full
sandbox workflow, start from the repository root with `./sandbox.sh start`.

## Root-Level Lifecycle

From the repository root:

- start the full sandbox: `./sandbox.sh start`
- stop services but keep the Kind cluster and image cache:
  `./sandbox.sh stop`
- delete the Kind cluster while retaining the separate local-registry
  container and its cached images: `./sandbox.sh delete`

Use service-specific scripts only when you are working on one area in
isolation and the infra layer is already available.

## Blockscout

Blockscout is the local explorer stack used for chain inspection and optional
contract verification.

Manual lifecycle from the repository root:

```console
cd services/blockscout
./blockscout.sh start
./blockscout.sh stop
```

Primary URLs:

- <http://blockscout.cbdc-sandbox.local/>
- <http://blockscout.cbdc-sandbox.local/api>

### Blockscout values files

The Blockscout values files in this folder are sandbox-only configuration and
must not be treated as production defaults:

- `values.yaml`: base chart overrides and local runtime sizing
- `values.local.yaml`: local route and database values
- `values.backend.env.yaml`: backend env overrides and local indexer tuning
- `values.frontend.env.yaml`: frontend env overrides for the local hostnames

Current local behavior:

- the stack is tuned conservatively for local use;
- backend/frontend source tags are pinned in `common/images.yaml`, but their
  release images are no longer published upstream;
- several heavier indexer paths are reduced or disabled in
  `values.backend.env.yaml`;
- migrations run as part of the local chart path and still assume a local-only
  Postgres-backed deployment.

Required backend/frontend build on a fresh registry:

- `./sandbox.sh build-images` or `services/blockscout/build-images.sh` clones
  the upstream Blockscout and Blockscout frontend repositories at the pinned
  tags, builds local images, and pushes them into the Kind registry;
- run it once on a fresh machine or after `./sandbox.sh registry-reset`, before
  starting Blockscout. Subsequent starts reuse the local registry images.

### Blockscout Name Service

The optional BENS microservice provides name-resolution support for Blockscout.

Manual lifecycle from the repository root:

```console
cd services/blockscout/bens-microservice
./bens-microservice.sh start
```

URL:

- <http://blockscout.cbdc-sandbox.local/name-domains?only_active=true>

OpenAPI generation is manual. If you change
`services/blockscout/bens-microservice/swagger/bens.swagger.yaml`, regenerate
the server explicitly:

```console
cd services/blockscout/bens-microservice
./regen-openapi.sh
```

Current local caveat:

- OpenAPI Generator currently emits `ProtobufAny(object)` in
  `protobuf_any.py`; after regeneration this still needs to be changed to
  `ProtobufAny(BaseModel)` before using the generated server.

## NB Bond API

The NB Bond API is the privileged operator service that drives the on-chain
bond lifecycle on behalf of the issuer.

See:

- `services/nb-bond-api/README.md` for service-specific usage and environment
  variables
- `services/nb-bond-api/DEVELOPMENT.md` for API-focused runbooks

Manual lifecycle from the repository root:

```console
node scripts/generate-local-sandbox-fixtures.mjs
cd services/nb-bond-api
./nb-bond-api.sh start
```

The local Helm values file is intentionally untracked. The start script fails
fast if the local file cannot be generated and points back to the generator and
example file.

## Security Posture

These services are exposed without production-style access controls in the
local sandbox. In particular:

- <http://blockscout.cbdc-sandbox.local/>
- <http://blockscout.cbdc-sandbox.local/api>
- <http://blockscout.cbdc-sandbox.local/socket>
- <http://bond-api.cbdc-sandbox.local/>

Treat the entire service layer as trusted-local only. Do not expose it outside
local development, and do not reuse local sandbox credentials or example
values in any other environment.

## Local Registry And Images

Service deploys assume the local Kind registry workflow is available.

From the repository root:

```console
./infra/infra.sh registry-start
./infra/infra.sh registry-sync
```

Sandbox deploy/build image pins are centralized in `common/images.yaml`.
The shared Node.js toolchain pin is centralized in `common/node-version.env`.
Chart versions are pinned in `common/versions.yaml`.

## Formatting And Linting

### TypeScript

The NB Bond API uses ESLint and Prettier for TypeScript formatting and linting.
From the repository root:

```console
cd services/nb-bond-api
npm run lint
npm run format:check
```

These checks also run in GitHub Actions on pull requests that touch the API.
