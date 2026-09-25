# better-sqlite3 13 upgrade — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-09-25
**Created:** 2026-09-25
**Scope:** `services/nb-bond-api/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, plus any database-module fix the upgrade proves necessary
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Manifest, lockfile transplant, override audit, inventory, package gate
Phase 2  Local sandbox: baseline, image swap, binary check, resync from block 0
Phase 3  PR, merge, close #286
```

Phase 2 depends on Phase 1's lockfile, because the image is built from it. One PR, one commit
(plus a fix-up only if CI disagrees with the local gate). The plan folder is archived in the
same PR.

## Phase 1: Manifest and lockfile

1. Record the baseline: `npm ci`; nb-bond-api jest count on the unchanged tree.
2. `git show HEAD:package-lock.json > <scratch>/lock.before.json`.
3. Pin `better-sqlite3` to `13.0.3` in `services/nb-bond-api/package.json`.
4. Scratch resolve (`npm install --package-lock-only --ignore-scripts --legacy-peer-deps`);
   structural diff; classify moved entries as the bumped package, its new dependency
   (`node-addon-api`), entries orphaned by the removal of `prebuild-install` and `bindings`
   (check that nothing else in the tree still needs each one), or incidental. Transplant the
   first three classes only; workspace range exact.
5. Override audit; `npm ci`; confirm `node_modules/better-sqlite3/prebuilds/` holds the
   expected binaries.
6. Inventory row; `check-third-party-licenses.py`, `check-node-version-consistency.py`.
7. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`.

Recovery: an orphan still referenced elsewhere stays in the lockfile and is recorded as kept. A
jest failure is diagnosed against the v13 release notes before any source change; a source fix
stays inside the database module.

Exit: classified diff and gate results recorded in `progress.md`; test count equals the baseline.

## Phase 2: Local sandbox check

All commands target `kind-cluster-cbdc-monoledger`; manual `kubectl` commands pass
`--context=kind-cluster-cbdc-monoledger` rather than relying on the current context.

1. Start the stack if it is down: `./infra/infra.sh registry-start`, then `./sandbox.sh start`
   **from the unchanged `development` tree**, so the running image is 12.11.1.
2. Baseline, read-only: `/v1/health` (chain head and ingestion cursor), the bond and auction
   lists, and the row counts of `bidders`, `banks` and `operation_attempts` read through
   `kubectl exec` with a read-only SQLite handle.
3. From the Phase 1 tree, `./sandbox.sh start` again. The content hash changes, so the API image
   is rebuilt and rolled out; the other services are unchanged.
4. Binary check: the pod starts; in the pod,
   `node -e "require('better-sqlite3'); console.log(require('better-sqlite3/package.json').version)"`
   prints 13.0.3; the pod logs show no load error.
5. Before the resync: the system-of-record counts match step 2, and `/v1/health` reports
   ingestion caught up.
6. `POST /v1/admin/restart-ingestion?fromBlock=0`; wait until the cursor reaches the head.
7. After the resync: the bond and auction lists match step 2, and the system-of-record counts
   still match.

Recovery: if the pod fails to load the binary or the resync diverges, redeploy the 12.11.1
image by running `./sandbox.sh start` from the unchanged tree. SQLite 3.53.2 reopens the file,
and the projection can be resynced again. Record the failure in `progress.md` and stop for an
operator decision.

Exit: steps 4–7 recorded in `progress.md` with the observed values.

## Phase 3: PR and cleanup

1. Archive this folder to `docs/plans/archive/` and update `docs/DOCUMENTATION_INDEX.md` in the
   same commit.
2. PR against `development`: `Upgrade better-sqlite3 to 13.0.3`, with the lockfile
   classification, the package gate, and the live evidence.
3. After merge: close #286 with a comment pointing at the PR if Dependabot has not closed it.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Incidental churn; orphan removed while still needed | structural diff with classification, `npm ci` |
| Inventory | Version drift | licence checker |
| Unit and integration | Binding behaviour: transactions, pragmas, parameter binding | nb-bond-api jest on darwin; CI jest on linux-x64 |
| Image | Missing or incompatible binary in the linux image | in-pod `require`, pod logs |
| Projection | Write-path behaviour on real chain data | resync from block 0 to head; reads equal to baseline |
| System of record | Loss of unrecoverable rows | row counts before and after |

## Done Criteria

- [x] `better-sqlite3` 13.0.3 landed; the lockfile moved only in its subtree; overrides intact.
- [x] Package gate and verification scripts pass; test count unchanged.
- [x] Rebuilt image loads the binary; resync from block 0 matches the baseline; system-of-record
      counts unchanged.
- [ ] #286 closed as superseded.
