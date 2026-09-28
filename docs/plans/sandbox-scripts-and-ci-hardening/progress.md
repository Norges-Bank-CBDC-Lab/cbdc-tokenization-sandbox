# Sandbox scripts and CI hardening — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan drafted from the 2026-09-28 repo review; findings re-verified against the code
**Current phase:** Not started
**Next action:** Operator decides D1 (deploy-flag defaults). Then run Phase 0 steps 1, 2, 4,
and 6: port bindings, a timed resume of the stopped sandbox, `make bid-tools-install` in a
disposable worktree, and the CLI matrix from code reading. Record the results under "Verified So
Far" and confirm the D4 timeout default.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterization | Not started | | |
| 1 — Deploy-flag model (slice A) | Not started | | |
| 2 — Honest readiness waits (slice B) | Not started | | |
| 3 — CLI handling and side-effect scope (slices C1, C2) | Not started | | |
| 4 — Bid-tool install (slice D) | Not started | | |
| 5 — Loopback-only host ports (slice E) | Waiting on approval (D5) | | |
| 6 — Registry and image lifecycle (slice F) | Not started | | |
| 7 — Pin tool images (slice G) | Not started | | |
| 8 — Makefile and script consolidation (slice H, optional H2) | Waiting on D6 (and D7 for H2) | | |
| 9 — Pin drift (slice I) | Not started | | |
| 10 — CI and verification (slices J1–J4) | J1 not started; J2–J4 waiting on approval (D8–D10) | | |
| 11 — Leftovers (slice K) | Not started | | |

## Deviations From the Plan

None yet. The review findings were corrected while planning, as follows:

- **Dropped:** "Dependabot bot PRs go to `main` because `dependabot.yml` lacks
  `target-branch`." Open bot PRs target `development`, so no change is planned. Optional:
  Dependabot has no entries for the pip (BENS `requirements.txt`) and docker (Dockerfile `FROM`)
  ecosystems. This is recorded as a follow-up below, not in scope.
- **Corrected:** "Move the `forge create` private key to `ETH_PRIVATE_KEY`." `forge create --help`
  (forge 1.6.0) lists no environment binding for `--private-key`, only keystore variables. The
  sandbox deploy path uses `forge script`, where keys never reach argv. The decision is to
  document and accept (design D11).
- **Corrected:** "Besu pin has no drift check." `check-besu-qbft-baseline.py` compares
  `common/images.yaml` with `infra/besu/values.yaml` and asserts the baseline version (the
  `validate` check). The other duplicated pins are unguarded, as reported.
- **Narrowed:** "`checkPrereqs` gives no install hints." Hints exist for `jq`, `yq`, `node`/`npm`/
  `npx`, and `cast`. They are missing for `kind`, `kubectl`, `helm`, and `forge`, and for a
  stopped Docker daemon.
- **Narrowed:** "`node-version-consistency` doesn't cover `services/nb-ui/package.json`." True,
  but nb-ui declares no `@types/node` today, so this is a latent gap only.
- **Refined:** "Besu/gateway waited twice." On a full start Besu readiness is waited up to four
  times (`blockscout.sh`, `sandbox.sh` ×2, `contracts.sh`).
- **Refined:** The `--keep` missing-value failure was reproduced under bash 3.2 as
  `$1: unbound variable`, as reported.

## Verified So Far

- Tracked `.env.sandbox` contents, hard-set exports at `sandbox.sh:52-58`, the unconditional
  `source` at `:155-157`, and the `generate-config` refusal at `:333-335` — read on 2026-09-28.
- The sandbox Kind node publishes `0.0.0.0:80` and `0.0.0.0:8545`, and the registry publishes
  `127.0.0.1:5001` — `docker ps`, 2026-09-28.
- The wait helpers `return 0` on timeout, clamp to 60, and default to 0 — read on 2026-09-28.
- Unknown subcommands fall through with exit 0 in `infra.sh`, `blockscout.sh`, `nb-bond-api.sh`,
  and `nb-ui.sh` — read on 2026-09-28.
- BSD `mktemp` with a non-trailing `XXXXXX` template creates the literal name, and a second call
  fails "File exists" — reproduced in a scratch directory, 2026-09-28.
- Neither bid CLI directory has a `package-lock.json`, and both are root workspaces — `ls` and
  root `package.json`, 2026-09-28. The actual `npm ci --prefix` failure is still to be
  reproduced (Phase 0).
- `syncImagesToRegistry` omits the verifier image. The sync order puts the source-built
  Blockscout images before db, BENS, node, and nginx — read on 2026-09-28.
- The hash-input checker has `-e` re-enabled by sourcing `helpers.sh` and tests only directories
  — read on 2026-09-28.
- The OpenAPI generator image has no tag and `slither.sh` uses `:latest` — read on 2026-09-28.
- `bash -n` passes on all 16 tracked `.sh` files, `helm lint` passes on the four local charts,
  and `tsc --noEmit` passes for both bid CLIs with the workspace TypeScript — local runs,
  2026-09-28.
- `git ls-files -ci --exclude-standard` is empty, no tracked file contains a home-directory path,
  and the only tracked `0x`+64-hex match outside lockfiles is an example ciphertext — local runs,
  2026-09-28.
- `license-inventory.yml` triggers on a gitignored path (`git check-ignore`), 2026-09-28.
- `06_OrderBook.s.sol` has no final `vm.stopBroadcast()` — read on 2026-09-28.

## Blocked / Waiting On

- D1 (deploy-flag defaults) — sandbox operator; blocks Phase 1.
- D4 (timeout default) — Phase 0 timing, then operator confirmation; blocks Phase 2.
- D5 (loopback binding, cluster recreate) — sandbox operator; blocks Phase 5.
- D6 (Makefile `infra-*` targets) and D7 (shared skeleton) — sandbox operator; block Phase 8 and
  H2.
- D8–D10 (new CI workflow, hygiene and link-check extensions, `shellcheck` double confirmation,
  cloud-term check) — sandbox operator; block J2–J4.
- D12 (Slither toolbox licence notice) — operator acknowledgement before slice G.

## Follow-ups Found Along the Way

- Dependabot has no `pip` entry for `services/blockscout/bens-microservice/requirements.txt` and
  no `docker` entry for Dockerfile bases — `.github/dependabot.yml` — optional, separate PR if
  wanted.
- `cast wallet address/public-key --private-key` in `deployBesu` puts the Besu fixture keys on
  argv — `common/helpers.sh:1493-1496` — same trade-off as D11; accept for local fixture keys.
- `syncImagesToRegistry` does not pre-warm the NGINX Gateway Fabric images (pulled by the chart
  at deploy time) — `common/helpers.sh:1317-1339` — assess whether offline starts need it.
- `infra/infra.sh stop` scales Besu and the gateway to zero while Blockscout keeps running.
  #293 moved the orchestrator to node-level stop for index continuity. Decide in slice H whether
  the component-level `infra.sh stop` should remain.

## Session Handoff

The plan is drafted only. No code changed. The sandbox was left running as found. Nothing is
half-done.
