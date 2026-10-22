# Sandbox scripts and CI hardening — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

The sandbox's shell entrypoints, Makefile, image pins, and CI checks tell the operator the truth.
A clean clone starts with the deploy flags the README describes, and flag overrides never dirty
the tracked tree. A readiness timeout fails the run instead of printing "Finished deploying". A
typo in a subcommand exits non-zero before it edits `/etc/hosts`. The documented bid-tool install
works. Besu RPC and the unauthenticated API are reachable only from the workstation, not the LAN.
`registry-reset` and `registry-sync` finish or explain what is missing. The Makefile no longer
contradicts `sandbox.sh`. Duplicated version pins are either removed or checked. CI covers the
files it is meant to guard. Contributors and the operator see these effects whenever they run
`./sandbox.sh`, `make`, or open a PR.

## Why This Change

A repo review on 2026-09-28 found about forty defects in the script and CI layer. Each is small,
but together they mislead the operator:

- A clean clone silently runs a different deploy workflow from the one `sandbox.sh` and the
  README describe (a tracked `.env.sandbox` overrides the defaults, and `generate-config` refuses
  to run because that file already exists).
- `./sandbox.sh start` exits 0 and prints "Finished deploying" when a component never became
  ready.
- `./infra/infra.sh strat` runs the prerequisite checks and a `sudo` hosts-file edit, then
  exits 0.
- `make bid-tools-install` fails, and the walkthrough's alternative changes the root lockfile.
- Host ports 80 and 8545 are bound on all interfaces, so the unauthenticated Besu RPC (zero gas)
  and the API (`AUTH_MODE=none`) are reachable from the local network.

The remaining findings are drift that makes the next change harder: image pins repeated outside
`common/*.yaml`, a Makefile that predates the #293 lifecycle change, CI trigger paths that skip
the files they guard, and link and hygiene checks with blind spots.

## Scope

### In Scope

1. **Deploy-flag model.** Defaults live in `sandbox.sh`. `.env.sandbox` becomes an untracked
   local override file with a tracked example. Precedence is environment > `.env.sandbox` >
   defaults. `generate-config` works on a clean clone. The README describes the real defaults.
2. **Honest readiness waits.** `waitForApp` and `waitForApiGateway` return non-zero after
   printing diagnostics. One default timeout is defined in `common/helpers.sh`. The flag banner
   says what the flag does.
3. **CLI argument handling.** Unknown subcommands and missing flag values exit non-zero before
   any side effect. `-h` prints help and exits 0. `/etc/hosts` is edited only on `start` paths.
   `checkPrereqs` detects a stopped Docker daemon and gives install hints. The `contracts/`
   helper scripts get the same fixes: verify-flag parsing is shared, the chain ID has one
   source, `--watch` help is corrected, and `verify` no longer requires a Kind cluster.
   Word-splitting, debug output, and the stale help example in `deploy.sh` are fixed, strict mode
   is added to `start-anvil.sh`, and `06_OrderBook.s.sol` gets its missing `stopBroadcast`.
4. **Bid-tool install.** `make bid-tools-install` and the docs use the root npm workspace
   install. The Makefile temp file is created portably.
5. **Loopback-only host ports.** The Kind port mappings bind `127.0.0.1`. Applying this means
   recreating the cluster, which needs operator approval.
6. **Registry and image lifecycle.** `registry-sync` includes the smart-contract-verifier
   image. `registry-reset` and `registry-sync` no longer abort part-way when the source-built
   Blockscout images are absent. A missing hash input fails loudly. The hash-input checker keeps
   its own error handling.
7. **Unpinned tool images.** The OpenAPI generator and the Slither toolbox images are pinned in
   `common/images.yaml`. The generator runs as the invoking user.
8. **Consolidation.** `sandbox.sh` is the canonical entrypoint. The Makefile delegates to it and
   no longer states the pre-#293 stop semantics. There is one documented `registry-start`
   command, and duplicate readiness waits and prerequisite checks are removed.
9. **Pin drift.** Dead fallback constants in `common/helpers.sh` are removed, and a check
   compares the remaining fallback pins with `common/images.yaml` and `common/versions.yaml`.
10. **CI and verification.** Actions are pinned to SHAs with version comments, workflow trigger
    paths are corrected, and the hygiene and link checks close their gaps. The operator is
    asked to approve new CI jobs (`bash -n`, `helm lint`, bid-CLI typecheck) and the optional
    checks.
11. **Leftovers.** Stale Yarn files, the BENS generator stub `package.json`, stale comments, the
    fixture-generator log wording, `.dockerignore` and `.editorconfig` gaps, and the missing
    flag banners.

### Out of Scope

- Rewriting the scripts in another language, or adding a shell test framework.
- Growing `build-images` into a general image builder (the existing `docs/KNOWN_ISSUES.md` item
  stays open).
- Changing the Blockscout, Besu, or chart versions themselves. This plan changes where pins
  live, not what they are.
- Dependabot target-branch configuration. A reviewer claimed Dependabot PRs target `main`. Open
  bot PRs target `development`, so the claim is dropped. See `progress.md`.
- Anything about the non-local deployment. Changes that affect it are only flagged.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| On a clean clone, `./sandbox.sh start` resolves each `DEPLOY_*` flag to the value the README documents, and `git status` stays clean after `generate-config` and edits to `.env.sandbox` | Silent workflow change; dirty tree | `git ls-files .env.sandbox` is empty; a flag-resolution dry run (Phase 1) prints the documented values; `generate-config` succeeds on a fresh worktree |
| `DEPLOY_X=false ./sandbox.sh start` honours the environment over `.env.sandbox`, and `.env.sandbox` honours over defaults | Hard-set values ignored the environment | Phase 1 precedence matrix recorded in `progress.md` |
| A component that never becomes ready makes `./sandbox.sh start` exit non-zero after diagnostics, and "Finished deploying" is not printed | False success | Forced-timeout run (Phase 2) shows exit status ≠ 0 |
| `./infra/infra.sh strat`, `./services/*/*.sh strat`, and `./sandbox.sh strat` exit non-zero without running `checkPrereqs` or editing `/etc/hosts`; `-h` exits 0 | Side effects on a typo | Command matrix in `progress.md` |
| `stop`, `delete`, and `generate-config` never invoke `sudo` | Unneeded privilege prompt | Code inspection plus a run with a hosts file already populated |
| `make bid-tools-install` succeeds on a clean clone and leaves `package-lock.json` unchanged | Broken install; lockfile churn | Fresh worktree run; `git diff --exit-code package-lock.json` |
| `docker port <kind node>` shows `127.0.0.1:80` and `127.0.0.1:8545` after recreate | LAN exposure of unauthenticated RPC/API | `docker ps` port column |
| `./sandbox.sh registry-reset` completes the non-Blockscout sync when the source-built images are absent and names `build-images` as the next step | Part-way abort | Run with the two Blockscout tags removed from the host cache |
| Deleting a declared hash input makes the hash function print the missing path and fail, and the checker reports it | Silent abort | Checker run with a temporary rename in a scratch worktree |
| No image in a tracked script resolves to an implicit `latest` | Non-reproducible tooling | `rg` for unpinned `docker run`/`pull` refs returns none |
| Every fallback pin outside `common/*.yaml` equals its source-of-truth value, and CI fails when they drift | Silent drift | New check passes; a deliberately edited fallback fails it |
| CI workflows run when their guarded files change, and actions are SHA-pinned with version comments | Unguarded changes; mutable tags | Workflow diff review; a test PR touching `*.sh` triggers publication hygiene |
| The link check fails for a link whose target is untracked | Local pass, CI fail | Checker run with a link to an ignored file |

## Constraints

- Sandbox-sized and local-first. Scripts must keep working under macOS `/bin/bash` 3.2 (no
  associative arrays, no `mapfile`, no `${var,,}`).
- Public repo: no secrets, private identifiers, or home-directory paths. Fixtures are referenced
  by path only.
- No new dependency, image, or program without explicit operator approval. Anything licensed
  more restrictively than Apache-2.0 needs double confirmation.
- New CI workflows or checks need operator approval.
- The Kind config change forces a cluster recreate, which destroys local chain state. It needs
  operator approval.
- Script environment flags keep a banner directly above their exports, with true and false
  behaviour on each line.

## Open Questions

- Deploy-flag defaults for `DEPLOY_VERIFY_CONTRACTS` and `DEPLOY_SKIP_SIMULATION`: keep today's
  effective clean-clone behaviour (`false`/`true`) or switch to the values `sandbox.sh`
  declares (`true`/`false`). Owner: sandbox operator. Decided before Phase 1 (design D1).
- Loopback binding: approve the cluster recreate, and confirm nobody relies on LAN access to the
  sandbox. Owner: sandbox operator. Decided before Phase 5 (design D5).
- New CI jobs and optional checks: which of `bash -n`, `helm lint`, bid-CLI typecheck, a
  pin-consistency check, `shellcheck` (GPL-3.0, double confirmation), and a cloud-term denylist
  check to adopt. Owner: sandbox operator. Decided before Phases 9 and 10 (design D8–D10).
