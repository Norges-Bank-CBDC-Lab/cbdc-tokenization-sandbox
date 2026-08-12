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
- `docs/diagrams/README.md`: Maintained diagram catalog, scope, and update rules.
- `docs/KNOWN_ISSUES.md`: Known issues and follow-ups.
- `docs/AZURE_BOUNDARY.md`: What this repo's charts and scripts can vs cannot be reused from a non-local (ArgoCD / Azure) deployment.
- `docs/post-mortems/README.md`: Incident reports and historical troubleshooting write-ups.
- `docs/decisions/README.md`: Architecture Decision Records (ADRs) — index of immutable, point-in-time records of architecturally significant decisions (one decision per file; superseded, never rewritten).
  - `docs/decisions/0001-local-chain-besu-clique-london-baseline.md`: Why the local chain runs single-node Hyperledger Besu on Clique PoA pinned to the London EVM milestone with a zero-base-fee genesis — and the `PUSH0`, Foundry-fee, and transaction-only block-clock consequences.
  - `docs/decisions/0002-adopt-erc-3643-for-tokenized-securities.md`: Why securities (bonds + equities) move to canonical ERC-3643 (T-REX) with a shared identity registry + modular compliance, retiring the ERC-1410 partitioned `BondToken` and the bespoke ERC-20 `StockToken` — including the migration cost, cash (`Wnok`) staying on its own allowlist, and the redirect of the incremental-adoption plan.
  - `docs/decisions/0003-adopt-besu-qbft-osaka-with-archive-rpc.md`: Why the sandbox replaces Clique/London with Besu QBFT/Osaka, separates the validator from a Forest archive/RPC node, rejects a beacon client, and requires a destructive chain reset.
- `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md`: Plan to settle the primary auction cash leg by central-bank authority instead of a bidder ERC-20 allowance (fixes the `ERC20InsufficientAllowance` / `FailureReason.Cash` finalisation failure), then a phased path to omnibus broker custody, a unified `PrimaryDealerRegistry`, and two-tier coupon/redemption. Phase 1 is diff-level (Roles + Wnok `settle()` + BondDvP cash-leg swap + deploy wiring); Phases 2–6 are roadmap.
- `docs/plans/sandbox-fmi-wallet-plan.md`: Sandbox-only implementation plan for a multi-participant institutional wallet with encrypted local keys, typed transaction intents, simulated maker/checker approval, directory-backed recipient selection/revalidation, durable audit, and removal of bidder impersonation from the NB Bond API.
- `docs/plans/sandbox-entity-directory-and-name-service-plan.md`: Standalone sandbox entity-directory/name-service plan with its own persistent database, backend API, search/admin UI, synthetic profile/contact enrichment, optional provenance-aware on-chain registry readers, and a BENS-compatible Blockscout adapter backed by the same directory data.
- `docs/plans/dependency-security-pin-refresh-plan.md`: Remediates all 14 open Dependabot alerts in one lockfile operation — bumps the four stale root `overrides` security pins (js-yaml, undici, both scoped brace-expansion pins) and refreshes three in-range transitives (runtime ip-address under the rate limiter, body-parser, glob-nested brace-expansion) via a full-resolve transplant with a structural lockfile diff as the gate, followed by patch release v0.7.1.
- `docs/plans/erc-3643-incremental-adoption-plan.md`: **Superseded in direction by `docs/decisions/0002-adopt-erc-3643-for-tokenized-securities.md`** (full migration to canonical ERC-3643 for bonds + equities, retiring the partitioned `BondToken` and the ERC-20 `StockToken`). Retained as the record of the *incremental* approach considered and rejected — a shared external identity registry + modular compliance bolted onto the existing partitioned `BondToken` and cash (`Wnok`), closing the bond transfer-eligibility gap first, then agent powers, compliance modules, and full ONCHAINID. Its eligibility-gap analysis and phase mechanics remain a useful reference.
- `docs/plans/archive/`: Reference-only archive of completed implementation plans. Status lines inside each plan record the implementing PR and its state where relevant:
  - `docs/plans/archive/besu-qbft-osaka-upgrade-plan.md`: Completed greenfield upgrade from Besu 26.1.0 Clique/London to Besu 26.7.0 QBFT/Osaka, with separate validator and Forest archive/RPC nodes, Solidity 0.8.36, OpenZeppelin 5.6.1, static-peer wiring, chain-identity reset safeguards, and clean-cluster acceptance evidence.
  - `docs/plans/archive/backend-design-improvements-backlog.md`: Historical NB Bond API architecture backlog. Its main projection, read-your-writes, audit-trail, and lifecycle-status work shipped; residual ideas are retained for context but are no longer maintained as an active plan.
  - `docs/plans/archive/central-bank-wnok-allowlist-enrichment-plan.md`: Partially implemented Central Bank/WNOK allowlist enrichment plan. Live balances and bidder/CB labels shipped; the proposed bank/TBD/government-reserve taxonomy was closed without implementation.
  - `docs/plans/archive/cursor-reconcile-sync-plan.md`: Superseded reconciliation plan whose transport-agnostic `useLiveQuery` shape was absorbed by `sse-live-updates-plan.md`; the separate health-cursor layer was not implemented.
  - `docs/plans/archive/operator-audit-trail-design.md`: Historical design brief implemented with revised scope by `operator-audit-trail-plan.md` in PR #213: all operator mutation types and a global Operations page, with the proposed per-bond merged GET deferred.
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
  - `docs/plans/archive/role-based-access-control-plan.md`: Role-based access via Entra App Roles (`Sandbox.Operator` / `Sandbox.Tester`), enforced in both nb-ui (hide nav + guard route + access-denied screen) and nb-bond-api (`403` on `/v1/central-bank/*` and on tokens with no recognised role); local `none` mode stays fully open. Shipped via #163.
  - `docs/plans/archive/nav-categories-and-tbd-page-plan.md`: Nav refactor into dropdown categories (Central Bank / Securities / Banking) plus the Banking → TBD operator page (per-bank allowlist / mint / burn / transfer). Shipped via #179; follow-ups: tester-role access (#198), bank creation (#200). The WNOK allowlist enrichment was split out to the now-archived `docs/plans/archive/central-bank-wnok-allowlist-enrichment-plan.md`.
  - `docs/plans/archive/blockscout-v11-upgrade-plan.md`: Explorer stack upgrade to Blockscout backend `v11.2.1` + frontend `v2.9.0` + chart `4.5.1` on the unchanged Besu 26.1.0 baseline — source-built images, greenfield local install, `ECTO_USE_SSL` cleanup; BENS-stub refresh not needed. Shipped via #195.
  - `docs/plans/archive/jupyter-removal-plan.md`: Removal of the JupyterHub script runner — PR 1 decoupled the shared contract-metadata configmaps into the `contracts` namespace (#210); PR 2 deleted the service, runtime plumbing, gateway listener, pins, notebook CI, and license entries (#211). NB UI had already replaced the bank/central-bank notebook flows; equity flows retire to the ERC-3643 track.
  - `docs/plans/archive/operator-audit-trail-plan.md`: Operator audit trail — preserved `operation_attempts` system-of-record table (additive, no schema bump), `withOperationRecording` around all 20 operator on-chain mutations, `GET /v1/operations` with md5/ETag, and the System → Operations page in NB UI; ships the projection-purity rule write-up. Shipped via #213.
  - `docs/plans/archive/sse-live-updates-plan.md`: Authenticated SSE invalidations with Entra/MSAL bearer support, ETag-preserving query reconciliation, post-commit publishers, reconnect recovery, and explicit Azure proxy constraints. Shipped via #224 and verified through both the local gateway and an Entra-protected Azure sandbox deployment.
  - `docs/plans/archive/nb-application-architecture-improvements-plan.md`: Modular-monolith improvements for NB Bond API and NB UI — explicit dependency failures, testable app composition, feature services, frontend domain extraction, refresh-state behavior, and feature-owned contracts. Core work shipped via #224; the projection/contract follow-up is implemented in #225.
  - `docs/plans/archive/projection-aligned-api-contract-plan.md`: Checkpoint-consistent Bond/Auction projections, honest `202 MutationAccepted` handling, replayable lifecycle states, adaptive health polling, and the completed feature-owned Zod/OpenAPI split. Implemented in #225.

## Infra and services
- `infra/README.md`: Infra overview and command entrypoint.
- `infra/DEVELOPMENT.md`: Infra lifecycle, registry notes, and Besu configuration caveats.
- `infra/besu/config/README.md`: Provenance note for the local `genesis.json` (based on upstream Besu templates).
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

## Diagrams
- `docs/diagrams/architecture/*.md`: Current system context, runtime deployment, contract topology, and NB Bond API component views.
- `docs/diagrams/data/*.md`: Projection and persistence models.
- `docs/diagrams/processes/*.md`: Domain state machines, sequences, settlement flows, projection catch-up, and live-update behavior.
- `docs/diagrams/operations/*.md`: Sandbox lifecycle and deployment flowcharts.
- `docs/diagrams/security/*.md`: Trust boundaries, authentication, keys, and authorization layers.
- `docs/diagrams/generated/`: Git-ignored Slither and sol2uml output regenerated by `make diagrams`.

## Operations and reports
- `infra/AGENTS.md`: Infra-specific AI agent guidance and safety checks.
- `services/AGENTS.md`: Service-specific AI agent guidance and conventions.
- `services/nb-ui/AGENTS.md`: NB UI-specific AI agent guidance and safety checks.
