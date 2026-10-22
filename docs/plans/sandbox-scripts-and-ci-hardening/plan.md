# Sandbox scripts and CI hardening — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `sandbox.sh`, `.env.sandbox` (untrack) + `.env.sandbox.example`, `.gitignore`,
`common/helpers.sh`, `common/images.yaml`, `infra/infra.sh`, `infra/cluster/cluster-config.yaml`,
`services/blockscout/{blockscout.sh,build-images.sh,bens-microservice/}`,
`services/nb-bond-api/nb-bond-api.sh`, `services/nb-ui/nb-ui.sh`, `contracts/*.sh`,
`contracts/script/csd/06_OrderBook.s.sol`, `Makefile`, `scripts/verification/*`,
`scripts/generate-local-sandbox-fixtures.mjs`, `scripts/bid-*/`, `.github/workflows/*`,
`.dockerignore`, `.editorconfig`, and the docs that describe these
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0   Baseline and characterization (read-only + disposable worktree)
Phase 1   Deploy-flag model (I1)                        slice A
Phase 2   Honest readiness waits (I3)                   slice B
Phase 3   CLI argument handling and side-effect scope (I4, part of I6)   slices C1, C2
Phase 4   Bid-tool install (I5)                         slice D
Phase 5   Loopback-only host ports (I2)                 slice E   [operator approval: cluster recreate]
Phase 6   Registry and image lifecycle (I6)             slice F
Phase 7   Pin the unpinned tool images (I7)             slice G
Phase 8   Makefile and script consolidation (I8)        slice H   (+ optional H2 refactor)
Phase 9   Pin drift (I9)                                slice I   [CI wiring needs approval]
Phase 10  CI and verification (I10)                     slices J1–J4   [J2–J4 need approval]
Phase 11  Leftovers                                     slice K
```

Phases 1–4 fix behaviour that misleads the operator today. Phases 1 and 2 go first because every
later phase proves itself with `./sandbox.sh start`, which needs predictable inputs (Phase 1) and
an honest exit status (Phase 2). Phase 5 is independent but destructive, so it waits for approval
without blocking anything. Consolidation (Phase 8) comes after the bug fixes, so each bug fix
lands as a small, reviewable diff against today's structure.

Every slice is one `feature/<kebab>` PR against `development`. Every slice runs
`python3 scripts/verification/check-public-repo-hygiene.py` and
`python3 scripts/verification/check-markdown-links.py`, plus
`bash -n` on each touched `.sh` file.

## Phase 0: Baseline and Characterization

### Goal

Capture the current behaviour that later phases change, and settle the three `Needs
verification` items in the design, without touching chain state.

### Steps

1. Record current port bindings: `docker ps --format '{{.Names}}\t{{.Ports}}'`.
2. Time a resume. On a stopped sandbox, run `time ./sandbox.sh start 2>&1 | tee` into a scratch
   file outside the tree. Note each "Waiting for …" duration and any "Timed out" line. This run
   is non-destructive.
3. Fresh-start timing (optional, only if the operator is already planning a `delete` + `start`,
   for example as part of Phase 5): record the same numbers. Use the slowest wait to confirm or
   raise D4's 600 s default.
4. In a disposable `git worktree` (outside the tree, removed afterwards), run
   `make bid-tools-install` and capture the error. Then run `npm ci` at the worktree root and
   confirm both CLIs run `--help`.
5. `registry-reset` characterization. **Skip unless the operator agrees**: it discards the
   registry cache and forces a rebuild of the Blockscout images afterwards (about 20 minutes or
   more). The code path in the design is enough to proceed, so the empirical run can happen
   during Phase 6 verification.
6. Record the CLI matrix from code reading: exit codes and side effects for `-h`, an unknown
   command, and a missing flag value, per script. Do **not** run `infra.sh strat` (it can prompt
   for `sudo`).

### Verification Stop

- `progress.md` "Verified So Far" lists the port bindings, the per-wait timings, the
  bid-install error text, and the D4 number.

### Failure Diagnosis / Fix Forward / Rollback

- If the resume shows a wait that already exceeds 600 s, raise D4 before Phase 2 and record why.

### Exit Criteria

- [ ] D4 default confirmed with evidence.
- [ ] `make bid-tools-install` failure reproduced, or the finding is dropped with a reason.

## Phase 1: Deploy-Flag Model (I1) — slice A

### Goal

A clean clone gets the documented defaults. The environment overrides `.env.sandbox`, which
overrides the defaults. `generate-config` works, and local toggles never dirty the tree.

### Prerequisite

D1 decided by the operator.

### Steps

1. `sandbox.sh`:
   - Replace the exports at lines 52-58 with `: "${DEPLOY_INFRA:=true}"` (and similar) for all
     seven `DEPLOY_*` flags, using D1's values for verify and simulation. Then `export` each.
     Keep `WAIT_FOR_APP_TIMEOUT_SECONDS` out of here (Phase 2 moves it to helpers). Keep
     `SANDBOX_STOP_TIMEOUT_SECONDS`.
   - Rewrite the banner: "OPTIONAL SANDBOX FLAGS (environment > .env.sandbox > defaults)". Give
     each flag one line with its true/false behaviour and its default.
   - Add `loadDeployOverrides()`, following the design's allowlisted parser and bash 3.2 notes.
     Call it **before** the defaults block and after command and flag parsing. Delete the
     `source "$DEPLOYMENT_CONFIG_FILE"` block and its stale #293-era comment.
   - `generate-config`: when the file is absent, `cp .env.sandbox.example .env.sandbox` and
     print the path. When present, keep refusing and add "delete it to regenerate from
     `.env.sandbox.example`". Drop `generateConfig()` and its `env | grep` capture. Keep
     `checkPrereqs` out of `generate-config` (it needs no tools). Phase 3 removes the hosts-file
     edit.
   - `"All deployment flags are set to false (cf $DEPLOYMENT_CONFIG_FILE)"` wording should
     mention the environment too.
2. Add `.env.sandbox.example`, tracked. It has a header saying it is a local-override template,
   copied by `generate-config`, that the environment wins, and that unknown keys are rejected.
   Include all seven `DEPLOY_*` lines with the defaults, plus commented
   `# WAIT_FOR_APP_TIMEOUT_SECONDS=` and `# SANDBOX_STOP_TIMEOUT_SECONDS=`.
3. `.gitignore`: add `/.env.sandbox` under "deployment config". `git rm --cached .env.sandbox`.
4. `contracts/deploy.sh`: add a banner for `DEPLOY_SKIP_SIMULATION` above its use. Hoist it to
   `DEPLOY_SKIP_SIMULATION="${DEPLOY_SKIP_SIMULATION:-false}"` so the banner sits above an
   assignment, as the rule requires.
5. Docs: README step 7 and the flags paragraph (real defaults, precedence, the example file, and
   the note about a locally modified `.env.sandbox` blocking `git pull`); README command table
   row for `generate-config`; `docs/ARCHITECTURE.md` "Configuration And Versioning" bullet;
   `docs/diagrams/operations/sandbox-startup-flow.md` node label ("Resolve deploy flags: env >
   .env.sandbox > defaults").

### Verification Stop

Precedence matrix. To print the resolved flags without deploying, use a scratch copy of
`sandbox.sh`, kept outside the tree, with an early `env | grep ^DEPLOY_; exit` after the
defaults block. No debug flag is committed. Record the results:

| Environment | `.env.sandbox` | Expected |
|---|---|---|
| unset | absent | D1 defaults |
| unset | `DEPLOY_NB_UI=false` | `DEPLOY_NB_UI=false` |
| `DEPLOY_NB_UI=true` | `DEPLOY_NB_UI=false` | `true` |
| unset | `FOO=1` | rejected with a message, exit 1 |
| unset | `DEPLOY_INFRA=$(touch x)` | rejected (value regex), no file created |

Then: on a fresh worktree `./sandbox.sh generate-config` succeeds and `git status` is clean.
`./sandbox.sh start` on the existing stopped sandbox resumes, and `git status` is clean. Run
`bash -n sandbox.sh contracts/deploy.sh`.

### Failure Diagnosis / Fix Forward / Rollback

- A bash 3.2 incompatibility shows as a syntax error in `bash -n` under `/bin/bash`. Fix
  forward.
- Rollback: revert the PR. Restoring the tracked file restores the old behaviour exactly.

### Exit Criteria

- [ ] Matrix recorded in `progress.md`.
- [ ] `git ls-files .env.sandbox` empty; `.env.sandbox.example` tracked.
- [ ] README, ARCHITECTURE, and the startup-flow diagram match the code.

## Phase 2: Honest Readiness Waits (I3) — slice B

### Goal

A readiness timeout fails the run after its diagnostics. One default applies everywhere.

### Steps

1. `common/helpers.sh`: add a banner block after the config constants for
   `WAIT_FOR_APP_TIMEOUT_SECONDS` (default per D4; `0` waits forever) and `FORCE_IMAGE_PULL`
   (true re-pulls base and third-party images from upstream; false reuses the registry or host
   cache). Assign both with `${…:-…}` directly below the banner. Replace inline
   `${FORCE_IMAGE_PULL:-false}` reads with the variable.
2. `waitForApp`: `deadline=$(( SECONDS + timeout ))` when timeout > 0. Remove the `< 60` clamp.
   On timeout, print "❌ Timed out waiting for <app> after <n>s", run `dumpAppDiagnostics`, and
   `return 1`. Keep the `waitMsg` spinner.
3. `waitForApiGateway`: same deadline logic. On timeout, print the RPC URL probed and the last
   response (truncated), then `return 1`.
4. `sandbox.sh`: remove `WAIT_FOR_APP_TIMEOUT_SECONDS` from its exports and point its banner
   line at helpers ("defined in `common/helpers.sh`").
5. Docs: the README command table and `infra/DEVELOPMENT.md` document the flag and its default
   next to `FORCE_IMAGE_PULL`.

### Verification Stop

- Forced timeout: `WAIT_FOR_APP_TIMEOUT_SECONDS=5 ./services/nb-ui/nb-ui.sh start` while the
  nb-ui deployment is scaled to 0 (`./services/nb-ui/nb-ui.sh stop` first). The script returns
  non-zero, diagnostics print, and there is no "Finished". Restore with a normal start.
- Normal resume with the default. The exit status is 0 and the timings are within Phase 0 ±
  noise.
- `bash scripts/verification/check-image-hash-inputs.sh` still passes (it sources helpers).

### Failure Diagnosis / Fix Forward / Rollback

- If a normal start now fails on a slow component, first read its diagnostics dump. Only raise
  D4 if the component was genuinely progressing. Never restore the non-fatal path.

### Exit Criteria

- [ ] Forced timeout exits non-zero in both a component script and `sandbox.sh start`.
- [ ] No `return 0` remains on a timeout path; there is no clamp and a single default.

## Phase 3: CLI Argument Handling and Side-Effect Scope (I4, part of I6)

### Slice C1 — entrypoints and prerequisites

1. `common/helpers.sh`: add `requireFlagValue FLAG VALUE` (error "`<flag>` needs a value", exit
   1) and `printUnknownCommand CMD` (message only; each script prints its own help).
2. `sandbox.sh`, `infra/infra.sh`, `services/blockscout/blockscout.sh`,
   `services/nb-bond-api/nb-bond-api.sh`, `services/nb-ui/nb-ui.sh`:
   - Handle `-h|--help` as the first argument (help, exit 0) and as a flag (help, exit 0).
   - Right after parsing, validate `CMD` with a `case` over the script's verbs. Unknown commands
     print the message and help and exit 1, before `checkPrereqs`, hosts edits, or the cluster
     check. Add an `else` fallback in the dispatch chain too, as defence in depth.
   - `--keep` goes through `requireFlagValue` and is validated as a positive integer.
   - Quote every `cd "$SCRIPT_DIR"` and `cd "$SCRIPT_DIR/…"`.
   - Fix "does not exists" to "does not exist".
3. Hosts-file scope: call `ensureLocalhostHostEntries` only in `start` paths (`sandbox.sh
   start`, `infra.sh start`, and the standalone `start` of each service script). Remove it from
   `sandbox.sh` `stop`/`delete`/`generate-config`, `infra.sh` `stop`/`delete`, and the
   non-subtask preamble of the service scripts.
4. `infra.sh`: run `checkPrereqs` once. Keep the top-level non-subtask call and remove the calls
   inside `start`/`stop`/`delete`/`registry-sync`. `sandbox.sh` already ran it for subtasks.
5. `checkPrereqs`: require `docker info` to succeed (message: daemon not running; start Docker
   Desktop or the engine). Drop the `docker-compose` alternative. Check `kind`, `kubectl`,
   `helm`, and `forge` with `command -v` and hints (Kind/Helm/kubectl install pages as plain
   text, and `foundryup` for Forge) before the version prints.

### Slice C2 — `contracts/` scripts

1. `contracts.sh`:
   - Extract `parseVerifyFlags` (shared by `verify` and `verify-latest`) that fills `ADDRESS`,
     `CONTRACT`, `CONSTRUCTOR_ARGS[_PATH]`, `VERIFIER`, `VERIFIER_URL`, `WATCH_FLAG`,
     `GUESS_ARGS`, and `TARGET_CHAIN_ID`. Flags a verb does not accept are rejected, and values
     go through `requireFlagValue`.
   - Build forge arguments as a bash array. `verify` uses `--chain "$TARGET_CHAIN_ID"`, default
     `$CHAIN_ID`.
   - `CHAIN_ID` is read from `infra/besu/values.yaml` `.networkId` via `yq` (single source).
   - Help: `--watch (default)` and `--no-watch`. `-h` exits 0 and is handled before the cluster
     check.
   - Move the cluster-existence check into `start` and `delete` only. `verify*` need
     `BESU_LOCAL_RPC_URL` and `BLOCKSCOUT_LOCAL_URL` from `contracts/.env`.
   - Validate the command before `requireContractsEnv`.
2. `deploy.sh`: use an `ARGS` array, and append user arguments with `"$@"`. Remove the debug
   `echo`s. Fix the help example to `src/norges-bank/Wnok.sol:Wnok`. Guard `--verifier*` values.
   Add a help note that `forge create` takes the key on argv, which is acceptable for local
   fixture keys only (D11).
3. `run-scripts.sh`: guard `$2` with `requireFlagValue`, and make `VERIFY_FLAGS` an array
   (check that `deployContracts` receives it correctly; it currently takes one string, so pass
   `"${VERIFY_FLAGS[@]}"` and adapt `deployContracts` to `shift 2; verify_args=("$@")`).
4. `start-anvil.sh`: `set -euo pipefail`, then `exec anvil …`.
5. `contracts/script/csd/06_OrderBook.s.sol`: add `vm.stopBroadcast();` after the owner block.
   Run `forge fmt`, `forge build`, and `forge test`. There is no deployment effect (same
   transactions).

### Verification Stop (C1 + C2)

A command matrix recorded in `progress.md`, one row per script: `-h` → 0, help printed; `strat` →
1, no `checkPrereqs` output, no `sudo` prompt; `--keep` with no value → 1 with the message; a
normal verb still works. Confirm by `rg -n ensureLocalhostHostEntries` that the only call sites
are `start` branches. Then run `./sandbox.sh stop` and `./sandbox.sh start` once and check that
neither prints the hosts-file line on `stop`. Run `./contracts/contracts.sh verify-latest` against the running
sandbox, and do one run with the Kind context unavailable (`KUBECONFIG=/dev/null`) to prove
verify no longer needs the cluster. `forge test` must be green.

### Failure Diagnosis / Fix Forward / Rollback

- If `deployContracts` receives mangled verify flags, the symptom is forge "unexpected argument".
  Fix the array hand-off. Each slice reverts cleanly on its own.

### Exit Criteria

- [ ] Every entrypoint rejects unknown commands with no side effects, and `-h` exits 0.
- [ ] Only `start` paths edit `/etc/hosts`.
- [ ] `verify`/`verify-latest` share one parser and use the resolved chain ID.

## Phase 4: Bid-Tool Install (I5) — slice D

### Steps

1. `Makefile` `bid-tools-install`: `npm ci` at the repo root. It installs all workspaces from the
   one lockfile, which is the documented monorepo model. Update the help text.
2. `Makefile:182`: replace the `mktemp` template with
   `tmp_input=$$(mktemp "$${TMPDIR:-/tmp}/bid-encrypt-basic.XXXXXX")` (Xs at the end; the
   `.json` suffix is not needed by the encrypt CLI). Keep the `trap`.
3. Docs: `contracts/docs/bond-lifecycle-walkthrough.md:31-32`,
   `scripts/bid-encryption/README.md`, and `scripts/bid-submitter/README.md` say "run `npm ci`
   once at the repository root (or `make bid-tools-install`)" instead of `npm install` in the
   package directory.

### Verification Stop

In a disposable worktree: `make bid-tools-install` succeeds, and
`git diff --exit-code package-lock.json` is clean. Run `make bid-encrypt-basic AUCTION_ID=…`
twice in a row against a running auction (or up to the `mktemp` line with a dry input) with no
"File exists" error.

### Exit Criteria

- [ ] Install works from a clean clone, and no doc tells users to run `npm install` inside a
      workspace package.

## Phase 5: Loopback-Only Host Ports (I2) — slice E — operator approval required

### Prerequisite

D5 approved. The operator confirms that nobody relies on LAN access and accepts losing local
chain, Blockscout, and API state.

### Steps

1. `infra/cluster/cluster-config.yaml`: add `listenAddress: "127.0.0.1"` to both
   `extraPortMappings`, and extend the comment block (loopback-only by design; the ports are
   unauthenticated; use `kubectl port-forward --address` or an SSH tunnel for remote access).
2. Docs: `docs/ARCHITECTURE.md` trust-boundary section (endpoints bind loopback only);
   `infra/README.md` and `infra/DEVELOPMENT.md` port notes; a README note that an existing
   cluster keeps the old binding until recreated.
3. Apply: `./sandbox.sh delete`, then `./sandbox.sh start`. This recreates the Kind node, keeps
   the registry, and redeploys contracts to a fresh chain.

### Verification Stop

- `docker ps` shows `127.0.0.1:80->31437/tcp` and `127.0.0.1:8545->31439/tcp`.
- `curl` to `http://besu.cbdc-sandbox.local:8545` (eth_blockNumber), Blockscout, the bond API
  `/v1/health`, and the web UI all succeed from the host.
- From another LAN host (if available), the ports are refused. Otherwise, confirm with
  `lsof -nP -iTCP:8545 -sTCP:LISTEN` that the address is `127.0.0.1`.

### Failure Diagnosis / Fix Forward / Rollback

- If Kind rejects the field, check the Kind version (`listenAddress` has been supported since
  early v1alpha4). Rollback is removing the two lines plus another recreate.

### Exit Criteria

- [ ] Loopback-only bindings observed; all four hostnames work locally.

## Phase 6: Registry and Image Lifecycle (I6) — slice F

### Steps

1. `syncImagesToRegistry`: add `getBlockscoutScVerifierImage`. For the two source-built
   Blockscout images, add `syncSourceBuiltImage`. It checks `kindRegistryHasImage` or a local
   tag of the target platform and pushes it. Otherwise it records the image as skipped. After
   the loop, print "Synced N images; skipped: <list>. Run ./sandbox.sh build-images to build
   them." and return 0.
2. `deployBlockscout`: before `loadImageToKind` for the backend and frontend, run the same
   presence check, and on a miss fail with the `build-images` hint.
3. `resetKindRegistry`: its closing message names `build-images` as the next step whenever the
   sync skipped anything.
4. Hash inputs: add `nbUIHashFiles`, `nbBondApiHashFiles`, and `bensHashFiles` listers. The hash
   functions check each listed file exists (a missing one prints the path to stderr and returns
   1) and drop the `2>/dev/null` on `shasum`. The deploy callers already check for an empty
   hash, so make them print the function's stderr instead of exiting silently: move the
   assignment into `if ! bundle_hash="$(…)"; then …; fi`.
5. `scripts/verification/check-image-hash-inputs.sh`: `set +e` right after sourcing helpers
   (with a comment on why). Wrap each hash call in `if ! out=$("$hash_fn"); then fail …`. Add
   `assert_declared_files_exist NAME LISTER`. Keep its "tracked files are never modified"
   guarantee.
6. README: the `registry-reset` row adds "then run `./sandbox.sh build-images`". Make the
   `registry-sync` row and `infra/DEVELOPMENT.md` say the verifier image is included and the
   source-built images are skipped with a hint.

### Verification Stop

- `bash scripts/verification/check-image-hash-inputs.sh` passes.
- In a scratch worktree, temporarily rename `services/nb-ui/vite.config.js`. The checker reports
  the missing input by name and exits 1.
- `./sandbox.sh registry-sync` on the current registry pushes or keeps all images, including the
  verifier. The empirical `registry-reset` run (Phase 0 step 5) is done here if the operator
  agreed. Remove the local Blockscout tags first (`docker image rm` of the two `…:kind`/upstream
  tags). Reset completes the other images and prints the hint. `build-images` then restores the
  Blockscout images.

### Exit Criteria

- [ ] Reset and sync never abort part-way; the verifier image is pre-warmed; hash failures
      name the file.

## Phase 7: Pin the Unpinned Tool Images (I7) — slice G

### Steps

1. `common/images.yaml`: a `tools:` section with `openapi_generator_cli:
   openapitools/openapi-generator-cli:<tag>` and `eth_security_toolbox:
   trailofbits/eth-security-toolbox:<tag>`. Choose the tags at implementation time: the current
   release, verified to run. For the toolbox, prefer the tag whose Slither version matches the
   CI action's.
2. `regen-openapi.sh`: resolve the image with `yq` from `common/images.yaml` (clear error if
   missing), add `--user "$(id -u):$(id -g)"`, and add a comment documenting the
   `--skip-overwrite` semantics.
3. `contracts/slither.sh`: resolve the image the same way.
4. `THIRD_PARTY_LICENSES.md`: add rows in a "Local developer tooling" subsection (or the
   deployment-time table): OpenAPI Generator (Apache-2.0) and the eth-security-toolbox/Slither
   image (AGPL-3.0, to be verified). Add the matching bullets to `docs/THIRD_PARTY_NOTES.md`.
   Run `python3 scripts/verification/check-third-party-licenses.py`.

### Verification Stop

- `./services/blockscout/bens-microservice/regen-openapi.sh` on a clean tree produces no diff,
  and no root-owned files (`find … -user 0` is empty on Linux; on macOS, confirm file owners).
- `./contracts/slither.sh` on amd64, or the arm64 guard message on Apple silicon (unchanged
  behaviour).
- The licence check passes.

### Exit Criteria

- [ ] No `docker run`/`pull` of an untagged image in tracked scripts.

## Phase 8: Makefile and Script Consolidation (I8) — slice H (+ optional H2)

### Prerequisite

D6 confirmed.

### Steps

1. `Makefile`: replace `sandbox-start`/`stop`/`delete`/`generate-config` with a `sandbox-%`
   pattern rule that runs `./sandbox.sh $*`. `help` lists the `sandbox.sh` verbs and says
   "`make sandbox-<verb>` runs `./sandbox.sh <verb>`". `sandbox-fresh-start` runs
   `registry-start`, `build-images`, and `start` (help: fresh machine, slow). Remove
   `infra-stop`. Keep or remove the other `infra-*` targets per D6. Fix the help texts that
   state pre-#293 semantics. `.PHONY` updated.
2. `Makefile` basic bid targets: extract the shared health/auction resolution and context-file
   write into one `define RESOLVE_BID_CONTEXT` block that both targets call.
3. A single documented `registry-start`: README steps and table, `requireKindRegistry`'s hint,
   and `infra/AGENTS.md` all use `./sandbox.sh registry-start`. The `infra.sh` verb stays
   because `sandbox.sh` delegates to it.
4. `sandbox.sh start` waits, one per dependency. Remove the pre-contract
   `waitForBesu`/`waitForApiGateway` (`blockscout.sh` and `contracts.sh` already wait before
   they use Besu). Keep `waitForBlockscout` before contracts only when verification is enabled,
   and do the final waits once per enabled component. Update the startup-flow diagram if its
   gates change.
5. Makefile `BID_CHAIN_ID ?= 2018`: add a comment pointing at `infra/besu/values.yaml`
   `networkId`.
6. **H2 (optional, only with D7 go-ahead):** a `componentMain` helper in `helpers.sh` taking
   verbs and callbacks, used by the five component scripts. `nb-ui.sh` and `nb-bond-api.sh`
   become about 15 lines each.

### Verification Stop

`make help`; `make sandbox-image-report` (read-only) works; `make sandbox-start` on a stopped
sandbox resumes; `make bid-tools-install`. Record the wait count in a start log (`grep -c
"Waiting for"`) before and after.

### Exit Criteria

- [ ] No Makefile help text contradicts `sandbox.sh -h`; every `sandbox.sh` verb is reachable
      through `make sandbox-<verb>`.

## Phase 9: Pin Drift (I9) — slice I

### Steps

1. `common/helpers.sh`: delete `BLOCKSCOUT_CHART_VERSION`, `BENS_BASEIMAGE`,
   `NB_UI_NGINX_BASEIMAGE`, `NB_UI_BASEIMAGE`, and the NGF literal. Drop the `default` parameter
   from `getImageValue`/`getVersionValue` and the fallback `yq` reads in `getBesuImage`,
   `getBlockscoutDbImage`, `getBensBaseImage`, and `getBlockscout{Frontend,Backend}Image` (they
   are never used). `getLocalRegistryImage` requires `yq` (recommended), so `KIND_REGISTRY_IMAGE`
   goes too. Check `node-version-consistency` still passes, because it reads `helpers.sh`.
2. `scripts/verification/check-image-pin-consistency.py` (stdlib; mirror the style of
   `check-node-version-consistency.py`). It compares the `bens-microservice/Dockerfile` `ARG`
   defaults with `blockscout.bens`, the `services/nb-ui/Dockerfile` nginx `ARG` with
   `nb_ui.nginx`, the `services/blockscout/values.yaml` `dbImage`/`bensImage`/backend and
   frontend `image.repository:tag` with `blockscout.*`, and the
   `infra/gateway/templates/nodeport-config.yaml` version label with
   `charts.nginx_gateway_fabric`. It also scans tracked `*.sh` for untagged `docker run`/`pull`
   images.
3. `common/images.yaml` header: list the files the check guards, so a bump knows the sweep.
   Add a pointer comment for kindest/node (lives in `cluster-config.yaml`).
4. `contracts/README.md` or root README prerequisites: note the Foundry version CI uses and how
   to match it (`foundryup --install <version>`). Also note that helm, kind, and yq are
   unpinned host tools (documented minimums only; no enforcement).
5. CI wiring waits for D8 (Phase 10 J3). Until then the check runs locally in the PR gate.

### Verification Stop

The check passes on the tree. Editing `services/nb-ui/Dockerfile`'s nginx tag in a scratch
worktree fails it with a clear message. `./sandbox.sh start` resume still resolves every image.
Run `bash scripts/verification/check-image-hash-inputs.sh` and
`python3 scripts/verification/check-node-version-consistency.py`.

### Exit Criteria

- [ ] No dead fallback constants; every remaining duplicate pin is checked.

## Phase 10: CI and Verification (I10)

### Slice J1 — existing workflows (no new checks)

1. Pin `actions/checkout`, `actions/setup-node`, and `actions/setup-python` to full commit SHAs
   with `# vX.Y.Z` comments. Look up the SHAs at implementation time from the releases matching
   today's `@v7`. Add `# vX.Y.Z` comments to the `foundry-rs/foundry-toolchain` and
   `crytic/slither-action` SHAs. Dependabot's github-actions ecosystem keeps SHA pins and their
   comments updated.
2. `publication-hygiene.yml`: remove the `paths:` filter.
3. `license-inventory.yml`: remove the gitignored `src/requirements.txt` trigger.
4. `node-version-consistency.yml`: add `services/nb-ui/package.json`. In the checker, treat it as
   an optional manifest (validated only if it declares `@types/node`).

### Slice J2 — hygiene and link-check extensions (D9, approval)

1. `check-public-repo-hygiene.py`: add tracked-but-ignored detection
   (`git ls-files -ci --exclude-standard` must be empty). Add `Handoff-AI-*.md`, `/outputs/`,
   `/.obsidian/`, and `/.env.sandbox` to `REQUIRED_GITIGNORE_ENTRIES`, plus the local agent
   tooling entries already present in the local-temp block. Add a check for absolute macOS and
   Linux home-directory paths over tracked text files. Keep the regex in the script only, so
   this plan's own prose cannot trip it. Add a contextual key
   scan (`0x`+64-hex on lines with secret-like key names) with a path allowlist.
2. `check-markdown-links.py`: resolve targets against the `git ls-files` set and their
   directories. Strip `"title"` suffixes. Run anchor checking once in report-only mode and record
   the count in `progress.md`. Enable it by default only if the count is small and fixed in the
   same slice. Otherwise leave it behind a `--anchors` flag and add a follow-up.

### Slice J3 — new workflow (D8, approval)

New `.github/workflows/scripts-and-charts.yml` (read-only permissions, SHA-pinned actions,
triggered on `**/*.sh`, `**/helm/**`, `infra/**`, `common/**`, `scripts/**`, `Makefile`, and
itself). Jobs or steps:

- `bash -n` over `git ls-files '*.sh'`
- `helm lint` of the four local charts (the runner image ships Helm; otherwise this needs a setup
  action, which is a new third-party action and needs approval)
- `npm ci` at the root, then `npx tsc --noEmit -p` for both bid CLIs
- `python3 scripts/verification/check-image-pin-consistency.py`

### Slice J4 — optional checks (D10)

- `shellcheck`: only after double confirmation (GPL-3.0). A baseline run first. Fix or
  annotate findings in a separate PR.
- Cloud-term denylist: the script reads patterns from an environment variable (a CI repository
  variable) or an ignored local file, skips with a notice when absent, and contains no terms
  itself.

### Verification Stop (J1–J4)

Each PR shows the workflows it touches running. A throwaway PR commit that adds a home-path
string to a `.sh` file fails publication hygiene, and is then reverted. The link check fails on
a link to an ignored file (scratch doc in a scratch worktree).

### Exit Criteria

- [ ] All first-party actions SHA-pinned; hygiene runs on every PR.
- [ ] Approved checks run in CI; unapproved ones are recorded in `progress.md` as declined or
      deferred.

## Phase 11: Leftovers — slice K

1. Delete `scripts/bid-{encryption,submitter}/.yarnrc.yml` and the Yarn stanzas in their
   `.gitignore`.
2. Delete `services/blockscout/bens-microservice/package.json`. Update
   `check-third-party-licenses.py` (remove `validate_bens_node_metadata` and its call) and the
   `THIRD_PARTY_LICENSES.md` npm note. Run the licence check.
3. `nb-bond-api.sh:64`: the comment says a PVC by default, with `emptyDir` only when persistence
   is disabled.
4. `generate-local-sandbox-fixtures.mjs` `writeIfMissing`: capture `existed = existsSync(...)`
   before writing, and log "Rewrote" only when it existed.
5. `.dockerignore`: add `outputs` and `.obsidian`.
6. `.editorconfig`: add `[*.{sh,py}] indent_size = 4` (matches existing files; no reformat).
7. `readlink -f` in `contracts/*.sh`: replace with the `cd "$(dirname …)" && pwd` form the other
   scripts use (no macOS version floor).

Verification: `bash -n`; licence, hygiene, and link checks; `node scripts/generate-local-sandbox-fixtures.mjs --force`
in a scratch worktree shows "Wrote" for new files; `docker build` of nb-ui still succeeds (the
context shrinks only).

## Test Matrix

| Layer | Risk or behaviour | Test/evidence |
|---|---|---|
| Flag resolution | Precedence and defaults; injection through `.env.sandbox` | Phase 1 matrix (five rows) |
| Lifecycle | Resume unchanged after Phases 1, 2, 3, 8 | `./sandbox.sh start` on a stopped sandbox, exit 0, all URLs up |
| Wait failure | Timeout exits non-zero | Phase 2 forced timeout (component and orchestrator) |
| CLI | Unknown command, `-h`, missing flag value, no side effects | Phase 3 matrix per script |
| Contracts | Shared verify parser; chain ID; no cluster needed; OrderBook script | `verify-latest` live; `KUBECONFIG=/dev/null` run; `forge test` |
| Bid tools | Install from a clean clone; `mktemp` twice | Disposable worktree |
| Network | Loopback binding | `docker ps`, `lsof`, local curls |
| Registry | Partial reset; verifier pre-warm; skip hint | Phase 6 runs |
| Hash inputs | Missing declared file reported | Checker run with a scratch rename |
| Pins | Drift detection | New check passes, then fails on a scratch edit |
| CI | Triggers and gates | PR runs; throwaway failing commit |
| Portability | macOS bash 3.2 | `/bin/bash -n` plus runs on macOS; CI `bash -n` on Linux |

## Recommended PR Slices

| Slice | Branch | Architectural outcome | Main proof | Compatibility / cleanup |
|---|---|---|---|---|
| A | `feature/deploy-flag-defaults` | One flag model; untracked override file | Phase 1 matrix | A locally modified `.env.sandbox` must be stashed before pull (PR body) |
| B | `feature/fatal-readiness-timeouts` | Waits fail honestly; one default | Forced timeout | None |
| C1 | `feature/entrypoint-arg-validation` | Validate-before-act; hosts edit on start only; prereq checks | CLI matrix | None |
| C2 | `feature/contracts-script-fixes` | Shared verify parser; chain ID from values; OrderBook `stopBroadcast` | `verify-latest`, `forge test` | None |
| D | `feature/bid-tools-root-install` | Root workspace install; portable `mktemp` | Clean-worktree install | None |
| E | `feature/loopback-host-ports` | Loopback-only ports | `docker ps` after recreate | **Approval.** Recreate required |
| F | `feature/registry-sync-completeness` | Complete, non-aborting sync; loud hash failures | Phase 6 runs | None |
| G | `feature/pin-tool-images` | Tool images pinned; generator as user | Regen no-diff; licence check | Licence notice (D12) |
| H | `feature/makefile-delegates-to-sandbox` | Makefile pass-through; one `registry-start`; single waits | `make` runs; wait count | Removed `infra-*` targets listed in PR body |
| H2 | `feature/component-script-skeleton` | Shared skeleton (optional) | CLI matrix re-run | Only with D7 go-ahead |
| I | `feature/image-pin-consistency` | Dead fallbacks gone; drift check | Check pass/fail | CI wiring deferred to J3 |
| J1 | `feature/ci-action-pins-and-triggers` | SHA pins; correct triggers | Workflow runs | None |
| J2 | `feature/hygiene-and-link-check-gaps` | Stronger existing gates | Throwaway failing commit | **Approval** (D9) |
| J3 | `feature/scripts-and-charts-ci` | New workflow | Its first run | **Approval** (D8) |
| J4 | `feature/optional-shellcheck` / `feature/optional-cloud-term-check` | Optional checks | Baseline run | **Double confirmation** / **approval** (D10) |
| K | `feature/script-leftovers-cleanup` | Leftover cleanup | Licence, hygiene, and `bash -n` checks | None |

Independent slices can land in any order after A and B. E can land whenever the operator approves
it. I lands before J3. K is independent. Branch naming, commit style, and the per-area gate
follow the repository PR workflow.

## Migration, Rebuild, and Rollout

- Data/schema version effect: none, except slice E, which forces a cluster recreate and so a
  fresh chain, Blockscout index, and API database. Contracts redeploy to new addresses on the new
  chain, which is the normal fresh-sandbox path. No consumer configuration changes, because the
  API resolves addresses from the registry configmap.
- Local rebuild/restart path: slices A–D and F–K need only `./sandbox.sh start` on the existing
  sandbox. `registry-sync` is optional after F.
- Compatibility window: after A, a clone with a locally edited `.env.sandbox` must move it aside
  before pulling, then restore it (it becomes an ignored local file).
- Non-local deployment note: unaffected. It does not use these scripts, Kind, or the Makefile.
- Rollback or fix-forward boundary: every slice reverts independently. For E, rollback needs
  another recreate.

## Documentation and Public-Repo Hygiene

- Docs to update: `README.md` (quick start steps 6–7, command table, Makefile section),
  `docs/ARCHITECTURE.md` (configuration and trust boundaries),
  `docs/diagrams/operations/sandbox-startup-flow.md`, `infra/README.md`,
  `infra/DEVELOPMENT.md`, `infra/AGENTS.md`, `contracts/README.md`,
  `contracts/docs/bond-lifecycle-walkthrough.md`, `scripts/bid-*/README.md`,
  `scripts/DEVELOPMENT.md`, `scripts/README.md`, and `CONTRIBUTING.md` (bid-tool install, if
  mentioned).
- `docs/DOCUMENTATION_INDEX.md`: add this plan folder when it is committed.
- Known issues: none added by default. If D10 or anchor checking is deferred, record it as a
  follow-up.
- Third-party inventory: slice G (tool images), slice K (BENS stub removal).
- Committed text: no vendor or model names, no local tooling paths, no home paths, and no
  non-local deployment specifics. Fixtures are referenced by path.

Verification per slice:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
# Slices G and K (image pins, inventory):
python3 scripts/verification/check-third-party-licenses.py
```

## Out of Scope

- Retiring the Makefile; a shell test framework; making `build-images` a general builder;
  version bumps; Dependabot target branch (claim dropped); non-local deployment changes.

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has recorded evidence in `progress.md`.
- [ ] Approval-gated slices are either landed with their approval noted or recorded as declined
      or deferred.
- [ ] Public-repo checks pass on every slice.
- [ ] Documentation matches the implemented behaviour.
- [ ] No PR body or commit contains private environment information.
