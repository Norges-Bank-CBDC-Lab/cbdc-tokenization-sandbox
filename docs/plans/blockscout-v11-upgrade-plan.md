# Blockscout v11 Upgrade — Implementation Plan

**Status:** ✅ Implemented — validated locally 2026-07-03 (backend v11.2.1, chart 4.5.1, 13/13 contracts verified; Phase 5 BENS refresh not needed). Move to `docs/plans/archive/` on merge.
**Branch suggestion:** `feature/blockscout-v11-upgrade` — defer the actual branch / commit / PR / CI-gate workflow to the repo PR conventions
**Components touched:** `common/images.yaml`, `common/versions.yaml`, `common/helpers.sh`, `services/blockscout/` (values files, docs, conditionally the BENS stub), `docs/`

## Goal

Bring the local sandbox explorer stack from Blockscout backend `v10.0.8` /
frontend `v2.7.3` / chart `blockscout-stack 4.4.3` to the current upstream
releases — backend `v11.2.1`, frontend `v2.9.0`, chart `4.5.1` — against the
existing Besu `26.1.0` node, with no regression in the local workflow:
explorer reachable, chain fully indexed, contract verification via the
sc-verifier microservice still working, and the BENS name-service stub still
answering the frontend without errors.

## Current-State Evidence

All checks below were run live in the planning session (2026-07-03) against
the Kind cluster `cluster-cbdc-monoledger`.

- Docs read: root `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`,
  `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`,
  `services/blockscout/debugging.md`,
  `services/blockscout/bens-microservice/README.md`,
  `docs/THIRD_PARTY_NOTES.md`, `THIRD_PARTY_LICENSES.md`.
- Repo declarations inspected:
  - `common/images.yaml`: `blockscout.backend: ghcr.io/blockscout/blockscout:v10.0.8`,
    `blockscout.frontend: ghcr.io/blockscout/frontend:v2.7.3`,
    `blockscout.smart_contract_verifier: v1.10.3`, `blockscout.db: postgres:18.4`.
  - `common/versions.yaml`: `charts.blockscout_stack: 4.4.3`; fallback
    `BLOCKSCOUT_CHART_VERSION=4.4.3` in `common/helpers.sh`.
  - `services/blockscout/values.yaml`: fallback image tags `v10.0.8` / `v2.7.3`;
    `blockscout.separateApi.enabled: false`; migrations run via the backend
    init container (`init.enabled: true` → `create_and_migrate()`).
  - `services/blockscout/values.backend.env.yaml`:
    `ETHEREUM_JSONRPC_VARIANT: besu`, internal-transactions and
    pending-transactions fetchers disabled, `DISABLE_CATCHUP_INDEXER: "true"`,
    `ECTO_USE_SSL: false`, BENS + sc-verifier microservice wiring.
  - `services/blockscout/templates/`: repo-owned templates copied over the
    pulled chart (`composeBlockscoutChart`), including a fork of
    `blockscout-migration-job.yaml` and the `httproute.yaml` whose BENS
    `URLRewrite` comment is tied to *frontend v2.7.x* call paths.
  - `services/blockscout/build-images.sh`: optional source-build path clones
    upstream by the same tags pinned in `common/images.yaml`.
- Live local checks:
  - Helm: release `blockscout` = `blockscout-stack-4.4.3`, app version `10.0.8`, deployed.
  - Pods in `blockscout` namespace all `Running`/`Completed` (backend,
    frontend, postgres, bens, sc-verifier).
  - Besu: `web3_clientVersion` = `besu/v26.1.0/...`, head block `0x54` (84).
  - Backend health: `GET /api/health` healthy, `db == cache == node == 84`
    (indexed exactly to head). `GET /api/v2/config/backend-version` = `v10.0.8`.
  - Frontend: `GET http://blockscout.cbdc-sandbox.local/` → HTTP 200.
- Upstream release facts (checked 2026-07-03):
  - Backend latest: `v11.2.1` (2026-06-18). `v11.0.0` (2026-04-22) release
    notes: *"Version v11.0.0 must be installed on top of v10.1"* for existing
    databases; greenfield installs are exempt. Latest v10.1 patch is
    `v10.1.1` (2026-03-20). `ECTO_USE_SSL` deprecated in favour of
    `ECTO_SSL_MODE`. No JSON-RPC-variant changes across v11.x.
  - Frontend latest: `v2.9.0` (2026-06-24). Requires backend API ≥ `v11.2.0`
    and BENS API ≥ `v1.7.1`. None of the env vars set in
    `values.frontend.env.yaml` were removed or renamed in v2.8.x/v2.9.0.
  - Chart latest: `blockscout-stack 4.5.1` (2026-05-28), appVersion `11.1.0`.
    `values.yaml` is byte-identical to 4.4.3; the template delta
    (migration job/secret, basic-auth secret, small deployment additions) is
    entirely gated behind `separateApi.enabled` / `envFromSecret` /
    basic-auth options this repo does not enable.
  - smart-contract-verifier: `v1.10.3` is still the newest published release —
    no change.
  - **Upstream no longer publishes pullable release images** (discovered
    during implementation): `ghcr.io/blockscout/blockscout:latest` is a
    v9.0.2-era build (2025-08-14), `ghcr.io/blockscout/frontend:latest` is
    v2.3.5 (2025-10-14), Docker Hub stopped in April 2025, and the formerly
    pullable `v10.0.8` / `v2.7.3` tags have been removed from ghcr. The
    locally running v10.0.8/v2.7.3 images were source-built via
    `./sandbox.sh build-images` on 2026-05-19 (image config `created`
    timestamp, no OCI labels). Only rolling `master`/`main`/`prerelease-*`
    tags and the sc-verifier release images remain published.
- Local validation entry points: `./sandbox.sh start|delete`,
  `./services/blockscout/blockscout.sh start|stop`, `make verify-contracts`
  (→ `contracts/contracts.sh verify-latest --watch`), `helm template`,
  `curl` against `blockscout.cbdc-sandbox.local`.
- Blocked or unverified checks: exact BENS endpoints called by frontend
  `v2.9.0` against the local stub (validated at runtime in Phase 4; fallback
  in Phase 5). Blockscout v11 migration behaviour on Postgres 18.4 is
  validated by the greenfield start in Phase 3 (upstream notes list no
  Postgres version change; v10.0.8 already runs on 18.4 locally).

## Scope

### In Scope

- Backend image pin `v10.0.8` → `v11.2.1` and frontend image pin `v2.7.3` →
  `v2.9.0` in `common/images.yaml` (fallback tags in
  `services/blockscout/values.yaml` kept aligned).
- Chart pin `4.4.3` → `4.5.1` in `common/versions.yaml` plus the fallback in
  `common/helpers.sh`.
- Backend env change required by v11: replace deprecated `ECTO_USE_SSL: false`
  with `ECTO_SSL_MODE: "disable"` — v11 defaults DB SSL to `require`
  (resolution: `ECTO_SSL_MODE` → `sslmode` in `DATABASE_URL` → `require`), so
  dropping the old variable without setting the new one fails migrations with
  `Postgrex.Error: ssl not available` (hit during implementation).
- Runtime validation of the BENS stub and sc-verifier against the new
  backend/frontend; conditional refresh of the BENS swagger + regenerated
  server if (and only if) validation fails.
- Source-building the backend/frontend images at the new tags via
  `./sandbox.sh build-images` (upstream stopped publishing release images),
  and documenting that reality (`docs/KNOWN_ISSUES.md`, `sandbox.sh`
  build-images help text, `common/images.yaml` comments,
  `docs/AZURE_BOUNDARY.md`).
- Documentation updates listed in Phase 6.

### Out Of Scope

- Besu version change (stays `26.1.0`; Clique + London baseline per ADR 0001
  and `docs/KNOWN_ISSUES.md` is untouched).
- Postgres / python / busybox base-image bumps (separate dependency-pin lane).
- Enabling additional Blockscout microservices (stats, user-ops-indexer, etc.).
- The non-local (Azure/GitOps) Blockscout upgrade — planned in the other
  repo; see Portability Flags for the constraint it inherits.

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| D1: How to apply locally | (a) Full `./sandbox.sh delete && ./sandbox.sh start` — fresh chain + fresh explorer DB, contracts redeploy + re-verify; (b) `blockscout.sh stop && start` only, temporarily enabling the catchup indexer to backfill the existing 84-block chain | **(a)** — the chain is disposable (84 blocks), the full start is the standard validation loop, and it avoids touching the catchup-indexer config at all | OK to destroy local chain history (routine) |
| D2: BENS stub handling | (a) Validate as-is, refresh swagger + regen only on failure; (b) refresh proactively to `bens/v1.7.3` | **(a)** — smallest reviewable diff; the stub may well satisfy the lookups the frontend makes | Confirm validate-first approach |

Neither decision blocks writing or reviewing the change; both gates sit in
front of Phase 3.

## Portability Flags

- **The v10 → v11 stepping-stone rule matters wherever the Blockscout
  database is persistent.** Locally the DB is wiped on every
  `blockscout.sh stop` (namespace + PVC delete), so v11 installs greenfield.
  A deployment with a persistent DB (the Azure/GitOps one) must either step
  `v10.0.8 → v10.1.1 → v11.2.1` with migrations at each hop, or accept a
  full re-index. Do **not** promote these pins to the other repo as a plain
  image bump.
- `DISABLE_CATCHUP_INDEXER: "true"` means any *explorer-only* restart on a
  surviving chain loses pre-restart history. Pre-existing behaviour, not new
  to v11 — flagged here because it shapes D1 and any future non-local restart
  strategy.
- **No public upstream images exist for Blockscout v10+.** The pins in
  `common/images.yaml` name the intended upstream refs, but they resolve only
  because `./sandbox.sh build-images` builds them from source into the local
  registry. A non-local deployment must build the backend + frontend images
  itself (amd64 for AKS) and host them in its own registry — it cannot pull
  them from ghcr or Docker Hub.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| Backend runs v11.2.1 | The upgrade actually happened | `curl -s http://blockscout.cbdc-sandbox.local/api/v2/config/backend-version` | `{"backend_version":"v11.2.1"}` |
| Chart 4.5.1 deployed | Pins are consistent end-to-end | `helm list -n blockscout` | `blockscout-stack-4.5.1`, status `deployed` |
| All pods steady | No crash-loops introduced | `kubectl get pods -n blockscout` | All `Running`/`Completed`, no restarts accumulating |
| Chain fully indexed | Explorer is trustworthy | `GET /api/health` | `healthy: true`, `db == node` head |
| Frontend works on v2.9.0 | Operator-facing surface intact | `GET /` → 200; browse blocks / txs / an address page | Pages render, no error banners |
| Contract verification path works on v11 | sc-verifier wiring survives | `make verify-contracts`; `GET /api/v2/smart-contracts/<addr>` | `is_verified: true` for the deployed contracts |
| BENS stub answers the new frontend | No silent 404 noise | `kubectl logs -n blockscout deploy/bens-deployment` while browsing | Only 2xx responses (or Phase 5 executed and then 2xx) |
| Docs + hygiene | Public repo stays consistent | Phase 6 script runs | All three verification scripts pass |

## Assumptions

- Backend `v11.2.1` + frontend `v2.9.0` is the intended pairing (frontend
  v2.9.0 explicitly requires backend ≥ v11.2.0, so the two bumps must land
  together — a frontend-only or backend-only bump is not a valid intermediate
  state for this repo).
- The `besu` JSON-RPC variant remains supported and unchanged in v11.x (no
  variant-related notes in any v11 release), and the sandbox's narrowed RPC
  surface (internal-tx + pending-tx fetchers disabled, realtime indexer only)
  keeps Besu 26.1.0 compatibility low-risk.
- sc-verifier `v1.10.3` remains the pin (still upstream latest);
  `MICROSERVICE_SC_VERIFIER_*` wiring is unchanged in v11.

## Plan Order

```
Phase 0  Baseline capture (done in planning session; re-run if stale)
Phase 1  Pin + config edits
Phase 2  Chart render + diff validation
Phase 3  Local apply via full sandbox recreate   (Gate: D1 confirmed)
Phase 4  Post-change verification (incl. BENS + verification path)
Phase 5  BENS stub refresh                        (Conditional: only if Phase 4 BENS checks fail)
Phase 6  Documentation + public-repo hygiene
```

## Phase 0: Baseline Verification

### Goal

Prove the starting state before changing anything.

### Steps

- `helm list -n blockscout` → expect `blockscout-stack-4.4.3` / app `10.0.8`.
- `kubectl get pods -n blockscout` → all steady.
- `curl -s http://blockscout.cbdc-sandbox.local/api/health` → healthy, db == node.
- `curl -s http://blockscout.cbdc-sandbox.local/api/v2/config/backend-version` → `v10.0.8`.
- Capture a baseline render for the Phase 2 diff:
  `helm template` of the composed 4.4.3 chart with the four values files, saved
  to a scratch location.

### Verification Stop

- All of the above return the expected baseline values (they did on
  2026-07-03; re-run only if the sandbox changed since).

### Fix Iteration / Rollback

If baseline state disagrees with the docs or expected architecture, stop and
fix the sandbox first — do not upgrade a broken explorer.

### Exit Criteria

- Baseline evidence recorded (values above) and baseline render saved.

## Phase 1: Pin And Config Edits

### Goal

Make all version pins and config edits in one reviewable commit, with no
cluster changes yet.

### Steps

- `common/images.yaml`:
  - `blockscout.backend` → `ghcr.io/blockscout/blockscout:v11.2.1`
  - `blockscout.frontend` → `ghcr.io/blockscout/frontend:v2.9.0`
  - refresh the header example block so it doesn't present the now-current
    pins as a hypothetical upgrade.
- `common/versions.yaml`: `charts.blockscout_stack` → `4.5.1`.
- `common/helpers.sh`: fallback `BLOCKSCOUT_CHART_VERSION=4.4.3` → `4.5.1`
  (kept aligned with `versions.yaml` by repo convention).
- `services/blockscout/values.yaml`:
  - fallback tags `v10.0.8` → `v11.2.1` and `v2.7.3` → `v2.9.0`;
  - update the "Overwrites default values based on:" reference comment to the
    `blockscout-stack-4.5.1` tag URL (same comment in `values.local.yaml`).
- `services/blockscout/values.backend.env.yaml`: replace `ECTO_USE_SSL: false`
  with `ECTO_SSL_MODE: "disable"`. v11 defaults DB SSL to `require`, so an
  explicit disable is mandatory for the plain-TCP in-cluster Postgres —
  removing the old variable alone crash-loops the migration init container
  with `Postgrex.Error: ssl not available`.
- No changes to `values.frontend.env.yaml` (all vars survive v2.9.0), no
  changes to the sc-verifier pin, no changes to the repo-owned templates yet
  (the forked `blockscout-migration-job.yaml` renders to nothing while
  `separateApi.enabled: false`, so it is inert across the chart bump).

### Verification Stop

- `git diff` review: only the files above, only version/comment lines.
- `yq` parses both edited YAML pin files cleanly.

### Fix Iteration / Rollback

- Pure file edits — `git checkout -- <file>` reverts.

### Exit Criteria

- Diff reviewed; nothing outside the intended files.

## Phase 2: Chart Render + Diff Validation

### Goal

Prove the composed 4.5.1 chart renders cleanly with our values and that the
manifest delta against 4.4.3 is fully explained.

### Steps

- Re-run the compose step so the 4.5.1 chart is pulled and the repo templates
  are copied in (same mechanism `blockscout.sh start` uses).
- `helm template` with the four values files; save the proposed render.
- `diff -u` baseline vs proposed; classify every change. Expected delta:
  image tags only. The upstream 4.5.x template changes (migration job/secret,
  frontend basic-auth secret) are gated behind `separateApi.enabled` /
  `envFromSecret` / basic-auth values this repo leaves off — if any of them
  *do* appear in the render, stop and explain before applying.

### Verification Stop

- Render succeeds; diff contains image-tag changes and nothing unexplained;
  no resource deletions predicted.

### Fix Iteration / Rollback

- Do not proceed to Phase 3 while unexplained render changes remain.

### Exit Criteria

- Proposed render archived next to the baseline; delta classified.

## Phase 3: Local Apply (Full Sandbox Recreate)

**Gate: D1 confirmed by operator — this destroys local chain history (routine
for this sandbox).**

### Goal

Apply the upgrade through the standard full lifecycle so Blockscout v11
installs greenfield (satisfying upstream's stepping-stone rule by never
migrating a v10 database).

### Steps

- `./sandbox.sh delete`
- `./sandbox.sh build-images` — clones the pinned release tags and builds the
  backend + frontend images from source into the local kind registry
  (required: upstream publishes no release images; the kind registry survives
  cluster deletion, so this is a once-per-pin-change step).
- `./sandbox.sh start` — reuses the freshly built images from the registry,
  deploys chart 4.5.1, fresh Postgres, BENS, sc-verifier, then Besu-dependent
  steps: contracts deploy + verification, NB Bond API, NB UI.

Do **not** use an in-place `helm upgrade` against the existing release: the
running database was created by v10.0.8 and upstream requires v10.1 before
v11 migrations. The namespace-wiping path sidesteps that class of failure
entirely.

### Verification Stop

- `kubectl get pods -A | grep -Ev '\sRunning|\sCompleted'` → empty.
- `helm list -n blockscout` → `blockscout-stack-4.5.1` deployed.
- `kubectl -n blockscout get events --sort-by=.lastTimestamp | tail -10` →
  no warnings on the blockscout workloads.

### Fix Iteration / Rollback

- Rollback = `git revert` the pin commit, then `./sandbox.sh delete && start`
  again (returns to v10.0.8 greenfield). `helm rollback` is *not* a valid
  path across this boundary because the database is recreated either way.
- If only the backend misbehaves (e.g. an env var v11 rejects), fix the env
  in `values.backend.env.yaml` and re-run
  `./services/blockscout/blockscout.sh stop && start` (fresh DB again;
  contracts must then be re-verified with `make verify-contracts`).

### Exit Criteria

- Full stack up on the new versions with a fresh chain.

## Phase 4: Post-Change Verification

### Goal

Prove the explorer works end-to-end on v11.2.1 / v2.9.0 against Besu 26.1.0.

### Steps

- `curl -s http://blockscout.cbdc-sandbox.local/api/v2/config/backend-version`
  → `v11.2.1`.
- `curl -s http://blockscout.cbdc-sandbox.local/api/health` → healthy,
  `db == node` (realtime indexer caught the contract-deploy blocks; the start
  sequence deploys contracts only after Blockscout answers).
- Frontend: `GET /` → 200; browse latest blocks, a transaction, and a
  contract address page in the browser.
- Contract verification: `make verify-contracts`;
  `curl -s http://blockscout.cbdc-sandbox.local/api/v2/smart-contracts/<GlobalRegistry-addr>`
  → `is_verified: true`.
- BENS: watch `kubectl logs -n blockscout deploy/bens-deployment -f` while
  browsing address pages; confirm requests are 2xx. Also scan backend logs
  for BENS/microservice errors (`kubectl logs -n blockscout
  deploy/blockscout-blockscout-stack-blockscout | grep -i -E "bens|microservice"`).
- Adjacent services sanity: NB Bond API `GET /v1/health` healthy; NB UI loads.

### Verification Stop

- All checks above pass → skip Phase 5.
- BENS checks fail (404s / frontend errors) → enter Phase 5.

### Fix Iteration / Rollback

- Backend indexing issues: follow `services/blockscout/debugging.md`
  (trace/RPC triage is unchanged).
- Unrecoverable: rollback per Phase 3.

### Exit Criteria

- Acceptance-criteria table rows 1–6 all satisfied (row 7 possibly via Phase 5).

## Phase 5: BENS Stub Refresh (Conditional)

Run only if Phase 4 shows the v2.9.0 frontend (or v11 backend) calling BENS
endpoints the local stub doesn't serve.

### Goal

Restore a silent, error-free name-service surface for the new frontend.

### Steps

- Refresh `services/blockscout/bens-microservice/swagger/bens.swagger.yaml`
  from the upstream `bens/v1.7.3` tag (frontend v2.9.0 requires BENS API
  ≥ v1.7.1), preserving the upstream MIT SPDX identifier.
- Regenerate the server: `(cd services/blockscout/bens-microservice && ./regen-openapi.sh)`.
- Re-check the `URLRewrite` filter in
  `services/blockscout/templates/httproute.yaml`: its chain-id path injection
  matches the *v2.7.x* frontend call shape; adjust filter and comment if the
  v2.9.0 call paths changed.
- `./services/blockscout/blockscout.sh stop && start` (rebuilds the BENS
  image content-hash), then `make verify-contracts` (fresh explorer DB), then
  re-run the Phase 4 BENS checks.
- Re-check provenance notes in `docs/THIRD_PARTY_NOTES.md` (per the BENS
  README) — the entries are file-level and expected to stay accurate, but the
  regen requires the check.

### Verification Stop

- BENS logs show only 2xx while browsing; frontend shows no name-service
  errors; `python3 scripts/verification/check-third-party-licenses.py` passes.

### Fix Iteration / Rollback

- The stub is repo-owned and content-hash built — reverting the swagger +
  regenerated output restores the previous image on the next start.
- If the refreshed stub still can't satisfy the frontend, fall back to
  disabling the name service (frontend `NEXT_PUBLIC_NAME_SERVICE_API_HOST`
  removal + backend `MICROSERVICE_BENS_ENABLED: "false"`) and record the
  regression in `docs/KNOWN_ISSUES.md` — decision to take with the operator.

### Exit Criteria

- Acceptance row 7 satisfied (or the documented fallback agreed and recorded).

## Phase 6: Documentation And Public-Repo Hygiene

### Goal

Leave the repo's documentation consistent with the new versions.

### Steps

- `services/blockscout/debugging.md`: update the "the v10 backend used here"
  wording in the contract-verification section (make it version-accurate or
  version-agnostic).
- Confirm the comment/reference updates from Phase 1 landed
  (`values.yaml` / `values.local.yaml` chart-tag URLs, `images.yaml` example).
- `docs/DOCUMENTATION_INDEX.md`: entry for this plan (added when the plan was
  created); move the plan to `docs/plans/archive/` once shipped and update the
  index accordingly.
- No expected changes to `THIRD_PARTY_LICENSES.md` rows (Blockscout entries
  are deliberately version-less, "pulled at deploy time") — verified by
  script, not assumed.
- `docs/KNOWN_ISSUES.md`: no new entries expected; add one only if Phase 5
  ends in the disable-BENS fallback.

### Verification Stop

- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- `python3 scripts/verification/check-third-party-licenses.py` (image pins
  changed; expected to pass without inventory edits)

### Fix Iteration / Rollback

- Doc-only fixes; iterate until the scripts pass.

### Exit Criteria

- All three scripts pass; docs match the deployed reality.

## Documentation And PR Plan

Branch naming, commit / PR style, and CI gates follow the repo's standard PR
workflow (feature branch targeting `development`).

- PR 1 (single PR): pin bumps + env cleanup + doc updates (+ BENS refresh if
  Phase 5 ran). Small diff, one reviewable unit.
- Docs to update: `services/blockscout/debugging.md`, comment lines in the
  values/pin files, `docs/DOCUMENTATION_INDEX.md` (plan entry), this plan's
  status line.
- Evidence to include in PR body: backend-version endpoint output, `helm list`
  line showing chart 4.5.1, `/api/health` snippet (db == node), verified
  contract API response (`is_verified: true`), note on whether Phase 5 was
  needed, hygiene-script pass lines.
- CI note: editing `common/helpers.sh` (and `bens-microservice/**` if Phase 5
  runs) triggers the Image Hash Inputs workflow; the license-inventory and
  publication-hygiene workflows run as usual. No contract or Node surface
  changes are expected.

## Residual Risks

- **Source-built images are now the only route (pre-existing, now explicit):**
  upstream stopped publishing release images, so the pinned refs resolve only
  after `./sandbox.sh build-images` seeds the local registry. A fresh clone
  that skips the build step cannot start Blockscout — documented in
  `docs/KNOWN_ISSUES.md`, the `sandbox.sh` help text, and
  `common/images.yaml`. Revert to pulled images if upstream restores a
  release channel.
- **BENS stub drift (medium, contained):** frontend v2.9.0 expects BENS API
  ≥ v1.7.1; the local stub was generated from an earlier copied swagger and
  the gateway `URLRewrite` matches v2.7.x call paths. Worst case is cosmetic
  (name lookups fail / log noise) with a contained fix (Phase 5) and a
  documented fallback. This is the most likely phase-4 failure.
- **Env-var strictness in v11 (low):** the sandbox sets a conservative,
  widely-used env surface; the one deprecated var (`ECTO_USE_SSL`) is removed
  in Phase 1. Any other rejected var surfaces immediately at boot in Phase 3
  and is fixed in `values.backend.env.yaml`.
- **Postgres 18.4 with v11 migrations (low):** newer than upstream's default
  images but already proven with v10.0.8 locally; greenfield migration in
  Phase 3 is the test. Rollback path exists.
- **Chart 4.5.1 hidden template behaviour (low):** the delta is gated off in
  this configuration and Phase 2 diffs the actual render before anything is
  applied.
- **Two-version jump in one PR (accepted):** backend v11.2.x and frontend
  v2.9.0 are mutually required, so the pair cannot be split. The greenfield
  install removes the usual migration risk that would argue for stepping.

## Done Criteria

- All acceptance-criteria rows satisfied with evidence captured in the PR.
- Plan status updated and file moved to `docs/plans/archive/` after merge.
- Local sandbox left running on backend `v11.2.1`, frontend `v2.9.0`, chart
  `4.5.1`, chain re-deployed and contracts verified.
