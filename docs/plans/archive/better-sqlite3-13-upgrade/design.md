# better-sqlite3 13 upgrade — Design

**Status:** Approved (2026-09-25)
**Created:** 2026-09-25
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-09-25/` (lockfile transplant and
classification), `services/nb-bond-api/DEVELOPMENT.md` §7.10 (data persistence).

## Decision Summary

Take 13.0.3 as Dependabot proposed, through the same scratch-resolve-and-transplant procedure as
the rollups, so the lockfile moves only where the upgrade requires it. Prove it in three layers:
the jest suite on the development machine (darwin binary), CI (linux-x64 glibc binary), and the
rebuilt API image on the local Kind cluster (linux binary for the host architecture), where a
resync from block 0 exercises every write path against real chain data. Capture the
system-of-record row counts before the image swap, because those tables cannot be rebuilt from
the chain.

## Current-State Evidence

### Repository Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `better-sqlite3` is an exact runtime pin in nb-bond-api and listed in the inventory at 12.11.1 | `services/nb-bond-api/package.json`, `THIRD_PARTY_LICENSES.md` | One manifest pin and one inventory row change |
| **Verified.** The API uses a small surface: the constructor, `pragma('user_version')`, `pragma('journal_mode = WAL')`, `transaction()`, prepared statements, and `close()` | `src/ingestion-db.ts`, `src/ingestion.ts`, `src/projection/snapshots.ts`, `src/admin.ts` | None of it is changed by the v13 release notes |
| **Verified.** The import is typed by an ambient `declare module 'better-sqlite3'` and the code narrows the handle to its own `IngestionDatabase` interface | `src/types/better-sqlite3.d.ts`, `src/admin.ts` | `@types/better-sqlite3` need not move |
| **Verified.** Five jest files open real SQLite databases | `tests/app.test.ts`, `chain-identity`, `compose-auction-failure`, `ingestion-idempotency`, `compose-coupon` | The suite exercises the native binding, including the cross-realm object binding fixed in 13.0.1 |
| **Verified.** 13.0.3 declares no install script, but it ships a `binding.gyp`, and `npm ci` still runs node-gyp on it. The gyp file compiles only when `lib/binding.js` finds no `prebuilds/<platform>-<arch>.node` for the host (musl detected through `process.report`) or when `force_build=1`; otherwise the build is a no-op | npm tarball; `npm ci` on the development machine left only stamp files under `build/Release` and the process loaded `prebuilds/darwin-arm64.node` | A compile fallback still exists. The builder stage needs Python and `make` for the node-gyp configure step, as it did for 12.x's fallback. The `node:26.5.0` image (Debian 13) has Python 3.13.5, GNU Make 4.4.1 and g++ 14.2, and glibc 2.41 is newer than the Ubuntu 22.04 build host of the linux binaries; Phase 2 proves the image build end to end |
| **Verified.** Prebuilt binaries ship for darwin, linux (glibc), linuxmusl and win32, each x64 and arm64; the linux binaries are built on Ubuntu 22.04 | npm tarball, 13.0.3 release notes | The Debian-based `node:26.5.0` image is covered on both architectures |
| **Verified.** 13.0.3 depends only on `node-addon-api ^8.0.0` (MIT) and needs Node ≥22 | registry metadata | The runtime is 26.5.0; `node-addon-api` is headers only, but it is a production dependency, so `npm prune --omit=dev` keeps it in the image |
| **Verified.** The bundled SQLite moves 3.53.2 → 3.53.4 | installed 12.11.1, `deps/sqlite3/sqlite3.h` in 13.0.3 | Patch release; the on-disk format is unchanged, so an existing PVC database opens as is and a rollback can reopen it |
| **Verified.** The image builder runs `npm ci` and then `npm prune --omit=dev`, and copies `node_modules` into the runtime stage | `services/nb-bond-api/Dockerfile` | The prebuilt binaries arrive with the package; no network download from GitHub at build time any more |
| **Verified.** The image content hash includes the root `package-lock.json` | `common/helpers.sh` | `./sandbox.sh start` rebuilds and redeploys the API image after the change |
| **Verified.** `POST /v1/admin/restart-ingestion?fromBlock=0` drops only the projection tables and restarts ingestion | `src/app.ts`, `src/admin.ts` | The live resync leaves `bidders`, `banks`, `operation_attempts` in place |
| **Verified.** #286's own lockfile diff: `better-sqlite3` changed, `node-addon-api` added, 28 entries removed (`prebuild-install`, `bindings` and their subtree), but it writes `^13.0.3` into the workspace entry | #286 diff | Transplant the same set, with the workspace range exact |
| **Verified.** The removed packages are permissive and none is named in `docs/THIRD_PARTY_NOTES.md` | npm metadata, notes file | No notes change |

### Runtime Evidence

- **Verified (2026-09-25, read-only):** the `cluster-cbdc-monoledger` node container and the
  `kind-registry` container are stopped, and the current `kubectl` context points at a different
  cluster. The sandbox scripts pass `--context=kind-cluster-cbdc-monoledger` explicitly, so
  manual `kubectl` commands in this plan must do the same.
- **Needs verification:** that the rebuilt image loads the linux binary, and that a full
  resync completes. Both happen in Phase 2.

## Invariants

- System-of-record tables (`bidders`, `banks`, `operation_attempts`) keep every row across the
  image swap and the resync.
- The projection rebuilt from block 0 matches what the API served before the upgrade.
- No lockfile movement beyond the `better-sqlite3` subtree.
- Every manual `kubectl` command names `--context=kind-cluster-cbdc-monoledger`; none relies on
  the current context.

## Target State

- `better-sqlite3 13.0.3` pinned in nb-bond-api; `node-addon-api` 8.x in the lockfile as its
  only dependency; the `prebuild-install` subtree gone.
- Inventory row `better-sqlite3 | 13.0.3 | MIT`.
- No source change expected. If one is needed, it is limited to the database module and listed
  in the PR.

## Alternatives Considered

- **Merge #286 after pushing an inventory commit to it.** The bot branch writes a caret range
  into the lockfile, and a human commit stops Dependabot from rebasing it. The transplant keeps
  the repo's exact-pin convention.
- **Stay on 12.x.** It still works, but it depends on the deprecated `prebuild-install` and a
  build-time download from GitHub, and each Node major needs a new binary. v13 removes both.
- **Remove the unused prebuilt binaries in the Dockerfile.** Saves about 15 MB in the image but
  adds a platform-specific step to maintain; not worth it for a sandbox image.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| `node-addon-api` as a new package | Approved | Given 2026-09-25 |
| Live check on the local sandbox | Required before the PR | Start the stack, or let the implementation start it (`./infra/infra.sh registry-start`, then `./sandbox.sh start`) |
| Release afterwards | None | Say if a tag is wanted |

## Residual Risks

- The image grows by roughly 15 MB (12 MB installed for 12.11.1, 27 MB for 13.0.3) because the
  package carries eight prebuilt binaries instead of one downloaded binary.
- A host whose platform has no prebuilt binary compiles SQLite from source during `npm ci`,
  which needs a C++20 toolchain. Every image and CI runner in use has a prebuilt binary.
- A non-local deployment built from the same Dockerfile gets the same binary as the local image
  for its architecture, so it needs no extra step; this plan does not verify it.
