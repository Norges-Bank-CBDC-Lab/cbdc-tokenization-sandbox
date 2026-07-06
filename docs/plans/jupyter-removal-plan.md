# `jupyter-removal` — Implementation Plan

**Status:** Draft, ready for operator review — replaces the earlier discovery-phase removal plan in full (that plan's inventory has been re-verified and folded in here; its replacement-UI track is obsolete now that the NB UI operator frontend has shipped).
**Branch suggestion:** `feature/jupyter-removal-metadata-namespace` (PR 1) and `feature/jupyter-removal` (PR 2) — defer the actual branch / commit / PR / CI-gate workflow to the repo PR conventions.
**Components touched:** `sandbox.sh`, `common/helpers.sh`, `common/images.yaml`, `common/versions.yaml`, `infra/gateway/templates/gateway.yaml`, `services/script-runner/` (deleted), `.github/workflows/pylint.yml` (deleted), `.github/workflows/license-inventory.yml`, `scripts/verification/check-third-party-licenses.py`, `THIRD_PARTY_LICENSES.md`, `docs/THIRD_PARTY_NOTES.md`, `README.md`, `CONTRIBUTING.md`, `services/README.md`, `services/DEVELOPMENT.md`, `services/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DOCUMENTATION_INDEX.md`.

## Goal

Completely and safely remove the JupyterHub-based script runner from the sandbox: runtime deployment plumbing, gateway exposure, image/chart pins, the service code itself (~3.3k lines of notebook Python plus four notebooks), notebook-specific CI, and all documentation/provenance references. The one hidden coupling — shared contract metadata configmaps living in the `jupyterhub` namespace — is decoupled first as its own reviewable step. When done, `./sandbox.sh start` brings up the full sandbox with no Jupyter reference anywhere in the repo outside `docs/plans/archive/`.

## Current-State Evidence

All of the following was verified in-session against the repo and the running sandbox (`cluster-cbdc-monoledger`, context `kind-cluster-cbdc-monoledger`).

**Live cluster (verified):**

- `helm list -A` shows six releases (`besu`, `blockscout`, `gateway`, `nb-bond-api`, `nb-ui`, `ngf`) — **no JupyterHub release**. `DEPLOY_SCRIPTRUNNER="false"` (`sandbox.sh:55`) is the default and the operational reality.
- The `jupyterhub` namespace nevertheless exists and contains **only** the two shared contract-metadata configmaps: `registry-contract` (key: `address`) and `contracts-deployed` (keys: `chainId`, `registryAddress`, `deployedAt`). On a default deployment the namespace is purely a misnamed carrier of contract metadata.
- `GLOBAL_REGISTRY_ADDRESS` reaches NB Bond API as a **literal Helm value** (`helm -n nb-bond-api get values nb-bond-api`), read from the configmap at deploy time by `sandbox.sh`. **No running workload references the configmaps at runtime**, so moving them touches deploy scripts only.

**Repo wiring (verified, file:line):**

- `common/helpers.sh:21` `REGISTRY_CONTRACT_NAMESPACE=jupyterhub`; `:24` `CONTRACTS_DEPLOYMENT_NAMESPACE=$REGISTRY_CONTRACT_NAMESPACE`; `:29–34` `SCRIPTRUNNER_*` constants (dir, tmpdir, base image `quay.io/jupyter/base-notebook:notebook-7.5.3`, chart version 4.3.2).
- The namespace is created **inline** by the same `kubectl apply` manifests that write the configmaps — `markContractsDeployed()` (`helpers.sh:549–569`) and `deployRegistryContractAddressToConfigmap()` (`helpers.sh:575–591`) both embed a `Namespace` object. Readers: `getRegistryContractAddressFromConfigmap()` (`:520–525`), `contractsDeploymentExists()` (`:527–533`), `getContractsDeploymentChainId()` / `getContractsDeploymentRegistryAddress()` (`:535–547`). `contracts/contracts.sh:166` deletes the registry configmap on `stop`. All follow the two namespace constants — there are no hardcoded `jupyterhub` strings in the configmap read/write paths outside the constants themselves.
- Script-runner-only helpers: `waitForScriptRunner()` (`:815–817`), `getScriptRunnerChartVersion()` (`:948–950`), `getScriptRunnerImage()` (`:1012–1015`), the script/notebook/ABI configmap deployers (`:1439–1474`), `composeScriptRunnerChart()` (`:1477–1490`), `deployScriptRunner()` (`:1492–1512`), plus the `getScriptRunnerImage` entry in `syncImagesToRegistry()` (`:1164`) and the `jupyterhub.cbdc-sandbox.local` entry in `ensureLocalhostHostEntries()` (`:235`).
- `sandbox.sh`: flag banner + default (`:45`, `:55`), flag-override comment (`:152–153`), `requireContractsEnv` gate `DEPLOY_CONTRACTS || DEPLOY_SCRIPTRUNNER` (`:161`), start block (`:235–240`), wait block (`:251–253`), post-deploy URL message (`:290–294`), stop block (`:326–329`).
- Gateway: `jupyterhub-http` listener in `infra/gateway/templates/gateway.yaml:22–28`; the matching `HTTPRoute` lives inside the service (`services/script-runner/templates/httproute.yaml`) and disappears with it.
- Pins: `common/images.yaml:51–52` (`script_runner.base`) plus the base-notebook upstream link in the header comment; `common/versions.yaml:26` (`script_runner: 4.3.2`) plus the JupyterHub chart link comment.
- CI: `.github/workflows/pylint.yml` triggers **only** on `services/script-runner/notebook/**` and runs pylint + black against that tree. `.github/workflows/license-inventory.yml:17` lists `services/script-runner/notebook/requirements.txt` as a trigger path. `.github/workflows/image-hash-inputs.yml` does **not** cover script-runner (it uses the upstream chart, no locally built image).
- License tooling: `scripts/verification/check-third-party-licenses.py:346–347` **parses `services/script-runner/notebook/requirements.txt`** — deleting the file without updating the checker breaks the license gate. `THIRD_PARTY_LICENSES.md` (~lines 47, 144–180) carries the notebook Python dependencies, the Jupyter base-notebook image, and the JupyterHub chart entries. `docs/THIRD_PARTY_NOTES.md:17` lists `services/script-runner/templates/NOTES.txt` as adapted third-party material.
- Docs: `README.md:139` (flag list), `:161` (hosts example); `CONTRIBUTING.md:42–49` (notebook lint/format section); `services/README.md:11, 31, 55`; `services/DEVELOPMENT.md:94–119, 152, 185–186`; `docs/ARCHITECTURE.md:68–69, 78, 197–285` (component entry, hostname list, full Script Runner section).
- Blockscout `mapping` table: created and seeded by the Blockscout chart's BENS db-init job (`services/blockscout/templates/bens-db-init-job.yaml:36–41`, post-install hook), read by the BENS microservice. The notebook UI's runtime reads/writes of this table disappear with the service; the table, its seeding, and BENS behaviour on a default deployment (script runner off) are **unchanged** by this removal.

**Blocked / unverified:** none — sandbox was up for all live checks.

## Scope

### In Scope

- Move the shared contract-metadata configmaps out of the `jupyterhub` namespace (Phase 1, own PR).
- Remove all script-runner runtime plumbing, gateway exposure, host entry, flag surface, and pins (Phase 2).
- Delete `services/script-runner/` and notebook-specific CI; update license inventory and its checker in the same change (Phase 3).
- Documentation and provenance cleanup, final full-stack validation (Phases 4–5).

### Out Of Scope

- Replacement UI work. The NB UI operator frontend already covers the commercial-bank and central-bank workflows (see Capability Disposition below); the remaining equity/broker flows are retired here and belong to the ERC-3643 migration track (`docs/decisions/0002-adopt-erc-3643-for-tokenized-securities.md`).
- Any change to BENS, the `mapping` table, or Blockscout.
- Non-local deployment concerns (none identified; this change only shrinks the surface).

## Capability Disposition

What the notebooks provided, and where each flow stands after removal:

| Notebook capability | Disposition |
|---|---|
| Commercial bank view (TBD mint/burn, allowlist, balances) | Replaced — NB UI Banking page (shipped) |
| Norges Bank view (wNOK mint/burn/transfer, allowlist) | Replaced — NB UI Central Bank page (shipped) |
| Issuer view (stock issuance/listing), broker view (orders, trades, price chart), onboarding/mapping registration | Retired — equity flows are re-planned under the ERC-3643 migration, not rebuilt as-is |
| `raw.ipynb` Web3 scratchpad, `MarketMaker.ipynb` | Retired — `cast`/Foundry and the reference CLIs (`scripts/bid-encryption/`, `scripts/bid-submitter/`) cover developer needs |
| `sync.sh` pod↔repo notebook sync | Retired with the service |

All deleted code remains retrievable from git history at `services/script-runner/` prior to the removal commit.

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| D1: New namespace for shared contract metadata | `contracts` / `besu` / `default` | `contracts` — self-describing, matches the data it carries; created inline by the existing apply manifests, so no extra bootstrap code | Confirm name before PR 1 |
| D2: Notebook code fate | Delete entirely / keep as untracked local tooling | Delete entirely; git history preserves it, and the useful flows are either shipped in NB UI or re-planned under ERC-3643 | Confirm |
| D3: Existing-cluster migration | Full `./sandbox.sh delete && start` / manual configmap copy | Full recreate (the sandbox is disposable by design). The copy path exists for clusters that must survive — see Phase 1 | Confirm recreate is acceptable |
| D4: GitHub required-status config | — | Before merging PR 2, confirm in repo settings that the pylint workflow is not a required status check; a required check whose workflow no longer exists blocks all PRs | Operator checks GitHub settings |

## Acceptance Criteria

| Criterion | Verification evidence | Target state |
|---|---|---|
| Shared contract metadata decoupled from Jupyter | `kubectl get configmap -n contracts` shows `registry-contract` + `contracts-deployed`; `jupyterhub` namespace absent on a fresh default deploy | After PR 1 |
| Full sandbox works without script-runner code present | `./sandbox.sh delete && ./sandbox.sh start` completes; all pods Ready; NB Bond API `/v1/health` OK; NB UI reachable | After PR 2 |
| No repo references remain | `rg -i 'jupyter|scriptrunner|script-runner|script_runner|DEPLOY_SCRIPTRUNNER'` hits only `docs/plans/archive/` | After PR 2 |
| Gateway no longer exposes the hostname | `helm template` diff shows only the `jupyterhub-http` listener removed; `kubectl get gateway -A` shows no jupyterhub listener | After PR 2 |
| License gate stays green | `python3 scripts/verification/check-third-party-licenses.py` passes with the requirements file and inventory entries removed together | After PR 2 |
| Hygiene gates stay green | `check-public-repo-hygiene.py`, `check-markdown-links.py` pass; CI green on both PRs | Both PRs |

## Assumptions

- The genesis-predeployed `GlobalRegistry` address and contract deployment flow are unchanged by this work; only the *location* of the metadata configmaps moves.
- No component outside this repo consumes the `jupyterhub` namespace. (The sandbox is local-only; any external consumer would be a repo-boundary violation.)
- Stale `DEPLOY_SCRIPTRUNNER` lines in operators' existing generated `.env.sandbox` files are harmless after removal (an exported-but-unread variable); regenerating via `./sandbox.sh generate-config` clears them.

## Plan Order

```
Phase 0  Baseline verification (read-only)
Phase 1  Decouple shared contract metadata  → PR 1  (Gate: D1, D3 confirmed)
Phase 2  Remove runtime plumbing + pins + gateway     ┐
Phase 3  Delete service code + CI + license inventory │ → PR 2  (Gate: D2, D4 confirmed; PR 1 merged)
Phase 4  Docs + provenance cleanup                    ┘
Phase 5  Full-stack validation + plan archival
```

Phases 2–4 ship as one PR: the license-inventory gate forces the requirements-file deletion, checker update, and `THIRD_PARTY_LICENSES.md` edits to land atomically, and a half-removed service is a worse intermediate state than a slightly larger PR.

## Phase 0: Baseline Verification

### Goal

Prove the starting state before changing anything.

### Steps

- `kind get clusters` → `cluster-cbdc-monoledger`; `kubectl config current-context` → `kind-cluster-cbdc-monoledger`.
- `helm list -A` → six releases, no `jupyterhub` release.
- `kubectl -n jupyterhub get configmaps` → exactly `registry-contract`, `contracts-deployed` (+ `kube-root-ca.crt`).
- `curl -s http://bond-api.cbdc-sandbox.local/v1/health` → healthy; note the reported chain id and registry address for later comparison.
- `python3 scripts/verification/check-public-repo-hygiene.py && python3 scripts/verification/check-markdown-links.py && python3 scripts/verification/check-third-party-licenses.py` → all pass pre-change.

### Verification Stop

All baseline reads match the Current-State Evidence above. If they don't (e.g. a JupyterHub release *is* deployed because the operator runs with the flag on), record the delta and re-check the Phase 1/2 impact before proceeding.

### Fix Iteration / Rollback

Read-only phase — nothing to roll back.

### Exit Criteria

Baseline recorded; D1–D4 answered.

## Phase 1: Decouple Shared Contract Metadata (PR 1)

### Goal

Shared contract metadata no longer lives in the `jupyterhub` namespace, while everything (including the still-present script runner) keeps working.

### Scope

`common/helpers.sh` only — the constants are the single source; all readers/writers follow them.

### Steps

1. `common/helpers.sh:21`: `REGISTRY_CONTRACT_NAMESPACE=contracts` (D1). `CONTRACTS_DEPLOYMENT_NAMESPACE` (`:24`) already derives from it — no further change.
2. Leave `SCRIPTRUNNER_NAMESPACE=jupyterhub` (`:29`) untouched — the script runner (until Phase 3) keeps deploying to its own namespace; the coupling is what's being severed.
3. Verify no other hardcoded `jupyterhub` string exists in a configmap read/write path: `rg -n 'jupyterhub' common/ contracts/ sandbox.sh` — expected hits only in the `SCRIPTRUNNER_*` constants, host-entry list, and start/stop blocks (all Phase 2 targets).
4. Nothing creates the new namespace explicitly — both writer functions embed a `Namespace` object in their `kubectl apply` (`helpers.sh:554–558`, `:578–582`), so `contracts` comes into existence on the next contract deployment.

### Verification Stop

- **Fresh recreate (D3 default):** `./sandbox.sh delete && ./sandbox.sh start` with default flags. Then: `kubectl get ns` shows `contracts` and **no** `jupyterhub`; `kubectl -n contracts get configmaps` shows both maps; NB Bond API `/v1/health` healthy and its `GLOBAL_REGISTRY_ADDRESS` (Helm values) matches the configmap; `./contracts/contracts.sh stop && ./contracts/contracts.sh start` round-trips cleanly against the new namespace.
- Optional (only if the operator wants the script runner exercised one last time): a start with `DEPLOY_SCRIPTRUNNER=true` still deploys and reaches `http://jupyterhub.cbdc-sandbox.local/` — the runner reads the registry address through the moved constant.

### Fix Iteration / Rollback

- Git revert of the one-line constant change; `./sandbox.sh delete && start` returns to the old layout.
- **Migration trap (do not skip):** on an *existing* cluster, changing the constant makes `contractsDeploymentExists()` look in the empty new namespace, so the next `./sandbox.sh start` would **redeploy the contracts** — new `BondManager`/`BondToken` addresses, orphaning existing bonds. The recreate path avoids this entirely. If a cluster must survive, copy first: `kubectl -n jupyterhub get cm registry-contract contracts-deployed -o yaml | sed 's/namespace: jupyterhub/namespace: contracts/' | kubectl apply -f -` (after `kubectl create ns contracts`), then `kubectl delete ns jupyterhub`.

### Exit Criteria

Fresh default deployment carries contract metadata in `contracts`; no `jupyterhub` namespace exists; PR 1 merged with CI green.

## Phase 2: Remove Runtime Plumbing, Pins, And Gateway Exposure

### Goal

`./sandbox.sh start` (and every helper it sources) has no script-runner path; the gateway stops exposing the hostname; registry sync stops pulling the base image.

### Steps

1. `sandbox.sh`: remove the `DEPLOY_SCRIPTRUNNER` default (`:55`) and its banner-comment line (`:45`); remove the flag-override comment (`:152–153`); simplify the `requireContractsEnv` gate (`:161`) to `DEPLOY_CONTRACTS` only; remove the start block (`:235–240`), wait block (`:251–253`), post-deploy URL message (`:290–294`), and stop block (`:326–329`); remove the flag from `generate-config` output. Per the root `AGENTS.md` flag-documentation rule, the `DEPLOY_*` banner block must end up listing exactly the remaining 7 flags.
2. `common/helpers.sh`: remove `SCRIPTRUNNER_*` constants (`:29–34`), the `jupyterhub.cbdc-sandbox.local` host entry (`:235`), `waitForScriptRunner` (`:815–817`), `getScriptRunnerChartVersion` (`:948–950`), `getScriptRunnerImage` (`:1012–1015`), the `syncImagesToRegistry` entry (`:1164`), the three script-runner configmap deployers (`:1439–1474`), `composeScriptRunnerChart` (`:1477–1490`), `deployScriptRunner` (`:1492–1512`). Check `deployEvmEnvironmentSecret` (`:608–626`) for remaining callers with `rg -n 'deployEvmEnvironmentSecret'` — if the script runner was its only caller, remove it too; if contracts/blockscout paths use it, keep it.
3. `infra/gateway/templates/gateway.yaml:22–28`: remove the `jupyterhub-http` listener.
4. `common/images.yaml`: remove the `script_runner:` block (`:51–52`) and the base-notebook upstream link in the header comment. `common/versions.yaml`: remove `script_runner: 4.3.2` (`:26`) and the JupyterHub chart link comment.
5. Confirm `.github/workflows/image-hash-inputs.yml` needs no change (verified: it does not cover script_runner).

### Verification Stop

- `bash -n sandbox.sh common/helpers.sh` (syntax) and `rg -n 'SCRIPTRUNNER|ScriptRunner|script_runner' sandbox.sh common/ infra/` → zero hits.
- `helm template gateway infra/gateway --values infra/gateway/values.local.yaml` renders; diff against pre-change render shows **only** the listener removal (classify every predicted delete).
- `./infra/infra.sh registry-sync` completes without referencing the base-notebook image.

### Fix Iteration / Rollback

Git revert; the gateway chart re-applies the listener on the next `./sandbox.sh start`. No data at risk in this phase.

### Exit Criteria

Repo-side runtime surface is script-runner-free; gateway render diff is exactly one listener.

## Phase 3: Delete The Service, CI, And License Inventory (Atomic With Phase 2 In PR 2)

### Goal

Remove the code and every gate that referenced it, keeping the license inventory check green in the same commit.

### Steps

1. `git rm -r services/script-runner/` (D2).
2. Delete `.github/workflows/pylint.yml` (it targets only the deleted tree). Gate: D4 confirmed (not a required status check).
3. `.github/workflows/license-inventory.yml:17`: remove the `services/script-runner/notebook/requirements.txt` trigger path.
4. `scripts/verification/check-third-party-licenses.py:346–347`: remove the parsing of the deleted requirements file (and any section mapping tied to it).
5. `THIRD_PARTY_LICENSES.md`: remove the script-runner notebook Python dependency entries, the Jupyter base-notebook image entry, and the JupyterHub chart entry (~lines 47, 144–180). `docs/THIRD_PARTY_NOTES.md:17`: remove the `NOTES.txt` adapted-material entry.

### Verification Stop

- `python3 scripts/verification/check-third-party-licenses.py` passes.
- `rg -i 'jupyter|scriptrunner|script-runner|script_runner|ipynb|pylint'` across the repo → hits only under `docs/plans/archive/` and remaining Phase 4 doc targets.

### Fix Iteration / Rollback

Git revert restores code, workflow, and inventory together — the atomicity is why these land in one commit.

### Exit Criteria

Service gone; CI workflow list down to 7; license gate green.

## Phase 4: Documentation And Provenance Cleanup

### Goal

Documentation reflects the actual runtime; no doc instructs a reader to use a removed component.

### Steps

- `README.md`: remove `DEPLOY_SCRIPTRUNNER` from the flag list (`:139`) and `jupyterhub.cbdc-sandbox.local` from the hosts example (`:161`).
- `CONTRIBUTING.md:42–49`: remove the Script Runner Notebook lint/format section.
- `services/README.md` (`:11, :31, :55`), `services/DEVELOPMENT.md` (`:94–119, :152, :185–186`), `services/AGENTS.md`: remove script-runner sections/mentions.
- `docs/ARCHITECTURE.md`: remove the component entry (`:68–69`), the hostname from the ingress list (`:78`), and the Script Runner section (`:197–285`); adjust component numbering/diagram text accordingly.
- `docs/KNOWN_ISSUES.md`: sweep for script-runner mentions (e.g. the "build-images is Blockscout-only" item mentions the component set) and update as found.
- `docs/DOCUMENTATION_INDEX.md`: update this plan's entry; on shipping, move this file to `docs/plans/archive/` and update its `Status:` line with the merging PR numbers.

### Verification Stop

- `python3 scripts/verification/check-public-repo-hygiene.py && python3 scripts/verification/check-markdown-links.py` pass.
- Final sweep: `rg -i 'jupyter|scriptrunner|script-runner|script_runner|DEPLOY_SCRIPTRUNNER|ipynb'` → hits only under `docs/plans/archive/`.

### Fix Iteration / Rollback

Docs-only; git revert.

### Exit Criteria

Sweep clean; hygiene green.

## Phase 5: Full-Stack Validation And Archival

### Goal

Prove the sandbox end-to-end from a clean slate with the removal merged.

### Steps

- `./sandbox.sh delete && ./sandbox.sh start` (default flags) on the merged `development` branch.
- `kubectl get pods -A | grep -Ev '\sRunning|\sCompleted'` → empty; `kubectl get ns` → no `jupyterhub`; `contracts` present with both configmaps.
- Gateway: `curl -sI http://web.cbdc-sandbox.local/` → 200; `curl -sI http://jupyterhub.cbdc-sandbox.local/` → connection/404 failure is the *expected* result (host entry may linger in `/etc/hosts` on operator machines; harmless).
- NB Bond API `/v1/health` healthy; chain head advancing; Blockscout indexing; one end-to-end smoke (create bond → auction → close → finalise via NB UI or API).
- Move this plan to `docs/plans/archive/`, update `Status:` with PR numbers, update `docs/DOCUMENTATION_INDEX.md`.

### Verification Stop

All acceptance criteria in the table above check off with captured evidence.

### Fix Iteration / Rollback

A failed full recreate at this point indicates a missed reference — fix forward (the sweep in Phase 4 makes this unlikely); `git revert` of PR 2 restores the previous state if needed.

### Exit Criteria

Done Criteria below all true.

## Documentation And PR Plan

Branch naming, commit / PR style, and CI gates follow the repo PR conventions.

- **PR 1** (`feature/jupyter-removal-metadata-namespace`): Phase 1 — the one-line namespace constant move + evidence of the fresh-recreate validation. Small and independently revertible.
- **PR 2** (`feature/jupyter-removal`): Phases 2–4 — plumbing, deletion, CI, license inventory, docs. Atomic for the license gate.
- Evidence for PR bodies: baseline vs post-change `helm template` gateway diff, `kubectl get ns` / configmap listings, health-check outputs, hygiene + license script passes, the final `rg` sweep output.

## Residual Risks

- **GitHub required-status trap (D4):** if the pylint workflow is configured as a required check, deleting it blocks every PR until repo settings are updated. Checked before merge; fixed in settings, not in the repo.
- **Existing clusters:** anyone pulling PR 1 and running `./sandbox.sh start` against a pre-existing cluster without recreating triggers the contract-redeploy trap (see Phase 1 rollback). Mitigated by calling it out in the PR 1 body; the repo's norm of disposable sandboxes makes recreate the expected path.
- **Stale operator state:** old `/etc/hosts` entries and `.env.sandbox` flags linger harmlessly; `./sandbox.sh generate-config` and manual hosts cleanup are optional.
- **Lost demo logic:** the broker/issuer notebook flows (order book, trades, price chart) have no current replacement; they are deliberately retired and their re-imagining belongs to the ERC-3643 track. Git history retains the reference implementation.

## Done Criteria

- Fresh `./sandbox.sh start` deploys the complete sandbox with no Jupyter component, namespace, listener, pin, flag, or helper.
- Shared contract metadata lives in the `contracts` namespace; contract deploy/stop round-trips work.
- `rg -i 'jupyter|scriptrunner|script-runner|script_runner|DEPLOY_SCRIPTRUNNER|ipynb'` hits only `docs/plans/archive/`.
- All CI workflows green; license, hygiene, and markdown-link checks pass.
- This plan is archived with PR numbers in its `Status:` line.
