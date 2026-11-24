# PostgreSQL 18.7 bump — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-11-24
**Created:** 2026-11-24
**Scope:** `common/images.yaml`, `services/blockscout/values.yaml`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/postgres-18-7-bump/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Branch, release-note check against the schema, dump and fingerprint
Phase 2  Pin sweep and static checks
Phase 3  In-place roll, verification, restart, 10-minute watch
Phase 4  Archive the plan folder, PR, merge on go-ahead
```

## Phase 1: Evidence and safety net

1. Read the 18.7 release notes against the live schema (index access methods and operator classes).
2. `pg_dump -Fc` of `blockscout_db` and a globals-only dump to a directory outside the repository;
   record size and checksum.
3. Fingerprint the key tables (row counts and checksums up to a fixed block number) and note the
   explorer height and the database log.

## Phase 2: Pin sweep

1. Edit the pin (tag and index digest) in `common/images.yaml` and `services/blockscout/values.yaml`.
2. Update the PostgreSQL row and the "not yet taken" bullet in `docs/KNOWN_ISSUES.md`; add the index
   entry.
3. Run `check-image-pins.py`, `check-image-hash-inputs.sh`, hygiene, links and licences.

## Phase 3: Live roll

1. `./infra/infra.sh registry-sync`, then `./services/blockscout/blockscout.sh start` (the Blockscout
   component start; it upgrades the release and recreates the database pod). A one-second probe times
   the gap.
2. Verify version, the log, the fingerprint, the explorer height, a verified contract page, BENS and
   NB Bond API.
3. Restart the database pod once; then a 10-minute watch with a few transactions.

Recovery: revert the pin and re-run the component start; the volume is untouched. Never delete the
Blockscout namespace without asking: it holds the volume.

## Phase 4: PR

Archive the folder, open the PR against `development`, merge only on the operator's go-ahead.

## Done Criteria

- [x] Pin and prose agree on 18.7.
- [x] Register row refreshed.
- [x] Live roll verified against every acceptance row.
- [ ] PR merged on go-ahead.
