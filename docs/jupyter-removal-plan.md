# Jupyter Removal Plan

## Purpose

This document captures a safe removal plan for the JupyterHub-based `script-runner`
service so the work can be resumed later without repeating the discovery phase.

## Current State Summary

The current Jupyter footprint is broader than one optional UI service.

- Runtime deployment:
  `services/script-runner/`, `sandbox.sh`, `common/helpers.sh`,
  `infra/gateway/templates/gateway.yaml`, `common/images.yaml`,
  `common/versions.yaml`.
- Notebook-hosted application code:
  `services/script-runner/notebook/scripts/`,
  `services/script-runner/notebook/notebooks/`.
- Contributor and CI workflow:
  `.github/workflows/pylint.yml`, `CONTRIBUTING.md`,
  `services/DEVELOPMENT.md`.
- Documentation and provenance:
  `README.md`, `services/README.md`, `docs/ARCHITECTURE.md`,
  `docs/THIRD_PARTY_NOTES.md`, `THIRD_PARTY_LICENSES.md`.

## Removal Difficulty

Overall difficulty: medium.

Reasons:

- The deployment is isolated enough that the service can be removed without
  breaking Besu, Blockscout, or NB Bond API directly.
- The current Jupyter codebase contains a non-trivial amount of business/demo
  logic: about 3.3k lines of Python plus multiple notebooks.
- One hidden coupling must be removed first:
  `common/helpers.sh` currently stores the contract registry configmap and the
  contracts deployment marker in the `jupyterhub` namespace.

## What Would Be Lost

- Hosted multi-user notebooks via JupyterHub.
- The current role-based notebook UI:
  onboarding, broker, issuer, commercial bank, and Norges Bank views.
- `raw.ipynb` as a direct Web3 scratchpad.
- `MarketMaker.ipynb` as an interactive market-maker runner.
- `sync.sh` for copying notebook changes between a spawned pod and the repo.
- Notebook-specific Python linting and formatting CI.

## Important Hidden Dependencies

### 1. Shared contract metadata lives in the `jupyterhub` namespace

Today these are tied together in `common/helpers.sh`:

- `REGISTRY_CONTRACT_NAMESPACE=jupyterhub`
- `CONTRACTS_DEPLOYMENT_NAMESPACE=$REGISTRY_CONTRACT_NAMESPACE`
- `SCRIPTRUNNER_NAMESPACE=jupyterhub`

This means the `jupyterhub` namespace is currently carrying two concerns:

- script-runner runtime resources
- shared contract registry/configmap state used by other components

That namespace must be decoupled before fully deleting Jupyter resources.

### 2. The notebook UI writes directly to Blockscout Postgres

The notebook code reads and writes the `mapping` table directly through
`DATABASE_URL`. This is used for bank and customer naming/address lookups.

This means a replacement UI should not simply reproduce the current pattern of
letting the frontend talk to Postgres directly.

### 3. The notebook UI signs transactions directly using injected private keys

The current notebook runtime loads `PK_*` values into the Python process and
signs transactions in-process. This is acceptable for a local sandbox, but it is
not the right long-term boundary for a proper web UI.

## Recommended End State

- Remove the hosted JupyterHub service completely.
- Replace product-facing flows with a dedicated web UI plus backend APIs.
- Keep any developer scratchpad tooling as local-only tools:
  CLI scripts, local notebooks, or a dev-only app started manually.

## Safe Order Of Operations

### Phase 0. Confirm the target scope

Decide whether the target is:

- stop deploying Jupyter only
- remove the service from the repo but keep local notebooks as a dev tool
- completely remove all notebooks, Python UI code, and related CI

Recommended target:

- remove the hosted JupyterHub service
- move shared configmaps out of the `jupyterhub` namespace
- keep only the tooling that is still useful for local development

### Phase 1. Decouple shared contract metadata from Jupyter

Do this first.

Tasks:

- Introduce a neutral namespace for shared contract metadata.
  Suggested names: `contracts` or `sandbox-system`.
- Move these helpers away from `jupyterhub`:
  `REGISTRY_CONTRACT_NAMESPACE`, `CONTRACTS_DEPLOYMENT_NAMESPACE`.
- Verify all readers/writers of the registry configmap and contracts deployment
  marker still resolve correctly:
  `contracts/contracts.sh`, `common/helpers.sh`, NB Bond API deployment logic.

Acceptance criteria:

- Contract deployment works with `DEPLOY_SCRIPTRUNNER=false`.
- NB Bond API still resolves the GlobalRegistry address.
- No shared runtime state depends on the `jupyterhub` namespace anymore.

### Phase 2. Remove runtime exposure and deployment plumbing

Tasks:

- Remove the `script-runner` start/stop path from `sandbox.sh`.
- Remove Jupyter-specific image and chart pins from:
  `common/images.yaml`, `common/versions.yaml`.
- Remove the Jupyter route from:
  `infra/gateway/templates/gateway.yaml`.
- Remove Jupyter host entry expectations from:
  `README.md` and `common/helpers.sh`.
- Remove script-runner deployment helpers from:
  `common/helpers.sh`.

Acceptance criteria:

- `./sandbox.sh start` does not mention or depend on script-runner.
- Gateway and host setup no longer expose `jupyterhub.cbdc-sandbox.local`.
- Registry image sync no longer pulls the Jupyter base image.

### Phase 3. Remove the service code

Tasks:

- Delete `services/script-runner/` after Phase 1 and Phase 2 are complete.
- Remove notebook-specific CI in `.github/workflows/pylint.yml`.
- Remove notebook-specific contributor instructions from `CONTRIBUTING.md`.

Acceptance criteria:

- No build, deploy, or CI path references `services/script-runner/`.
- The repo has no remaining runtime dependency on JupyterHub.

### Phase 4. Clean up docs and provenance

Tasks:

- Update:
  `README.md`, `services/README.md`, `services/DEVELOPMENT.md`,
  `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md` if needed.
- Remove or update Jupyter references from:
  `services/AGENTS.md`, `docs/THIRD_PARTY_NOTES.md`, `THIRD_PARTY_LICENSES.md`.
- Remove references to notebook formatting and linting.

Acceptance criteria:

- The documentation reflects the actual runtime.
- Third-party and license docs no longer list removed Jupyter components as
  active dependencies.

### Phase 5. Replace the functionality intentionally

This should be treated as a separate track, not an afterthought.

Tasks:

- Decide which current Jupyter capabilities must survive.
- Move privileged writes and signing to backend APIs.
- Replace direct Blockscout Postgres writes with a proper service boundary.
- Reuse Blockscout/BENS read APIs where possible.
- Keep local-only developer tooling only if it still adds value.

## Capability Mapping For The Replacement

### Must be rebuilt if those flows still matter

- User onboarding:
  address generation, bank signup, broker signup, mapping registration.
- Broker workflow:
  customer selection, balances, order placement, order revocation, order book,
  trade history, price chart.
- Issuer workflow:
  issue/list token, manage stock allowlist, inspect listings.
- Commercial bank workflow:
  TBD mint/burn, allowlist management, balance views.
- Norges Bank workflow:
  wNOK mint/burn/transfer, commercial bank allowlist/registry views.

### Can be replaced by dev-only tools

- `raw.ipynb`
- `MarketMaker.ipynb`
- notebook editing/sync workflow

## File Checklist

Files very likely to change during removal:

- `common/helpers.sh`
- `sandbox.sh`
- `infra/gateway/templates/gateway.yaml`
- `common/images.yaml`
- `common/versions.yaml`
- `README.md`
- `CONTRIBUTING.md`
- `services/README.md`
- `services/DEVELOPMENT.md`
- `services/AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/THIRD_PARTY_NOTES.md`
- `THIRD_PARTY_LICENSES.md`
- `.github/workflows/pylint.yml`
- `services/script-runner/`

Files to verify for indirect dependency after the namespace move:

- `contracts/contracts.sh`
- `services/nb-bond-api/`
- `services/blockscout/templates/bens-db-init-job.yaml`

## Suggested Work Breakdown

### Track A. Decommission

- Move shared configmaps out of `jupyterhub`.
- Remove deployment/runtime references.
- Remove CI/docs/provenance references.
- Delete `services/script-runner/`.

### Track B. Replacement UI

- Define the backend API surface first.
- Port required workflows one role at a time.
- Keep direct key handling and DB writes out of the browser.

### Track C. Developer tooling

- Decide whether local notebooks still add value.
- If yes, keep them as local tools only.
- If no, replace with small CLIs or scripted test/demo flows.

## Effort Estimate

- Stop deploying and exposing Jupyter only:
  less than 1 day.
- Remove it cleanly from runtime, docs, CI, and shared namespace wiring:
  about 2 to 4 days.
- Rebuild all current capabilities behind a proper web UI and backend:
  about 1 to 3 weeks, depending on required parity.

## Recommendation

The future web UI should replace Jupyter for product-facing and operator-facing
flows. JupyterHub should only survive if there is a deliberate need for a
hosted multi-user notebook environment inside the cluster. Based on the current
repo, that should not be the default direction.
