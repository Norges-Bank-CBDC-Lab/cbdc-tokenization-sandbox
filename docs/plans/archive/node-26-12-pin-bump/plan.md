# Node 26.12 toolchain pin bump — Implementation Plan

**Status:** Implemented — shipped in the same PR as the change; archived 2026-10-21
**Created:** 2026-10-21
**Scope:** `common/node-version.env`, three workspace `package.json` files, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `infra/DEVELOPMENT.md`, the hash-input docs (`scripts/verification/README.md`, `services/nb-bond-api/README.md`, `services/nb-ui/DEVELOPMENT.md`), `docs/plans/nb-bond-api-hardening/` (instruction lines and progress note), `docs/DOCUMENTATION_INDEX.md`, this plan folder
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Gate: node:26.12.1 published for amd64 and arm64
Phase 1  Cache-key fix and its check case (correctness first, on the old pin)
Phase 2  Pin bump: env file, @types/node, lockfile, inventory, docs
Phase 3  Gates locally on Node 26.12.1, then CI
Phase 4  Live check: rebuild local images, version and read checks
Phase 5  Archive the plan folder, PR, merge on go-ahead
```

One PR against `development`, from a worktree off `origin/development`. The plan folder is
archived in the same PR.

## Phase 0: Image availability gate

1. Query the registry manifest index for `node:26.12.1` and `node:26.12.1-slim`. Both must list
   `linux/amd64` and `linux/arm64`.
2. Install Node 26.12.1 locally with nvm, so the local gates match CI.

Exit: both architectures listed. If they are missing, stop and re-check later; nothing else
starts first.

## Phase 1: Cache-key fix

Landed separately as #308 (with the Python base for `bens-microservice` added), so this PR no
longer carries it; see `progress.md`.


1. Before editing, record `nbBondApiBundleHash` and `nbUIBundleHash` on the unchanged tree.
2. Add the base image refs to both functions' hash inputs (`printf` lines in the existing
   `{ ...; } | shasum` group), with a comment explaining why.
3. Add a sensitivity case to `check-image-hash-inputs.sh`: override the base image variable in a
   subshell and assert the hash changes, then assert it is back to baseline afterwards. Keep the
   file's pure, offline contract.
4. Run `bash scripts/verification/check-image-hash-inputs.sh`.

Exit: all existing cases pass and the new case passes. Both hashes differ from step 1, expected,
because the input set grew; record that in `progress.md`.

Recovery: if a deploy path computes the hash before the base vars are set, move the hash call
after them rather than defaulting the vars.

## Phase 2: Pin bump

1. `common/node-version.env`: the three values from the design.
2. `@types/node` 26.6.5 in nb-bond-api, bid-encryption, and bid-submitter. Lockfile via scratch
   resolve and classified transplant: the `@types/node` entry plus the three workspace ranges,
   nothing else.
3. Three inventory rows.
4. `infra/DEVELOPMENT.md:57` example. In `docs/plans/nb-bond-api-hardening/`: `plan.md:64,378` and
   `design.md:342`, plus a dated deviation line in its `progress.md`.

Exit: `check-node-version-consistency.py` and `check-third-party-licenses.py` pass, and the
lockfile diff is exactly four entries.

## Phase 3: Gates

1. On Node 26.12.1: `npx -y npm@11.14.1 ci`, `npm audit`.
2. nb-bond-api: lint, `format:check`, test, build. nb-ui: `format:check`, lint, test, build.
3. `npx tsc --noEmit` (or each package's typecheck script) in `scripts/bid-encryption` and
   `scripts/bid-submitter`.
4. Node-version, image-hash, licence, hygiene, and link checks.

Exit: all green; test counts equal the baseline (293 jest, 139 vitest) or the difference is
explained.

## Phase 4: Live check (read-only apart from the image rebuild)

1. With the operator's go-ahead, `./sandbox.sh start` from the main checkout on the branch's
   files, the same approach as earlier dependency checks.
2. Confirm the deploy logs show both images rebuilt (no "already in local registry" skip for the
   new hashes).
3. `kubectl exec` into the nb-bond-api pod: `node --version` = v26.12.1.
4. Curl one read endpoint on `http://bond-api.cbdc-sandbox.local/`, which exercises
   `better-sqlite3`. Load `http://web.cbdc-sandbox.local/` once.
5. Restore the main checkout (`git restore`).

Exit: the version matches and the reads answer.

Recovery: if the API fails to start on 26.12.1, capture the pod log, revert the env-file pin in
the branch, and report. Phase 1 stays valid on its own.

## Phase 5: PR and cleanup

1. Archive this folder to `docs/plans/archive/`, set `Status:`, and add the index entry.
2. Run the cloud-wording and vendor-name greps; PR against `development` with the evidence.
3. Merge on the operator's go-ahead; delete the worktree and branch.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Pins | Drift across env, manifests, lockfile, workflows | node-version checker |
| Image cache | Base bump not rebuilding images | new hash-sensitivity case; live rebuild log |
| Types | `@types/node` 26.6 declaration changes | nb-bond-api `tsc`, CLI typechecks |
| Runtime | Node 26.6–26.12 behaviour changes | jest, vitest, nb-ui build on 26.12.1; CI on 26.12.1 |
| Native module | `better-sqlite3` binding on the new runtime | live API read |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] Images published; pins at 26.12.1 / 26.6.5; all checks pass.
- [x] Cache keys include the base refs; the new case passes (via #308).
- [ ] CI green on 26.12.1; local images rebuilt and verified (local part done).
- [ ] PR merged on go-ahead; worktree cleaned up.
