# Image and chart pin refresh — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-10-21 — Phase 1 implemented and verified on the local sandbox; PR pending
**Current phase:** Phase 1: image hash base refs (awaiting PR and merge)
**Next action:** After slice 1 merges, branch `feature/nginx-1-30-6` from a fresh `development`,
re-check the newest nginx 1.30.x tag and its platforms, and run Phase 2.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline | Done for planning (2026-10-21); re-run per slice | see below | — |
| 1 — Image hash base refs | Done locally (2026-10-21) | `check-image-hash-inputs.sh` 11/11 plus a negative test; one-time rebuild of all three images on the local sandbox | pending |
| 2 — nginx 1.30.6 | Not started | | |
| 3 — Blockscout supporting components | Not started | | |
| 4 — NGINX Gateway Fabric 2.8.0 | Not started | | |
| 5 — Besu 26.10.0 | Not started | | |
| 6 — Blockscout v12 + frontend v2.12 | Not started | | |
| 7 — Local registry 3.1.2 | Not started | | |

## Deviations From the Plan

- 2026-10-21: the operator approved D1–D6 and limited the scope to the local sandbox. The
  Besu rollback moved from `./sandbox.sh delete` to `besu storage revert-code-format`, after
  confirming that the 26.10.0 database upgrade affects only the Bonsai validator and ships a
  revert subcommand.

## Verified So Far

- Pin inventory by `git grep` on `origin/development` at `f9e9b0a` — 2026-10-21.
- Newest tags and amd64/arm64 availability on Docker Hub, ghcr.io and GitHub releases for
  every in-scope pin — 2026-10-21. Python 3.14.9 is released but has no image yet; `postgres`
  18.5 was never released.
- Running images match the pins; nb-ui `nginx -v` = 1.30.3; Gateway API CRDs v1.5.1; Kind node
  v1.32.11; gateway published on `0.0.0.0:80`/`:8545`, registry on `127.0.0.1:5001` —
  2026-10-21.
- Blockscout `fill_internal_transactions_address_ids` = `completed`; 160 blocks indexed (v12
  upgrade gate satisfied) — read-only `psql` query, 2026-10-21.
- `bensImageHash` omits the Python base ref on `development`; the pending Node 26.12.1 pin
  bump adds base refs for nb-ui and nb-bond-api only — 2026-10-21.
- `docker.io/library/node:26.12.1` resolves to an OCI index with no manifests — 2026-10-21
  (affects the Node pin bump, not this plan directly).
- Upstream facts relied on: Blockscout `version_upgrade.ex` (`since 12.0.0, min_from 11.0.2`),
  the v12.0.3 `docker/Dockerfile` (Elixir 1.20.4 / OTP 28, `ffmpeg`), frontend v2.11.0 / v2.12.0
  compatibility tables, and the verifier v1.11.0 `base.toml` (`[compilers.execution] type =
  "disabled"`). Alpine's `ffmpeg` licence is `GPL-2.0-or-later AND LGPL-2.1-or-later`.
- Besu 26.10.0 release notes: the database auto-upgrade applies to Bonsai only (DB v4 / archive
  v3) and `besu storage revert-code-format` reverts it; `separateApi.enabled: false` in
  `services/blockscout/values.yaml`, so chart 4.5.2's strategy change does not apply — 2026-10-21.

- Phase 1 live check (2026-10-21): new hashes `nb-ui:1c4a3bad4d62`, `nb-bond-api:e9b24c156cd2`
  and `bens-microservice:d23100904bb4` were built, pushed and deployed once. The previous BENS
  tag `f4aa56680fa6` equals the old formula's hash on the same tree, so its change comes only from
  the Python base ref. Pods are Ready; NB Bond API `/v1/health` is `ok` (chain 2018, ingestion
  lag 0); nb-ui answers 200 through the gateway; BENS answers 2xx; Blockscout is unaffected.
- Phase 1 negative test: with the nginx and BENS base-ref lines removed from a scratch copy of
  `common/helpers.sh`, the check fails on `nb_ui.nginx` and `blockscout.bens`.

## Blocked / Waiting On

- D4 second confirmation (ffmpeg licence) — operator, before Phase 6.
- The later non-local rollout — operator; out of scope here, see `plan.md` "Deferred Non-Local Rollout".
- Phase 7 — the status of scripts-hardening Phase 6 (who owns `ensureKindRegistry`).

## Follow-ups Found Along the Way

- No Dependabot coverage for Docker images or Helm charts — `.github/dependabot.yml` — propose a
  `docker` ecosystem entry for the Dockerfiles and a scheduled pin-freshness report; needs a CI
  decision.
- Upstream moved the nginx-unprivileged Docker Hub home to `nginx/nginx-unprivileged` —
  `common/images.yaml:55` — re-check at the next bump.
- The verifier fetches the `linux-amd64` solc list on every platform —
  `services/blockscout/templates/sc-verifier-deployment.yaml` — check behaviour on arm64.
- `busybox:1.37.0` in `services/blockscout/templates/blockscout-migration-job.yaml` is outside
  the pin files and unchecked.

## Session Handoff

Phase 1 is on `feature/image-hash-base-refs` (not yet pushed). The local sandbox now runs the
nb-ui and nb-bond-api images from `development` at `f9e9b0a`; before this they were built from an
older tree, so the restart also deployed the changes in that commit. The new hashes match the
stage base refs that Node, nginx and Python pin bumps will move. A later Node pin bump that
rebases onto this change drops its own hash edits.
