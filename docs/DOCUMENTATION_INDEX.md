# Documentation Index

This file lists the documentation that is most likely to need updates when behavior, scripts, or interfaces change.

## Core entrypoints
- `README.md`: Local setup, sandbox lifecycle, and registry workflow.
- `LICENSE`: Root repository license text.
- `CONTRIBUTING.md`: Contribution workflow, validation expectations, and provenance rules.
- `SECURITY.md`: Security reporting guidance and support scope.
- `AGENTS.md`: Root repository guidance for AI coding agents and repo-aware automation.
- `docs/THIRD_PARTY_NOTES.md`: File-level license exceptions and third-party deployment references.
- `THIRD_PARTY_LICENSES.md`: Curated direct dependency and deployment-time license inventory.
- `docs/ARCHITECTURE.md`: Component and workflow architecture (sandbox runtime, contracts, APIs, bid flow).
- `docs/KNOWN_ISSUES.md`: Known issues and follow-ups.
- `docs/AZURE_BOUNDARY.md`: What this repo's charts and scripts can vs cannot be reused from a non-local (ArgoCD / Azure) deployment.
- `docs/post-mortems/README.md`: Incident reports and historical troubleshooting write-ups.
- `docs/plans/jupyter-removal-plan.md`: Deferred decommission plan for the JupyterHub-based script runner and its replacement path.
- `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md`: Plan to settle the primary auction cash leg by central-bank authority instead of a bidder ERC-20 allowance (fixes the `ERC20InsufficientAllowance` / `FailureReason.Cash` finalisation failure), then a phased path to omnibus broker custody, a unified `PrimaryDealerRegistry`, and two-tier coupon/redemption. Phase 1 is diff-level (Roles + Wnok `settle()` + BondDvP cash-leg swap + deploy wiring); Phases 2–6 are roadmap.
- `docs/plans/erc-3643-incremental-adoption-plan.md`: Incremental ERC-3643 (T-REX) adoption — a shared external identity registry + modular compliance for the existing partitioned `BondToken` (kept as a learning/comparison artifact) and all cash (`Wnok`), closing the bond transfer eligibility gap first (Phase 1 keystone), then agent powers, compliance modules, and full ONCHAINID (Phases 2–4 roadmap in the same file). Flags upgrading the CSD base securities to canonical ERC-3643 as the Path-A target.
- `docs/plans/role-based-access-control-plan.md`: Role-based access for the Central Bank page via Entra App Roles (`Sandbox.Operator` / `Sandbox.Tester`; the Norges Bank group is assigned to the operator role), enforced in both nb-ui (hide nav + guard route + access-denied screen) and nb-bond-api (`403` on `/v1/central-bank/*` and on any token with no recognised role). Local `none` mode stays fully open.
- `docs/plans/archive/`: Reference-only archive of plans whose implementation has shipped. Status lines inside each plan link to the merging PRs:
  - `docs/plans/archive/openapi-v2-plan.md`: NB Bond API v2 design — bulky resource tree, md5 / ETag caching protocol, RFC 7807 problem+json errors, and dual auth modes (`none` / `entra`).
  - `docs/plans/archive/nb-ui-frontend-plan.md`: Implementation plan for the `services/nb-ui/` operator frontend (React + Vite), NB Bond API aggregate endpoints + CORS, and pluggable auth (none / Entra-MSAL).
  - `docs/plans/archive/bidders-and-central-bank-plan.md`: Implementation plan for the `#/bidders` and `#/central-bank` NB UI pages plus their NB Bond API support (server-side impersonated bid submission, WNOK mint / burn / transfer / allowlist via the Norges Bank operator key).
  - `docs/plans/archive/health-indicator-and-self-healing-plan.md`: Plan B — `HealthBadge` + ingestion self-heal-at-boot. Shipped together with Plan C in PR #115.
  - `docs/plans/archive/network-health-modal-and-reconnect-plan.md`: Plan C — clickable `HealthBadge` opens the `NetworkHealthModal` with recent errors plus `Reconnect` / `Resync from block 0` affordances. Shipped together with Plan B in PR #115.
  - `docs/plans/archive/image-build-lifecycle-plan.md`: Local image-build/registry lifecycle — shared hashed-image build helper, registry-reuse before upstream pull, visible `FORCE_IMAGE_PULL`, and `image-report` / `cleanup-images` / `registry-reset` verbs + CI hash-input test. Shipped via #128.
  - `docs/plans/archive/operator-ui-backlog.md`: Post-#115 operator-UI follow-up backlog (shipped items landed via #115 / #117 / #118; retired from the active list).
  - `docs/plans/archive/auction-finalisation-winner-selection-plan.md`: Design B finalisation fix — the operator's winner selection (by on-chain `bidIndex`) is sent to the backend, which recomputes the allocation + clearing rate over exactly that subset and cross-checks the operator's expected rate before minting, so a deselected bid can no longer set the coupon. Shipped via #133.
  - `docs/plans/archive/auction-web-fixes-plan.md`: Four auction web fixes — clearing-yield gating (proposed→final), allocation-hash tooltip + DTO, chain-time-robust auction close, and contract custom-error decoding. Shipped via #129.
  - `docs/plans/archive/blockscout-contract-verification-plan.md`: Local Blockscout contract verification — smart-contract-verifier microservice deploy, backend wiring, and `contracts.sh verify-latest --watch` hardening. Shipped via #141.
  - `docs/plans/archive/bond-lifecycle-management-plan.md`: Bond lifecycle — pre-stage bonds, soft-delete via `disablePartition`, standalone create + disable endpoints (backlog items 11 + 12). Shipped via #127.
  - `docs/plans/archive/outstanding-plan-items.md`: Triage notes for leftover items from the bond-lifecycle / auction plans (most accepted as low-priority doc debt or declined). Retained for historical reference.

## Infra and services
- `infra/README.md`: Infra overview and command entrypoint.
- `infra/DEVELOPMENT.md`: Infra lifecycle, registry notes, and Besu configuration caveats.
- `services/README.md`: Services overview and links to detailed docs.
- `services/DEVELOPMENT.md`: Service deployment, URLs, and operational notes.
- `services/blockscout/debugging.md`: Blockscout/Besu debugging playbook.
- `services/nb-bond-api/README.md`: NB Bond API overview and environment variables.
- `services/nb-bond-api/DEVELOPMENT.md`: NB Bond API runbooks and OpenAPI usage.
- `services/nb-ui/README.md`: NB UI operator frontend overview.
- `services/nb-ui/DEVELOPMENT.md`: NB UI runtime config, auth plugin model, deployment shape.
- `services/blockscout/bens-microservice/README.md`: BENS OpenAPI server (generated; update via regen script).

## Contracts
- `contracts/AGENTS.md`: Contract-specific AI agent guidance and Foundry expectations.
- `contracts/README.md`: Foundry workflow (build/test/deploy/verify, including `contracts.sh verify-latest`).
- `contracts/docs/contracts-security.md`: Contract trust model, privileged roles, sandbox limits, and current security posture.
- `contracts/docs/contracts-reference.md`: Curated reference to the main runtime contracts, cash-side components, and lifecycle flows.
- `contracts/docs/natspec/README.md`: Generated NatSpec contract reference and regeneration instructions.
- `contracts/docs/bond-lifecycle-walkthrough.md`: Minimal external integration walkthrough for the primary bond lifecycle.
- `contracts/docs/contracts-versioning.md`: ABI and interface stability expectations for external integrators.

## Scripts
- `scripts/README.md`: Scripts overview and usage entrypoint.
- `scripts/AGENTS.md`: Script-specific AI agent guidance.
- `scripts/DEVELOPMENT.md`: Scripts overview and usage notes.
- `scripts/verification/README.md`: Repository-level verification and publication-hygiene checks.
- `scripts/bid-encryption/README.md`: Bid encryption CLI usage.
- `scripts/bid-submitter/README.md`: Bid submitter CLI usage.

## Operations and reports
- `infra/AGENTS.md`: Infra-specific AI agent guidance and safety checks.
- `services/AGENTS.md`: Service-specific AI agent guidance and conventions.
- `services/nb-ui/AGENTS.md`: NB UI-specific AI agent guidance and safety checks.
- `docs/diagrams/processes/*.md`: Process diagram narratives.
