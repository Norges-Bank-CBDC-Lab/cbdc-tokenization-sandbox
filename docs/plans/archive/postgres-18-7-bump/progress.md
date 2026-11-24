# PostgreSQL 18.7 bump — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 1 Evidence and safety net | Done (2026-11-24) | Release notes checked against the live schema; custom-format dump and fingerprint taken |
| 2 Pin sweep | Done (2026-11-24) | Two pin files, the Known Issues row and bullet, the index entry; the image-pin, image-hash, hygiene, link and licence checks pass |
| 3 Live roll | Done (2026-11-24) | In-place roll on the existing volume; every acceptance row has evidence below |
| 4 PR | In progress | Folder archived in the change commit; merge pending the operator's go-ahead |

## Deviations From Plan

- A restore of the dump into a scratch database was not attempted (it would add a database to the
  live instance); only the archive's table of contents was read back.

## Verified Claims

Image: `postgres:18.7` index digest `sha256:eece53c7c4410fb9c6556a19b8e0f2d61708a5893e2aa0a1e3c716661374ab18`
(the arm64 platform manifest is `sha256:a86f3436d25922261becd750696f3d8212ee14164b87793f408c85011cad3b5a`),
re-read from the registry before the pin edit. The image is Debian 13 with no CA store.

Release notes against the schema: 452 btree, 6 GIN and 2 GiST indexes; no btree index on a `bpchar`
column and no `pg_trgm` operator class, so neither reindex instruction applies. The remaining
reindex remarks are conditional on events the sandbox does not produce.

Before the roll: PostgreSQL 18.6, `blockscout_db` about 20 MB, 74 tables, data checksums on. A
custom-format dump (1,013,820 bytes, sha256 `d489c11a91912b66433da594b3de04a2e708dc98e12e305d5d090714a62a20c4`)
and a globals-only dump were written outside the repository. Fingerprint up to block 1931: 1,932
blocks, 374 transactions, 129 logs, 16 token transfers, 115 addresses, 18 smart contracts and 4
tokens, each with an md5 over its key columns. The explorer was at the chain head.

The roll (`registry-sync`, then `./services/blockscout/blockscout.sh start`, which recreates the
database pod): the pod was unreachable for about 5 seconds (a one-second probe saw it down from
10:58:38 to 10:58:43 UTC) and the explorer API answered 500 or nothing for about 59 seconds, until the
backend reconnected on its own; no explorer pod restarted.

After the roll:

- `SELECT version()` reports PostgreSQL 18.7 (Debian 18.7-1.pgdg13+5). The log shows "database system
  was shut down" then "ready to accept connections", with no recovery, warning, error, checksum, WAL
  or collation message. The collation version (2.41) equals the actual version, and the checksum
  failure counter is 0.
- The fingerprint is identical, table by table and checksum by checksum, both right after the roll
  and again after the restart and watch below. (The unbounded `block_rewards` count grew with new blocks.)
- The explorer is at the chain head. The verified `BondAuction` contract page still shows its source
  (15,620 characters). The BENS service reports `SERVING` and answers the name-resolution call with
  HTTP 200 (no names exist here). NB Bond API is `ok` with lag 0 and no failures; the NB UI answers 200.
- One restart of the database pod: down for about 1 to 2 seconds and the explorer back within about
  1 second, a clean shutdown and start. The log gained eight "cancel request did not match any process"
  lines at `LOG` level, which are the explorer's connections reconnecting with their old process IDs.
- Ten-minute watch (11:01 to 11:12 UTC) with 13 zero-fee transactions (none failed): 11 status lines,
  one per minute. The explorer height equalled the chain head except once, one block behind; NB Bond
  API lag stayed 0; the database log stayed free of findings; no pod restarted.

## Follow-ups

- A restore of the dump into a scratch database and an amd64 run were not done.
- The weekly pin report lists `node:26.13.1` as moved; not investigated here.

## Session Handoff

Change committed on `feature/postgres-18-7`. The local stack already runs PostgreSQL 18.7. The
pre-roll dump stays on the operator's machine outside the repository. Next: PR against `development`,
merge on the operator's go-ahead.
