## Services Agent Guide

Inherits the root `AGENTS.md`. This file adds service-specific guidance.

### Structure
- `services/blockscout/`: Blockscout explorer stack (backend + frontend).
- `services/nb-bond-api/`: Express.js API that drives the on-chain bond lifecycle.
- `services/DEVELOPMENT.md`: detailed run instructions and tooling notes.

### Commands (per service)
- `services/blockscout/`:
  - Start: `./blockscout.sh start`
  - Stop: `./blockscout.sh stop`
  - Name service: `cd services/blockscout/bens-microservice && ./bens-microservice.sh start`
  - BENS OpenAPI regen: `cd services/blockscout/bens-microservice && ./regen-openapi.sh`
  - Backend/frontend source tags: pinned in `common/images.yaml`; current
    release images must be built locally because upstream does not publish them
  - Required on a fresh registry: `cd services/blockscout && ./build-images.sh`
  - URLs: `http://blockscout.cbdc-sandbox.local/`
- `services/nb-bond-api/`:
  - Start: `./nb-bond-api.sh start`
  - Local Helm values: generate `services/nb-bond-api/helm/values.local.yaml` with `node scripts/generate-local-sandbox-fixtures.mjs` before direct deploys if the start script has not already created it
  - Lint: `npm run lint`
  - Format check: `npm run format:check`
  - URL: `http://bond-api.cbdc-sandbox.local/`

### How to run
- Follow `services/DEVELOPMENT.md` and each service README.
- Most services expect infra running (see `infra/DEVELOPMENT.md`).

### Style and conventions (services)
- Respect language-specific formatters and linters (ESLint/Prettier for TS).
- nb-bond-api SQLite projection-purity rule: projection tables are dropped and rebuilt from chain on every resync/schema bump — never store locally-generated rows in them. Anything the chain cannot reproduce belongs in the preserved system-of-record tables (`bidders`, `banks`, `operation_attempts`). See `services/nb-bond-api/README.md` "Projection-purity rule".
- Keep config changes explicit and documented.
- Avoid committing secrets; use local env or configmaps as documented.
- Treat the values files under `services/blockscout/` as sandbox-only. Do not present them as production deployment templates.
- Keep Blockscout source tags pinned. Because current backend/frontend release
  images are not published upstream, use `build-images.sh` to populate a fresh
  local registry; do not replace the pins with rolling upstream tags.

### Flag documentation (services)
- For service scripts that define environment flags (e.g., `DEPLOY_*`), keep a banner comment block directly above the exports.
- If the banner is missing, create it; if it exists, add/update the flag entry.
- Each banner line must describe what the flag does when set to `true` and when set to `false`.
