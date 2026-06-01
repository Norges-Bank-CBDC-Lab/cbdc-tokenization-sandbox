# Blockscout Contract Verification — Implementation Plan

**Status:** Implemented — verified live on the local sandbox (13/13 contracts `is_verified: true`); pending PR. Move to `docs/plans/archive/` with the PR link once merged.
**Branch suggestion:** `feature/blockscout-sc-verifier` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `common/images.yaml`, `services/blockscout/templates/` (2 new), `services/blockscout/values.backend.env.yaml`, `common/helpers.sh` (`deployBlockscout` image wiring), `contracts/contracts.sh` (`verify-latest` hardening), docs (`THIRD_PARTY_*`, `services/blockscout/debugging.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`)

## Goal

`make verify-contracts` should produce **actually-verified** contracts in the local Blockscout, not a false `success=13`. After this change, the local Blockscout stack runs a **smart-contract-verifier** microservice; the backend is wired to it; `verify-latest` waits for and reports the *real* verification result; and re-running `make verify-contracts` flips the deployed contracts (chain 2018) to `is_verified: true` in Blockscout, with source visible in the UI.

## Non-Goals

- No change to which contracts are deployed or to the verifier URL (`BLOCKSCOUT_LOCAL_URL` is already correct).
- No Vyper verification (Solidity-only; this repo is Foundry/Solidity).
- No cloud/Azure deployment of the verifier — local-first only; the upstream `blockscout-stack` chart wrapping pattern is local (see `docs/AZURE_BOUNDARY.md`).

## Current-State Evidence

- **Diagnosed live this session:**
  - `make verify-contracts` → `contracts/contracts.sh verify-latest` → `forge verify-contract … --verifier blockscout --verifier-url $BLOCKSCOUT_LOCAL_URL` (no `--watch`). Script counts forge submission as `success` (reported `total=13 success=13`).
  - `contracts/.env` `BLOCKSCOUT_LOCAL_URL=http://blockscout.cbdc-sandbox.local:80/api/` is correct; `/api` → backend svc `blockscout-blockscout-stack-blockscout-svc:80` returns 200 JSON; Blockscout synced (`total_blocks=77` == Besu height; `finished_indexing: true`).
  - forge output: `Submitted contract for verification: Response: OK, GUID: …` — submission accepted, not verified.
  - `kubectl get pods -n blockscout` = backend, frontend, `bens-deployment`, postgres only — **no smart-contract-verifier**. Backend env wires only `MICROSERVICE_BENS_*`. Deployed contracts confirmed unverified: v2 `/api/v2/smart-contracts/{addr}` returns bytecode-only keys; legacy `getsourcecode` → `ContractName=None`.
- **Repo declarations inspected:**
  - `common/helpers.sh` `composeBlockscoutChart` (pulls `blockscout-stack` v4.4.3, copies `services/blockscout/templates/*` in) and `deployBlockscout` (resolves each image → `loadImageToKind` → `kindRegistryImageFor`/`prepareBensImage` → `helm upgrade … --set bensImage=…`, with values files `values.yaml`, `values.local.yaml`, `values.backend.env.yaml`, `values.frontend.env.yaml`).
  - `common/images.yaml` → `blockscout.{backend,frontend,bens}` pins.
  - Model templates `services/blockscout/templates/bens-deployment.yaml` (port 8050, hardened `securityContext` incl. `readOnlyRootFilesystem: true`, `runAsNonRoot`, drop ALL) + `bens-service.yaml` (port 80 → 8050).
- **Live checks run:** cluster context `kind-cluster-cbdc-monoledger`; blockscout pods/services; `/api/v2/stats`, `/api/v2/smart-contracts/{addr}`, legacy `getsourcecode`; Besu height via `eth_blockNumber`.
- **Not yet verified:** the exact `ghcr.io/blockscout/smart-contract-verifier` tag compatible with backend `v10.0.8`, and that the sc-verifier pod can fetch solc compilers from the local Kind network (egress) — both validated in Phase 3/4.

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| **D1 — sc-verifier image source** | upstream `ghcr.io/blockscout/smart-contract-verifier:<tag>`, mirrored to the kind registry like backend/frontend | Upstream, pinned in `common/images.yaml` under `blockscout.smartContractVerifier`; mirror via `kindRegistryImageFor` (NOT locally built — it's a third-party image, unlike BENS). | ✅ Operator approved the new image pin. Confirm pinning the latest stable tag is acceptable. |
| **D2 — compiler fetching / writable fs** | (a) `readOnlyRootFilesystem: true` + `emptyDir` mounted at the compilers dir + `…COMPILERS_DIR` env; (b) `readOnlyRootFilesystem: false` | **(a)** — keep the hardened posture (matches BENS), add an `emptyDir` for `/tmp` + a compilers dir and point the env at it. | Confirm OK to keep hardened (recommended). |
| **D3 — egress for compiler downloads** | sc-verifier fetches the solc list + binaries from `solc-bin.ethereum.org` on first use | Local Kind has egress; accept on-demand fetch. Flag as a runtime dependency (offline sandboxes would need a pre-baked compilers volume — out of scope). | None (flagged as a portability note). |
| **D4 — verify-latest hardening** | add `--watch` (forge polls Blockscout for the real result) vs. custom GUID polling | `--watch` — least code, surfaces the true status and non-zero exit on failure. Keep `verify` (non-latest) consistent. | None. |

## Portability Flags

- The sc-verifier's on-demand solc fetch needs network egress. A future air-gapped/cloud deploy would pre-bake or PVC-mount a compilers cache — flagged, not solved here.
- The deploy wiring stays env/`--set`-driven (no hardcoded image refs in templates), consistent with the existing chart-as-input posture in `docs/AZURE_BOUNDARY.md`.

## Acceptance Criteria

| Criterion | Why | Verification evidence | Target |
|---|---|---|---|
| sc-verifier pod Ready | The microservice exists | `kubectl get pods -n blockscout` shows the sc-verifier pod `Running`/Ready | Pass |
| Backend wired to it | Verification routes to the microservice | backend deploy env shows `MICROSERVICE_SC_VERIFIER_ENABLED=true` + `_URL` + `_TYPE` | Pass |
| Contracts actually verify | The bug is fixed | After `make verify-contracts`: `/api/v2/smart-contracts/<addr>` → `is_verified: true` + `name`; legacy `getsourcecode` → real `ContractName`; source visible in UI | Pass |
| Script reports truth | No more false success | `verify-latest` (now `--watch`) exits non-zero / prints failure if a contract doesn't verify | Pass |
| No unrelated chart drift | Safe deploy | `helm template` diff shows only the sc-verifier additions | Pass |
| Public-repo hygiene + license | Public repo | `check-public-repo-hygiene.py`, `check-markdown-links.py`, `check-third-party-licenses.py` pass; new image recorded in the third-party inventory | Pass |

## Assumptions

- The `blockscout-stack` v4.4.3 backend (`ghcr.io/blockscout/blockscout:v10.0.8`) supports `MICROSERVICE_SC_VERIFIER_*` wiring (it does; this is the standard Blockscout verification path).
- The sc-verifier's default Solidity fetcher config works against `solc-bin.ethereum.org` from the local cluster.

## Plan Order

```
Phase 0  Baseline (capture unverified state for a known contract)
Phase 1  Image pin + deploy wiring (images.yaml, helpers.sh)
Phase 2  Verifier templates + backend env (sc-verifier Deployment/Service, values.backend.env.yaml)
Phase 3  Render + local apply (helm template diff, redeploy Blockscout)
Phase 4  Script hardening (verify-latest --watch) + end-to-end verification
Phase 5  Docs + public-repo hygiene
```

## Phase 0: Baseline Verification

### Goal
Capture the current "unverified" evidence for a known deployed contract so Phase 4 shows the flip.

### Steps
- Confirm context: `kubectl config current-context` = `kind-cluster-cbdc-monoledger`.
- Record for e.g. BondAuction `0xcd15…db9b`: `/api/v2/smart-contracts/<addr>` (bytecode-only) and legacy `getsourcecode` (`ContractName=None`).

### Verification Stop
- Baseline confirms unverified.

### Exit Criteria
- Known address + its current unverified response recorded.

## Phase 1: Image Pin And Deploy Wiring

### Goal
Pin the sc-verifier image and teach `deployBlockscout` to load + register + pass it to helm (mirroring backend/postgres, not the locally-built BENS path).

### Steps
- `common/images.yaml`: add `blockscout.smartContractVerifier: ghcr.io/blockscout/smart-contract-verifier:<pinned-tag>`.
- `common/helpers.sh`: add a getter (e.g. `getBlockscoutScVerifierImage`) mirroring `getBlockscoutBackendImage`; in `deployBlockscout`, `loadImageToKind` + `kindRegistryImageFor` it and add `--set scVerifierImage=<registry-ref>` to the `helm upgrade`.

### Verification Stop
- `getBlockscoutScVerifierImage` echoes the pinned ref; `bash -n common/helpers.sh` clean.

### Fix Iteration / Rollback
- Revert the two files; nothing applied to the cluster yet.

### Exit Criteria
- Image resolvable and wired; no cluster change yet.

## Phase 2: Verifier Templates And Backend Env

### Goal
Add the sc-verifier Deployment + Service and wire the backend to it.

### Steps
- `services/blockscout/templates/sc-verifier-deployment.yaml` (mirror `bens-deployment.yaml`): `image: {{ required … .Values.scVerifierImage }}`, container port 8050, `/health` probes, hardened `securityContext` **plus** an `emptyDir` mounted at a writable compilers dir and `/tmp`, with env `SMART_CONTRACT_VERIFIER__SOLIDITY__ENABLED=true`, `SMART_CONTRACT_VERIFIER__SOLIDITY__COMPILERS_DIR=<writable>`, `SMART_CONTRACT_VERIFIER__SERVER__HTTP__ADDR=0.0.0.0:8050`, Vyper/Sourcify disabled. (D2: keep `readOnlyRootFilesystem: true` with the writable mounts.)
- `services/blockscout/templates/sc-verifier-service.yaml` (mirror `bens-service.yaml`): port 80 → 8050.
- `services/blockscout/values.backend.env.yaml`: add `MICROSERVICE_SC_VERIFIER_ENABLED: "true"`, `MICROSERVICE_SC_VERIFIER_URL: http://<sc-verifier-svc>:80/`, `MICROSERVICE_SC_VERIFIER_TYPE: sc_verifier` (mirror the `MICROSERVICE_BENS_*` block; confirm exact file by grepping where `MICROSERVICE_BENS_*` lives).

### Verification Stop
- `helm template blockscout <chart> --values …` renders the new Deployment/Service and the backend env without error.

### Fix Iteration / Rollback
- Delete the new templates + revert the env file.

### Exit Criteria
- Chart renders cleanly with the sc-verifier resources.

## Phase 3: Local Apply / Redeploy

### Goal
Apply the smallest change that proves it: redeploy Blockscout.

### Steps
- Redeploy via the repo's Blockscout flow (the service start path that calls `composeBlockscoutChart` + `deployBlockscout`; confirm the exact entrypoint — `./services/blockscout/…` or `./sandbox.sh` blockscout step — from the service scripts).

### Verification Stop
- `kubectl get pods -n blockscout` → sc-verifier `Ready`; `kubectl -n blockscout logs <sc-verifier>` shows it started + (on first verify) fetched compilers, no crashloop.
- Backend deploy env shows `MICROSERVICE_SC_VERIFIER_*`.
- `helm -n blockscout history blockscout` shows a new `deployed` revision.

### Fix Iteration / Rollback
- `helm -n blockscout rollback blockscout <prev>`; or revert templates/values and redeploy. If the pod can't fetch compilers, capture logs and reconsider D3 (pre-baked compilers).

### Exit Criteria
- sc-verifier Ready and backend wired.

## Phase 4: Script Hardening And End-To-End Verification

### Goal
Make `verify-latest` report the truth and prove contracts verify.

### Steps
- `contracts/contracts.sh`: default `verify-latest` (and `verify`) to pass `--watch` to `forge verify-contract` so it polls the real status and fails loudly; keep the existing `--no-...`/override flags consistent.
- Re-run `make verify-contracts`; watch each contract reach `Contract successfully verified`.

### Verification Stop
- `/api/v2/smart-contracts/<addr>` → `is_verified: true`, real `name`; legacy `getsourcecode` → real `ContractName`; source visible at `http://blockscout.cbdc-sandbox.local/address/<addr>`.
- Negative check: a deliberately wrong compiler/args now yields a **non-zero** script exit (no more silent success).

### Fix Iteration / Rollback
- If verification fails: read sc-verifier logs (compiler version match, constructor args). Adjust env/args; `--guess-constructor-args` already on. Roll back script change independently if needed.

### Exit Criteria
- Deployed contracts show verified in Blockscout; script reports real status.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal
Record the new microservice and the now-working flow; keep the repo public-safe.

### Steps
- Add `ghcr.io/blockscout/smart-contract-verifier:<tag>` to the third-party image inventory (`THIRD_PARTY_LICENSES.md` and/or `docs/THIRD_PARTY_NOTES.md` — match where the other Blockscout images are recorded; license is GPL-3.0 for Blockscout components → **flag for operator** per the more-restrictive-than-Apache-2.0 rule, though the existing Blockscout images already set this precedent).
- `services/blockscout/debugging.md`: document the verification path (sc-verifier microservice, `make verify-contracts`, how to check `is_verified`).
- `docs/KNOWN_ISSUES.md`: no current entry to remove; optionally add a one-liner that local verification requires the sc-verifier (now deployed).
- `docs/DOCUMENTATION_INDEX.md`: index this plan; move to `docs/plans/archive/` when shipped.

### Verification Stop
- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- `python3 scripts/verification/check-third-party-licenses.py`

### Exit Criteria
- Docs updated; hygiene + license + link checks pass.

## Documentation And PR Plan

Branch / commit / PR / CI-gate detail defers to `sandbox-pr-workflow`. Likely CI: `validate-publication-hygiene`, `validate-inventory` (image/inventory change). No npm/contracts-source change, so `format-lint-test*` / `Contracts CI` shouldn't gate (the `contracts.sh` shell change isn't a Foundry-source change — confirm path filters).

- **PR 1:** the full change (image pin + deploy wiring + templates + backend env + script hardening + docs). One coherent feature.
- **Evidence for PR body:** before/after `is_verified` for a known address (false→true), sc-verifier pod Ready, backend env, and the negative-case non-zero exit.

## Residual Risks

- **Compiler fetch egress:** if the sc-verifier can't reach `solc-bin`, verification fails at compile time. Mitigation: logs + (fallback) pre-baked compilers volume (out of scope).
- **Backend↔verifier version skew:** sc-verifier tag must be compatible with backend `v10.0.8`. Mitigation: pin a known-compatible tag; validate in Phase 4.
- **License posture:** Blockscout components are GPL-3.0; this image follows the existing Blockscout-image precedent in the repo but must be recorded in the inventory and flagged to the operator.
- **readOnlyRootFilesystem + compilers dir:** if the writable mount/env is wrong, the pod crashloops. Mitigation: Phase 3 log check; D2 fallback to `readOnlyRootFilesystem: false`.

## Done Criteria

- `make verify-contracts` results in `is_verified: true` for the deployed contracts on chain 2018 (verified via Blockscout API + UI), the sc-verifier pod is Ready and backend-wired, `verify-latest --watch` reports real status (non-zero on failure), the new image is inventoried, docs updated, and all hygiene/license/link checks pass.
```
