# better-sqlite3 13 upgrade — Intent

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Requested by:** sandbox operator

## Outcome

The NB Bond API runs on `better-sqlite3` 13.0.3, the version Dependabot proposed in #286, with
the licence inventory updated and the upgrade proven on the local sandbox: the rebuilt API
image loads the new native binary, the projection rebuilds from block 0, and the
system-of-record tables survive the restart. #286 is closed as superseded.

## Why This Change

`better-sqlite3` is the API's only native dependency and holds both the chain projection and
the system-of-record tables (`bidders`, `banks`, `operation_attempts`). Version 13 is a major
release:

- The addon moves to Node-API (`node-addon-api`), so one binary works across Node versions.
- `prebuild-install`, which downloaded a binary from GitHub during `npm ci`, is gone. Prebuilt
  binaries for eight platforms now ship inside the npm package itself.
- The bundled SQLite moves from 3.53.2 to 3.53.4.
- New APIs (`db.explain()`, `statement.toString()`); 13.0.1 fixes a regression that rejected
  plain objects created in another realm, such as inside Jest.

#286 fails only `validate-inventory`; its lint, format and test checks pass. It was held out of
the #291 rollup because it adds a package and changes how the binary reaches the image.

## Scope

### In Scope

- `services/nb-bond-api/package.json`: `better-sqlite3` `12.11.1 → 13.0.3`, exact pin.
- `package-lock.json`: the `better-sqlite3` entry, the new `node-addon-api` entry, removal of
  `prebuild-install`, `bindings` and the packages only they required, and the workspace range
  written exact.
- `THIRD_PARTY_LICENSES.md`: the `better-sqlite3` row.
- A local sandbox check of the rebuilt `nb-bond-api` image and a projection resync.
- Closing #286 after merge.

### Out of Scope

- `@types/better-sqlite3` (7.6.13): the API's own ambient module declaration types the import,
  and none of the new v13 APIs are used.
- Using the new `explain()` or `toString()` APIs.
- Trimming the prebuilt binaries the image does not use; see the residual risks in
  `design.md`.
- Release or tag: not required by this change.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Lockfile diff is exactly: `better-sqlite3` changed, `node-addon-api` added, the `prebuild-install` subtree removed, workspace range exact; nothing else | Incidental churn | structural diff with every entry classified |
| Root overrides still resolve at their pins | Un-applied overrides | override audit |
| nb-bond-api lint, format, jest suite and build pass with the same test count | API behaviour change | package gate |
| The rebuilt image starts on the local cluster and its Node process loads `prebuilds/linux-<arch>.node` | Missing or incompatible binary, or an unexpected source compile in the builder | pod logs, in-pod `require` check, `/v1/health` |
| `POST /v1/admin/restart-ingestion?fromBlock=0` rebuilds the projection to the chain head | Behaviour change in transactions, WAL or pragmas on real data | health cursor at head, bond and auction reads match pre-upgrade |
| `bidders`, `banks` and `operation_attempts` row counts are unchanged across the image swap and the resync | Loss of unrecoverable system-of-record data | counts before and after |
| Licence and Node-version checks pass; `node-addon-api` is MIT | Inventory drift, licence surprise | script output, registry metadata |

## Constraints

- One new package, `node-addon-api`, approved by the operator on 2026-09-25. No other additions.
- The local sandbox cluster is `cluster-cbdc-monoledger`; every live command targets that
  context explicitly.
- One PR against `development`; public-repo rules.

## Open Questions

None blocking.
