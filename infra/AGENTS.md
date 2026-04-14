## Infra Agent Guide

Inherits the root `AGENTS.md`. This file covers infra-specific structure and style.

### Structure
- `infra/infra.sh`: entrypoint to start/stop/delete the local cluster and deploy charts.
- `infra/cluster/cluster-config.yaml`: Kind cluster definition + port mappings.
- `infra/besu/`: Helm chart + config for a Besu node.
  - `infra/besu/config/`: Besu config + genesis files.
- `infra/gateway/`: Helm chart for the nginx API gateway.
- `infra/DEVELOPMENT.md`: operational notes and caveats (EVM version, Besu quirks).

### How to run
- Start: `./infra/infra.sh start`
- Stop: `./infra/infra.sh stop` (keeps cluster and image cache)
- Delete: `./infra/infra.sh delete` (full teardown)
- Most commands assume you run them from `infra/`.

### Commands (detail)
- Kind cluster config: `infra/cluster/cluster-config.yaml`
- Registry workflow:
  - Start: `./infra.sh registry-start`
  - Sync: `./infra.sh registry-sync`
  - Shared base image pins: `common/images.yaml`
  - Blockscout backend/frontend pins: `services/blockscout/values.yaml`
- Besu chart:
  - Chart: `infra/besu/Chart.yaml`
  - Default values: `infra/besu/values.yaml`
  - Local overrides: `infra/besu/values.local.yaml`
  - Templates: `infra/besu/templates/`
  - Config: `infra/besu/config/config.toml`
  - Genesis: `infra/besu/config/genesis.json`
- Gateway chart:
  - Chart: `infra/gateway/Chart.yaml`
  - Values: `infra/gateway/values.local.yaml`
  - Templates: `infra/gateway/templates/`

### Style and conventions (infra)
- Keep YAML and Helm templates readable; avoid clever templating unless needed.
- Prefer explicit values over deeply nested includes.
- Match the existing indentation and key ordering.
- Keep values in `values.local.yaml` local-only; avoid committing secrets.

### Safety checklist (infra)
- Validate Kind cluster config after changes (port mappings, mounts).
- Keep Besu RPC/WS endpoints restricted to local dev.
- Ensure Helm templates remain deterministic and renderable.
- If you change image pins or registry behavior, update the relevant docs in `README.md`, `infra/README.md`, and `infra/DEVELOPMENT.md`.
