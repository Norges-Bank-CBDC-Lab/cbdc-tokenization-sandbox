# better-sqlite3 13 upgrade — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-25 — Phases 1 and 2 done; PR opened with the plan archived in it
**Current phase:** Phase 3: PR, then close #286 after merge
**Next action:** After merge, close Dependabot PR #286 as superseded if the bot has not

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 1 — Manifest and lockfile | Done | Baseline on the unchanged tree: 249 jest tests. Lockfile: `better-sqlite3` 12.11.1 → 13.0.3; `node-addon-api` 8.9.2 added (MIT); 29 entries removed (`prebuild-install`, `bindings`, and the 27 entries only they required, including the nested `node-abi/node_modules/semver` and `rc/node_modules/strip-json-comments`; the root `semver` and `strip-json-comments` stay); `detect-libc` marked dev-only because its remaining dependent is `lightningcss`; workspace range exact. The result is identical to #286's own changes for these entries. Excluded as incidental: eight removals caused by legacy peer resolution, as in the previous rollups. Scalar overrides at their pins, five nested `brace-expansion` copies unchanged. `npm ci` installs 833 packages (861 before); the process loads `prebuilds/darwin-arm64.node` with SQLite 3.53.4. Inventory row updated; licence and Node-version checks pass. nb-bond-api lint, prettier, 249 jest tests, and build pass; nb-ui prettier, lint, 125 vitest tests, and build pass (the root lockfile also triggers its workflow). No source change (2026-09-25) | this PR |
| 2 — Local sandbox check | Done | Baseline from the running pod on `better-sqlite3` 12.11.1 / SQLite 3.53.2: head 340, lag 0; schema `user_version` 6, WAL; system of record `bidders` 3, `banks` 0, `operation_attempts` 23; projection 3 auctions, 2 bonds, 5 bids, 5 allocations. `./services/nb-bond-api/nb-bond-api.sh start` built and rolled out `nb-bond-api:494a5a819351`; the builder's `npm ci` took 13 s with no source compile. In the new pod, `better-sqlite3` 13.0.3 loads `prebuilds/linux-arm64.node` (SQLite 3.53.4, Node 26.5.0, arm64); no `.node` file outside `prebuilds/`, `prebuild-install` absent, `node-addon-api` present, no load errors in the pod log. After the swap, every table count and the `/v1/bonds`, `/v1/auctions`, `/v1/bidders`, `/v1/banking/banks`, `/v1/operations` and `/v1/central-bank` responses are byte-identical to the baseline. `POST /v1/admin/restart-ingestion?fromBlock=0` returned 200 and the log shows ingestion restarting at block 0; it caught up to head 341 with no failures, and every table count and response is again byte-identical to the baseline, including the system-of-record counts (2026-09-25) | this PR |
| 3 — PR and cleanup | In progress | Plan folder archived in the PR itself; #286 closed after merge | this PR |

## Deviations From the Plan

- The design first stated that 13.0.3 has no compile fallback. `npm ci` showed that npm still
  runs node-gyp on the shipped `binding.gyp`, which compiles only when no prebuilt binary matches
  the host. `design.md` is corrected, and the builder image's toolchain is recorded there.
- The nb-ui gate was added to Phase 1 because the root lockfile triggers its workflow.
- Archived in the same PR as the change instead of a separate document-move PR.
- Local checks run on Node 25.8.0 (CI uses the pinned 26.5.0).
- Phase 2 step 1 was skipped: the stack was already running a 12.11.1 image, which is the state
  the step exists to produce. That image predates #283, so the swap also brought in the #283,
  #284 and #291 changes; the API responses stayed identical regardless.
- Phase 2 step 3 used `./services/nb-bond-api/nb-bond-api.sh start` instead of
  `./sandbox.sh start`, so only the API image was rebuilt and redeployed.
- The live SSE route `/v1/events` was left out of the snapshots because it never completes.

## Verified So Far

- The v13 release notes, the 13.0.3 tarball layout (no declared install script but a `binding.gyp` that compiles only without a matching prebuilt binary, eight prebuilt binaries,
  loader in `lib/binding.js`), the SQLite versions, the API's use of `better-sqlite3`, the
  Dockerfile flow, the image hash inputs, the resync route, and #286's lockfile diff, all
  verified on 2026-09-25 (see `design.md`).
- `node-addon-api` approved by the operator on 2026-09-25.

## Follow-ups Found Along the Way

None yet.
