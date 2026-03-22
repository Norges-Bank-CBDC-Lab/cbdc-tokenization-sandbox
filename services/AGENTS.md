## Services Agent Guide

Inherits the root `AGENTS.md`. This file adds service-specific guidance.

### Structure
- `services/blockscout/`: Blockscout explorer stack (backend + frontend).
- `services/script-runner/`: JupyterHub-based notebook environment.
- `services/nb-bond-api/`: Express.js API that drives the on-chain bond lifecycle.
- `services/DEVELOPMENT.md`: detailed run instructions and tooling notes.

### Commands (per service)
- `services/blockscout/`:
  - Start: `./blockscout.sh start`
  - Stop: `./blockscout.sh stop`
  - Name service: `cd services/blockscout/bens-microservice && ./bens-microservice.sh start`
  - BENS OpenAPI regen: `cd services/blockscout/bens-microservice && ./regen-openapi.sh`
  - Default images: published GHCR images pinned in `services/blockscout/values.yaml`
  - Optional local override: `cd services/blockscout && ./build-images.sh`
  - URLs: `http://blockscout.cbdc-sandbox.local/`
- `services/script-runner/`:
  - Start/stop: see `services/script-runner/README.md` and `services/DEVELOPMENT.md`
  - URL: `http://jupyterhub.cbdc-sandbox.local/`
  - Notes: use `sync.sh` to persist changes to the repo.
- `services/nb-bond-api/`:
  - Start: `./nb-bond-api.sh start`
  - Local Helm values: copy `services/nb-bond-api/helm/values.local.example.yaml` to `services/nb-bond-api/helm/values.local.yaml` before direct deploys
  - Lint: `npm run lint`
  - Format check: `npm run format:check`
  - URL: `http://bond-api.cbdc-sandbox.local/`

### How to run
- Follow `services/DEVELOPMENT.md` and each service README.
- Most services expect infra running (see `infra/DEVELOPMENT.md`).

### Style and conventions (services)
- Respect language-specific formatters and linters (Black/Pylint for Python, ESLint/Prettier for TS).
- Keep config changes explicit and documented.
- Avoid committing secrets; use local env or configmaps as documented.
- Treat the values files under `services/blockscout/` as sandbox-only. Do not present them as production deployment templates.
- Keep Blockscout on published pinned images by default. Use `build-images.sh` only when intentionally testing upstream source changes locally.

### Flag documentation (services)
- For service scripts that define environment flags (e.g., `USE_KIND_REGISTRY`), keep a banner comment block directly above the exports.
- If the banner is missing, create it; if it exists, add/update the flag entry.
- Each banner line must describe what the flag does when set to `true` and when set to `false`.
