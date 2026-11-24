# PostgreSQL 18.7 bump — Design

**Status:** Approved (2026-11-24)
**Created:** 2026-11-24
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/image-pin-refresh/` (how image pins are refreshed and verified).

## Decision Summary

Move the pin to 18.7 in one small PR and roll the database in place. Both releases of a minor line
share the on-disk format, so the existing volume opens directly. The database is a single Deployment
with a `Recreate` strategy, so the roll costs a short outage of the database and, until the Blockscout
backend reconnects, of the explorer.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `postgres:18.7` is a multi-arch index (amd64, arm64 and others) with index digest `sha256:eece53c7c4410fb9c6556a19b8e0f2d61708a5893e2aa0a1e3c716661374ab18`; the arm64 platform manifest is `sha256:a86f3436...` | registry manifest read on 2026-11-24 | The pin carries tag and index digest |
| **Verified.** A dump and restore is not required for 18.x | 18.7 release notes, "Migration to Version 18.7" | In-place roll |
| **Verified.** The instance holds one database, `blockscout_db` (74 tables, about 20 MB, data checksums on); the BENS service in this sandbox keeps no tables of its own | `pg_database`, `pg_tables` | One dump covers the data |
| **Verified.** The schema has 452 btree, 6 GIN and 2 GiST indexes. No btree index sits on a `bpchar` column, and no index uses a `pg_trgm` operator class (the GIN full-text indexes use `tsvector_ops`; the GiST indexes are range-type exclusion constraints) | `pg_index`, `pg_opclass`, `pg_attribute` | The two release-note items that ask for a REINDEX of existing indexes (btree on `bpchar`, `gist_trgm_ops`) do not apply |
| **Verified.** The other REINDEX remarks in the notes are conditional ("if you suspect"): a VACUUM that needed several index passes, sibling-page deletion, `REINDEX CONCURRENTLY` interleavings | release notes | No action; the sandbox does not run these paths, and the database is small |
| **Verified.** Incremental backup files are not trusted by the notes; the sandbox takes no incremental backups | release notes, repository search | None |
| **Verified.** The new composite-type protection needs C extensions rebuilt; the installed extensions (`btree_gist`, `citext`, `pg_trgm`, `btree_gin`, `plpgsql`) ship with the image | `pg_extension` | None |
| **Verified.** The image has no CA store (no ca-certificates package; `/etc/ssl/certs` holds only the snake-oil certificate) | image read | The register row is unchanged in substance |
| **Verified.** The database collation version (2.41) matches the image's libc | `pg_database_collation_actual_version` | No collation warning expected, and none appeared |

## Rejected Alternatives

- **Dump and restore into a fresh volume.** Not required for a minor release, and it would add a
  second source of difference to the check.
- **Reindex everything as a precaution.** The release notes' reindex advice names index kinds the
  schema does not have; the rest is conditional.
- **Combine with other pins.** One revertable change per PR.

## Risks

- **Short outage.** The explorer API answers 500 or nothing from the moment the database stops until
  the backend reconnects. Verified by a one-second probe.
- **Rollback.** Reverting the pin and re-running the Blockscout start brings back 18.6 on the same
  volume (a minor-release downgrade needs no data change); the dump taken before the roll is the
  fallback.
