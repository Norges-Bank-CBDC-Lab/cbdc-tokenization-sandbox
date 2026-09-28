# Sandbox scripts and CI hardening — Design

**Status:** Draft
**Created:** 2026-09-28
**Intent:** [`intent.md`](intent.md)
**Builds on:** #293 (stop keeps state, see
[`../archive/sandbox-stop-keeps-state/design.md`](../archive/sandbox-stop-keeps-state/design.md)),
the image lifecycle work in
[`../archive/image-build-lifecycle-plan.md`](../archive/image-build-lifecycle-plan.md), and ADR
0003 for the Besu baseline check.

## Decision Summary

- **`sandbox.sh` owns defaults. The environment wins, and `.env.sandbox` is a local override.**
  Every `DEPLOY_*` flag is written `: "${DEPLOY_X:=default}"`. That form only fills a variable
  that is unset. `.env.sandbox` is parsed with a strict `KEY=VALUE` allowlist and applied only to
  keys the environment did not set, and it is no longer `source`d. The file is untracked. A
  tracked `.env.sandbox.example` documents every flag, and `generate-config` copies it.
- **A timeout is a failure.** Wait helpers print diagnostics and then `return 1`. Callers already
  run under `set -e`, so the run stops with a non-zero status. The default timeout is defined once
  in `common/helpers.sh`, and wall-clock time comes from bash's `SECONDS`.
- **Validate first, act second.** Every entrypoint checks its subcommand against an explicit list
  before it runs any side effect. Only `start` paths edit `/etc/hosts`.
- **Loopback only.** Kind `extraPortMappings` get `listenAddress: "127.0.0.1"`, which matches the
  registry's existing `127.0.0.1:5001` binding. Applying it needs a cluster recreate, so it is its
  own slice behind operator approval.
- **Pins have one home.** Fallback constants that `getImageValue`/`getVersionValue` refuse to use
  are deleted. Pins that must stay duplicated (Dockerfile `ARG` defaults, Helm fallback values,
  a chart version label) are checked against `common/*.yaml`. The two unpinned tool images move
  into `common/images.yaml`.
- **`sandbox.sh` is canonical, and the Makefile delegates.** The Makefile passes lifecycle verbs
  through to `sandbox.sh` instead of restating them.
- **CI guards what it claims to guard.** Trigger paths, action SHA pins, and gaps in the hygiene
  and link checks are fixed inside the existing workflows. New CI jobs and optional checks are
  separate slices, each behind operator approval.
- **Order.** Operator-misleading behaviour bugs go first (I1, I3, I4, I5), then exposure (I2),
  registry and image lifecycle (I6, I7), consolidation (I8), pin drift (I9), CI (I10), and
  leftovers.

## Current-State Evidence

`Verified` means the claim was read in the code or observed read-only on 2026-09-28. `Inferred`
means it follows from the code but was not executed. `Needs verification` is checked in Phase 0.

### Repository Evidence

#### I1 — Deploy flags

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `.env.sandbox` is tracked (since the initial public release; #211 only removed a line) and sets `DEPLOY_VERIFY_CONTRACTS=false` and `DEPLOY_SKIP_SIMULATION=true`. It omits `DEPLOY_NB_UI` | `.env.sandbox`; `git log --follow -- .env.sandbox` | A clean clone runs without verification and without simulation |
| **Verified.** `sandbox.sh:52-58` hard-sets `DEPLOY_INFRA`, `DEPLOY_CONTRACTS`, `DEPLOY_VERIFY_CONTRACTS`, `DEPLOY_BLOCKSCOUT`, `DEPLOY_NB_BOND_API`, and `DEPLOY_NB_UI` to `"true"`, ignoring the environment. Only `DEPLOY_SKIP_SIMULATION` uses `${…:-false}` | `sandbox.sh:39-60` | Banner says "set before running this script", but environment values are overwritten |
| **Verified.** `sandbox.sh:155-157` `source`s `.env.sandbox` for every command, after the exports | `sandbox.sh` | The file overrides both the environment and the defaults, and its content is executed as shell |
| **Verified.** `generate-config` refuses when the file exists (`sandbox.sh:333-335`) and otherwise writes `env \| grep ^DEPLOY_`, which picks up any `DEPLOY_*` variable in the user's shell | `sandbox.sh:106-113, 330-338` | Fails on every clean clone. Can capture unrelated variables |
| **Verified.** README step 7 says skipping `generate-config` gives "the default root-level workflow". `docs/ARCHITECTURE.md:364` says toggles are generated into `.env.sandbox` | `README.md:152-164` | Docs describe a flow that cannot happen on a clean clone |
| **Verified.** The comment at `sandbox.sh:151-154` justifies sourcing for `stop`/`delete` so they "uninstall" enabled services. Since #293, `stop` stops the node and `delete` deletes the cluster, and neither reads `DEPLOY_*` | `sandbox.sh:297-316` | Stale rationale |
| **Verified.** `contracts/deploy.sh:130` reads `DEPLOY_SKIP_SIMULATION` with no banner | `contracts/deploy.sh` | Violates the flag-banner rule |
| **Verified.** The documented verification path is a separate `make verify-contracts` run (`contracts.sh verify-latest --watch`) | `contracts/README.md:158`, `services/DEVELOPMENT.md:44` | Evidence that the current effective default (`verify=false`) is the operator's working flow |

#### I2 — Host port exposure

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `infra/cluster/cluster-config.yaml:22-28` has no `listenAddress`, so Kind defaults to `0.0.0.0` | File; `docker ps` shows `0.0.0.0:80->31437/tcp, 0.0.0.0:8545->31439/tcp` on the sandbox node | Unauthenticated zero-gas Besu RPC and the API (`AUTH_MODE=none`) are reachable from the LAN. `infra/AGENTS.md` requires "Keep Besu RPC/WS endpoints restricted to local dev" |
| **Verified.** The registry binds `127.0.0.1:5001` (`ensureKindRegistry`) | `common/helpers.sh:499-512` | Precedent for loopback-only |
| **Verified.** The Kind API server already binds `127.0.0.1` | `docker ps` | Only the two app ports are exposed |

#### I3 — Readiness waits

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `waitForApp` on timeout prints "Dumping diagnostics and continuing", calls `dumpAppDiagnostics`, and `return 0`. `waitForApiGateway` does the same after its RPC probe | `common/helpers.sh:846-910, 932-973` | `sandbox.sh` continues and prints "✔️ Finished deploying" with exit 0 |
| **Verified.** Timeouts between 1 and 59 are clamped to 60. The default inside helpers is `0` (wait forever). `sandbox.sh:59` sets 60 | Same; `sandbox.sh:59` | Standalone component scripts wait forever. The banner "lower fails faster" is false, because a timeout never fails |
| **Verified.** The loop counts iterations (`sleep 1` plus two `kubectl` calls), not wall-clock time | `common/helpers.sh:861-905` | The real wait is longer than the configured number of seconds |
| **Needs verification.** How long each wait takes on a normal resume and on a fresh start. This sizes the new default | Phase 0 timing run | A fatal 60 s timeout could break starts that succeed today with a warning |

#### I4 — CLI handling

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** No `else` branch for unknown subcommands in `infra/infra.sh:70-104`, `services/blockscout/blockscout.sh:60-77`, `services/nb-bond-api/nb-bond-api.sh:60-75`, or `services/nb-ui/nb-ui.sh` | Files | `infra.sh strat` runs `checkPrereqs` and `ensureLocalhostHostEntries` (possibly `sudo tee -a /etc/hosts`), then exits 0 |
| **Verified.** `./sandbox.sh -h` treats `-h` as the command and prints "Unknown command". `-h` after a command exits 1 in every script | `sandbox.sh:116-149, 355-357` | Help looks like an error |
| **Verified.** `--keep` with no value fails with `$1: unbound variable` under `set -u` (reproduced with bash 3.2) | `sandbox.sh:136-139`, `infra/infra.sh:49-52` | Cryptic error |
| **Verified.** `contracts.sh -h` exits 1 (unknown command), and only after the cluster-existence check | `contracts/contracts.sh:89-136, 414-418` | Same |
| **Verified.** `run-scripts.sh` `--verifier`/`--verifier-url` read `$2` unguarded. `contracts.sh verify` flags do the same | `contracts/run-scripts.sh:47-54`; `contracts/contracts.sh:214-251` | Unbound-variable abort |
| **Verified.** `start-anvil.sh` has no strict mode | `contracts/start-anvil.sh` | Minor |
| **Verified.** Unquoted `cd $SCRIPT_DIR` in `sandbox.sh`, `infra/infra.sh`, `blockscout.sh`, `nb-bond-api.sh`, `nb-ui.sh`, `contracts.sh`, `deploy.sh`, and `run-scripts.sh`, plus `cd $SCRIPT_DIR/<dir>` in `sandbox.sh` | Files | Breaks in a path with spaces |
| **Verified.** `deploy.sh` builds `ARGS` as a string and appends `${@}` into it. Debug `echo "verifier"` / `echo "verifier_url"` (lines 75, 81). The help example `src/norges-bank/03_Wnok.sol:Wnok` does not exist (the contract is `src/norges-bank/Wnok.sol`) | `contracts/deploy.sh` | Script arguments with spaces break; noisy output; wrong help |
| **Verified.** `deploy.sh` passes `--private-key $PRIVATE_KEY` on argv for `forge create`. The sandbox `deployContracts` path uses only `forge script`, where keys are read inside forge. `forge create --help` lists no environment binding for `--private-key` (it lists `ETH_KEYSTORE`/`ETH_PASSWORD`) | `contracts/deploy.sh:139`; `common/helpers.sh:1677-1737`; forge 1.6.0 help | The review suggestion "use `ETH_PRIVATE_KEY`" is **not supported**; see decision D11 |
| **Verified.** `contracts.sh` repeats about 60 lines of flag parsing between `verify` and `verify-latest`. `verify` hardcodes `--chain 2018` instead of `$CHAIN_ID`. Help lists `--watch` as optional although watch is the default, and omits `--no-watch`. The cluster-existence check (`:133`) also gates `verify`/`verify-latest`, which only need RPC and Blockscout | `contracts/contracts.sh:191-413` | Drift risk; wrong help; unnecessary cluster requirement |
| **Verified.** `06_OrderBook.s.sol` opens a third `vm.startBroadcast(ownerKey)` and never calls `vm.stopBroadcast()` | `contracts/script/csd/06_OrderBook.s.sol:42-45` | Forge closes it at script end, so this is harmless but inconsistent with every other script. Adding the call changes no transactions or addresses |

#### I5 — Bid tooling install

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `Makefile:139-141` runs `npm --prefix scripts/bid-{encryption,submitter} ci`. Neither directory has a `package-lock.json`, because both are workspaces of the root `package.json` | `ls`; root `package.json` `workspaces` | **Inferred:** `npm ci` fails (an explicit `--prefix` skips workspace-root detection, and `ci` requires a lockfile). Reproduce in Phase 0 on a disposable worktree, because `npm ci` deletes the prefix's `node_modules` |
| **Verified.** `contracts/docs/bond-lifecycle-walkthrough.md:31-32`, `scripts/bid-encryption/README.md:14`, and `scripts/bid-submitter/README.md:8` say to run `npm install` in the package directory | Files | **Inferred:** npm resolves to the workspace root and may rewrite the root lockfile (KNOWN_ISSUES warns against plain `npm install`) |
| **Verified.** `mktemp /tmp/bid-encrypt-basic.XXXXXX.json` on macOS BSD `mktemp` creates the literal name, because Xs are replaced only at the end. A second call fails "File exists" | Reproduced in a scratch dir; `Makefile:182` | Second run, or two concurrent runs, of `bid-encrypt-basic` fail |

#### I6 — Registry and images

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `syncImagesToRegistry` omits `blockscout.smart_contract_verifier`, although `getBlockscoutScVerifierImage`'s comment says registry-sync pre-pulls it | `common/helpers.sh:1126-1133, 1317-1339` | Pre-warm is incomplete, and the first deploy pulls it mid-flight |
| **Verified.** `resetKindRegistry` removes the registry and then syncs in order Besu → Blockscout frontend → backend → db → BENS base → node → nginx. `loadImageToKind` falls back to `docker pull` of the `ghcr.io/…:v11.2.6` / `v2.10.3` refs, which upstream no longer publishes (`docs/KNOWN_ISSUES.md`) | `common/helpers.sh:1045-1097, 1465-1472` | **Inferred:** with the built images absent from the host cache, the pull fails under `set -e` and the db, BENS, node, and nginx images are never synced |
| **Verified.** The hash functions end in `… 2>/dev/null } \| shasum \| cut` under `pipefail`. A missing explicit input makes `bundle_hash="$(…)"` fail, and `set -e` exits with no message | `common/helpers.sh:1556-1569, 1746-1761, 1817-1833` | Silent abort of `start` |
| **Verified.** `check-image-hash-inputs.sh` sets `-uo pipefail`, but sourcing `helpers.sh` turns `-e` back on (`set -Eeuo pipefail` at helpers line 1). The checker tests only the hashed directories, not the explicit file inputs | `scripts/verification/check-image-hash-inputs.sh:16-22, 90-95` | A broken explicit input kills the checker with no message. Removing a file from a hash list is not caught |
| **Verified.** `checkPrereqs` passes if either `docker-compose --version` or `docker info` succeeds, so an installed `docker-compose` with a stopped daemon passes. `kind`, `kubectl`, `helm`, and `forge` have no install hints (they are invoked or not checked at all) | `common/helpers.sh:64-140` | A late, confusing failure |
| **Verified.** `ensureLocalhostHostEntries` runs on `stop`, `delete`, and `generate-config` (`sandbox.sh:299, 310, 332`) and in every standalone script, not only on `start` | Files | A possible `sudo` prompt for commands that need no hostnames |

#### I7 — Unpinned images

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `regen-openapi.sh:12` uses `openapitools/openapi-generator-cli` with no tag (implicit `latest`), runs as root (root-owned files on Linux), and passes `--skip-overwrite`, so existing generated files are never regenerated. That flag also protects the hand-written `src/openapi_server/impl/` | `services/blockscout/bens-microservice/regen-openapi.sh` | Non-reproducible output. "Regen" only adds new files |
| **Verified.** `contracts/slither.sh:5` pins `trailofbits/eth-security-toolbox:latest` | File | Local Slither differs from run to run. CI uses a SHA-pinned action instead |

#### I8 — Consolidation

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** Makefile has no `build-images`, `registry-reset`, `cleanup-images`, or `image-report`. `sandbox-fresh-start` skips `build-images`. Help says `sandbox-stop` "keeps cluster/cache" and `sandbox-delete` tears down "cluster + cache" (pre-#293). `infra-stop` scales Besu and the gateway to zero, while `sandbox stop` stops the node | `Makefile:22-107`; `infra/infra.sh:84-87` | Two front doors that disagree |
| **Verified.** `registry-start` exists in both `sandbox.sh` and `infra.sh`. README and `requireKindRegistry` point to the `infra.sh` form | `README.md:124-127, 200`; `common/helpers.sh:555-561` | Two documented commands |
| **Verified.** On a full `start`, Besu readiness is waited up to four times (`blockscout.sh:64`, `sandbox.sh:198`, `contracts.sh:145`, `sandbox.sh:242`) and Blockscout up to three times (`sandbox.sh:203, 217, 247`). `infra.sh start` runs `checkPrereqs` twice when standalone (`:66`, `:71`), and again after `sandbox.sh` already ran it | Files | Noise and slower starts. Cheap per call, but it obscures the dependency order |
| **Verified.** `nb-ui.sh` and `nb-bond-api.sh` differ only in names and comments. All six component scripts repeat the parse/help/`--as-subtask` skeleton | `diff` | Refactor candidate (needs go-ahead) |
| **Verified.** `bid-encrypt-basic` and `bid-submit-basic` repeat about 20 lines of `curl`+`jq` context resolution | `Makefile:148-245` | Drift risk |
| **Verified.** Chain ID 2018 is literal in `contracts.sh:139`, `Makefile:16`, the genesis, and `infra/besu/values.yaml:11`. `check-besu-qbft-baseline.py` guards genesis and network-id | Files | Scripts can drift from the chain |

#### I9 — Pin drift

| Pin | Source of truth | Duplicates | Guarded today |
|---|---|---|---|
| Besu | `common/images.yaml` | `infra/besu/values.yaml:7`, `check-besu-qbft-baseline.py:94`, docs | **Yes.** The `validate` check compares chart vs common and asserts the baseline version (review claim corrected) |
| Blockscout backend/frontend/db, BENS base | `common/images.yaml` | `services/blockscout/values.yaml:6-7, 47, 112` (Helm fallbacks) | No |
| python (BENS) | `common/images.yaml` `blockscout.bens` | `bens-microservice/Dockerfile:16-17`, `helpers.sh:41` (`BENS_BASEIMAGE`, unused) | No |
| nginx-unprivileged | `common/images.yaml` `nb_ui.nginx` | `services/nb-ui/Dockerfile:19`, `helpers.sh:52` (+ unused alias `NB_UI_BASEIMAGE`, 53-55) | No |
| registry | `common/images.yaml` `local_registry` | `helpers.sh:59` (used only when `yq` is missing) | No |
| Blockscout chart | `common/versions.yaml` | `helpers.sh:39` | No |
| NGF chart | `common/versions.yaml` | `helpers.sh:1118` literal, `infra/gateway/templates/nodeport-config.yaml:9` label | No |
| kindest/node | `infra/cluster/cluster-config.yaml` (digest) | none | n/a (single source) |
| Foundry | CI only (`test-contracts.yml:35`, v1.7.1) | none locally; README uses `foundryup` unpinned | n/a |
| helm, kind, yq | none | none | Unpinned host tools |

**Verified.** `getImageValue`/`getVersionValue` take a `default` argument and refuse to use it
(`common/helpers.sh:383-429`). Every fallback constant passed to them is dead.

#### I10 — CI and verification

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** First-party actions pinned by tag (`actions/checkout@v7`, `setup-node@v7`, `setup-python@v7`). Third-party actions (`foundry-rs/foundry-toolchain`, `crytic/slither-action`) pinned by SHA with no version comment | `.github/workflows/*.yml` | Mutable tags; SHAs whose version is unreadable |
| **Verified.** `bash -n` passes on all 16 tracked `.sh` files today. No CI runs it. `shellcheck` is not installed locally | Local run | A syntax error ships unnoticed |
| **Verified.** `helm lint` passes for `infra/besu`, `infra/gateway`, `services/nb-bond-api/helm`, and `services/nb-ui/helm`. No CI runs it | Local run | Chart breakage ships unnoticed |
| **Verified.** `tsc --noEmit -p scripts/bid-{encryption,submitter}/tsconfig.json` passes with the existing workspace TypeScript. No CI runs it | Local run | No new dependency needed to add it |
| **Verified.** `publication-hygiene.yml` triggers only on `**/*.md` and a fixed file list, not on `*.sh`, `*.yaml`, `Makefile`, or `.github/**` | Workflow | Home paths or keys in scripts or workflows are never checked |
| **Verified.** `license-inventory.yml:16` triggers on `services/blockscout/bens-microservice/src/requirements.txt`, which is gitignored | Workflow; `git check-ignore` | Dead trigger |
| **Verified.** `node-version-consistency.yml` does not trigger on `services/nb-ui/package.json`, and the checker does not read it. nb-ui declares no `@types/node` today | Workflow; checker `NODE_TYPE_MANIFESTS` | Latent gap only |
| **Verified.** The hygiene check scans a fixed allowlist of example files. It has no home-path check, no check for tracked files that match `.gitignore`, and no repo-wide key scan. All three pass today: `git ls-files -ci --exclude-standard` is empty, no tracked file contains a home-directory path, and the only tracked `0x`+64-hex string outside lockfiles is a ciphertext in `scripts/bid-submitter/examples/initial.json` | Local runs | Rules exist only as manual discipline |
| **Verified.** `check-markdown-links.py` resolves targets with `Path.exists()`. It passes a link to an ignored-but-present file, ignores anchors, and treats `(path "title")` as a path | `scripts/verification/check-markdown-links.py:52-60` | Passes locally but fails in CI; no anchor coverage |

#### Leftovers

| Finding | Evidence |
|---|---|
| **Verified.** `scripts/bid-{encryption,submitter}/.yarnrc.yml` and Yarn stanzas in their `.gitignore` remain; the repo uses npm workspaces | Files |
| **Verified.** `services/blockscout/bens-microservice/package.json` is a generator stub (`main: index.js` missing, not a workspace). `check-third-party-licenses.py:259-274` reads it, and `THIRD_PARTY_LICENSES.md` has an npm note for it | Files |
| **Verified.** `nb-bond-api.sh:64` says the DB is on an `emptyDir`. The chart uses a PVC by default | `services/nb-bond-api/helm/values.yaml:6-13`, `templates/pvc.yaml` |
| **Verified.** `writeIfMissing` logs `force && existsSync(filePath)` after writing, so under `--force` a new file logs "Rewrote" | `scripts/generate-local-sandbox-fixtures.mjs:89-98` |
| **Verified.** `.dockerignore` does not exclude `outputs/` or `.obsidian/` (both gitignored root dirs) | `.dockerignore` |
| **Verified.** `.editorconfig` sets `indent_size = 2` globally. Shell and Python files use 4 | `.editorconfig` |
| **Verified.** `FORCE_IMAGE_PULL` (`helpers.sh:1055`) and `DEPLOY_SKIP_SIMULATION` (`deploy.sh:130`) have no banner. `helpers.sh` has none at all | Files |
| **Verified.** `readlink -f` in `contracts/*.sh` needs macOS 12.3 or later | `contracts/contracts.sh:5`, `deploy.sh:5`, `run-scripts.sh:5` |
| **Verified.** `blockscout.sh`, `nb-bond-api.sh`, `nb-ui.sh`, and `contracts.sh` print "does not exists" | Files |

### Runtime Evidence

- **Verified:** The sandbox node publishes `0.0.0.0:80` and `0.0.0.0:8545`. The registry
  publishes `127.0.0.1:5001` (`docker ps`, 2026-09-28).
- **Verified:** `bash -n`, `helm lint`, and the bid-CLI `tsc --noEmit` all pass today.
- **Needs verification:** Per-wait durations for resume and fresh start. The exact
  `make bid-tools-install` failure. `registry-reset` behaviour with the Blockscout images absent
  from the host cache. All are captured in Phase 0 without touching chain state.

### Existing Test Coverage and Gaps

- No shell test harness exists. Script behaviour is proven by command matrices recorded in
  `progress.md`. The one committed shell check, `check-image-hash-inputs.sh`, is extended in
  place. No new permanent test files are added for shell behaviour.
- The Python verification scripts have no unit tests. Changes are proven by running them against
  the tree and against a deliberately broken scratch copy.

## Significant Findings

| Priority | Finding | Why it matters | Plan response |
|---|---|---|---|
| Blocking | I1: tracked `.env.sandbox` overrides defaults and hard-set flags ignore the environment | Every other phase is verified through `./sandbox.sh start`. Its inputs must be predictable first | Phase 1 |
| Blocking | I3: timeouts return 0 | Later phases rely on `start` exiting non-zero on failure as their verification stop | Phase 2 |
| Important | I4: side effects before command validation | `sudo` hosts edit on a typo | Phase 3 |
| Important | I2: LAN exposure | Unauthenticated RPC with zero gas and the API are reachable off-host | Phase 5, approval |
| Important | I5: documented install fails | First-contact failure for bid tooling | Phase 4 |
| Important | I6: partial registry reset; silent hash abort | Leaves the registry half-populated with no message | Phase 6 |
| Follow-up | I7–I10, leftovers | Drift and coverage gaps | Phases 7–11 |

## Invariants

- `./sandbox.sh start` on an existing, stopped sandbox resumes it with the same effective flags
  as before this plan (under decision D1's recommendation).
- `./sandbox.sh stop` keeps all state, and only component or sandbox `delete` is destructive
  (#293).
- `registry-start` comes before `start`, and `build-images` before `registry-sync`, on a fresh
  machine.
- No script under this plan introduces a new tool, image, or package without approval.
- All scripts run under macOS `/bin/bash` 3.2 and on Linux bash 5.
- Script flags keep a banner directly above their exports with true/false behaviour per line.
- Besu and Blockscout version bumps still need the multi-file sweep. The `validate` check keeps
  guarding the Besu baseline, and this plan adds guards without removing any.
- Committed text stays vendor-neutral and free of non-local deployment specifics.

## Field and Source Classification

| Concept | Current source | Target source | Owner | Fallback rule |
|---|---|---|---|---|
| `DEPLOY_*` defaults | hard-set in `sandbox.sh` plus tracked `.env.sandbox` | `: "${DEPLOY_X:=…}"` in `sandbox.sh` | configured | environment > `.env.sandbox` > default |
| Local flag overrides | tracked `.env.sandbox` (sourced) | untracked `.env.sandbox`, parsed with an allowlist | operator | unknown keys rejected with a message |
| Flag documentation | README prose | tracked `.env.sandbox.example` plus the banner | repo | example lists every flag with its default |
| Readiness timeout | `sandbox.sh` (60) / helpers (0) | `common/helpers.sh` (one default) | configured | `0` means wait forever, explicitly |
| Image pins | `common/images.yaml` plus scattered fallbacks | `common/images.yaml` / `versions.yaml`; necessary fallbacks checked | configured | drift fails CI |
| Tool images | implicit `latest` | `common/images.yaml` `tools.*` | configured | script errors when the key is missing |
| Chain ID in scripts | literal `2018` | `infra/besu/values.yaml` `networkId` via `yq` in `contracts.sh`; the Makefile default stays literal with a pointer comment | configured | the baseline check guards genesis |

## Target Architecture

### Deploy-flag loading (`sandbox.sh`)

```text
1. Parse command and flags (validate command against the list; -h → help, exit 0).
2. loadDeployOverrides ".env.sandbox":
     for each non-comment line KEY=VALUE:
       reject unless KEY matches ^(DEPLOY_[A-Z_]+|WAIT_FOR_APP_TIMEOUT_SECONDS|SANDBOX_STOP_TIMEOUT_SECONDS)$
       reject unless VALUE matches ^[A-Za-z0-9._-]*$
       if KEY is unset in the environment: export KEY=VALUE
3. Defaults (banner above): : "${DEPLOY_INFRA:=true}" … ; export each.
```

Bash 3.2 has no `-v` test, so step 2 tests "is set" with `eval "[ -n \"\${$KEY+x}\" ]"`. This is
safe because `KEY` has already matched the allowlist regex. A value is never evaluated. The
function lives in `sandbox.sh`, the only consumer. `generate-config` copies
`.env.sandbox.example` to `.env.sandbox` when absent, and when present it still refuses, but now
tells the user how to reset. `.gitignore` gets `/.env.sandbox`, and the file is removed from the
index with `git rm --cached`.

**Migration effect (Inferred from git semantics).** When a clone pulls the commit that untracks
the file, git deletes an unmodified working copy, and a locally modified one blocks the pull
until it is stashed. Under D1's recommendation the new defaults equal the old tracked values, so
deleting the file changes nothing. The PR body and README call out the modified-copy case.

### Wait helpers (`common/helpers.sh`)

A banner block near the top defines
`WAIT_FOR_APP_TIMEOUT_SECONDS="${WAIT_FOR_APP_TIMEOUT_SECONDS:-<D4 default>}"` and
`FORCE_IMAGE_PULL="${FORCE_IMAGE_PULL:-false}"`. `waitForApp` and `waitForApiGateway` compute a
deadline from `SECONDS`, drop the 60 s clamp, and on timeout print the diagnostics and
`return 1`. `sandbox.sh` stops setting its own default, and its banner line says "true: n/a;
value: seconds before a component wait fails the run; 0 waits forever".

### Entrypoint skeleton (per script, no shared refactor)

Each script validates `CMD` with a `case` right after parsing: known verbs pass, `-h|--help` print
help and exit 0, and anything else prints "Unknown command" plus help and exits 1. That happens
before `checkPrereqs`. Flags that take a value go through `requireFlagValue "$1" "${2-}"`, a
helper in `helpers.sh`. `ensureLocalhostHostEntries` moves into the `start` branches only.
`checkPrereqs` requires `docker info` to succeed ("daemon not running"), and it checks `kind`,
`kubectl`, `helm`, and `forge` with hints before using them.

A shared skeleton function for all six component scripts (parse, help, `--as-subtask`) is
**not** part of the default scope. It is a refactor offered as optional slice H2 (D7).

### Registry sync

`syncImagesToRegistry` gains the smart-contract-verifier image. It treats the two source-built
Blockscout images as "present locally or skip with a warning". The check is
`kindRegistryHasImage` or a local tag of the right platform. When neither exists, it records the
image and skips the upstream pull. At the end it prints a summary and, if any source-built image
was skipped, the hint `./sandbox.sh build-images`. It exits 0, because the skipped images are a
documented separate step, not a sync failure. `deployBlockscout` gets the same pre-check with the
same hint, so `start` fails with a clear message instead of a `docker pull` error.

### Hash inputs

Each hash function reads its explicit file list from a small lister function (for example
`nbUIHashFiles`) and checks each file exists before hashing. A missing file prints
`❌ image hash input missing: <path>` to stderr and returns 1. The checker runs `set +e` after
sourcing `helpers.sh`, calls the listers to assert every declared file exists, and captures a
hash failure as a reported failure instead of a silent exit.

### Loopback binding

`listenAddress: "127.0.0.1"` on both `extraPortMappings`. `/etc/hosts` already maps the sandbox
names to `127.0.0.1`, so browsers, scripts, and the Makefile are unaffected. Only LAN or remote
access stops working. A person who needs it can use `kubectl port-forward --address` or an SSH
tunnel (documented, not built). This is the security posture a non-local deployment should also
keep, and it is flagged for awareness only.

### Tool image pins

`common/images.yaml` gains a `tools:` section with `openapi_generator_cli` and
`eth_security_toolbox` (explicit version tags; digests optional). `regen-openapi.sh` and
`slither.sh` read them with `yq` and fail with a clear message when the key is missing.
`regen-openapi.sh` adds `--user "$(id -u):$(id -g)"` and a comment explaining `--skip-overwrite`:
it only adds files, protects the hand-written `impl/`, and to regenerate a file you delete it
first.

### Makefile

Lifecycle targets become thin pass-throughs, for example a `sandbox-%` pattern rule that runs
`./sandbox.sh $*`. That keeps every `sandbox.sh` verb available without restating semantics.
`help` lists the verbs and points to `./sandbox.sh -h`. `sandbox-fresh-start` runs
`registry-start`, then `build-images`, then `start`, and its help says it is for a fresh machine
and slow. `infra-*` targets are removed or reduced per D6. The bid targets stay. The duplicated
context resolution moves into one Make `define` used by both basic targets.
`bid-tools-install` runs `npm ci` at the repo root.

### Pin drift check

1. Delete the dead fallbacks: `BLOCKSCOUT_CHART_VERSION`, `BENS_BASEIMAGE`,
   `NB_UI_NGINX_BASEIMAGE`/`NB_UI_BASEIMAGE`, the NGF literal, and the unused `default` parameter
   of `getImageValue`/`getVersionValue` along with its callers' `yq` lookups of fallback values.
   `KIND_REGISTRY_IMAGE` stays only if `registry-start` must work without `yq`. Otherwise
   `getLocalRegistryImage` requires `yq` like everything else (recommended; `checkPrereqs`
   already requires it for `start`).
2. New `scripts/verification/check-image-pin-consistency.py` (stdlib only, like its neighbours).
   It asserts that each Dockerfile `ARG *_IMAGE=` default, `services/blockscout/values.yaml`
   fallback, and the NGF `app.kubernetes.io/version` label equals `common/images.yaml` or
   `common/versions.yaml`. It also asserts that no tracked script contains a `docker run`/`pull`
   of an untagged image. Besu stays with the existing `validate` check.
3. Wiring it into CI is a new check (D8).

### CI and verification

- Existing workflows: SHA-pin `actions/*` with `# vX.Y.Z` comments, and add version comments to
  the two third-party SHAs. Drop the `paths:` filter from `publication-hygiene.yml` (the checks
  run in seconds, and a required check that is skipped by path filtering is a known trap). Remove
  the gitignored trigger from `license-inventory.yml`. Add `services/nb-ui/package.json` to the
  node-version trigger and to the checker as an optional manifest (checked only when it declares
  `@types/node`).
- Hygiene check extensions (D9): tracked files matching `.gitignore` must be empty
  (`git ls-files -ci --exclude-standard`). Required ignore entries gain `Handoff-AI-*.md`,
  `/outputs/`, `/.obsidian/`, and `/.env.sandbox`. There is a home-directory path pattern check
  over tracked text files. A key scan finds `0x`+64-hex values on lines whose key name suggests
  a secret (`private`, `_PK`, `PK_`, `secret`, `mnemonic`, `seal`), with a small path
  allowlist, so hashes in tests and genesis do not need allowlisting.
- Link check: build the target set from `git ls-files` (plus their parent directories), strip an
  optional `"title"`, and optionally validate `#anchors` in `.md` targets with GitHub-style
  slugs. Anchors are behind a first-run count of existing failures (Phase 10 step).
- New CI jobs (D8, each needs approval): `bash -n` over tracked `.sh`; `helm lint` of the four
  local charts; `tsc --noEmit` of both bid CLIs; the pin-consistency check. These fit in one new
  "Scripts and charts" workflow or as steps in existing ones. The recommendation is one new
  workflow so the check name is meaningful.
- Optional (D10): a cloud-term denylist check whose patterns live outside the repo (an Actions
  repository variable, or an ignored local file). The committed script contains no terms and
  skips with a notice when the list is absent.

### Security and Deployment Boundary

The loopback binding narrows exposure. Nothing in this plan adds auth or changes `AUTH_MODE`. The
`.env.sandbox` parser removes a small code-execution surface (the file was `source`d). Private
keys on `forge create` argv stay as they are (D11). Portability flag: the non-local deployment
does not use `sandbox.sh`, the Makefile, or Kind, so it is unaffected. Its image pins are its own.

## Alternatives Considered

- **Keep `.env.sandbox` tracked and only fix the defaults.** Editing toggles would still dirty
  the tree, and `generate-config` would stay broken. Rejected.
- **Keep `source`-ing `.env.sandbox`.** It gives file > env precedence and executes arbitrary
  shell. Rejected in favour of an allowlisted parser.
- **Keep timeouts non-fatal but print a louder warning.** The run still claims success. Rejected.
- **Separate `--publish 127.0.0.1` via a kind wrapper script.** Kind supports `listenAddress`
  natively, so this is rejected.
- **Retire the Makefile entirely.** It breaks bid-tool muscle memory and the documented `make`
  targets. Rejected in favour of pass-throughs.
- **Extend `check-besu-qbft-baseline.py` or `check-node-version-consistency.py` for pin
  drift.** Both are scoped by name and purpose, and mixing concerns makes failures harder to
  read. Rejected in favour of one small new script.
- **Adopt `shellcheck` immediately.** It is GPL-3.0 (more restrictive than Apache-2.0), so it
  needs double confirmation. `bash -n` catches syntax errors at zero cost. `shellcheck` is
  offered as an option.
- **Move `forge create` keys to an environment variable.** Unsupported by `forge create` (no env
  binding for `--private-key`). A keystore is heavier than the risk for deterministic local
  fixture keys.

No decision here is load-bearing enough for an ADR. They are operational conventions, recorded in
this plan and in the README.

## Decisions

| # | Decision | Recommendation | Rationale | Operator action required |
|---|---|---|---|---|
| D1 | Defaults for `DEPLOY_VERIFY_CONTRACTS` / `DEPLOY_SKIP_SIMULATION` | `false` / `true`, today's effective clean-clone behaviour | Removing the tracked file then changes nothing for anyone; verification stays the separate `make verify-contracts` step | **Explicit choice** (the alternative is `true` / `false`: slower start, verification inside `start`) |
| D2 | `.env.sandbox` tracked? | Untracked, gitignored, with a tracked `.env.sandbox.example` | Local overrides never dirty the tree; `generate-config` works | None beyond D1 |
| D3 | Precedence | environment > `.env.sandbox` > defaults | Matches the banner's promise and common tooling | None |
| D4 | Wait timeout | Fatal. Default **600 s**, confirmed against Phase 0 timings (raise if a fresh start's slowest wait exceeds half of it). `0` = forever | Honest failure without breaking slow first starts | Confirm the number after Phase 0 |
| D5 | Loopback binding | `listenAddress: "127.0.0.1"` on both mappings | Closes LAN exposure; matches `infra/AGENTS.md` | **Approval:** cluster recreate (`./sandbox.sh delete` + `start`) destroys local chain, Blockscout, and API state; confirm no LAN consumers |
| D6 | Makefile lifecycle targets | `sandbox-%` pass-through. Remove `infra-stop` (diverging semantics), keep `infra-registry-*` as aliases or drop them | One truth (`sandbox.sh`) | Confirm removal of `infra-*` targets |
| D7 | Shared script skeleton | Defer (optional slice H2) | It is a refactor across six scripts, and the per-script `case` fixes solve the bugs | **Go-ahead** if wanted |
| D8 | New CI surfaces | One new workflow: `bash -n`, `helm lint`, bid-CLI `tsc --noEmit`, pin consistency | No new dependency; closes real gaps | **Approval** (new workflow/checks) |
| D9 | Hygiene and link-check extensions | Adopt | They extend existing gates and pass on today's tree | **Approval** (new assertions in an existing gate) |
| D10 | `shellcheck`; cloud-term denylist | Both optional. `shellcheck` only after double confirmation (GPL-3.0). The denylist only with patterns stored outside the repo | Licence; the committed text rule | **Double confirmation** / **approval** |
| D11 | `forge create --private-key` on argv | Accept and document in `deploy.sh` help. The sandbox path uses `forge script` | Fixture keys are deterministic and local-only; no env binding exists | None |
| D12 | Slither toolbox pin | Pin a version tag in `common/images.yaml` and add a tooling row to the licence inventory | Reproducibility. **Licence notice:** the image bundles Slither, which is AGPL-3.0 (**Needs verification** of the exact label). It is already in use and pinning adds no new dependency, but it is more restrictive than Apache-2.0, so the operator is notified | Acknowledge |

## Residual Risks

- The fatal timeout may surface slow-start conditions that used to pass with a warning. Phase 0
  timing and D4 mitigate this, and the diagnostics dump stays.
- Untracking `.env.sandbox` blocks `git pull` in a clone with local edits to it. The PR and
  README say to stash or move the file first.
- Anchor validation in the link check uses heuristic slugs. It stays optional until a first run
  shows a manageable number of findings.
- `yq` becomes a hard prerequisite for `registry-start` if `KIND_REGISTRY_IMAGE` is removed.
  `checkPrereqs` hints cover it.
