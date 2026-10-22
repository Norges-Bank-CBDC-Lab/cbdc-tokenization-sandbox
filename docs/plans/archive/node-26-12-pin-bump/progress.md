# Node 26.12 toolchain pin bump — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| 0 Image availability gate | Done (2026-10-21, 14:45 UTC) | `node:26.12.1` and `-slim` list amd64 and arm64. At 13:45 UTC they listed none yet, so Phases 1–3 went ahead first: they need only the Node binary |
| 1 Cache-key fix | Landed separately (#308) | Implemented here first, then carved into #308 by the image pin refresh plan (its decision D1), which also covers the Python base. On rebase this branch took `development`'s `helpers.sh` and hash check unchanged |
| 2 Pin bump | Done (2026-10-21) | Env file, `@types/node` in three workspaces, lockfile (4 entries), inventory (3 rows), and docs |
| 3 Gates | Done (2026-10-21) | All green on Node 26.12.1; counts equal the baseline |
| 4 Live check | Done (2026-10-21) | Both images rebuilt under new hashes from `node:26.12.1` (no cache skip); API pod reports `v26.12.1`, `better-sqlite3` loads, UI runs nginx 1.30.6; read endpoints return the same counts as before the redeploy |
| 5 PR and cleanup | In progress | Folder archived in the change commit; push, PR, and merge pending operator go-ahead |

## Deviations From Plan

- The cache-key fix and its check cases shipped in #308, ahead of this PR, and nginx moved to
  1.30.6 in #309. This branch was rebased onto both. `common/helpers.sh`,
  `scripts/verification/check-image-hash-inputs.sh`, and `scripts/verification/README.md` are now
  identical to `development`. The hash-input lists in `services/nb-bond-api/README.md` and
  `services/nb-ui/DEVELOPMENT.md` were not part of #308 and stay in this PR.
- Phases 1–3 ran before the image gate cleared. The gate exists for the image builds, and those
  phases need only the Node binary. Phase 4 still waits for it.
- Three more docs list the exact hash inputs and were updated: `scripts/verification/README.md`,
  `services/nb-bond-api/README.md`, `services/nb-ui/DEVELOPMENT.md`. `docs/ARCHITECTURE.md`
  and `services/nb-ui/README.md` only say "build inputs" and stay as they are.
- (Superseded by #308, which also checks the nginx and Python bases through a throwaway copy of
  `common/images.yaml`.)

## Verified Claims

- Baseline on Node 26.5.0: nb-bond-api 39 suites / 293 tests; nb-ui 27 files / 139 tests; both
  CLI workspaces typecheck clean. On Node 26.12.1 after the change: identical.
- Bundle hashes (bash) moved from `f64c8aa2501f` to `6fe746c23eb9` (nb-bond-api) and from
  `bfc3f1ea6187` to `5ee7fca2e9e3` (nb-ui) with the cache-key fix alone. That is expected,
  because the input set grew.
- Removing the base-ref line from `nbBondApiBundleHash` makes the new
  `assert_base_image_sensitivity` case fail.
- Lockfile structural diff: `node_modules/@types/node` 26.5.1 → 26.6.5 plus the three workspace
  ranges, nothing else. The nine `--legacy-peer-deps` removals were not transplanted.
- `npm ci` on Node 26.12.1 succeeds with no engine warnings; `npm audit` reports 0. The
  Node-version, image-hash, licence, hygiene, and link checks pass.

- Live check (2026-10-21, after rebase onto #308 and #309): `nb-bond-api.sh start` and
  `nb-ui.sh start` built `nb-bond-api:a7b0d94ae1c2` and `nb-ui:ffb975201316` from
  `node:26.12.1`. The API pod reports `v26.12.1`, and `better-sqlite3` opens a database
  (SQLite 3.53.4). `/v1/bonds` 3, `/v1/bidders` 3, `/v1/banking/banks` 3, and
  `/v1/operations` 103 all match the pre-redeploy snapshot (the API data sits on a persistent
  volume). The UI answers 200, and the API logged no errors in the first five minutes.

## Follow-ups

- Node 26 LTS (2026-10-28): take the first LTS-tagged release in a later bump.
- `packageManager` `npm@11.14.1` differs from the npm bundled with the pinned Node.

## Session Handoff

All phases done locally; the folder is archived in the change commit. Remaining: push, open the PR
against `development`, confirm CI on 26.12.1, merge on the operator's go-ahead.
