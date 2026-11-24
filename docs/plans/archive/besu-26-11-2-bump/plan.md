# Besu 26.11.2 bump — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-24
**Created:** 2026-11-24
**Scope:** `common/images.yaml`, `infra/besu/values.yaml`, `scripts/verification/check-besu-qbft-baseline.py`, `README.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY_NOTES.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `infra/README.md`, `infra/DEVELOPMENT.md`, `docs/plans/archive/besu-26-11-2-bump/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, pre-upgrade baseline, pin sweep, static checks
Phase 2  Trust-store read and Known Issues row
Phase 3  Live in-place upgrade, lifecycle smoke, restarts, soak
Phase 4  Archive the plan folder, PR, merge on go-ahead
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 1: Pin sweep

1. Branch `feature/besu-26-11-2` from `origin/development`.
2. Read-only baseline: `web3_clientVersion`, head block, hash and state root on both nodes, NB Bond
   API ingestion lag, Blockscout block height.
3. Edit the pin (tag and index digest) in `common/images.yaml` and `infra/besu/values.yaml`, the
   constant in the baseline checker, and the version prose in the five documents.
4. Run `check-besu-qbft-baseline.py`, `check-image-pins.py`, `check-image-hash-inputs.sh`, and the
   hygiene, link, licence and node-version checks.

Exit: all static checks pass and a repository search finds no remaining `26.11.0` outside archived
and frozen records.

## Phase 2: Trust-store register

1. Pull the 26.11.2 image and list its trust store (`keytool -list -cacerts`).
2. Update the Besu row in `docs/KNOWN_ISSUES.md`. If a distrusted root has reappeared, stop and report.

## Phase 3: Live upgrade and verification

1. `./infra/infra.sh registry-sync`, then `./infra/infra.sh start`, which runs the Besu Helm upgrade
   in place. No `delete`, no wipe.
2. Check both nodes report `besu/v26.11.2`, the old head block keeps its hash and state root, and a
   few mined transactions have equal hashes and state roots on both nodes.
3. NB Bond API lag 0; Blockscout at the same height.
4. Bond lifecycle smoke on the upgraded chain: deploy, auction with bids and finalisation, coupon.
5. Restart each node once; a `trace_block` call against the archive node.
6. A 20-minute soak with a transaction trickle, sampled at intervals.
7. Skip the fresh-genesis run unless something above looks wrong.

Exit: every acceptance row has evidence in `progress.md`.

Recovery: if a node fails to start, revert the pin and re-run the component start. Because 26.11.0
refuses data last started by 26.11.2 while the version-compatibility protection is on, the first
start after a revert needs `BESU_VERSION_COMPATIBILITY_PROTECTION=false`. If the archive node diverges
from the validator, stop and report before doing anything destructive. Never wipe the chain without
asking.

## Phase 4: PR

1. Move this folder to `docs/plans/archive/`, set the `Status:` line, add the index entry, in the same
   commit as the change.
2. Push and open a PR against `development`. No AI attribution.
3. Merge only on the operator's go-ahead.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Pins and checkers | Drift across the sweep | baseline checker, image-pin and image-hash checks, repository search |
| Trust store | A distrusted root returns | `keytool` listing |
| Chain | Block production or consensus regression | versions, head, hash and state-root equality, mined transactions |
| Consumers | NB Bond API, Blockscout regress | ingestion lag, explorer height |
| Lifecycle | Zero-fee transaction-pool regression | bond deploy, auction, coupon |
| Restart and soak | Restart or slow-divergence regression | restarts, `trace_block`, periodic snapshots |

## Rollback

Revert the commit and re-run the component start on the old pin, with the version-compatibility
protection off for the first start (see `docs/KNOWN_ISSUES.md`). The volumes persist across both.

## Done Criteria

- [x] Pins, checker, and prose agree on 26.11.2.
- [x] Trust-store row refreshed.
- [x] Live upgrade verified against every acceptance row.
- [ ] PR merged on go-ahead.
