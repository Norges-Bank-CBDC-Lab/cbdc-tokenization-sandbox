# Incremental ERC-3643 (T-REX) Adoption — Implementation Plan

**Status:** Proposed — roadmap / meeting-prep. **Phase 1 is the keystone and is implementation-ready once the open questions below are answered**; Phases 2–4 are scoped roadmap that the operator returns to *this same document* to execute in sequence. No contract code has changed; implementing any phase needs a separate explicit go-ahead.
**Branch suggestion:** `feature/erc3643-identity-compliance` (Phase 1 only; later phases get their own `feature/<kebab>` branches). Branch / commit / PR / CI-gate workflow is owned by `sandbox-pr-workflow`.
**Components touched (across all phases):** `contracts/src/norges-bank/BondToken.sol`, `contracts/src/norges-bank/Wnok.sol`, `contracts/src/norges-bank/ERC1410/ERC1410.sol`, `contracts/src/common/Roles.sol`, `contracts/src/common/Errors.sol`, new `contracts/src/common/identity/*` + `contracts/src/common/compliance/*` (and their interfaces), `contracts/script/norges-bank/03_Wnok.s.sol` + `10_Bond.s.sol` + the bond/wnok setup scripts, `contracts/contracts.sh` (verify-latest mapping), tests under `contracts/test/`, and contracts docs. Consumers (`services/nb-bond-api`, `services/nb-ui`) re-ingest the redeployed addresses but get no behavioural change in Phase 1.

## Goal

Adopt the ERC-3643 (T-REX) **identity + modular-compliance** model into the sandbox's existing tokens *incrementally*, without a ground-up rewrite, so that:

1. **The current, real security gap is closed first.** `BondToken.transferByPartition` / `operatorTransferByPartition` today move partitioned bond units with **no eligibility check at all** — the ERC-1410 base (`ERC1410Minimal._transferByPartition` → `_move`) validates only recipient-non-zero, granularity, and balance. Any address that has ever received a bond unit can freely transfer it to **any** address, allowlisted or not. Phase 1 inserts an identity + compliance gate into that path. This is the headline motivation.
2. **Future rule changes need no token redeploys.** Identity verification and transfer compliance live in **external** contracts the tokens point at via `setIdentityRegistry(addr)` / `setCompliance(addr)`. After the one-time Phase 1 redeploy, Phases 2–4 (agent powers excepted) add or swap rules by deploying a new module and re-pointing a setter — the token bytecode stays put.
3. **All cash and bonds share one verified-participant set.** `Wnok` (and any other cash tokens) and `BondToken` reference the **same** Identity Registry, so a single "is this participant vetted?" decision gates every cash leg and the securities leg. Cash carries only *light* compliance (eligibility + freeze/pause); it does **not** take on security-token modules (no investor caps or accreditation on central-bank money).

When done (Phase 1), the local sandbox has: a deployed `IdentityRegistry` seeded from the current `Allowlist` membership; a deployed default (permissive) `ModularCompliance`; `BondToken` and `Wnok` redeployed to reference both; a Foundry suite proving a verified holder can receive, an unverified address reverts, and a compliance veto reverts; and a `cast`-level demonstration that an unverified recipient can no longer receive a bond partition. The plan then carries Phases 2–4 forward in the same file.

## Non-Goals

- **No one-token-per-ISIN refactor.** The existing partitioned `BondToken` (one deployment, many ISIN partitions) is retained — and is **explicitly kept as a learning / comparison artifact** to measure the partitioned model against the canonical ERC-3643 (Path A) model, *not* as the endorsed long-term shape for all securities. The canonical-ERC-3643 target is the CSD base securities (see Decision D2). (See Decision D1 — Path B.)
- **No byte-for-byte `IERC3643` interface conformance.** The plan implements ERC-3643-*aligned semantics* (identity verification + modular compliance + agent powers) shaped to this repo's ERC-1410 + AccessControl + Allowlist conventions, not a drop-in `IERC3643` ABI for external T-REX tooling. (See Decision D3.)
- **No real ONCHAINID (ERC-734/735) in Phases 1–3.** The Phase 1 registry is a *simplified, interface-shaped* verified-set. Full claim-based identity (Claim Topics Registry + Trusted Issuers Registry + per-investor ONCHAINID with signed claims) is deferred to Phase 4 and gated on a concrete testcase. (See Decision D4.)
- **No new third-party dependency by default.** The ERC-3643 (`@T-REX`) and `@onchain-id` reference packages are **not** vendored as a default. The simplified interfaces are implemented in-repo first; vendoring the upstream packages is an explicit, approval-gated option (per root `AGENTS.md` dependency policy). (See Decision D6.)
- **No Path A greenfield asset in these four phases.** A canonical standalone ERC-3643 ERC-20 (one token, claim-based identity, full modules) for a future "TBD" asset against the *same* shared registry is noted as a **non-blocking forward option** and is explicitly out of scope here. (See Decision D2 and Open Question Q5.)
- **No locking, escrow, or settlement-model change.** This plan is about *who may hold and transfer*, not *how settlement is authorised*. It is orthogonal to and composable with `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md` (the cash-leg authority work).
- **No promotion to a non-local deployment.** This plan is local-first. Portability flags are surfaced below.

## Current-State Evidence

What was inspected and what was actually verified in this session (2026-06-05).

### Verified live (against the running sandbox)

- **The sandbox is currently DOWN — nothing could be verified against a live chain this session.** `kind get clusters` failed with *"Cannot connect to the Docker daemon"* (Docker not running). `kubectl config current-context` returns `kind-cluster-cbdc-monoledger` (the expected context name), but the cluster behind it is not up. `curl` against `http://besu.cbdc-sandbox.local:8545/` (`eth_chainId`, `eth_blockNumber`) and `http://bond-api.cbdc-sandbox.local/v1/health` both failed to connect.
- **Therefore the following are marked NEEDS VERIFICATION (re-run when the sandbox is up):** chain id (expected `2018` / `0x7e2`), current head block, live-deployed `BondToken` / `Wnok` addresses via `GlobalRegistry.getContract(...)`, and current `Allowlist` membership on both tokens. Do this before Phase 0 exits.

### From repo files (read this session — accurate as of the working tree, not chain-verified)

- **The bond transfer path has no eligibility gate (the headline gap).** `contracts/src/norges-bank/ERC1410/ERC1410.sol`:
  - `transferByPartition` (line ~178) and `operatorTransferByPartition` (line ~189) both funnel into `_transferByPartition` (line ~246) → `_move` (line ~268).
  - `_transferByPartition` checks only `to != address(0)`. `_move` checks only granularity (`_enforceGranularity`), aggregate balance, and partition balance. **There is no allowlist, identity, or compliance check anywhere in the bond transfer path.** `operatorTransferByPartition` gates the *caller* (`isOperatorForPartition`) but never the *counterparties*.
  - `BondToken` (`contracts/src/norges-bank/BondToken.sol`) does not override `_move` / `_transferByPartition`, so it inherits this gap unchanged. Its own write paths (`mintByIsin`, `redeemFor`, etc.) are role-gated but the holder-to-holder transfer is not.
- **`Wnok` already enforces an allowlist on its transfer overrides** (`contracts/src/norges-bank/Wnok.sol`): `transfer` (line ~96) checks `_allowlist[owner]` + `_allowlist[to]`; `transferFrom` (line ~113) is `onlyRole(TRANSFER_FROM_ROLE)` and checks both parties. It does **not** override `_update`, so the allowlist lives only in the public overrides. The Phase 1 change folds these checks into the shared `IdentityRegistry` call so behaviour is preserved (a name change of the gate, not a loosening).
- **Both tokens are NON-UPGRADEABLE.** `Wnok` has a plain `constructor(address admin, string name_, string symbol_)`; `BondToken` has a plain `constructor(string _name, string _symbol)`. Neither uses a proxy or `Initializable`. By contrast, `contracts/src/csd/BaseSecurityToken.sol` *is* upgradeable (`Initializable`, `ERC20Upgradeable`, `AllowlistUpgradeable`, `_disableInitializers()` in the constructor). **Implication: adding storage-bearing features (the registry/compliance pointers, freeze/pause state) to `BondToken`/`Wnok` requires a one-time redeploy + state reset of those two contracts.** Cheap locally via `./contracts.sh start`; consumers re-ingest the new addresses.
- **The `Allowlist` data model is a flat verified-set, which maps cleanly to an Identity Registry.** `contracts/src/common/Allowlist.sol`: `mapping(address => bool) _allowlist` + `address[] _allAllowed`, with `add` / `remove` / `allowlistQuery(addr)` / `allowlistQueryAll()` all `ALLOWLIST_ADMIN_ROLE`-gated. `AllowlistUpgradeable.sol` is the ERC-7201-namespaced equivalent used by the CSD stack. A simplified `IdentityRegistry.isVerified(addr)` is a near-rename of `allowlistQuery(addr)`; `allowlistQueryAll()` gives the migration seed list.
- **There is a CSD precedent for forced transfer + custodial roles** (reuse target for Phase 2). `BaseSecurityToken.custodialTransfer(from, to, amount)` (line ~159) is `onlyRole(Roles.CUSTODIAL_TRANSFER_ROLE)` and calls `ERC20Upgradeable._transfer` directly (bypasses allowance, emits `CustodialTransferred`). `Roles.CUSTODIAL_TRANSFER_ROLE` and `Roles.SECURITY_OPERATOR_ROLE` already exist in `contracts/src/common/Roles.sol`.
- **Role library already carries most of what the Owner/Agent mapping needs.** `contracts/src/common/Roles.sol`: `DEFAULT_ADMIN_ROLE` (0x00), `BOND_ADMIN_ROLE`, `BOND_CONTROLLER_ROLE`, `BOND_MANAGER_ROLE`, `ALLOWLIST_ADMIN_ROLE`, `MINTER_ROLE`, `BURNER_ROLE`, `CUSTODIAL_TRANSFER_ROLE`, `SECURITY_OPERATOR_ROLE`, `TRANSFER_FROM_ROLE`. No ERC-3643 `OWNER` / `AGENT` roles exist — the plan *maps onto* existing roles rather than renaming (Decision D5 / Phase 2).
- **Deploy + registry wiring is name-keyed and centralised.** `contracts/script/norges-bank/03_Wnok.s.sol` deploys `Wnok` and calls `registry.setContract(wnok.name(), address(wnok))`. `10_Bond.s.sol` deploys `BondAuction` / `BondToken` / `BondDvP` / `BondManager` and registers each by `name()` in `GlobalRegistry`. `GlobalRegistry.setContract` (`contracts/src/common/GlobalRegistry.sol`) is `onlyOwner` and emits `ContractAdded` / `ContractUpdated`. Re-pointing a redeployed token = one `setContract` call with the same name.
- **Foundry / toolchain pins.** `contracts/foundry.toml`: `solc = "0.8.35"`, `evm_version = "london"`, `via_ir = true`, `optimizer = true` / `optimizer-runs = 200`, `forge-std 1.16.1`. Sources pragma `^0.8.29`. `contracts/remappings.txt`: OpenZeppelin Contracts **5.4.0** + upgradeable **5.4.0** (deliberately pinned off 5.5.0+ to stay on the London milestone — see the `foundry.toml` comment). No `@T-REX` / `@onchain-id` remapping exists today.
- **CI gate names + extra gates (important for the PR).** `.github/workflows/test-contracts.yml` is the **`Contracts CI`** workflow (triggers on `contracts/**`): runs `forge fmt --check`, `forge build --sizes`, **`bash ./check-verify-latest-mapping.sh`** (fails if a deployed CREATE contract type has no `resolveContractIdentifier` mapping in `contracts.sh`), `forge test -vvv`, and Slither with **`fail-on: medium`**. Any new deployable contract (`IdentityRegistry`, `ModularCompliance`, each compliance module) MUST be added to the `resolveContractIdentifier()` case block in `contracts/contracts.sh` or this gate fails.
- **Test conventions.** `contracts/test/norges-bank/BondToken.t.sol` and `Wnok.t.sol` use `forge-std/Test`, `vm.prank` / `vm.startPrank`, role grants via `grantRole(Roles.X, addr)`, and `vm.expectRevert(abi.encodeWithSelector(Errors.X.selector, ...))`. Custom errors live centrally in `contracts/src/common/Errors.sol`. (Note: `BondToken.t.sol` already covers `disablePartition`, and `Errors.sol` already carries `BondAlreadyDisabled` / `BondNotEmpty` / `BondHasFinalisedAuction` — the bond-lifecycle plan has partly shipped; this plan adds *new* error names, see each phase.)

### From repo artifacts (NOT chain-verified — last local deployment record)

- `contracts/broadcast/03_Wnok.s.sol/2018/run-latest.json` records `Wnok -> 0xfe11872f5cf6d9e7af19165d2bd91afd8faf1ce8`; `contracts/broadcast/.../2018/run-latest.json` records `BondToken -> 0x290ca0df9a593e210d0e31519f4795f581da9563`. These match the addresses quoted in `docs/plans/bond-lifecycle-management-plan.md`'s live snapshot, but they are **broadcast artifacts from a prior run, not a live `GlobalRegistry` read** — confirm against the chain in Phase 0 once the sandbox is up.

### Local validation entry points already wired by CI

- `Contracts CI` (`.github/workflows/test-contracts.yml`) — Foundry `fmt`/`build`/`test` + verify-latest mapping check + Slither (`fail-on: medium`) for any `contracts/**` change.
- `validate-publication-hygiene` / markdown-link / third-party-license checks under `scripts/verification/` (run for doc + dependency changes).

### Blocked or unverified checks

- All live chain checks (chain id, head, live addresses, allowlist membership) — sandbox down this session (Docker daemon not running). Re-run in Phase 0.

## Scope

### In Scope

- **Phase 1 (keystone):** a simplified `IIdentityRegistry` + implementation (seeded from current `Allowlist` membership), an `ICompliance` modular-compliance interface + a single permissive default module, `setIdentityRegistry` / `setCompliance` wiring on `BondToken` and `Wnok`, and the eligibility + compliance check inserted into the bond transfer path (and folded into `Wnok`'s existing allowlist overrides). One-time redeploy + state reset of `BondToken` and `Wnok`. New Foundry unit tests + a `cast`-level gate demonstration.
- **Phase 2:** agent powers — `pause()`/`unpause()`, `setAddressFrozen`, `freezePartialTokens`/`unfreezePartialTokens`, `forcedTransfer` (bond), aligned onto existing `AccessControl` roles (Owner ≈ `DEFAULT_ADMIN_ROLE`; Agent ≈ operator/controller roles). Token-state features — they ride on the Phase 1 redeploy if bundled, else require their own redeploy.
- **Phase 3:** real `ICompliance` modules (MaxInvestors, CountryRestrict, Lockup/TimeTransferLimits, MaxBalance, SupplyLimit), each a new contract plugged into the same compliance seam with **zero** token changes.
- **Phase 4:** graduate the simplified registry to the full ERC-3643 identity stack (Claim Topics Registry + Trusted Issuers Registry + per-investor ONCHAINID with signed claims), gated on a concrete testcase. Designed as a registry **swap**, not a token rewrite.
- **Cross-cutting:** `contracts/src/common/Errors.sol` new error names per phase; `contracts/contracts.sh` `resolveContractIdentifier` entries for every new deployable contract; contracts docs (`contracts/docs/contracts-reference.md`, `contracts/docs/contracts-security.md`); `docs/ARCHITECTURE.md` trust-model note; `docs/KNOWN_ISSUES.md` updates; a `docs/DOCUMENTATION_INDEX.md` entry (listed as a task, **not** applied here — see Documentation section).

### Out Of Scope

- One-token-per-ISIN (Path A) for the existing bond; byte-for-byte `IERC3643` ABI conformance; real ONCHAINID before Phase 4; vendoring `@T-REX` / `@onchain-id` by default; a Path-A greenfield pilot asset; settlement-model changes; any non-local / GitOps promotion. (See Non-Goals and Decisions.)

## Folder And File Placement

New contracts land under `contracts/src/common/` because both `BondToken` (norges-bank) and `Wnok` (norges-bank), and potentially future CSD assets, share them — this mirrors how `Allowlist` / `Roles` / `Errors` already live in `common/`.

| Item | Path | Rationale |
|---|---|---|
| Identity registry interface | `contracts/src/common/identity/IIdentityRegistry.sol` | Real cross-contract boundary (tokens call it); interface justified per `contracts/AGENTS.md` |
| Simplified identity registry impl | `contracts/src/common/identity/IdentityRegistry.sol` | Shared verified-set; seeded from `Allowlist` |
| Compliance interface | `contracts/src/common/compliance/ICompliance.sol` | Cross-contract boundary (tokens call `canTransfer`; modules implement) |
| Modular compliance impl | `contracts/src/common/compliance/ModularCompliance.sol` | Holds the module list; tokens point here |
| Compliance module interface | `contracts/src/common/compliance/IComplianceModule.sol` | Multiple implementations (Phase 3) ⇒ interface justified |
| Default permissive module | `contracts/src/common/compliance/modules/DefaultComplianceModule.sol` | Phase 1 no-op baseline (always allows) |
| Phase 3 modules | `contracts/src/common/compliance/modules/{MaxInvestorsModule,CountryRestrictModule,LockupModule,MaxBalanceModule,SupplyLimitModule}.sol` | One module per testcase |
| Phase 4 identity stack | `contracts/src/common/identity/{ClaimTopicsRegistry,TrustedIssuersRegistry}.sol` + ONCHAINID integration | Heavyweight; last |
| New errors | `contracts/src/common/Errors.sol` | All custom errors live here |
| New roles (if any) | `contracts/src/common/Roles.sol` | Role library; prefer reuse over new (Phase 2) |
| Deploy scripts | extend `contracts/script/norges-bank/03_Wnok.s.sol` + `10_Bond.s.sol`, or add `contracts/script/common/NN_Identity.s.sol` + `NN_Compliance.s.sol` deployed before the tokens | Registry must hold registry/compliance addresses before token construction wires them |
| verify-latest mappings | `contracts/contracts.sh` `resolveContractIdentifier()` | CI gate requires every deployed CREATE type be mapped |
| Tests | `contracts/test/common/IdentityRegistry.t.sol`, `Compliance.t.sol`, module tests; extend `contracts/test/norges-bank/BondToken.t.sol` + `Wnok.t.sol` | Matches existing test layout |

## Decisions And Open Questions

The architecture decision this plan **assumes** is **PATH B** (external identity + compliance, existing partitioned bond retained). The open questions below are the meeting agenda — Q1–Q6 should be answered before Phase 1 implementation starts.

| ID | Decision / Question | Options | Recommendation (plan assumption) | Needed from operator |
|---|---|---|---|---|
| **D1 / Q1** | Adoption path for the existing bond | **Path A** (refactor to canonical standalone ERC-3643 ERC-20, one token per asset) vs **Path B** (keep partitioned `BondToken`; identity + compliance as external contracts via `setIdentityRegistry` / `setCompliance`) | **Path B.** Preserves the ISIN-partition model the whole stack (BondManager, auctions, DvP, nb-bond-api ingestion, nb-ui) is built on; isolates rule changes to external contracts so future phases avoid token redeploys. The partitioned bond is retained as a **deliberate learning / comparison artifact** (partitioned vs canonical 3643); the canonical-3643 target is the CSD base securities (D2). | Confirm Path B |
| **D2 / Q5** | First canonical-ERC-3643 (Path A) asset | Upgrade the **CSD base securities** (`BaseSecurityToken` / `StockToken`, already UUPS-upgradeable) to ERC-3643 vs a greenfield token vs defer | **Operator lean: upgrade the CSD base securities.** They are *already upgradeable*, so this is an **upgrade, not a redeploy** — making them the canonical Path-A token against the *same* shared `IdentityRegistry`. Out of scope for Phases 1–4 (which cover the partitioned bond + cash), but the registry is built asset-agnostic to receive it. | Confirm CSD base securities as the Path-A target + sequence vs the bond/cash phases |
| **D3 / Q3** | Interface fidelity | Literal **`IERC3643`** ABI conformance (for external T-REX tooling / explorers) vs ERC-3643-**aligned** semantics shaped to repo conventions | **Aligned, not byte-conformant.** Conformance buys interop with external T-REX UIs we don't run locally, at the cost of fighting the ERC-1410 + AccessControl + Allowlist base. Revisit if an external tool becomes a requirement. | Confirm aligned-semantics is acceptable |
| **D4 / Q4** | Identity depth | Real **ONCHAINID** (ERC-734/735, signed claims, multi-issuer) now vs a **simplified** sandbox verified-set that is interface-shaped for a later swap | **Simplified now (Phase 1), ONCHAINID deferred to Phase 4** and gated on a testcase needing verifiable multi-issuer credentials. The Phase 1 `IIdentityRegistry` is shaped so Phase 4 is a swap, not a rewrite. | Confirm deferral |
| **Q2** | Are **all forms of cash** in scope for the shared identity layer now? | Yes — `Wnok` and any other cash tokens on the shared registry (light compliance) vs No (leave cash on its own `Allowlist`) | **Yes — all cash on the shared registry, LIGHT compliance only** (eligibility + freeze/pause; no investor caps / accreditation on central-bank money). One verified-participant set gates all cash AND bonds. | Confirm all cash in scope |
| **D5** | Owner/Agent role model | Introduce new `OWNER` / `AGENT` roles vs **map onto existing `AccessControl` roles** | **Map onto existing roles** (Owner ≈ `DEFAULT_ADMIN_ROLE`; Agent ≈ `BOND_CONTROLLER_ROLE` / operator roles). Document the mapping; don't rename the repo's role surface. | Confirm mapping approach (Phase 2) |
| **D6** | Dependency posture for upstream packages | Vendor `@T-REX` + `@onchain-id` reference contracts vs **implement simplified interfaces in-repo** | **In-repo simplified interfaces by default.** Vendoring upstream is an explicit, approval-gated decision (root `AGENTS.md` requires per-dependency approval; also a licence check via `check-third-party-licenses.py`). | Approve only if/when Phase 4 ONCHAINID fidelity demands it |
| **Q6** | Token redeploy sequencing | **Bundle** Phase 1 + Phase 2 token surface into one redeploy vs accept **two** redeploys (Phase 1 now, Phase 2 later) | **Bundle if the team is ready** for the agent-powers surface at the same time; otherwise accept a second redeploy when Phase 2 lands. Phase 1's external indirection means Phase 3 needs no redeploy regardless. | Decide bundle vs two redeploys |

## Portability Flags

Local-first choices that are acceptable for this sandbox but would need attention before any non-local promotion (don't solve here — surface the cost):

- **One-time state reset on redeploy.** Phase 1 resets `BondToken` / `Wnok` balances and allowlist/identity state because the tokens are non-upgradeable. Acceptable locally (`./contracts.sh start` redeploys a disposable chain). A non-local environment with real balances would need a migration path (snapshot holders, re-mint, or a one-off upgradeable wrapper) — call this out before promotion.
- **Simplified registry vs ONCHAINID.** The Phase 1 verified-set is a sandbox simplification. A non-local deployment aiming for real T-REX interop would need the Phase 4 ONCHAINID stack (and likely the vendored `@onchain-id` package, with its licence reviewed).
- **Role-grant policy.** The Owner/Agent powers (Phase 2) are gated by roles the local sandbox grants to deterministic fixture keys. A non-local deployment would govern those grants with a multisig + timelock — no contract change, just grant policy. (Same posture the closed-loop plan documents for `CASH_SETTLEMENT_ROLE`.)
- **Aligned-not-conformant interface.** If external T-REX tooling is ever required (a portability/interop requirement), the aligned-semantics choice (D3) would need revisiting toward literal `IERC3643` conformance.

## Acceptance Criteria

Phase 1 is the gating deliverable; criteria below are mostly Phase 1, with the later-phase criteria flagged.

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Unverified recipient cannot receive a bond partition | Closes the headline gap | Foundry: `BondToken` transfer to an address absent from `IdentityRegistry` reverts with the new eligibility error; `cast` send on local chain reverts likewise | Pass |
| Verified holder → verified holder bond transfer succeeds | No false-negative on legitimate transfers | Foundry: both parties verified ⇒ `transferByPartition` / `operatorTransferByPartition` succeed, balances move | Pass |
| Compliance veto reverts the transfer | Proves the compliance seam is wired | Foundry: a stub module whose `canTransfer` returns false ⇒ bond transfer reverts with the compliance error | Pass |
| `Wnok` behaviour preserved after folding allowlist into the registry | No regression on cash | Foundry: existing `Wnok.t.sol` transfer/transferFrom allowlist tests pass against the registry-backed gate (allowlisted ⇒ ok, removed ⇒ revert) | Pass / no regression |
| Shared registry gates both tokens | One verified-participant set for cash + bonds | Foundry: same `IdentityRegistry` instance referenced by both; removing an address blocks both a `Wnok` transfer and a `BondToken` transfer | Pass |
| `IdentityRegistry` seeded from current `Allowlist` membership | Migration correctness | Deploy script reads existing allowlist (or fixture seed list) and `isVerified(addr)` returns true for each seeded address; `cast call` spot-check post-deploy | Pass |
| `setIdentityRegistry` / `setCompliance` re-point without redeploy | Phase B payoff | Foundry: after construction, an admin call to each setter changes the referenced address; transfers honour the new target | Pass |
| One-time redeploy refreshes `GlobalRegistry` + consumers re-ingest | Don't strand consumers | `GlobalRegistry.getContract("<bond/wnok name>")` returns the new address; nb-bond-api `/v1/health` reports the new `bondToken` / `wnok` (re-run when sandbox up) | Pass (live) |
| `forge fmt --check`, `forge build --sizes`, `forge test -vvv` all green | CI gate (`Contracts CI`) | Workflow logs | Pass |
| `bash contracts/check-verify-latest-mapping.sh` passes (new contracts mapped) | CI gate | `resolveContractIdentifier` updated in `contracts.sh`; script exits 0 | Pass |
| Slither shows no new high/medium findings | CI gate (`fail-on: medium`) | `./slither.sh` output captured in PR | Clean |
| **(Phase 2)** `pause` blocks transfers; `setAddressFrozen` blocks a frozen address; `freezePartialTokens` blocks the frozen portion; `forcedTransfer` moves by authority | Agent powers correct | Foundry tests per power; `cast` demonstration | Pass |
| **(Phase 3)** Each module enforces its rule with ZERO token changes | Path B payoff | Foundry per-module tests; module add/remove on `ModularCompliance`; `git diff` shows no `BondToken`/`Wnok` edit | Pass |
| **(Phase 4)** Claim-based verification works; registry swap requires no token redeploy | Identity graduation | Foundry: `setIdentityRegistry(newOnchainIdRegistry)` and a claim-verified holder transfers; old token bytecode unchanged | Pass |
| Docs + index task done; public-repo hygiene scripts pass | Maintainability + public safety | `check-public-repo-hygiene.py` + `check-markdown-links.py` clean; index entry added (as its own change) | Clean |

## Assumptions

Safe to proceed with (anything unsafe is an Open Question above):

- The local sandbox stays on the current Besu pin (Clique + London; no new opcode introduced — the new code is plain Solidity 0.8.35 / `^0.8.29`, same as the rest).
- No new third-party dependency in Phases 1–3 (all built on existing OpenZeppelin 5.4.0 + Foundry). Phase 4 ONCHAINID *may* need a dependency — that is the approval-gated D6 decision, surfaced not assumed.
- The redeploy is acceptable locally because the chain is disposable (`./contracts.sh start` re-runs the full deploy; `GlobalRegistry` is predeployed in genesis and re-pointed by name).
- The simplified `IIdentityRegistry` surface (`isVerified(addr)`, register/remove, batch seed) is sufficient for Phases 1–3; Phase 4 extends/swaps it behind the same interface.
- The compliance module interface (`canTransfer(from,to,amount)` view + `transferred`/`created`/`destroyed` state hooks) is sufficient for the Phase 3 modules.

## Plan Order

```
Phase 0  Baseline verification (sandbox up; chain id + head; live BondToken/Wnok addresses; current allowlist membership)
Phase 1  Foundation / keystone  (Gate: Q1, Q2, Q3, Q4, Q6 answered)
  1a  IIdentityRegistry + IdentityRegistry (seeded from Allowlist)
  1b  ICompliance + ModularCompliance + DefaultComplianceModule (permissive)
  1c  setIdentityRegistry / setCompliance on BondToken + Wnok
  1d  Insert isVerified + canTransfer into the bond transfer path; fold Wnok allowlist into the registry call
  1e  Errors + verify-latest mapping + deploy-script wiring
  1f  Foundry unit tests + Slither
  1g  Local redeploy + cast transfer demonstration  (Gate: 1f green)
Phase 2  Agent powers  (pause/freeze/forcedTransfer; Owner/Agent role mapping)  (Gate: Q6 — bundle with Phase 1 redeploy or accept a second redeploy)
Phase 3  Compliance modules  (one per testcase; ZERO token changes)
Phase 4  Full identity  (ONCHAINID stack; gated on a concrete testcase; registry swap)
```

## Phase 0: Baseline Verification

### Goal

Capture the live starting state so any drift is obvious, and confirm the assumptions the later phases depend on. (Could not be done this session — sandbox down.)

### Steps

- `kind get clusters` → expect `cluster-cbdc-monoledger`; `kubectl config current-context` → expect `kind-cluster-cbdc-monoledger`.
- `curl -s -X POST http://besu.cbdc-sandbox.local:8545/ -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'` → expect `0x7e2` (2018); repeat `eth_blockNumber` twice ~1s apart to confirm the head advances.
- `curl -s http://bond-api.cbdc-sandbox.local/v1/health` → capture current `bondToken` / `wnok` addresses + chain head.
- Resolve live addresses from the registry: `cast call <GlobalRegistry> "getContract(string)(address)" "<BOND_TOKEN_CONTRACT_NAME>"` and `"<WNOK_CONTRACT_NAME>"` (names from `contracts/.env`). Compare against the broadcast-artifact addresses (`BondToken 0x290c…9563`, `Wnok 0xfE11…1Ce8`) — note any mismatch.
- Snapshot current allowlist membership for the migration seed: `cast call <Wnok> "allowlistQueryAll()(address[])"` and the equivalent for any bond-side allowlist; save to `/tmp/baseline-allowlist.json`.
- `cd contracts && forge test` → confirm a green baseline before any change.

### Verification Stop

- Chain reachable, head advancing, chain id `2018`.
- Live `BondToken` / `Wnok` addresses recorded (and reconciled with the broadcast artifacts).
- Allowlist seed list captured.
- `forge test` green.

### Fix Iteration / Rollback

If the live addresses disagree with the broadcast artifacts, or the baseline test suite is red, stop and reconcile before touching this plan (decide whether to redeploy from a clean state or update the plan's address references).

### Exit Criteria

- Baseline captured; the five Phase-1 open questions (Q1–Q4, Q6) are answered by the operator.

## Phase 1: Foundation / Keystone

### Goal

Close the bond transfer eligibility gap and establish the external identity + compliance seam, with a one-time redeploy of the two non-upgradeable tokens. After this phase, eligibility and compliance are enforced on every bond transfer and preserved on every cash transfer, and future rule changes (Phase 3) need no token redeploy.

### Scope

- **1a — Identity registry.** `IIdentityRegistry` (interface) + `IdentityRegistry` (impl). Minimum surface: `isVerified(address) view returns (bool)`; `registerIdentity(address)` / `batchRegisterIdentity(address[])` / `deleteIdentity(address)` gated by an identity-admin role (reuse `Roles.ALLOWLIST_ADMIN_ROLE` or add `IDENTITY_ADMIN_ROLE` — decide in implementation, prefer reuse per D5). Seed from the current `Allowlist` membership (batch-register the `allowlistQueryAll()` snapshot, or the deterministic fixture list the deploy scripts already use). Shape the interface so Phase 4 can back `isVerified` with claim verification instead of a flat mapping — `isVerified` is the only method tokens call.
- **1b — Compliance.** `ICompliance` (what tokens call: `canTransfer(from,to,amount) view returns (bool)` + state hooks `transferred(from,to,amount)` / `created(to,amount)` / `destroyed(from,amount)`), `ModularCompliance` (holds an ordered module list; `addModule` / `removeModule` admin-gated; `canTransfer` ANDs every module; hooks fan out to modules), `IComplianceModule`, and `DefaultComplianceModule` (always returns true — the permissive Phase 1 baseline so behaviour is purely additive over today).
- **1c — Token wiring.** Add to `BondToken` and `Wnok`: storage `IIdentityRegistry public identityRegistry;` + `ICompliance public compliance;`, an admin-gated `setIdentityRegistry(address)` and `setCompliance(address)` (Owner ≈ `DEFAULT_ADMIN_ROLE`), and constructor params (or post-deploy setters wired by the deploy script) so a freshly deployed token references both from the start. Emit `IdentityRegistrySet(address)` / `ComplianceSet(address)`.
- **1d — Transfer-path gate.**
  - **BondToken (the gap):** override the ERC-1410 transfer hook so `transferByPartition` and `operatorTransferByPartition` enforce, before `_move`: `identityRegistry.isVerified(to)` (and `isVerified(from)` where appropriate — `from` is always an existing holder so it should already be verified; check it to catch de-listed holders), then `compliance.canTransfer(from, to, value)`, then call the compliance `transferred` hook after the move. The cleanest seam is a `_beforePartitionTransfer` / overridable check added to `ERC1410Minimal._move` (or a hook called from `_transferByPartition`) that `BondToken` implements; mint (`_mint`) and burn (`_burn`) call `created` / `destroyed` respectively. Keep the hook a no-op in the base so other ERC1410 consumers are unaffected.
  - **Wnok (preserve behaviour):** replace the two inline `_allowlist[...]` checks in `transfer` / `transferFrom` with `identityRegistry.isVerified(...)` for both parties, and call `compliance.canTransfer` (light compliance — the default permissive module in Phase 1). Net behaviour is identical to today's allowlist for a verified set seeded from that same allowlist. Keep `TRANSFER_FROM_ROLE` on `transferFrom` unchanged.
- **1e — Errors, mapping, deploy wiring.** New `Errors` (e.g. `NotVerified(address account)`, `TransferNotCompliant(address from, address to, uint256 amount)` — final names TBD in implementation, added to `contracts/src/common/Errors.sol`). Add `IdentityRegistry`, `ModularCompliance`, `DefaultComplianceModule` to `resolveContractIdentifier()` in `contracts/contracts.sh` (CI `check-verify-latest-mapping.sh` gate). Add a `contracts/script/common/NN_Identity.s.sol` + `NN_Compliance.s.sol` (deployed and registered in `GlobalRegistry` *before* `03_Wnok` / `10_Bond`, so the token deploy scripts can wire `setIdentityRegistry` / `setCompliance` to known addresses); seed the registry from the allowlist in the setup script.
- **1f — Tests.** `contracts/test/common/IdentityRegistry.t.sol` (verify/register/delete, seed), `Compliance.t.sol` (module list, `canTransfer` AND, hooks), and extensions to `BondToken.t.sol` (verified→verified ok; unverified `to` reverts; de-listed `from` reverts; compliance-stub veto reverts; mint/burn fire `created`/`destroyed`) and `Wnok.t.sol` (registry-backed gate preserves the existing allowlist assertions). `forge fmt`; `./slither.sh`.
- **1g — Redeploy + demo.** `./contracts.sh start` (clean redeploy + `GlobalRegistry` re-point by name). A `cast send` bond transfer to a verified address succeeds; the same to an unverified address reverts with `NotVerified`. Re-ingest: nb-bond-api + nb-ui pick up the new addresses via `/v1/health` (no code change — they read the registry/config).

### Verification Stop

- `forge build --sizes` clean; `forge test -vvv` green incl. the new files; `forge fmt --check` clean; `bash check-verify-latest-mapping.sh` passes; `./slither.sh` no new high/medium.
- Local redeploy succeeds; `GlobalRegistry.getContract` returns the new `BondToken` / `Wnok`; the `cast` gate demonstration behaves as specified.
- nb-bond-api `/v1/health` reports the new addresses; no consumer errors in logs.

### Fix Iteration / Rollback

- Failed test / Slither finding: fix the contract, re-run (don't suppress a real finding without operator sign-off).
- Pre-redeploy, rollback is `git restore`. Post-redeploy gone wrong: redeploy from clean (`./contracts.sh start`), re-point `GlobalRegistry`, restart consumers — the chain is disposable, so a full `./sandbox.sh delete && ./sandbox.sh start` is the nuclear option (destructive; operator OK).
- If the redeploy reset surprises a consumer, confirm nb-bond-api re-ran ingestion from the new address (it resolves the address from the registry on boot).

### Exit Criteria

- Unverified bond transfers revert; verified transfers succeed; compliance veto reverts; `Wnok` behaviour preserved; shared registry gates both; redeploy + re-ingest done. All Phase-1 acceptance rows pass.

## Phase 2: Agent Powers

### Goal

Add ERC-3643-style agent controls — pause, address freeze, partial-token freeze, and forced transfer — onto the bond (and pause/freeze onto cash where it makes sense), mapped onto the repo's existing `AccessControl` roles rather than introducing a parallel Owner/Agent role surface.

### Scope

- **Pause / unpause.** `pause()` / `unpause()` (OpenZeppelin `Pausable` or an equivalent flag checked in the transfer hook added in Phase 1). Gated by Agent ≈ `BOND_CONTROLLER_ROLE` (bond) / an operator role (Wnok). The transfer-path check (Phase 1d) additionally reverts when paused.
- **Address freeze.** `setAddressFrozen(address, bool)` + a `frozen` mapping; the transfer hook reverts if `from` or `to` is frozen. Emit `AddressFrozen(addr, bool, agent)`.
- **Partial-token freeze.** `freezePartialTokens(addr, amount)` / `unfreezePartialTokens(addr, amount)` + a `frozenTokens` mapping; the transfer hook requires `balance - frozenTokens >= value` (for bonds, per-partition). Emit `TokensFrozen` / `TokensUnfrozen`.
- **Forced transfer.** `forcedTransfer(from, to, value)` on the bond — reuse the `BaseSecurityToken.custodialTransfer` precedent: gate with `Roles.CUSTODIAL_TRANSFER_ROLE` (already defined), move tokens by authority (bypassing holder consent but still honouring identity verification on `to`), emit a forced-transfer event. For the partitioned bond this is a partition-aware move (call the internal `_move` directly under the role check). Note: `BondToken`'s controller/operator surface (`operatorTransferByPartition`, controllers) already gives an authority path; `forcedTransfer` is the ERC-3643-named, identity-checked wrapper.
- **Owner/Agent mapping (documented, not renamed).** Owner ≈ `DEFAULT_ADMIN_ROLE`; Agent ≈ `BOND_CONTROLLER_ROLE` / `SECURITY_OPERATOR_ROLE` / `CUSTODIAL_TRANSFER_ROLE` depending on the action. Document the mapping table in `contracts/docs/contracts-security.md`; do not rename the existing role library.
- **Honesty on redeploy (Q6).** pause/freeze/forcedTransfer are **token-state** features — the frozen flags and pause flag live in token storage, so they **must** be in the token contract and they **do** require a token change. They are NOT external-module candidates. Therefore: if Phase 2 is bundled with Phase 1, they ride the single Phase 1 redeploy (recommended when the team is ready — see Q6); if Phase 2 lands later, it requires its **own** token redeploy + state reset. The external-registry indirection from Phase 1 does **not** save a redeploy here — that payoff is Phase 3's.

### Steps

1. Add pause/freeze storage + the agent functions to `BondToken` (and pause/freeze to `Wnok` as light controls). Extend the Phase 1 transfer hook to also check paused / frozen / partial-freeze.
2. Add `forcedTransfer` reusing the `CUSTODIAL_TRANSFER_ROLE` precedent; new events + errors in `Errors.sol`.
3. Tests: pause blocks then unpause allows; frozen address blocked both directions; partial freeze blocks only the frozen portion; `forcedTransfer` moves by authority and still enforces `isVerified(to)`; role-negative tests.
4. `forge fmt`; `./slither.sh`; if not bundled with Phase 1, redeploy + re-ingest.

### Verification Stop

- All agent-power Foundry tests green; Slither clean; `cast` demonstration of pause + freeze + forcedTransfer on the local chain.
- If a separate redeploy was needed, `GlobalRegistry` re-pointed and consumers re-ingested.

### Fix Iteration / Rollback

- Standard contract fix-and-rerun. Pre-redeploy: `git restore`. Post-redeploy: redeploy clean + re-point + restart consumers.

### Exit Criteria

- Pause, address-freeze, partial-freeze, and forced-transfer all enforced and tested; Owner/Agent mapping documented; redeploy posture (bundled vs separate) recorded in the PR.

## Phase 3: Compliance Modules

### Goal

Demonstrate the Path B payoff: add real transfer-compliance rules as new modules plugged into the Phase 1 `ModularCompliance` seam, each with **zero** changes to `BondToken` / `Wnok` and **no** token redeploy.

### Scope

One module per testcase, each implementing `IComplianceModule` and added to the bond's (and/or Wnok's) `ModularCompliance` via `addModule`:

- **MaxInvestorsModule** — caps the number of distinct holders (per partition for the bond). `canTransfer` rejects a transfer that would push a new holder over the cap; `created` / `transferred` / `destroyed` maintain the holder count.
- **CountryRestrictModule** — allow/deny by jurisdiction. In the simplified registry this reads a country code attached to the identity (a registry extension or a side mapping until Phase 4 claims exist); `canTransfer` rejects disallowed destinations.
- **LockupModule / TimeTransferLimitsModule** — time-based restrictions: a lockup window after acquisition, and/or a rolling per-period transfer-volume cap. `transferred` records timestamps/volumes; `canTransfer` enforces them.
- **MaxBalanceModule** — caps the maximum balance any single holder may hold (per partition for the bond).
- **SupplyLimitModule** — caps total supply (complements the bond's existing per-partition `partitionOffering` ceiling; useful as a global cap or for a Path-A asset).

Document the module interface (`canTransfer` + `transferred` / `created` / `destroyed`) and the `addModule` / `removeModule` flow on `ModularCompliance` in `contracts/docs/contracts-reference.md`. Each module is independently testable and independently add/removable at runtime.

### Steps

1. Implement one module + its `IComplianceModule` conformance; add it to `resolveContractIdentifier()` in `contracts.sh` (CI gate).
2. Unit-test the module in isolation, then an integration test that adds it to `ModularCompliance` and asserts a bond transfer is gated by it — and a `git diff` proving no `BondToken` / `Wnok` source changed.
3. Repeat per module. `forge fmt`; `./slither.sh`.
4. Wire chosen modules into the deploy/setup script's compliance configuration (which modules are active by default in the sandbox).

### Verification Stop

- Per-module Foundry tests green; integration test shows the rule enforced; `git diff --stat` confirms zero token-source changes; Slither clean; `check-verify-latest-mapping.sh` passes (new modules mapped).

### Fix Iteration / Rollback

- A misbehaving module is removed via `removeModule` (runtime, no redeploy) — the strongest demonstration of the seam. Fix and re-add.

### Exit Criteria

- At least the modules the active testcases need are implemented, tested, and runtime-pluggable with no token redeploy; module flow documented.

## Phase 4: Full Identity (ONCHAINID)

### Goal

Graduate the simplified Phase 1 registry to the full ERC-3643 identity stack — Claim Topics Registry + Trusted Issuers Registry + per-investor ONCHAINID (ERC-734/735) with signed claims — only when a concrete testcase needs multi-issuer verifiable credentials. Because tokens only ever call `isVerified`, this is a registry **swap**, not a token rewrite.

### Scope

- **ClaimTopicsRegistry** — the set of claim topics a holder must satisfy to be verified.
- **TrustedIssuersRegistry** — the issuers whose claims are accepted, per topic.
- **ONCHAINID integration** — per-investor identity contracts (ERC-734 key holder / ERC-735 claim holder) carrying signed claims; the new identity registry's `isVerified(addr)` resolves the investor's ONCHAINID and checks it has valid, unexpired claims for every required topic from a trusted issuer.
- **Swap, not rewrite.** Implement the claim-based registry behind the **same** `IIdentityRegistry.isVerified` interface from Phase 1, then `setIdentityRegistry(newRegistry)` on `BondToken` / `Wnok`. No token bytecode change; no token redeploy. Migrate the verified set (register ONCHAINIDs / issue baseline claims for the existing seeded participants).
- **Dependency decision (D6) bites here.** Real ERC-734/735 + ONCHAINID is where vendoring `@onchain-id` (and possibly `@T-REX`) becomes attractive. That is an **explicit, approval-gated** step (root `AGENTS.md` per-dependency approval + `check-third-party-licenses.py` + `docs/THIRD_PARTY_NOTES.md` / `THIRD_PARTY_LICENSES.md` update). Default remains in-repo simplified implementations unless the operator approves the vendored packages.

### Steps

1. Confirm the triggering testcase (multi-issuer verifiable credentials) — Phase 4 does not start without it.
2. Decide D6 (in-repo vs vendored `@onchain-id`); if vendored, run the dependency-approval + licence workflow first.
3. Implement ClaimTopicsRegistry + TrustedIssuersRegistry + the claim-checking identity registry behind `IIdentityRegistry`.
4. Add the new deployable contracts to `resolveContractIdentifier()` (CI gate).
5. Tests: a holder with valid claims from a trusted issuer is verified and can transfer; revoked/expired claim ⇒ `isVerified` false ⇒ transfer reverts; `setIdentityRegistry` swap leaves token bytecode unchanged (assert address-only change).
6. `setIdentityRegistry(newRegistry)` on both tokens; migrate the seeded participants; `forge fmt`; `./slither.sh`.

### Verification Stop

- Claim-based verification works end-to-end in Foundry; the swap requires no token redeploy (proven by unchanged token addresses if done on the live chain, or unchanged bytecode in tests); Slither clean.

### Fix Iteration / Rollback

- The registry swap is reversible: `setIdentityRegistry(previousSimplifiedRegistry)` restores the Phase 1 behaviour without a token redeploy. Fix forward and re-swap.

### Exit Criteria

- Multi-issuer claim-based identity in use for the triggering testcase, swapped in behind the stable interface with no token redeploy; dependency posture (in-repo vs vendored) recorded and, if vendored, licence-inventoried.

## Local Validation

Run from `contracts/` unless noted (these are the same gates `Contracts CI` runs):

- `forge fmt --check` — formatting gate.
- `forge build --sizes` — compile + contract-size check.
- `bash check-verify-latest-mapping.sh` — every new deployable CREATE contract type is mapped in `contracts.sh resolveContractIdentifier()`.
- `forge test -vvv` — the full suite incl. the new identity / compliance / token tests.
- `./slither.sh` — static analysis; CI fails on **medium**, so no new high/medium findings.
- Live (sandbox up): `./contracts.sh start` redeploy, `cast call <GlobalRegistry> "getContract(string)(address)" "<name>"` to confirm re-point, and the `cast send` bond-transfer gate demonstration (verified ok / unverified revert). `curl http://bond-api.cbdc-sandbox.local/v1/health` to confirm consumers re-ingested.

## Documentation And Index Updates Required

These are **tasks for the implementing PRs**, not applied by this planning pass. (`docs/DOCUMENTATION_INDEX.md` is intentionally **not** edited here — it already has uncommitted working-tree changes; the index entry below is listed as a task to add when this plan is committed.)

- **`docs/DOCUMENTATION_INDEX.md`** — add, under "Core entrypoints" / plans, an entry such as:
  `docs/plans/erc-3643-incremental-adoption-plan.md`: Incremental ERC-3643 (T-REX) adoption — external identity registry + modular compliance for the existing partitioned `BondToken` and `Wnok` (Path B), closing the bond transfer eligibility gap first, then agent powers, then compliance modules, then full ONCHAINID. Phase 1 keystone; Phases 2–4 roadmap in the same doc.
- **`contracts/docs/contracts-reference.md`** — document `IdentityRegistry` / `ModularCompliance` / the module interface and the `setIdentityRegistry` / `setCompliance` / `addModule` flows (Phases 1 + 3).
- **`contracts/docs/contracts-security.md`** — document the new trust model: identity verification + compliance gate on transfers, the Owner/Agent → `AccessControl` role mapping (Phase 2), and the forced-transfer authority.
- **`docs/ARCHITECTURE.md`** — short note in the on-chain architecture / trust-model section that bond and cash transfers are gated by a shared identity registry + modular compliance.
- **`docs/KNOWN_ISSUES.md`** — on Phase 1 ship, retire/annotate the "Central Bank operator is not on its own WNOK allowlist by default" entry (it becomes "not in the shared identity registry") and note the one-time redeploy + state reset that Phase 1 (and a non-bundled Phase 2) entails.
- **`contracts/README.md`** — if a new `script/common/NN_*.s.sol` deploy ordering is introduced, note it in the deploy section.

## Public-Repo Hygiene

This repo is **public**. Before each PR:

- `python3 scripts/verification/check-public-repo-hygiene.py` — no real secrets / keys / identities, no internal hostnames / IPs / tenant ids, no AI-vendor names in committed text.
- `python3 scripts/verification/check-markdown-links.py` — doc links resolve (this plan links several repo docs).
- `python3 scripts/verification/check-third-party-licenses.py` — **only if** a dependency / third-party material changed (i.e. if Phase 4 vendors `@onchain-id` / `@T-REX`; then also update `docs/THIRD_PARTY_NOTES.md` + `THIRD_PARTY_LICENSES.md`).
- Identity seed data must be deterministic local fixtures only (the same posture as the existing `generate-local-sandbox-fixtures.mjs` keys) — never a real address set.

## Documentation And PR Plan

Branch naming (`feature/<kebab>` → `development`), commit / PR style, and CI gates are owned by `sandbox-pr-workflow` — point to it rather than restating here. Per repo policy: **no AI attribution** in commits or PR bodies; branch targets `development`, not `main`.

Recommended split — one PR per phase (Phase 1 is the keystone and ships first):

- **PR 1 — `feature/erc3643-identity-compliance` (Phase 1, the keystone):** `IIdentityRegistry` + `IdentityRegistry`, `ICompliance` + `ModularCompliance` + `DefaultComplianceModule`, token wiring + transfer-path gate, errors + verify-latest mapping + deploy/seed scripts, tests, the one-time redeploy. If Q6 = bundle, fold Phase 2's token surface in here.
- **PR 2 — Phase 2 (agent powers):** only if not bundled into PR 1 (then it carries its own token redeploy).
- **PR 3 — Phase 3 (compliance modules):** one PR (or one per module); ZERO token changes — the headline of the PR body.
- **PR 4 — Phase 4 (ONCHAINID):** gated on a concrete testcase + the D6 dependency decision.

Evidence to capture in each PR body:

- `forge test -vvv` output (the new tests called out by name).
- `forge build --sizes` and `./slither.sh` output (no new high/medium).
- `bash check-verify-latest-mapping.sh` passing.
- For Phase 1/2 (and a non-bundled Phase 2): the `cast` transcript of the redeploy + the gate demonstration (verified ok / unverified revert) and the `GlobalRegistry.getContract` re-point.
- For Phase 3: `git diff --stat` proving zero token-source changes; the `addModule` → enforced → `removeModule` runtime transcript.
- For Phase 4: the registry-swap proof (unchanged token bytecode/address) and, if vendored, the licence-inventory diff.
- Public-repo hygiene script output.

## Residual Risks

- **Redeploy state reset is the one genuinely disruptive step.** Phase 1 (and a non-bundled Phase 2) resets `BondToken` / `Wnok` balances and identity state because the tokens are non-upgradeable. Locally harmless; flagged as a portability concern for any future non-local promotion.
- **`from`-side verification on bonds.** Today `from` is always an existing holder, so checking `isVerified(from)` could in theory strand a holder who was de-listed after acquiring units. That is the intended ERC-3643 behaviour (a de-listed holder shouldn't move tokens) but it changes today's "anyone holding can transfer" behaviour — call it out so it isn't a surprise. The agent forced-transfer (Phase 2) is the escape hatch for legitimately moving a de-listed holder's tokens.
- **Compliance hook gas on the bond transfer path.** Each transfer now ANDs every active module's `canTransfer` and fans out the `transferred` hook. With many Phase 3 modules this adds gas; keep the default module set small and document the cost. Slither/forge-size gates catch egregious regressions.
- **Aligned-not-conformant interface (D3) limits external T-REX tooling.** If an external T-REX UI or explorer is later required, the aligned-semantics choice needs revisiting toward literal `IERC3643` — a larger change. Surfaced as Open Question Q3.
- **Phase 4 dependency surface.** Real ONCHAINID may pull `@onchain-id` / `@T-REX`; that is approval-gated and licence-reviewed (D6) and could stall Phase 4 if the licence posture is unacceptable. Deferring ONCHAINID to last contains this risk.
- **Country/jurisdiction data before Phase 4.** The Phase 3 `CountryRestrictModule` needs a country attribute per identity; before claim-based identity exists, that is a sandbox side-mapping — a simplification to flag, superseded by real claims in Phase 4.

## Done Criteria

- **Phase 1:** unverified bond transfers revert, verified transfers succeed, compliance veto reverts, `Wnok` behaviour preserved, shared registry gates both tokens, one-time redeploy + consumer re-ingest complete; all Phase-1 acceptance rows pass; `Contracts CI` gates green; plan status updated and Phase 2 ready to execute from this same doc.
- **Phases 2–4:** each phase's exit criteria met when executed; the doc's status line advances; on full completion the file moves to `docs/plans/archive/` with PR links (per `sandbox-doc-maintainer` conventions).
- The `docs/DOCUMENTATION_INDEX.md` entry (listed above) is added when this plan is committed.
