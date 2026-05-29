# Local Image Build & Cleanup Lifecycle — Implementation Plan

**Status:** ✅ Shipped via [#128](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/128). Archived.
**Branch suggestion:** `feature/local-image-lifecycle` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `common/helpers.sh`, `infra/infra.sh`, `sandbox.sh`, `scripts/verification/`, `.github/workflows/`, `README.md`, `infra/README.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`

## Goal

Make the local image-build/registry lifecycle deterministic, offline-friendly, and maintainable. Today the build/check/push logic is copy-pasted three times, a missing base image triggers an internet pull even when the local registry already has it, `FORCE_IMAGE_PULL` bypasses the cache silently, and nothing ever reclaims accumulated content-hash tags. After this work: one shared helper builds all three repo-owned images, builds stay offline when the registry is warm, the force-pull flag is visible and documented, and the operator has explicit `image-report` / `cleanup-images` / `registry-reset` verbs plus a CI test that guards the hash-skip logic. No behavior visible to the deployed sandbox changes — the running pods get the same image refs as before.

## Current-State Evidence

- **Repo declarations inspected (this session):**
  - `common/helpers.sh`: `ensureLocalDockerImage` (1026-1033), `loadImageToKind` (876-923), `syncImagesToRegistry` (1043-1065), `kindRegistryImageFor` (455-459), `getLocalRegistryImage` (1035-1041), `ensureKindRegistry` (394-431), and the three duplicated build paths `prepareBensImage` (1161-1208), `deployNBBondAPI` (1432-1492), `deployNBUI` (1534-1589). The hash functions `nbUIBundleHash` (1516-1532), `nbBondApiBundleHash` (1415-1430), `bensImageHash` (1142-1155).
  - Skip-check (identical per service): `curl -fsS ${KIND_REGISTRY_ENDPOINT}/v2/<repo>/tags/list | jq -e --arg t "$hash" '.tags // [] | index($t)'` at 1185-1187 / 1462-1464 / 1561-1563.
  - Base images reach `docker build` as **upstream** `--build-arg` refs (node:25.9.0, nginxinc/nginx-unprivileged:1.27-alpine, python:3.14.5), not `localhost:5001` refs — by design.
  - Subcommand dispatch: `sandbox.sh` case at line 121; `infra/infra.sh` case at line 35. Existing registry verbs `registry-start` / `registry-sync` live in `infra.sh`, surfaced via `sandbox.sh`.
  - `README.md:176` already documents the manual reset (`docker rm -f kind-registry`); `KNOWN_ISSUES.md` already has a "`sandbox.sh build-images` is Blockscout-only today" entry with a related follow-up.
- **Live local checks (verified this session):**
  - `kind get clusters` → `cluster-cbdc-monoledger`; context `kind-cluster-cbdc-monoledger`.
  - `kind-registry` (registry:2.8.3) up; `GET /v2/_catalog` → `bens-microservice, ghcr.io/blockscout/{blockscout,frontend}, hyperledger/besu, nb-bond-api, nb-ui, nginxinc/nginx-unprivileged, node, postgres, python, quay.io/jupyter/base-notebook`.
  - Confirmed: registry started with **no volume** and **no `REGISTRY_STORAGE_DELETE_ENABLED`** (delete disabled by default); no `docker rmi` / `prune` / `garbage-collect` anywhere in the repo.
- **Local validation entry points:** `./services/nb-ui/nb-ui.sh start`, `./services/nb-bond-api/nb-bond-api.sh start`, `./services/blockscout/blockscout.sh start` (BENS), `./infra/infra.sh registry-sync`, `curl http://localhost:5001/v2/<repo>/tags/list`, `docker images`.
- **Blocked / unverified:** none — sandbox is running.

## Scope

### In Scope

- Extract one shared hashed-image build/check/push helper and route all three repo-owned services through it (behavior-preserving).
- Make `ensureLocalDockerImage` reuse the local registry copy before pulling upstream.
- Surface `FORCE_IMAGE_PULL=true` with a warning + document the flag.
- Add `image-report` (read-only), `cleanup-images` (scoped host prune, keep current + 2), and `registry-reset` (recreate + resync) subcommands.
- Add a CI-gated test that the content-hash skip logic is input-sensitive.
- Documentation: README command table + env-var note, `KNOWN_ISSUES.md` tag-semantics note, `ARCHITECTURE.md` image-lifecycle update, index registration.

### Out Of Scope

- **#5 (image labels)** — skipped: identity is already in the image ref, labels aren't queryable via the registry HTTP API the sandbox uses, and `LABEL` in a Dockerfile would bust the content hash.
- **#10 (stale pinned-image check)** — skipped: source-tree staleness is already enforced by `scripts/verification/check-node-version-consistency.py` + the Node Version Consistency workflow; runtime stale images are harmless orphaned disk handled by `cleanup-images`.
- **#12 (cold-rebuild / warm-up command)** — skipped: `registry-sync` already warms the bases; the only real gap (host-cache vs registry) is closed by Phase 2 (#1).
- Enabling registry DELETE + `registry garbage-collect` (fragile, needs read-only mode; `registry-reset` is strictly better for a disposable local registry).
- The separate `services/blockscout/build-images.sh` path (upstream Blockscout/frontend) — no content hash, different lifecycle.

## Decisions And Open Questions

| Decision | Options | Recommendation | Resolution |
|---|---|---|---|
| Cleanup/diagnostic surface | One `cleanup-images --flags` vs separate verbs | Separate verbs | **Resolved: separate verbs** (`image-report`, `cleanup-images`, `registry-reset`) in `infra.sh`, surfaced via `sandbox.sh` |
| Host-prune retention | current only / +1 / +2 | Current + 2 previous | **Resolved: keep current + 2 previous** per service |
| #9 test gating | local-only vs CI-gated | CI-gated | **Resolved: local script + CI gate** (exact wiring → `sandbox-pr-workflow`) |
| Registry blob reclaim | enable GC vs recreate | Recreate | **Resolved: `registry-reset` recreates; no registry GC** |

## Portability Flags

- Phase 2 deliberately keeps Dockerfile `FROM` args as **upstream** refs (retag-from-registry happens in `ensureLocalDockerImage`, not in the build args), so built images stay portable / reproducible for a future non-local deployment. Do **not** regress this by baking `localhost:5001` into `FROM`.
- `registry-reset` is fully offline-safe only when the upstream bases are already in the host Docker cache or the machine is online (the re-sync re-pulls anything missing). Documented as a caveat, not solved here.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Refactor is behavior-preserving | Keystone must not change deployed images | nb-ui / nb-bond-api / bens produce the **same** content-hash tags and same `helm --set image` refs as before; re-run skips build | Same registry tags pre/post refactor |
| Offline build when registry warm | Reproducibility / offline | With bases pushed and bare `node:25.9.0` removed from host cache, a build does **not** hit the network and succeeds | No upstream pull; `FROM` still upstream ref |
| Force-pull is visible | Avoid silent network use | `FORCE_IMAGE_PULL=true ./infra/infra.sh registry-sync` prints an explicit warning per/at the run | Warning emitted; flag documented |
| Host prune keeps current + 2 | Bounded disk, safe rollback | After 4+ builds, `cleanup-images` leaves exactly current + 2 newest tags per repo and never removes bases or the deployed hash | `docker images` shows ≤3 hash tags/repo |
| `image-report` is read-only & offline | Safe dry-run | Running it with and without a cluster prints pod images + per-repo registry tags + the "current" marker, mutating nothing | Read-only, degrades gracefully |
| `registry-reset` wipes + repopulates | Disposable registry reclaim | After reset, `_catalog` is empty then re-warmed by sync; next start rebuilds repo images | Clean registry, deterministic refill |
| Hash test catches a dropped input | Guards stale-image regression | Test passes on `main`; removing an input from a `*BundleHash` list makes it fail | CI-gated, green |
| Docs + hygiene pass | Public-repo safety | `check-public-repo-hygiene.py` + `check-markdown-links.py` pass; new verbs + flag documented; plan indexed | All green |

## Assumptions

- The sandbox is running and the registry is warm for verification (confirmed this session).
- `jq`, `curl`, `docker`, `kubectl` available locally (already used by existing helpers).
- No new third-party dependency is introduced (so no `check-third-party-licenses.py` / AGENTS approval needed).

## Plan Order

```
Phase 0  Baseline (capture current tags/refs)
Phase 1  #8  Shared buildAndPushHashedImage helper (pure refactor)     -> PR1
Phase 2  #1  ensureLocalDockerImage retag-from-registry (offline fix)  -> PR2
Phase 3  #11 FORCE_IMAGE_PULL warning + doc                            -> PR2 (with Phase 2)
Phase 4  Cleanup cluster: registry-reset / cleanup-images / image-report / KNOWN_ISSUES note  -> PR3
Phase 5  #9  Hash-input test (local script + CI gate)  (depends on Phase 1)  -> PR4
Phase 6  Docs + public-repo hygiene  (cross-cutting; folded into each PR)
```

Each phase is independently shippable and its own PR; branch/commit/CI specifics defer to `sandbox-pr-workflow`.

## Phase 0: Baseline Verification

### Goal
Capture the exact current image refs so the Phase 1 refactor can be proven behavior-preserving.

### Steps
- Record current content-hash tags: `curl -s localhost:5001/v2/nb-ui/tags/list`, `.../nb-bond-api/tags/list`, `.../bens-microservice/tags/list`.
- Record deployed refs: `kubectl get deploy -A -o jsonpath` over `.spec.template.spec.containers[*].image` for nb-ui, nb-bond-api, and the BENS pod.
- Record `docker images` rows for the three repos + the base images (node/nginx/python).

### Verification Stop
- The three current hashes are noted and match what the running pods reference.

### Fix Iteration / Rollback
- If pod refs and registry tags disagree, resolve (e.g. run the service `start`) before refactoring so "same as before" is well-defined.

### Exit Criteria
- A written baseline of {repo → current hash, deployed ref} exists for comparison.

## Phase 1: Shared `buildAndPushHashedImage` Helper (#8 — keystone)

### Goal
Replace the 3× copy-pasted hash→skip-check→build→tag→push sequence with one helper, with zero change to produced tags or deployed refs.

### Scope
`common/helpers.sh` only. New helper + refactor of `prepareBensImage`, `deployNBBondAPI`, `deployNBUI`.

### Steps
- Add `buildAndPushHashedImage` with responsibilities: (1) the tags/list skip-check (centralized; logs "already in local registry — skipping build" to **stderr**); (2) on miss, `docker build --tag <repo>:<hash> --build-arg ... [-f <dockerfile>] <context>`, `docker tag` → `localhost:5001/<repo>:<hash>`, `docker push`; (3) echo the `localhost:5001/<repo>:<hash>` push tag on **stdout** as the only stdout output (BENS contract). All progress logs go to stderr.
- Keep **per-service** logic in the callers: the `*BundleHash` function, and the base-image pre-prep (`loadImageToKind` + `ensureLocalDockerImage` of the FROM stages — counts/args differ per service). Preserve the current skip-before-prepull ordering by having the helper invoke a caller-provided prepare step only on a build miss (callback), or by keeping prepare in the caller guarded behind the same skip-check — implementer's choice, but the no-build path must not newly pull bases.
- Route nb-ui, nb-bond-api, and BENS through the helper; callers keep their post-build action (return tag / `helm --set image=` / `--set bensImage`).

### Verification Stop
- Re-run each service build (`./services/nb-ui/nb-ui.sh start`, etc.): the produced `<repo>:<hash>` tags **equal the Phase 0 baseline**; a second run prints the skip message and does not rebuild.
- `helm` receives the same `localhost:5001/<repo>:<hash>` ref; pods are unchanged (no rollout).
- BENS stdout still yields exactly the push tag (consumed by `--set bensImage=$(prepareBensImage)`).

### Fix Iteration / Rollback
- Pure refactor — revert `helpers.sh` if any produced tag or stdout contract differs.

### Exit Criteria
- All three services build via the shared helper; tags/refs identical to baseline; `bash -n common/helpers.sh` clean.

## Phase 2: `ensureLocalDockerImage` Retag-From-Registry (#1 — offline fix)

### Goal
Stop the internet pull of a base image when the local registry already has it.

### Steps
- In `ensureLocalDockerImage` (1026-1033): when the bare upstream ref is absent from the host cache, before `docker pull <upstream>`: compute the kind ref via `kindRegistryImageFor`/`toKindImageTag`; if `localhost:5001/<kind>` exists locally → `docker tag` it back to the upstream ref; else try `docker pull localhost:5001/<kind>` then retag; only if neither is available fall back to the upstream `docker pull` (current last-resort behavior).
- Handle digest-pinned refs: `toKindImageTag` rewrites `@sha256:...` to `:kind`, so the retag target must be the **original** upstream ref string.

### Verification Stop
- Warm path proof: `docker rmi node:25.9.0` (leaving `localhost:5001/node:25.9.0-kind`), then build a service offline (disconnect network or watch `docker pull` traffic) — build succeeds with **no upstream pull**.
- The built image's `FROM` lineage still references the upstream ref (no `localhost:5001` baked in); content hash unchanged from Phase 0.
- Last-resort path still works when neither host nor registry has the base (online).

### Fix Iteration / Rollback
- Revert the function; behavior returns to unconditional upstream pull.

### Exit Criteria
- Offline build works when the registry is warm; portability preserved.

## Phase 3: `FORCE_IMAGE_PULL` Warning + Documentation (#11)

### Goal
Make the cache-bypass visible and the flag discoverable.

### Steps
- Emit an explicit warning when `FORCE_IMAGE_PULL=true` (once at the `syncImagesToRegistry` call-site to avoid one-per-image noise, or guarded in `loadImageToKind`): e.g. "⚠️ FORCE_IMAGE_PULL=true — bypassing registry/local cache, pulling from upstream".
- Document the flag in `README.md` (env/flag reference) and `infra/README.md` if relevant, stating clearly it affects **only base/3rd-party images via `loadImageToKind`** and does **not** rebuild nb-ui / nb-bond-api / bens (their content-hash skip never reads it).

### Verification Stop
- `FORCE_IMAGE_PULL=true ./infra/infra.sh registry-sync` prints the warning; a repo image with an existing hash still skips its build.

### Fix Iteration / Rollback
- Additive logging + docs; trivially revertible.

### Exit Criteria
- Warning emitted; flag documented with accurate scope.

## Phase 4: Cleanup Cluster — `registry-reset` / `cleanup-images` / `image-report` (#4 / #2 / #3 / #6 / #7)

### Goal
Give the operator explicit, scoped image-lifecycle verbs and document what actually wastes space.

### Scope
`infra/infra.sh` (implementations) + `sandbox.sh` (surface + help text) + `docs/KNOWN_ISSUES.md`. A single shared "current hash" definition (reuse the `*BundleHash` functions + live pod/helm refs) feeds both `image-report` and `cleanup-images`.

### Steps
- **`registry-reset`** (#4): `docker rm -f kind-registry || true` → `ensureKindRegistry` → `syncImagesToRegistry`. No registry DELETE/GC. Print the offline caveat.
- **`image-report`** (#6, read-only): list running pod images (`kubectl get pods -A -o jsonpath`, degrade gracefully if no cluster); per repo family call the existing `/v2/<repo>/tags/list` probe; mark which tag is "current" via the `*BundleHash` functions. Read-only and offline; states that registry tags are not deletable via the API (delete disabled), pointing to `registry-reset`.
- **`cleanup-images`** (#2/#3, host-side prune): for `nb-ui` / `nb-bond-api` / `bens-microservice`, list both `<repo>:<hash>` and `localhost:5001/<repo>:<hash>`, sort by created time, `docker rmi` all but **current + 2 newest**, excluding the currently-deployed hash and never touching shared base images (node/nginx/python/besu/blockscout/postgres/jupyter). Default = dry-run-style summary of what will go; explicit opt-in `--prune-build-cache` maps to `docker builder prune -f` with a loud "this is global, not sandbox-scoped" warning (never default).
- **#7 doc note** in `KNOWN_ISSUES.md`: `repo:tag` and `localhost:5001/repo:tag` are aliases of one image ID (negligible); the real growth is old unique content-hash image IDs (host) + un-GC'd blobs in the `kind-registry` container; reclaim via `cleanup-images` (host) and `registry-reset` (registry).

### Verification Stop
- Build a service 3+ times (touch a hashed file between builds) to create old tags; `image-report` lists them and marks the current one; `cleanup-images` leaves current + 2 and removes the rest, leaving bases and the deployed hash intact; `registry-reset` empties `_catalog` then re-warms it, and the next `start` rebuilds repo images.
- `image-report` run with the cluster down still prints registry + host data without error.

### Fix Iteration / Rollback
- All three verbs are additive; removing them is safe. `registry-reset` is destructive to the registry only (recreatable by design).

### Exit Criteria
- The three verbs exist, are documented in `sandbox.sh` help, behave per the retention/offline rules, and the KNOWN_ISSUES note is in place.

## Phase 5: Hash-Input Test (#9 — local script + CI gate)

### Goal
Guard against the real regression: a source file silently dropping out of a `*BundleHash` input set (ships a stale image).

### Steps
- Add `scripts/verification/check-image-hash-inputs.sh` (matching the standalone-script style of `contracts/check-verify-latest-mapping.sh` / `scripts/verification/check-node-version-consistency.py`; no bats/shunit2). It sources `common/helpers.sh` in a sandboxed temp copy and asserts: editing a file inside a hashed set changes the `*BundleHash` output; editing a non-hashed file does not; (optionally) the de-duplicated skip helper returns present/absent correctly against a fake `curl` on PATH.
- Wire into CI — exact workflow placement (new lightweight workflow vs. existing step) deferred to `sandbox-pr-workflow`.

### Verification Stop
- Script passes locally; deliberately removing an input from a `*BundleHash` list makes it fail (proves it catches the regression).

### Fix Iteration / Rollback
- Self-contained; remove the script + CI step to revert.

### Exit Criteria
- Test green locally and in CI; fails on a dropped hash input.

## Phase 6: Documentation And Public-Repo Hygiene

### Goal
Leave docs accurate and the repo public-safe.

### Steps
- `README.md`: add `image-report` / `cleanup-images` / `registry-reset` to the commands table; add the `FORCE_IMAGE_PULL` env note.
- `infra/README.md`: registry-lifecycle verbs.
- `docs/ARCHITECTURE.md`: update the image-lifecycle section for the shared helper + retag-from-registry + cleanup verbs.
- `docs/KNOWN_ISSUES.md`: the tag-semantics note (Phase 4); revisit the existing "build-images is Blockscout-only" follow-up if the shared helper changes its calculus.
- `docs/DOCUMENTATION_INDEX.md`: register this plan; move it to `docs/plans/archive/` when shipped.

### Verification Stop
- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- (No dependency/third-party change → `check-third-party-licenses.py` not required.)

### Exit Criteria
- Docs reflect the new verbs/flag; hygiene scripts pass.

## Documentation And PR Plan

Branch naming (`feature/<kebab>` → `development`), commit / PR style, and CI gates are owned by `sandbox-pr-workflow` — see it rather than restating here.

- **PR1:** Phase 1 (#8 shared helper) — reviewed as a behavior-preserving refactor with the Phase 0 baseline as evidence.
- **PR2:** Phases 2 + 3 (#1 offline fix + #11 force-pull warning/doc) — both base-image-handling, small.
- **PR3:** Phase 4 (cleanup cluster) + its docs.
- **PR4:** Phase 5 (#9 test + CI).
- **Docs/runbooks:** README, infra/README, ARCHITECTURE, KNOWN_ISSUES, DOCUMENTATION_INDEX.
- **Evidence for PR bodies:** Phase 0 vs post-refactor tag/ref equality; offline-build proof; `cleanup-images` before/after `docker images`; `registry-reset` `_catalog` before/after; failing-then-passing hash test.

## Residual Risks

- **Refactor regression** (Phase 1): a subtle stdout/stderr or build-arg slip changes a produced tag or breaks the BENS `$(prepareBensImage)` capture. Mitigated by the Phase 0 baseline equality check and `bash -n`.
- **Retag edge cases** (Phase 2): digest-pinned bases and multi-arch/platform mismatches — must retag to the original ref string and respect the kind platform handling in `loadImageToKind`.
- **Accidental over-prune** (Phase 4): `cleanup-images` must exclude bases and the deployed hash; default to a printed summary before deletion. `--prune-build-cache` is global — gated behind an explicit opt-in + warning.
- **`registry-reset` offline gap:** re-sync re-pulls missing bases — note the online/warm-cache requirement.

## Done Criteria

- All acceptance criteria met; the three services build via the shared helper with identical refs; offline build proven; force-pull visible + documented; the three verbs behave per the retention/offline rules; the hash test gates CI; docs updated and hygiene scripts pass; plan moved to `docs/plans/archive/` on ship.
