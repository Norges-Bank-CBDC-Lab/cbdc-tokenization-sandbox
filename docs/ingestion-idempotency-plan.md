# nb-bond-api ingestion idempotency — Phase 0 plan

Status: draft, awaiting operator review. Not yet executed.
Created: 2026-05-21.

## Goal

Make the three event tables in the nb-bond-api ingestion SQLite DB —
`auction_events`, `balance_events`, `bond_events` — **idempotent under
repeated processing of the same block range**. After this change,
calling `processBlockRange(from, to)` twice with the same arguments
produces the same final DB state as calling it once, for all event
tables.

This is a standalone hygiene fix. It does not introduce WebSocket
event subscription, a watchdog, or any other Phase 1 work. The plan
intentionally leaves the polling-only ingestion architecture
untouched and the API surface unchanged. It is the precondition that
unblocks any later refactor (WS push, watchdog catch-up, restart
recovery, persistent-DB migration) without re-opening the dedup
question.

## Non-goals

- WebSocket / `eth_subscribe` event subscription.
- Watchdog / catch-up timer.
- Any change to mutation handlers, OpenAPI surface, DTOs, or UI.
- Any switch of storage technology (still SQLite via `better-sqlite3`).
- Backfilling the new `log_index` column with chain-derived values for
  historical rows. Sandbox DB is wiped per pod restart (emptyDir);
  Phase 0 treats the projection as fully rebuildable from chain on
  schema-version bump (see §"Migration strategy").

## Current-state evidence

Verified live in the running sandbox this session.

### Docs read

- `AGENTS.md` (root) — change-hygiene rules; "Avoid large refactors
  unless explicitly requested" applies — Phase 0 is deliberately
  narrow.
- `docs/KNOWN_ISSUES.md` — no current entry touches ingestion DB
  schema. One mention of "ingestion cache" at line 38 is unrelated
  (concerns reopen-auction).
- `docs/openapi-v2-plan.md` — provides the doc structure template
  this plan follows.
- `services/nb-bond-api/README.md` + `DEVELOPMENT.md` — confirm DB
  is operator-internal projection of chain state, used to back
  history + holders endpoints.

### Repo declarations inspected

- [`services/nb-bond-api/src/ingestion.ts`](../services/nb-bond-api/src/ingestion.ts)
  (lines 88–194): the three INSERT helpers
  (`upsertAuctionEvent`, `applyBalanceDelta`, `insertBondEvent`) use
  plain `INSERT INTO <table> ... VALUES ...` with no `ON CONFLICT`
  clause. Their callers (`processBlockRange`, lines 326–469) pass
  `Number(log.blockNumber)` and `log.transactionHash` but **do not**
  pass `log.index`.
- [`services/nb-bond-api/src/ingestion-db.ts`](../services/nb-bond-api/src/ingestion-db.ts)
  (lines 36–106): schema definitions. All three event tables use
  `id INTEGER PRIMARY KEY AUTOINCREMENT` as their only key, with
  composite read indexes `(isin, block, id)` and friends.
- Read functions in the same file (`getAuctionEventsByIsin`,
  `getAuctionEventsById`, `getBondEventsByIsin`) all use
  `ORDER BY block, id` for stable in-block ordering.
- [`services/nb-bond-api/src/compose.ts`](../services/nb-bond-api/src/compose.ts)
  — three consumers of event rows:
  - `composeAuction` (line 313): `getAuctionEventsById` → builds
    `Auction.txs.{close,finalise,cancel}` TxRefs. Relies on `block`
    ordering; tiebreaker rarely matters in practice (each auction
    has at most one event of each kind), but `id` is what's currently
    used.
  - `composeBond` (line 484): `getBondEventsByIsin` → checks
    `hasRedeemEvent` (existence-only check; ordering doesn't matter).
  - `composeBondHistory` (line 601): `getAuctionEventsByIsin` +
    `getBondEventsByIsin` → returns sorted by `block` desc. Per-row
    `id` is not surfaced; existing API consumers cannot observe it.
- [`services/nb-bond-api/tests/ingestion-db.test.ts`](../services/nb-bond-api/tests/ingestion-db.test.ts):
  4 tests, all covering read functions over manually-seeded rows. No
  test exercises the insert path or re-insertion behaviour today.
- [`services/nb-bond-api/tests/ingestion.test.ts`](../services/nb-bond-api/tests/ingestion.test.ts):
  5 tests, all covering the pure-function `computeIngestionWindow`.
  No test exercises `processBlockRange`.
- `better-sqlite3` pinned at `12.10.0` (root `package.json` +
  `services/nb-bond-api/package.json`). Modern enough for
  `ALTER TABLE ADD COLUMN`, `CREATE UNIQUE INDEX IF NOT EXISTS`,
  and `PRAGMA user_version`.
- Ethers v6 `Log` shape verified from
  `node_modules/ethers/lib.esm/providers/provider.d.ts`:
  `readonly index: number` (the log-index within the block) +
  `readonly transactionHash: string`. The pair `(transactionHash,
  index)` is the natural unique key for any log emitted on this
  chain.

### Live local checks

| What | Command | Result |
|---|---|---|
| nb-bond-api pod healthy | `kubectl -n nb-bond-api get pod -l app=nb-bond-api` | `Running`, 1 restart 17h ago |
| Ingestion DB exists | `kubectl -n nb-bond-api exec ... -- test -f /app/data/ingestion.sqlite` | exists |
| Event table counts | inspect script (read-only) | `auction_events=2`, `balance_events=0`, `bond_events=0` |
| Other table counts | same | `auctions=1`, `partitions=1`, `balances=0`, `ingestion_state=1` |
| Duplicate scan by `(tx_hash, type)` | same | `0` duplicate groups in both event tables |
| Ingestion checkpoint | same | `last_block=77` |

The live DB has no duplicates today, confirming that the existing
polling-only architecture works in practice. The migration in this
plan is therefore safe to run against the current sandbox data —
nothing to lose, and nothing to migrate over.

### Local validation entry points

- `npm test -w nb-bond-api` (jest, runs unit tests).
- `npm run build -w nb-bond-api` (tsc).
- `npm run lint -w nb-bond-api` (eslint).
- `npm run regen:openapi -w nb-bond-api` (regenerates OpenAPI JSON;
  no schema change in this plan but should remain clean).
- `./services/nb-bond-api/nb-bond-api.sh start` to rebuild the image
  and helm-upgrade the deployment for Phase 3 end-to-end.

### Blocked / unverified

None. All verification commands ran successfully against the running
sandbox.

## Scope

### In scope

- Schema bump for `auction_events`, `balance_events`, `bond_events`:
  add `log_index INTEGER NOT NULL DEFAULT 0`.
- `CREATE UNIQUE INDEX` per table on the natural dedup key (see
  §"Dedup keys").
- Switch the three event-table `INSERT` statements to `INSERT OR
  IGNORE`.
- Thread `log.index` from `processBlockRange` callers through the
  three insert helpers.
- Add a `PRAGMA user_version`-based one-shot migration that drops
  the **entire projection** (the three event tables plus `auctions`,
  `partitions`, `balances`, `ingestion_state`) when the on-disk
  schema is older than the new version. The polling loop replays
  from `START_BLOCK` and repopulates everything. Sandbox-correct;
  rebuildable-projection assumption holds. (We can't keep `balances`
  across the migration: `applyBalanceDelta` reads-then-writes
  balances, so replaying every event on top of stale rows would
  double-count. Full drop is the only consistent path.)
- New tests that lock down the dedup behaviour: insert the same
  event twice → exactly one row; insert different events with the
  same `(tx_hash, log_index, …)` discriminator → distinct rows.
- Doc update: a brief paragraph in
  `services/nb-bond-api/DEVELOPMENT.md` under §7
  ("Operational notes") explaining the migration trigger and
  rebuildability assumption.

### Out of scope

- Changes to public endpoints, OpenAPI schemas, or response DTOs.
- Any UI change.
- WebSocket subscription, watchdog timer, push-based ingestion.
- A proper persistent-DB migration strategy (e.g. for a future
  Postgres / Azure-DB backend). The Phase 0 migration is
  deliberately drop-and-rebuild — appropriate for emptyDir-backed
  sandbox, would need to be replaced before any persistent-DB
  promotion. Tracked in §"Portability flags".
- Adding indexes for query performance beyond what's required for
  the unique constraints.

## Folder and file placement

No new folders. All changes live in existing files:

| File | Change |
|---|---|
| `services/nb-bond-api/src/ingestion-db.ts` | Schema bump in `createTables` + migration block in `openDatabase` |
| `services/nb-bond-api/src/ingestion.ts` | INSERT statements → `INSERT OR IGNORE`; `log.index` threaded through; helpers updated |
| `services/nb-bond-api/tests/ingestion-db.test.ts` | New dedup tests (~4 cases) |
| `services/nb-bond-api/DEVELOPMENT.md` | One paragraph under §7 |
| `docs/ingestion-idempotency-plan.md` | This plan (created in this PR) |
| `docs/DOCUMENTATION_INDEX.md` | Register the plan doc |

## Decisions and open questions

| # | Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|---|
| D1 | Migration mechanism | (a) `PRAGMA user_version` + drop+rebuild on bump; (b) `ALTER TABLE ADD COLUMN log_index DEFAULT 0` + `CREATE UNIQUE INDEX` in-place (existing rows get `log_index=0`, can collide if same tx had multiple events); (c) drop event tables on every startup unconditionally | **(a)** — clean, signals schema generations explicitly, treats projection as rebuildable, no fragile backfill of `log_index` | Confirm before implementation |
| D2 | Dedup key for `balance_events` | (a) `(tx_hash, log_index, holder)` — supports the two-row-per-transfer pattern unchanged; (b) refactor to one row per transfer with `from_holder` + `to_holder` columns; (c) add a `direction` enum and dedup on `(tx_hash, log_index, direction)` | **(a)** — minimal change, preserves existing per-holder row pattern that `applyBalanceDelta` already produces | Confirm |
| D3 | Dedup key for `auction_events` / `bond_events` | (a) `(tx_hash, log_index)`; (b) `(tx_hash, log_index, type)` (defensive — allows one log to spawn multiple rows of different types in future) | **(a)** — current code emits one row per log; tighter constraint, clearer intent | Confirm |
| D4 | Keep AUTOINCREMENT `id` PK | (a) keep `id` PK; add `(tx_hash, log_index, ...)` as a separate UNIQUE INDEX; (b) drop `id` and make the dedup key the PRIMARY KEY | **(a)** — preserves the `ORDER BY block, id` semantics that `compose.ts` relies on; cheaper than auditing all consumers; matches the "track stable insertion order separately from natural identity" pattern | Confirm |
| D5 | Test coverage scope | (a) Add a small in-memory DB test that exercises insert-then-reinsert via the actual helper functions; (b) Only test the SQL constraint directly with raw INSERTs (no helper coverage) | **(a)** — also exercises the `log.index` threading, catches "forgot to pass it" regressions | Confirm |

## Portability flags

(Things this plan does that work fine for the sandbox but would need
attention before promoting nb-bond-api to a persistent-DB / shared
environment.)

- **Migration is drop-and-rebuild.** It assumes the projection can
  be rebuilt from chain history in seconds. True for sandbox
  (≤100 blocks, single-digit events); not true for a years-old
  production chain. Before promoting nb-bond-api to a persistent DB,
  replace the migration with an in-place `ALTER TABLE` + `log_index`
  backfill (or accept a one-time rebuild downtime window).
- **No bounded `log_index` semantics check.** The plan trusts ethers
  to give us a `number` for `log.index`. SQLite stores it as an
  INTEGER. No range issue at chain scales we care about, but if
  anyone moves to a larger-than-Int64 indexing scheme, this assumption
  needs revisiting.

## Acceptance criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Inserting the same chain log twice produces exactly one row | This is the entire point of the change | New tests under `tests/ingestion-db.test.ts` | green |
| Inserting two distinct logs with the same `tx_hash` but different `index` produces two rows | Confirms the dedup key is the **pair** `(tx_hash, log_index)`, not `tx_hash` alone | Same test file | green |
| `composeBondHistory` / `composeAuction` / `composeBond` produce identical output before vs after the change | No regression in the read-path API | New integration-shape test that seeds the same chain events both ways | green |
| `npm test`, `npm run lint`, `npm run build`, `npm run regen:openapi` all clean | Standard local validation | CI workflows `nb-bond-api.yml` | green |
| Existing live data in the sandbox migrates cleanly on first restart after the change | Schema bump must not brick anyone's local sandbox | After Phase 3 restart: `kubectl exec ... node /app/dbinspect.js` shows `auction_events` count > 0 again after ingestion catches up | row count restored within `POLL_INTERVAL_MS × 2` |
| `docs/DOCUMENTATION_INDEX.md` lists the new plan | Doc maintenance | grep | present |
| Public-repo hygiene checks pass | Repo posture | `python3 scripts/verification/check-public-repo-hygiene.py` + `check-markdown-links.py` | clean |
| Third-party license inventory unchanged | No new dependency | `python3 scripts/verification/check-third-party-licenses.py` | clean |

## Assumptions

- The live nb-bond-api pod's `data/` mount is an `emptyDir` per
  Helm values, so the drop+rebuild migration costs nothing on
  pod restart. Verified earlier this session.
- ethers v6's `log.index` is reliably populated by Besu via
  `eth_getLogs`. Not exhaustively verified in this session but
  documented in the ethers types and standard JSON-RPC behaviour.
- No external consumer (CLI, script, manual SQL user) reads the
  internal `id` column. Confirmed by `rg id services/` — all
  references are inside ingestion or schema, not at the API
  boundary.

## Plan order

```
Phase 0  Baseline verification
Phase 1  Source change + new tests           (Gate: D1–D5 resolved)
  1a  Schema bump in ingestion-db.ts
  1b  log_index threaded through ingestion.ts; INSERT OR IGNORE
  1c  Migration helper in openDatabase
  1d  New tests covering dedup + log_index plumbing
Phase 2  Local validation
  2a  npm test / lint / build clean
  2b  npm run regen:openapi clean (no API surface change)
  2c  Hygiene scripts pass
Phase 3  Local apply
  3a  ./services/nb-bond-api/nb-bond-api.sh start (rebuild + helm upgrade)
  3b  Pod becomes Ready
  3c  Ingestion catches up to head
Phase 4  Post-change verification
  4a  Live DB inspect shows new schema (PRAGMA user_version = N)
  4b  Live row counts re-populated after ingestion sync
  4c  composeBondHistory output matches pre-change snapshot
Phase 5  Documentation + index update
```

---

## Phase 0: Baseline verification

### Goal

Capture the current schema + a small sample of event data so any
regression in Phase 4 is detectable.

### Steps

- `kubectl -n nb-bond-api exec <pod> -- node /app/dbinspect.js >
  /tmp/baseline-row-counts.txt` (the inspect script from this
  session — keep a copy of it in the workspace).
- `curl -s http://bond-api.cbdc-sandbox.local/v1/bonds/NO0045632134/history
  > /tmp/baseline-history.json` (capture current history-endpoint
  output for one ISIN).
- `git status` clean.

### Verification stop

Snapshot files exist under `/tmp/`. No code changes yet.

### Exit criteria

Baseline captured. Operator confirms D1–D5 in §"Decisions".

## Phase 1: Source change + new tests

### Goal

Implement the schema bump, the `INSERT OR IGNORE` switch, the
`log.index` threading, and the migration helper. Lock down the dedup
behaviour with new tests.

### Steps

1a. **`services/nb-bond-api/src/ingestion-db.ts`**:
- Bump `SCHEMA_VERSION = 2` (new module constant).
- In `createTables`, add `log_index INTEGER NOT NULL DEFAULT 0` to
  the three event-table definitions.
- Add three `CREATE UNIQUE INDEX IF NOT EXISTS` statements per
  D2 / D3 / D4 choices:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_events_dedup
    ON auction_events(tx_hash, log_index);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_balance_events_dedup
    ON balance_events(tx_hash, log_index, holder);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_bond_events_dedup
    ON bond_events(tx_hash, log_index);
  ```
- In `openDatabase` (write mode only), read
  `PRAGMA user_version`. If less than `SCHEMA_VERSION`:
  ```sql
  DROP TABLE IF EXISTS ingestion_state;
  DROP TABLE IF EXISTS auctions;
  DROP TABLE IF EXISTS auction_events;
  DROP TABLE IF EXISTS partitions;
  DROP TABLE IF EXISTS balances;
  DROP TABLE IF EXISTS balance_events;
  DROP TABLE IF EXISTS bond_events;
  PRAGMA user_version = 2;
  ```
  Every DROP is `IF EXISTS` so this is uniformly safe on both fresh
  and old DBs. Then call `createTables` to recreate everything with
  the new schema. Log `info` that a migration ran and which version
  we're at. Note: we drop the full projection (not just the event
  tables) because `applyBalanceDelta` reads-then-writes `balances`,
  so replaying every event on top of stale balance rows would
  double-count.

1b. **`services/nb-bond-api/src/ingestion.ts`**:
- `upsertAuctionEvent` signature gains `logIndex: number`. Insert
  statement becomes `INSERT OR IGNORE INTO auction_events
  (auction_id, isin, type, block, log_index, tx_hash, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?)`.
- `applyBalanceDelta` signature gains `logIndex: number`.
  `balance_events` insert becomes `INSERT OR IGNORE INTO
  balance_events (isin, holder, delta, balance_after, block,
  log_index, tx_hash, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`.
- `insertBondEvent` signature gains `logIndex: number`. Insert
  becomes `INSERT OR IGNORE INTO bond_events (isin, type, block,
  log_index, tx_hash, payload) VALUES (?, ?, ?, ?, ?, ?)`.
- In `processBlockRange`:
  - Manager event handlers (`BondAuctionInitialised`,
    `BondAuctionClosed`, `BondAuctionFinalised`,
    `BondAuctionCancelled`, `CouponPaid`, `AllCouponsPaid`,
    `BondRedeemed`): pass `Number(log.index ?? 0)` as `logIndex`.
  - Token event handlers (`IsinMinted`, `IsinRedeemed`,
    `TransferByPartition`): pass `log.index` through the
    `TokenAction` types, then through `applyBalanceDelta` calls.
  - For the two-call-per-transfer pattern, both calls share the
    same `logIndex` (they distinguish via `holder`).

1d. **`services/nb-bond-api/tests/ingestion-db.test.ts`** —
add new `describe` block:
- "auction_events dedup":
  - Insert one event, expect 1 row.
  - Insert the same `(tx_hash, log_index)` again with different
    payload, expect 1 row (the original `payload`).
  - Insert a different `(tx_hash, log_index)` event, expect 2 rows
    total.
- "balance_events dedup":
  - Insert one delta for holder A, expect 1 row.
  - Insert same `(tx_hash, log_index, holder=A)` again, expect 1
    row.
  - Insert same `(tx_hash, log_index, holder=B)`, expect 2 rows.
- "bond_events dedup": mirror auction_events test.
- "migration drops + recreates on user_version bump": open a DB at
  version 0 with the old-shape tables seeded; open again with the
  new module; assert the tables are empty and `PRAGMA user_version`
  is 2.

### Verification stop

- `npm test -w nb-bond-api` — all new + existing tests green.
- `npm run build -w nb-bond-api` — tsc clean.
- `npm run lint -w nb-bond-api` — eslint clean.
- `git diff` reviewed; no incidental edits to compose.ts /
  schemas.ts / index.ts.

### Fix iteration / rollback

If a test fails because of a column-order mismatch or a forgotten
`log_index` in a handler, fix forward. If the migration drops tables
under a developer's local pod while they had unsaved state — note
the sandbox DB is emptyDir, so this is impossible in the normal
flow. For an ad-hoc local dev run pointed at a host file, advise the
operator to delete the file and let ingestion rebuild.

### Exit criteria

All tests green; no unintended file changes.

## Phase 2: Local validation gate

### Goal

Catch hygiene + cross-cutting regressions before the cluster apply.

### Steps

- `npm test -w nb-bond-api`.
- `npm run build -w nb-bond-api`.
- `npm run lint -w nb-bond-api`.
- `npm run regen:openapi -w nb-bond-api` — should produce no diff
  (no API surface change).
- `python3 scripts/verification/check-public-repo-hygiene.py`.
- `python3 scripts/verification/check-markdown-links.py`.
- `python3 scripts/verification/check-third-party-licenses.py` —
  no dependency change, must stay clean.
- `git diff services/nb-bond-api/openapi.json` — empty.

### Verification stop

All commands above exit 0; no diff in `openapi.json`.

### Fix iteration / rollback

Standard "fix the failing check". No rollback path needed at this
phase since nothing has been applied to the cluster.

### Exit criteria

Local gate clean.

## Phase 3: Local apply

### Goal

Apply the change to the running sandbox via the narrowest restart
that proves the migration runs end-to-end.

### Steps

- `./services/nb-bond-api/nb-bond-api.sh start` — rebuilds the
  image with a new content hash, pushes to `localhost:5001`, and
  `helm upgrade --install` the deployment.
- `kubectl -n nb-bond-api get pods -w` until the new pod is
  `Ready 1/1`.

### Verification stop

- `kubectl -n nb-bond-api logs <pod> | grep -i 'migration\|schema'`
  shows the migration banner (one-shot, current version reported).
- `kubectl get pods -A | grep -Ev '\sRunning|\sCompleted'` is empty.
- `kubectl -n nb-bond-api get events --sort-by=.lastTimestamp |
  tail -5` shows no warnings on the new ReplicaSet.

### Fix iteration / rollback

- Pod fails to start → `kubectl logs` reveals migration error. Most
  likely cause would be a syntax error in the migration block;
  fix-forward in Phase 1.
- If the new image is broken, `helm -n nb-bond-api rollback
  nb-bond-api <previous-rev>` restores the previous image. Loss of
  the new event data is bounded to the rebuild window.

### Exit criteria

New pod `Ready`, migration banner logged once, no warning events.

## Phase 4: Post-change verification

### Goal

Prove that (a) the new schema is live, (b) ingestion still works
end-to-end, and (c) the read endpoints produce equivalent output to
the baseline.

### Steps

- `kubectl -n nb-bond-api exec <pod> -- node /app/dbinspect.js` —
  expect row counts to recover to baseline within
  `POLL_INTERVAL_MS × 2` (one tick to query chain head, one tick to
  process the catch-up range).
- `kubectl -n nb-bond-api exec <pod> -- sqlite3
  /app/data/ingestion.sqlite "PRAGMA user_version;"` —
  alternative: `node -e ... db.pragma('user_version')` if sqlite3
  CLI isn't in the image.
  Expect `2`.
- `kubectl -n nb-bond-api exec <pod> -- sqlite3
  /app/data/ingestion.sqlite ".schema auction_events"` — confirm
  the new `log_index` column and unique index are present.
- `curl -s http://bond-api.cbdc-sandbox.local/v1/bonds/NO0045632134/history
  > /tmp/post-change-history.json && diff /tmp/baseline-history.json
  /tmp/post-change-history.json` — accept differences only in the
  `txHash`/`block` fields of any events that landed during the
  redeploy window; everything else must match.
- Manual smoke: open the UI at `http://web.cbdc-sandbox.local/`,
  navigate to the bond detail page, confirm history events render
  the same way.

### Verification stop

All above clean; no unexpected diffs.

### Fix iteration / rollback

If ingestion fails to repopulate, check pod logs; the most likely
cause is the migration block running but `createTables` not being
re-invoked. If verified broken, `helm rollback` per Phase 3.

### Exit criteria

Live DB schema matches the plan; read endpoints behave identically
to baseline.

## Phase 5: Documentation + public-repo hygiene

### Goal

Leave docs in a state that explains the new schema + migration
without exposing internals a public reader doesn't need.

### Steps

- **`services/nb-bond-api/DEVELOPMENT.md`** §7 (operational notes):
  add a short paragraph (~10 lines) noting that the ingestion DB
  schema is versioned via `PRAGMA user_version`, that the projection
  is rebuildable from chain, and that an out-of-date on-disk schema
  triggers a one-shot drop-and-rebuild on next startup. Flag the
  portability implication for non-emptyDir deploys.
- **`docs/DOCUMENTATION_INDEX.md`**: add an entry for this plan.
- Run `python3 scripts/verification/check-public-repo-hygiene.py`.
- Run `python3 scripts/verification/check-markdown-links.py`.

### Verification stop

- Both hygiene scripts pass.
- `git diff --stat` shows only the in-scope files.

### Fix iteration / rollback

If a link check fails, fix the link. If hygiene check flags a
secret or hostname, redact before commit.

### Exit criteria

Hygiene clean. Plan-doc referenced from the index.

---

## Documentation and PR plan

- **One PR** off `development`, branch
  `fix/ingestion-events-idempotency`.
- PR body lists:
  - The latent-bug context (no current duplicates; soundness gap
    on restart / push / catch-up).
  - The eight rules from `docs/openapi-v2-plan.md` are unaffected.
  - Baseline + post-change row counts as evidence.
  - Migration mechanism (PRAGMA user_version + rebuild) and the
    portability flag for persistent-DB future.
- Reviewer ask: confirm the chosen dedup keys (D2 + D3) before
  approval.

## Residual risks

- **`log.index` field on Besu logs.** If for some reason Besu /
  ethers fails to populate `log.index` on a particular log shape we
  haven't seen, the dedup key collapses to `(tx_hash, 0, ...)` for
  all such logs, and re-processing would silently drop duplicates
  of distinct events. Mitigation: log a warning when
  `log.index === undefined`. Probability low; ethers types declare
  the field non-optional.
- **Migration runs unexpectedly.** A developer with a hand-curated
  DB file would lose their state. Mitigation: documented as
  "projection is rebuildable from chain" in DEVELOPMENT.md;
  emptyDir-backed sandbox is not affected; no production deploy
  exists yet.
- **Future schema bumps.** The PRAGMA-user_version + drop-rebuild
  approach is a one-trick pony for sandbox use. The next schema
  change (e.g. when we add Postgres) will need a real migration
  pathway. Tracked in §"Portability flags".

## Done criteria

- All acceptance-criteria rows in §"Acceptance criteria" are
  green.
- PR merged into `development`.
- The plan-doc remains in `docs/` as a historical record of the
  schema bump and the migration semantics it introduced.
