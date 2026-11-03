# Besu 26.11.0 bump — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-03
**Created:** 2026-11-03
**Scope:** `common/images.yaml`, `infra/besu/values.yaml`, `scripts/verification/check-besu-qbft-baseline.py`, `README.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY_NOTES.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `infra/README.md`, `infra/DEVELOPMENT.md`, `docs/plans/archive/besu-26-11-0-bump/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, pre-upgrade baseline, pin sweep, static checks
Phase 2  Trust-store read and Known Issues row
Phase 3  Live in-place upgrade and verification
Phase 4  Archive the plan folder, PR, merge on go-ahead
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Pin sweep

1. Branch `feature/besu-26-11-0` from `origin/development`, in a separate worktree.
2. Pre-upgrade baseline from the live stack (read-only): `web3_clientVersion`, head block and hash on
   both nodes, NB Bond API ingestion lag, Blockscout block height.
3. Edit the pin in `common/images.yaml` and `infra/besu/values.yaml`, the constant in the baseline
   checker, and the version prose in the five documents.
4. Run `check-besu-qbft-baseline.py`, `check-image-hash-inputs.sh`, and the hygiene, link, licence,
   and node-version checks.

Exit: all static checks pass and a repository-wide search finds no remaining `26.10.2` outside
archived and frozen records.

## Phase 2: Trust-store register

1. Pull the 26.11.0 image locally and list its trust store (`keytool -list -cacerts`).
2. Update the Besu row in `docs/KNOWN_ISSUES.md`: image tag, trust-store source, "Distrusted roots
   present", last-checked date. If a distrusted root has reappeared, stop and report it.

Exit: the row reflects a fresh read of the new image.

## Phase 3: Live upgrade and verification

1. `registry-sync` so the local registry holds 26.11.0, then re-run the Besu component start so Helm
   upgrades both StatefulSets in place (the exact entry point is in `infra/DEVELOPMENT.md`). No
   `delete`, no wipe.
2. Verify against the acceptance criteria: both nodes report `besu/v26.11.0`; the head advances;
   head hashes match on both nodes; a transaction is mined; NB Bond API ingestion lag is 0 and read
   endpoints answer; Blockscout indexes the new block.
3. Restart the archive node once and confirm Blockscout resumes indexing (the WebSocket check).
4. Scan Besu and Blockscout logs for new errors compared with the baseline.

Exit: every acceptance row has evidence recorded in `progress.md`.

Recovery: if the upgrade fails to start, revert the pin and re-run the component start; the volumes
are untouched. If the archive node diverges from the validator, stop and report before doing
anything destructive. Never wipe the chain without asking.

## Phase 4: PR

1. Move this folder to `docs/plans/archive/`, set the `Status:` line, add the index entry, in the
   same commit as the change.
2. Push and open a PR against `development` with the pin sweep, the behaviour-change table, and the
   live evidence. No AI attribution.
3. Merge only on the operator's go-ahead. Remove the worktree and branch.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Pins and checkers | Drift across the sweep | baseline checker, image-hash check, repository search |
| Trust store | A distrusted root returns | `keytool` listing |
| Chain | Block production or consensus regression | versions, head, hash equality, mined transaction |
| Consumers | NB Bond API, Blockscout regress | ingestion lag, explorer height, logs |
| WebSocket | Vert.x 5.2.2 write-after-close | archive restart, indexing resumes |

## Rollback

Revert the commit and re-run the component start on the old pin. The volumes persist across both.

## Done Criteria

- [x] Pins, checker, and prose agree on 26.11.0.
- [x] Trust-store row refreshed.
- [x] Live upgrade verified against every acceptance row.
- [ ] PR merged on go-ahead.
