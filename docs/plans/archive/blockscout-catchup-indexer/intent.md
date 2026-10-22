# Blockscout catch-up indexer — Intent

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Requested by:** sandbox operator

## Outcome

Blockscout indexes every block of the local chain, whatever happened while it was not running.
Blocks mined while Blockscout was stopped, broken, or freshly deleted are filled in after it
starts again, the genesis block included, and the explorer reports indexing as finished.

## Why This Change

The local Blockscout runs with `DISABLE_CATCHUP_INDEXER: "true"`, so it only indexes blocks as
they arrive. On 2026-09-25 that left blocks 106–344 permanently missing after a ten-day
PostgreSQL outage, and the only way to a complete explorer was a full sandbox reset. The same
gap follows any `./services/blockscout/blockscout.sh stop` while Besu keeps producing blocks
(an empty block every five minutes), and `./services/blockscout/blockscout.sh delete` followed by
`start` indexes nothing from before the new start. Even a healthy sandbox never indexes block 0,
so Blockscout reports `finished_indexing: false` permanently.

No record says why catch-up was disabled. The setting dates from the initial release, next to
trace-timeout tuning that the 2026-01-22 post-mortem later traced to an unrelated flag.

## Scope

### In Scope

- `services/blockscout/values.backend.env.yaml`: enable the catch-up indexer, with a comment on
  why it is on.
- Live proof on the local sandbox: block 0 indexed, a gap created by a component stop filled, and
  a full re-index after `blockscout.sh delete`.
- Documentation that currently describes the gap: the `docs/KNOWN_ISSUES.md` entry,
  `services/DEVELOPMENT.md` (Blockscout stop and delete), and the fallback paragraph in
  `services/blockscout/debugging.md`.

### Out of Scope

- The other indexer settings (internal-transaction and pending-transaction fetchers stay
  disabled; batch and concurrency values stay as they are unless Phase 2 shows catch-up is too
  slow to be useful).
- Besu configuration.
- Any non-local deployment; the values file is local-only by its own header.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| After the change, Blockscout indexes block 0 and reports `finished_indexing_blocks: true` | The genesis gap | indexing-status endpoint, `blocks` table |
| Blocks mined during a `blockscout.sh stop` are indexed after `start` | Component-stop gap | block numbers before, during, and after |
| After `blockscout.sh delete` and `start`, the whole chain is indexed again and `verify-latest` restores verifications | Explorer-only reset leaves history out | block count against chain head, verified-contract count |
| No new errors in the Blockscout backend or Besu logs during catch-up; the realtime indexer keeps up with the head | Load or RPC regressions | logs, head lag |
| Docs no longer describe the gap as current behaviour | Stale guidance | doc diffs |

## Constraints

- No new dependency; one values change.
- Public-repo rules.

## Open Questions

None blocking.
