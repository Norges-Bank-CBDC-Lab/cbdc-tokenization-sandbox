# PostgreSQL 18.7 bump — Intent

**Status:** Approved (2026-11-24)
**Created:** 2026-11-24
**Requested by:** sandbox operator

## Outcome

The explorer database (shared by Blockscout and the BENS service) runs PostgreSQL 18.7, rolled in
place on the existing database volume with no wipe and no re-index. Every pin and document that names
the version agrees, and the local stack is shown healthy on the new version before the change merges.

## Why This Change

PostgreSQL 18.7 (released 2026-11-12) is the current patch release; the repo pins 18.6. It carries a
long list of security and corruption fixes, among them use-after-free, buffer-overrun and
privilege-check fixes in server code. A dump and restore is not required for 18.x. The release notes
ask operators to reindex a few kinds of indexes; this plan checks the sandbox schema against each of
them (see the design).

## Scope

### In Scope

- The image pin in `common/images.yaml` and the chart value `dbImage` in
  `services/blockscout/values.yaml`.
- The PostgreSQL row of the certificate-authority register and the "patch releases not yet taken"
  bullet in `docs/KNOWN_ISSUES.md`.
- A live in-place roll and verification on the local database.

### Out of Scope

- Any change to database configuration, schema, extensions or the volume.
- Reindexing: no index the release notes name exists in this schema (see the design).
- Other pins that the weekly pin report lists.
- Any non-local rollout.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| `SELECT version()` reports 18.7 and the log has no warning, error, checksum, WAL or collation message | The new binaries fail on the old data directory | `psql`, the pod log |
| Row counts and checksums of the key Blockscout tables, up to a fixed block, are identical before and after | Data loss or change | fingerprint script output |
| Blockscout follows the chain head again; a verified contract page still shows its source | Explorer regression | explorer API |
| The BENS service answers; NB Bond API is unaffected | Consumer regression | API calls |
| One restart of the database pod comes back clean, and a 10-minute watch with transactions stays healthy | Restart and drift regression | logs, probes, status lines |
| The image-pin, image-hash, hygiene, link and licence checks pass | Pin drift | script output |
| The `docs/KNOWN_ISSUES.md` PostgreSQL row reflects a fresh read of the 18.7 image | Stale register | filesystem listing |

## Constraints

- No new dependency: same image repository, new tag, PostgreSQL License.
- No volume wipe and no re-index. If either becomes necessary, stop and ask.
- A `pg_dump` is taken before the roll and kept outside the repository.
- One PR against `development`. Public-repo rules apply.
