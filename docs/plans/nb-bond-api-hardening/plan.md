# nb-bond-api operational hardening — Implementation Plan

**Status:** Proposed
**Created:** 2026-09-28
**Scope:** `services/nb-bond-api` (`src/chain.ts`, new `src/tx-sender.ts`, `src/central-bank.ts`, `src/banks.ts`, `src/banking-tbd.ts`, `src/bidder-bid.ts`, `src/features/auctions/service.ts` send wiring only, `src/http.ts`, `src/app.ts`, `src/auth.ts`, `src/env-vars.ts`, `src/parsing.ts`, `src/bidders.ts`, `src/operations.ts`, `src/openapi/shared-responses.ts`, `src/contracts/common.ts`, `src/abi/TbdBytecode.json`, `openapi.json`, `helm/`, `Dockerfile`, `.env.example`, `README.md`, `DEVELOPMENT.md`, tests); `docs/KNOWN_ISSUES.md`; `docs/DOCUMENTATION_INDEX.md`; approval-gated: `common/node-version.env`, `common/helpers.sh`, `scripts/verification/check-node-version-consistency.py`, `docs/THIRD_PARTY_NOTES.md`, `THIRD_PARTY_LICENSES.md`, `.github/workflows/test-contracts.yml`, a new `scripts/verification/check-nb-bond-api-abi-sync.py`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Baseline and characterisation (no behaviour change)
Phase 1  Error envelope and contract text (A10)             -> slice 1
Phase 2  Per-signer transaction sender (A9)                 -> slice 2
Phase 3  Liveness, bounded health, chart hardening (A11)    -> slice 3
Phase 4  Runtime image (A14); 4b slim base behind approval  -> slices 4a, 4b
Phase 5  Cleanup and TBD bytecode refresh                   -> slice 5
Phase 6  Drift guards (optional, approval)                  -> slice 6
Phase 7  Route-module extraction (optional, go-ahead)       -> slices 7.x
Phase 8  Close-out: index, known issues, archive
```

Why this order:

- Phase 1 comes before Phase 2 because Phase 2 adds one error class
  (`TransactionUnconfirmedError`) and needs the consolidated classifier and its tests to plug
  into.
- Phase 3 depends on Phase 1 for the 503 mapping. Once health is bounded and the pod is Ready
  while the chain is down, requests must fail fast and honestly.
- Phase 5 comes after Phases 1 and 2 so the shared parsing helpers land in the consolidated
  error model.
- Phase 7 comes last so it moves settled code, and only after the separate hardening change lands.

Each phase is one PR against `development` unless noted. Every phase updates `progress.md` in
the same commit. Branch naming, commit style, and the per-package gate follow the repository
PR workflow.

## Phase 0: Baseline and Characterisation

### Goal

Pin the current behaviour that later phases change, and resolve the design's "Needs
verification" items before any code depends on them.

### Scope

Scratch work only, plus characterisation tests that ship with Phase 1 and Phase 2. No
production code changes.

### Steps

1. Record the gate baseline: `npm run lint -w nb-bond-api && npm run format:check -w nb-bond-api && npm test -w nb-bond-api`.
   Note the test count in `progress.md`.
2. Local dead-RPC timing. Run `RPC_URL=http://127.0.0.1:1 GLOBAL_REGISTRY_ADDRESS=<fixture address> BOND_ADMIN_PK=<fixture> DB_PATH=<scratch dir>/i.sqlite npm run dev -w nb-bond-api`,
   using values from the gitignored fixture files by path. Time `curl -m 30 -w '%{time_total}' http://127.0.0.1:8080/v1/health`.
   Expect it to hang past 1 s, which is the ethers detection loop.
3. Nonce collision reproduction against the live sandbox (read-mostly; needs operator OK
   because it sends two WNOK mints). Fire two `POST /v1/central-bank/wnok/mint` for 1 unit
   to the CB address in parallel and record the second response. If the operator declines,
   rely on the Phase 2 unit test.
4. Image facts. Record `docker image inspect` size and `du -sh node_modules` for the current
   tag. In a scratch copy of the Dockerfile, try
   `npm ci --omit=dev --workspace nb-bond-api --include-workspace-root=false` in a separate
   `deps` stage. Check that `node -e "require('better-sqlite3')"` succeeds in the runtime
   stage. Repeat with `node:26.5.0-slim` as the runtime base, without pushing anything to
   the shared registry.
5. Fixture regeneration check. Copy `services/nb-bond-api/helm/values.local.yaml` to a
   scratch directory, run `node scripts/generate-local-sandbox-fixtures.mjs --force` with
   the repo's generated outputs backed up, and diff the `secret` and `env` blocks. The keys
   must be identical. Restore the backup whatever the result. The operator may prefer to run
   this step themselves.
6. `forge build` in `contracts/` (writes only the gitignored `out/`). Confirm
   `jq -r .bytecode.object contracts/out/Tbd.sol/Tbd.json` differs from
   `jq -r .bytecode services/nb-bond-api/src/abi/TbdBytecode.json`, and that all six ABIs
   match.

### Verification Stop

`progress.md` "Verified So Far" records: the dead-RPC health timing, collision evidence (or
the decision to skip), the working deps-stage command, whether slim loads the native binding,
the regeneration diff, and the bytecode diff.

### Failure Diagnosis / Fix Forward / Rollback

- If `npm ci --workspace` does not give a runnable tree, fall back to a builder step
  `npm prune --omit=dev --workspace nb-bond-api`, or copy only the modules that
  `npm ls --omit=dev -w nb-bond-api --parseable` lists. Record the chosen command.
- If `--force` changes any key, do not use it in rollout. Instead document a manual deletion
  of the probe and security blocks from `values.local.yaml`.

### Exit Criteria

- [ ] Every "Needs verification" item in `design.md` is resolved or re-scoped in
      `progress.md`.

## Phase 1: Error Envelope and Contract Text (A10)

### Goal

Every failure gets an honest status and a safe, useful detail, classified in one place.

### Scope

`src/http.ts`, a new `src/error-text.ts`, `src/app.ts` (remove the wrapper middleware, add the
404 fallback, sanitise health and restart output), `src/auth.ts`, `src/openapi/shared-responses.ts`,
`src/contracts/health.ts` (description only), `openapi.json` (regenerated), tests.

### Steps

1. `src/error-text.ts`: `sanitiseErrorText(input: unknown): string`. Prefer `shortMessage`,
   cut at the first ethers key-dump marker, reduce URLs to their origin, and cap at 300
   characters. Export `isChainUnavailable(err)`, which is true for `RpcUnavailableError`,
   `RegistryResolutionError`, ethers `code` in `NETWORK_ERROR`, `TIMEOUT`, or `SERVER_ERROR`,
   or a `cause.code`/`error.code` in `ECONNREFUSED`, `ECONNRESET`, `EAI_AGAIN`, or `ENOTFOUND`.
   Import the chain error classes from `chain.ts`, or move them to `application-errors.ts`
   to avoid an http-to-chain import. Moving them is preferred, with `chain.ts` re-exporting
   them for compatibility.
2. `src/http.ts`:
   - `problemErrorMiddleware` becomes `createProblemErrorMiddleware(log)`, with the
     classification order in `design.md`. It handles body-parser errors (`type` and `status`),
     chain-unavailable errors (503 and `warn`), and unknown errors (500 with sanitised text
     plus `ref`, logged at `error` with the stack and ref via `crypto.randomUUID()`).
   - `ifNoneMatchMatches(header, etag)` per RFC 9110 weak comparison. `successResponse` uses
     it.
3. `src/app.ts`:
   - Delete the wrapper at the end of the file. Mount `createProblemErrorMiddleware(logger)`.
   - Add the JSON 404 fallback just before it.
   - Map `ingestion.recentErrors` through `sanitiseErrorText` in `/v1/health`. For
     `/v1/admin/restart-ingestion`, sanitise `outcome.status.recentErrors` before
     `successResponse`. `src/ingestion.ts` stays untouched.
4. `src/auth.ts`: fixed detail "Invalid or expired bearer token"; log the jose message at
   `debug`.
5. OpenAPI (`src/openapi/`, and wherever `components.responses` is assembled; locate with
   `rg -n "InternalError" src`):
   - Reword the `InternalError` description to "sanitised message plus a reference id that
     matches the server log".
   - Reword the `ServiceUnavailable` description to include chain RPC unavailability.
   - Add a `PayloadTooLarge` (413) response and add it to `errorRefs.mutate`.
   - Run `npm run regen:openapi`.
6. Tests, sized like the neighbouring files:
   - `tests/http.test.ts`: replace "exposes the thrown message…" with sanitisation cases
     built from recorded ethers error shapes: a `CALL_EXCEPTION` with `transaction=`, a
     `SERVER_ERROR` with `info.requestUrl` containing a path and credentials, and a non-Error
     throw. Add `RpcUnavailableError`, `RegistryResolutionError`, and
     `{ code: 'NETWORK_ERROR' }` giving 503; a body-parser 400 and 413 shape; and the weak,
     list, and `*` `If-None-Match` cases, including a stale tag in a list.
   - `tests/app.test.ts`: `POST /v1/bidders` with `{bad` gives 400 ProblemDetails;
     `GET /v1/nope` gives 404 `application/json` ProblemDetails.
   - `tests/auth.test.ts`: an invalid token's detail does not contain the jose text.
   - A health sanitisation unit test on the mapping helper.

### Verification Stop

- The package gate is green. `git diff openapi.json` shows only the response-description and
  413 changes.
- Against the redeployed local build: `POST` with bad JSON gives 400, and `/v1/nope` gives a
  JSON 404. Only unit tests prove the chain-unavailable 503 in this slice. The live
  dead-RPC proof comes in Phase 2, once `assertProviderReady` is bounded, because before that
  a boot-time outage makes requests hang instead of throwing.

### Failure Diagnosis / Fix Forward / Rollback

- A handler that intentionally rethrows raw errors for its own mapping (the coupon route's
  `describeRevert`, `mapCentralBankError`) must still see them first. The middleware only
  sees what escapes, so if a mapped status changes unexpectedly, look for a handler that
  swallowed its own mapping.
- The slice is self-contained, so rollback is a revert.

### Exit Criteria

- [ ] The acceptance rows for body-parser, 404, 503, sanitisation, 401, and ETag are met.
- [ ] No `logger.error("unhandled…")` for 202, 4xx, or 503 outcomes. A test spies on the
      logger.
- [ ] `docs/KNOWN_ISSUES.md` "request-path chain reads bubble up as opaque 500s" is marked
      resolved, pointing at this plan and noting the Phase 2 follow-through for
      post-broadcast failures.

## Phase 2: Per-Signer Transaction Sender (A9)

### Goal

No nonce collisions for any signer; no unbounded waits; honest outcomes for unconfirmed
transactions.

### Scope

New `src/tx-sender.ts`; `src/chain.ts`; `src/central-bank.ts`; `src/banks.ts`;
`src/banking-tbd.ts`; `src/bidder-bid.ts`; send wiring in `src/app.ts` and
`src/features/auctions/service.ts`; `src/operations.ts` (`classifyFailure`); `src/env-vars.ts`;
`src/http.ts` (504 mapping); `src/openapi/shared-responses.ts` (504 in `errorRefs.mutate`);
tests.

### Steps

1. `env-vars.ts`: add `NB_BOND_API_TX_WAIT_TIMEOUT_MS` (default 30 000) and
   `NB_BOND_API_RPC_TIMEOUT_MS` (default 10 000), each with a comment in the existing style.
2. `src/tx-sender.ts`:
   - `sendSigned(wallet, send)` with a per-checksummed-address `{ nonce, queue }` map.
   - The nonce is resolved inside the queue. The wait is `tx.wait(1, timeout)`.
   - Any error resets that address's nonce to `null`.
   - An ethers `TIMEOUT` from `wait` becomes `TransactionUnconfirmedError { hash, signer, timeoutMs }`.
   - Export `__resetTxSenderForTests()`.
3. `src/chain.ts`:
   - The provider becomes `new JsonRpcProvider(fetchRequestWithTimeout(RPC_URL), undefined, { staticNetwork: true })`.
   - `assertProviderReady()` races `getBlockNumber()` against `NB_BOND_API_RPC_TIMEOUT_MS`
     and throws `RpcUnavailableError` on expiry. Requests queued behind the boot-time
     network detection loop are never dispatched, so the fetch timeout alone would not end
     them.
   - `sendWithManagedNonce = (send) => sendSigned(wallet, send)`.
   - Delete the old mutex and cache.
4. Migrate the send sites:
   - `central-bank.ts`: each write becomes `sendSigned(getCbWallet(), (nonce) => fn(..., { nonce }))`;
     `toTxRef` reads the returned receipt.
   - `banks.ts`: `registerContract` uses the CB wallet through `sendSigned`. `deployTbd`
     uses `sendSigned(bankWallet, async (nonce) => (await factory.deploy(..., { nonce })).deploymentTransaction()!)`,
     and the address comes from `receipt.contractAddress`. Replace the "fresh keys start at
     nonce 0" comment, because operator-supplied keys are not necessarily fresh.
     `addBankToWnokAllowlist` already calls `addToAllowlist`.
   - `banking-tbd.ts`: `sendTbdTx` calls `sendSigned(wallet, (nonce) => invoke(tbd, { nonce }))`.
     The `invoke` callbacks forward overrides.
   - `bidder-bid.ts`: `submitFn(..., { nonce })` inside `sendSigned(bidderWallet, ...)`.
5. Unconfirmed outcomes:
   - `http.ts` maps `TransactionUnconfirmedError` to 504 ProblemDetails with the hash in
     detail. Add a `GatewayTimeout` response to `errorRefs.mutate`, then regenerate
     `openapi.json`.
   - Bond and auction mutations (`POST /v1/bonds`, coupon payments in `app.ts`; create,
     close, cancel, and finalise in the auctions service) catch `TransactionUnconfirmedError`
     after `withOperationRecording` and throw `MutationAcceptedError({ transactionHash:
     err.hash, blockNumber: null, resource })`. This gives the documented 202. Put it in a
     small shared helper, for example `acceptIfUnconfirmed(resource, fn)` in
     `application-errors.ts`, so the auctions service change is a wrapper, not a rewrite.
   - `operations.ts` `classifyFailure`: take `txHash` from `err.hash` for
     `TransactionUnconfirmedError`; the error text is "unconfirmed after N ms; may still mine".
6. Tests:
   - A new `tests/tx-sender.test.ts` (about 150 lines) with a fake wallet whose provider
     returns a scripted pending count and fake tx objects with controllable `wait`. Cover:
     1. Two concurrent sends for one address get `n` and `n+1`, and the second waits for the
        first to confirm.
     2. Two addresses run in parallel.
     3. A never-resolving `wait` gives `TransactionUnconfirmedError` after a short
        test-configured timeout, and the next send re-reads the nonce and proceeds.
     4. A pre-broadcast failure resets the cache and re-reads it.
     5. Keying is by checksummed address: two `Wallet` instances for one key share a queue.
   - `tests/http.test.ts`: 504 mapping.
   - `tests/operations.test.ts`: the unconfirmed hash is recorded.
   - Existing `central-bank`, `banks`, `banking-tbd`, and `bidder-bid` tests are updated for
     the override argument.

### Verification Stop

- The package gate is green.
- Live, after `./nb-bond-api.sh start`: two parallel `POST /v1/central-bank/wnok/mint`
  requests both return 200 with consecutive-nonce transactions (check with
  `cast tx <hash> nonce --rpc-url http://besu.cbdc-sandbox.local:8545`). Needs the operator's
  OK to mint 2 units.
- A bid and a TBD Nordea mint fired in parallel both succeed.
- Local `npm run dev` with `RPC_URL=http://127.0.0.1:1`: `GET /v1/registry` and
  `POST /v1/bonds` return 503 ProblemDetails. `/v1/registry` can take up to two timeouts,
  because its event scan swallows the first failure. This is the live proof deferred from
  Phase 1.

### Failure Diagnosis / Fix Forward / Rollback

- A `nonce too low` after the migration means some send path still bypasses `sendSigned`.
  Find it with `rg -n "\.wait\(|deploy\(" src`; outside `tx-sender.ts` the list should be
  empty.
- If `staticNetwork: true` masks a chain reset, the ingestion chain-identity check still
  fails fast and the process restarts. Record it if it is observed.
- Rollback is a revert. There is no persisted state change.

### Exit Criteria

- [ ] `rg -n "\.wait\(" services/nb-bond-api/src` matches only `src/tx-sender.ts`.
- [ ] The A9 acceptance rows are met.

## Phase 3: Liveness, Bounded Health, Chart Hardening (A11)

### Goal

Probes measure what they claim. Upgrades never run two pods on one volume. Configuration
changes roll the pod. Defaults reach existing sandboxes.

### Scope

`src/app.ts` (`/livez`, the health timeout helper), `helm/values.yaml`,
`helm/values.local.example.yaml`, `helm/templates/deployment.yaml`, `nb-bond-api.sh`
(comment only), `README.md`, `DEVELOPMENT.md` §7.8 and §7.10, tests.

### Steps

1. Get the readiness-semantics decision from the operator (`design.md` Decisions).
2. `app.ts`:
   - Mount `app.get('/livez', ...)` before `express.json()` and the other middleware.
   - Run the two chain blocks in `/v1/health` concurrently under one `withTimeout(..., 2000)`
     budget. The readiness `timeoutSeconds: 4` leaves headroom above it. When the budget
     expires, record `headReachable: false` or keep the zero addresses, as on errors.
3. `values.yaml`: add `strategy`, `livenessProbe` (`/livez`), `readinessProbe` (`/v1/health`,
   `timeoutSeconds: 4`), `resources`, `securityContext` (plus `readOnlyRootFilesystem:
   true`), and `podSecurityContext`, with the values from `design.md`. Add
   `replicaCount: 1`, with a comment that it is the only supported value.
4. `deployment.yaml`:
   - `strategy: {{ toYaml .Values.strategy | nindent 4 }}`.
   - The replica guard (`fail` when `replicaCount > 1`).
   - `checksum/config` and `checksum/secret` annotations on the pod template.
   - A `tmp` `emptyDir` mounted at `/tmp`.
5. `values.local.example.yaml`: remove the probe and security blocks (they are now chart
   defaults). Leave a pointer comment to `values.yaml`. Fix the "emptyDir" wording.
6. Fix the `nb-bond-api.sh` start-comment "emptyDir" wording.
7. Tests:
   - `tests/app.test.ts`: `/livez` answers 200 without touching the provider (mock
     `../src/chain` to throw on access).
   - Health returns within the bound when a mocked provider never resolves. Use fake timers,
     or a 2 s real wait if fake timers fight the promise race.
8. Chart proof, in a scratch directory:
   - `helm template services/nb-bond-api/helm --set image=x --values services/nb-bond-api/helm/values.local.example.yaml`.
     Check that `strategy.type` is `Recreate`, the annotations are present, `/livez` is the
     liveness path, and `readOnlyRootFilesystem` is `true`.
   - `--set replicaCount=2` fails.

### Verification Stop

- Rollout needs operator go-ahead for the regeneration: back up `values.local.yaml`, run
  `node scripts/generate-local-sandbox-fixtures.mjs --force` (safe per Phase 0), then
  `./services/nb-bond-api/nb-bond-api.sh start`.
- `kubectl -n nb-bond-api get deploy nb-bond-api -o jsonpath='{.spec.strategy.type}'` gives
  `Recreate`. The pod has resources, the pod annotations have the checksums, and
  `kubectl get events` shows no probe failures after 5 minutes.
- `kubectl exec` writes to `/app/data` and `/tmp` succeed, and a write to `/app` fails.
- The UI health badge is green.
- Change only `env.NB_BOND_API_SSE_HEARTBEAT_MS` in `values.local.yaml`, rerun `start`, and
  check that the pod is recreated. Revert the value afterwards.
- Optional, with go-ahead: scale Besu to zero, confirm there are no liveness restarts for
  3 minutes and that `/v1/health` reports `down`, then start Besu.

### Failure Diagnosis / Fix Forward / Rollback

- `EROFS` in the logs means a process writes outside `/app/data` and `/tmp`. Add the missing
  path as an `emptyDir` or record it. Do not drop `readOnlyRootFilesystem` silently.
- The pod is `OOMKilled` means the memory limit is too tight. Raise it from the measured peak
  plus headroom, and record the value.
- Rollback: `helm rollback nb-bond-api -n nb-bond-api` and restore the backed-up
  `values.local.yaml`. The PVC is untouched either way.

### Exit Criteria

- [ ] The A11 acceptance rows are met with live evidence in `progress.md`.
- [ ] README "Local Deployment Model" and DEVELOPMENT §7.8/§7.10 describe `/livez`,
      `Recreate`, the single-replica rule, and the new env vars.

## Phase 4: Runtime Image (A14)

### Goal

The runtime ships only nb-bond-api's production tree and starts without shell workarounds.
Optionally, it runs on a smaller base.

### Scope

4a: `Dockerfile`, `src/app.ts` (handle order), `README.md`. 4b (approval-gated):
`common/node-version.env`, `common/helpers.sh`,
`scripts/verification/check-node-version-consistency.py`, `docs/THIRD_PARTY_NOTES.md`,
`THIRD_PARTY_LICENSES.md`.

### Steps (4a)

1. Add a `deps` stage (or builder step) that produces an nb-bond-api-only production
   `node_modules` using the Phase 0 command. The runtime copies from it instead of the full
   pruned root.
2. In `createApp()`, open `biddersDb` (writable, which creates the file, the schema, and WAL)
   before `historyDb` (read-only). Change `CMD` to `["node", "/app/services/nb-bond-api/dist/index.js"]`.
   Keep `RUN mkdir -p /app/data`. Coordinate with the ingestion correctness plan: if it
   already restructures handle opening, take its version and only drop the `touch`.
3. Fix the Dockerfile comments that say the chart mounts an `emptyDir`.
4. Test: `tests/app.test.ts` gets one case where `createApp()` with a non-existent file
   `DB_PATH` starts cleanly. It uses a scratch temp directory, not `:memory:`.

### Steps (4b, only after explicit approval)

1. Add `SANDBOX_NODE_RUNTIME_SLIM_IMAGE=node:26.5.0-slim` to `common/node-version.env`.
2. In `common/helpers.sh`, set `NB_BOND_API_RUNTIME_BASEIMAGE=$SANDBOX_NODE_RUNTIME_SLIM_IMAGE`.
3. In `check-node-version-consistency.py`, require the runtime to derive from the new
   variable, and require the slim tag to equal `node:${SANDBOX_NODE_VERSION}-slim`.
4. `./infra/infra.sh registry-sync` (operator-run) so the offline build works.
5. Update the `node` bullet in `docs/THIRD_PARTY_NOTES.md` and the Node.js row notes in
   `THIRD_PARTY_LICENSES.md`, then run the licence check.

### Verification Stop

- `docker run --rm --entrypoint ls <tag> /app/node_modules` shows no `react`, `react-dom`,
  or nb-ui auth package. Record the before and after image size and `node_modules` size.
- The container starts on an empty volume and `/v1/health` answers.
- `python3 scripts/verification/check-node-version-consistency.py` and
  `bash scripts/verification/check-image-hash-inputs.sh` pass. For 4b, also run
  `python3 scripts/verification/check-third-party-licenses.py`.

### Failure Diagnosis / Fix Forward / Rollback

- `Cannot find module` at start means the workspace-scoped install missed a hoisted
  dependency. Switch to the `npm ls --parseable` copy approach from Phase 0.
- On slim, a `better-sqlite3` load error means a glibc mismatch. Stay on the full image and
  record why. 4a stands alone.

### Exit Criteria

- [ ] The A14 acceptance row is met.
- [ ] 4b is either merged with approval or recorded as declined in `progress.md`.

## Phase 5: Cleanup and TBD Bytecode Refresh

### Goal

Remove the verified leftovers, and fix the one artifact defect.

### Scope

`src/abi/TbdBytecode.json`, `src/parsing.ts`, `src/contracts/common.ts` (param schemas),
`src/app.ts`, `src/bidders.ts`, `src/operations.ts` (comment), `src/env-vars.ts` (comment),
`.env.example`, `README.md` (Env), tests.

### Steps

1. `TbdBytecode.json`: after `forge soldeer install && forge build` in `contracts/`, write
   `bytecode.object` from `contracts/out/Tbd.sol/Tbd.json` into the `bytecode` field, and
   keep `_comment`. Confirm that `Tbd.json`'s ABI is unchanged.
2. `parsing.ts`: `parsePositiveUint256(value, field)` throws `badRequest` for zero or for
   anything above `2^256 − 1`. Replace the six amount blocks in `app.ts`.
3. `contracts/common.ts`: `addressParamSchema` (`{ address }`) and `tbdHolderParamSchema`
   (`{ address, holder }`) built from `addressSchema`. Replace the eight regex checks with
   `validateRequest(..., 'params')`. The 400 body changes from "Bad Request / address must
   be…" to "Validation failed" with `errors[]`. That is contract-compatible, and nb-ui
   renders both.
4. `bidders.ts`: in `normalizePrivateKey`, reject scalar `0` and `>= SECP256K1_ORDER` with
   `BidderValidationError`. Wrap the delete and insert in
   `reconcileFixtureBidderOverrides` in `db.transaction(...)()`.
5. `operations.ts`: add the legacy comment above `'REDEMPTION'`, matching
   `src/contracts/operations.ts`. The value stays in both lists (see `design.md`).
6. `app.ts`:
   - Move the "Central Bank is operator-only" comment to the `app.use('/v1/central-bank', ...)`
     line.
   - Delete the redundant `app.use('/v1/banking', requireAnyRole(recognizedRoles))`, keeping
     the explanatory comment next to the global gate. Skip this item if the separate hardening change is open, because it owns role gates.
7. `env-vars.ts`: reword the `NB_BOND_API_CLOSE_GAS_LIMIT` comment. It is a fallback for a
   stale-head `eth_estimateGas` false revert, kept because empty blocks can still lag wall
   clock by up to `emptyblockperiodseconds`. Drop "during the migration".
8. `.env.example`: add every variable in `env-vars.ts`, grouped and commented, with the
   secrets empty. Add `README.md` Env entries for `NB_BOND_API_CLOSE_GAS_LIMIT`,
   `NB_BOND_API_TX_WAIT_TIMEOUT_MS`, and `NB_BOND_API_RPC_TIMEOUT_MS`, plus any other
   variables missing there.
9. Tests:
   - `parsing.test.ts`: uint256 bounds.
   - `bidders.test.ts`: a zero key and the order value give `BidderValidationError`, and
     the reconcile is atomic (a stubbed insert that throws leaves the original row).
   - `app.test.ts`: a bad address param gives 400 `Validation failed`.

### Verification Stop

- The package gate is green. The hygiene check passes: `.env.example` is on its allowlist,
  so it contains no key-shaped values.
- The live create-bank flow deploys a TBD, and `cast code <addr>` matches the runtime part of
  the new artifact. This needs an operator go-ahead because it creates a bank.

### Failure Diagnosis / Fix Forward / Rollback

- A byte mismatch after refresh means `contracts/out` came from a different
  `foundry.toml`. Rebuild with the committed config.
- Rollback is a revert. Banks already created keep their deployed code.

### Exit Criteria

- [ ] Each cleanup bullet is done or explicitly skipped with a reason in `progress.md`.

## Phase 6: Drift Guards (Optional, Operator Approval)

### Goal

Make the two generated artifacts fail CI when they drift.

### Steps

1. OpenAPI: add a `tests/openapi-contract.test.ts` case that compares
   `JSON.parse(readFileSync('openapi.json'))` with
   `JSON.parse(JSON.stringify(openApiDocument))` and fails with "run npm run regen:openapi".
   It runs inside the existing `format-lint-test` job.
2. ABI and bytecode: add `scripts/verification/check-nb-bond-api-abi-sync.py`, which compares
   `abi` for the six contracts, and `bytecode.object` for `Tbd`, between
   `contracts/out/<Name>.sol/<Name>.json` and `services/nb-bond-api/src/abi/`. In
   `.github/workflows/test-contracts.yml`, add `services/nb-bond-api/src/abi` to
   `sparse-checkout`, a step after "Run Forge build", and `services/nb-bond-api/src/abi/**`
   to `paths`. Document the script in `scripts/verification/README.md`.

### Verification Stop

Both checks pass on the branch, and fail when one ABI entry is hand-edited in a scratch
commit that is never pushed.

### Exit Criteria

- [ ] Approved guards are merged, or declined with a reason recorded.

## Phase 7: Route-Module Extraction (Optional, Separate Go-Ahead)

### Goal

Shrink `src/app.ts` (1526 lines, every route inline) into per-feature route modules, with no
behaviour change.

### Approach

- Follow the auctions precedent and extend it: `src/features/<feature>/routes.ts` exports
  `create<Feature>Router(deps)` (an Express `Router`). Where there is logic,
  `service.ts` holds it.
- `createApp()` keeps middleware order, public routes, the auth gates, the 404 fallback, and
  the error middleware, and mounts the routers.
- One PR per feature, in order: `central-bank`, `banking`, `bidders`, `system` (registry,
  operations, admin, events), `bonds`, then moving the auction routes next to the existing
  auction service.
- Start only after the separate hardening change and Phases 1–5 have merged, so the
  refactor moves settled code.
- Proof per slice: the full jest suite unchanged; `openapi.json` unchanged; `tests/app.test.ts`
  still green; a live smoke of that feature's pages in nb-ui.

## Phase 8: Close-Out

1. `docs/DOCUMENTATION_INDEX.md`: add this plan folder in the same PR as Phase 1, or as soon
   as this plan is committed.
2. `docs/KNOWN_ISSUES.md`: resolved entry (Phase 1). Add new entries only for accepted
   follow-ups.
3. When Phases 1–5 are merged, and 6 and 7 are merged or declined, move the folder to
   `docs/plans/archive/`, set `Status: Implemented`, and update the index.

## Test Matrix

| Layer | Risk or behaviour | Test/evidence |
|---|---|---|
| Unit: tx sender | Same-address serialisation, cross-address parallelism, wait timeout, reset on failure, address keying | `tests/tx-sender.test.ts` |
| Unit: error text | ethers payload stripping, URL redaction, length cap | `tests/http.test.ts` sanitiser cases |
| Unit: classifier | 400/413 body-parser, 503 chain-unavailable, 504 unconfirmed, 500 with ref, 202 unchanged, logging level | `tests/http.test.ts` |
| Unit: ETag | Weak, list, `*`, stale-in-list | `tests/http.test.ts` |
| Unit: validation | uint256 bounds, address params, bidder key range, atomic reconcile | `parsing`, `bidders`, `app` tests |
| API: app | JSON 404, bad JSON 400, `/livez` without chain, bounded health | `tests/app.test.ts` |
| API: auth | Generic `entra` 401 | `tests/auth.test.ts` |
| API: contract | Response text, 413 and 504 refs; optional snapshot | `openapi.json` diff; Phase 6 test |
| Audit trail | Unconfirmed hash recorded | `tests/operations.test.ts` |
| Chart | Recreate, guard, checksums, probes, read-only root | `helm template` in a scratch directory |
| Image | No nb-ui deps; starts without `touch`; slim loads native binding | `docker run` checks |
| Local runtime | Parallel same-key mutations; config change rolls pod; no probe failures; optional Besu-down | Phase 2 and Phase 3 verification stops |
| Artifact | `TbdBytecode.json` equals `forge build` output | Phase 5 compare; Phase 6 script |

## Recommended PR Slices

| Slice | Architectural outcome | Main proof | Temporary compatibility/cleanup |
|---|---|---|---|
| 1 `feature/nb-bond-api-error-envelope` | One classifier; honest 4xx, 503, 500; JSON 404; sanitised health; weak ETags | http, app, and auth tests; openapi diff | Closes the known-issue entry. 504 lands in slice 2 |
| 2 `feature/nb-bond-api-signer-queue` | Per-address sender; bounded waits; 202/504 for unconfirmed | `tx-sender` tests; live parallel mints | `sendWithManagedNonce` kept as an alias |
| 3 `feature/nb-bond-api-probes-chart` | `/livez`; bounded health; Recreate; guard; resources; checksums; read-only root | `helm template`; live events | One-time `values.local.yaml` regeneration |
| 4a `feature/nb-bond-api-runtime-deps` | Scoped runtime deps; no `touch` | `docker run` checks | None |
| 4b `feature/nb-bond-api-slim-runtime` | Slim base (approval) | Node consistency and licence checks | None |
| 5 `feature/nb-bond-api-cleanup` | Parsing helpers; key range; atomic reconcile; comments; `.env.example`; TBD bytecode | Unit tests; bytecode compare | `/v1/banking` gate removal may defer to the separate hardening change |
| 6 `feature/nb-bond-api-drift-guards` | Snapshot and ABI guards (approval) | Guard passes, and fails on a scratch edit | None |
| 7.x `feature/nb-bond-api-routes-<feature>` | Route modules (go-ahead) | Unchanged suite and spec | None |

## Migration, Rebuild, and Rollout

- Data/schema version effect: none. No SQLite schema change. System-of-record tables are
  untouched.
- Local rebuild/restart path: `./services/nb-bond-api/nb-bond-api.sh start` per slice. Slice 3
  needs the one-time `values.local.yaml` regeneration first. Slice 4b needs
  `./infra/infra.sh registry-sync` first.
- Compatibility window: none needed. nb-ui already renders `detail` and handles 202.
- Non-local deployment note: the new env vars have defaults. That deployment must keep one
  replica, and must carry the chart defaults (strategy, probes, read-only root, resources) if
  it overrides values.
- Rollback or fix-forward boundary: every slice reverts cleanly. The TBD bytecode refresh
  affects only banks created afterwards.

## Documentation and Public-Repo Hygiene

- Docs to update, in the slice that changes the behaviour: `services/nb-bond-api/README.md`
  (Env, Local Deployment Model, `/livez`), `services/nb-bond-api/DEVELOPMENT.md` (§7.8
  health, §7.10 chart table, and the error-semantics description where 500/503 are
  described), `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, and
  `scripts/verification/README.md` (Phase 6).
- Third-party/licence inventory impact: only slice 4b.
- Examples use placeholders only, and fixture keys are referenced by file path.

Verification:

```bash
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
# Slice 4b only:
python3 scripts/verification/check-third-party-licenses.py
python3 scripts/verification/check-node-version-consistency.py
```

## Out of Scope

- Items owned by a separate hardening change, including role gating on routes.
- The ingestion and projection correctness plan's items, including `src/ingestion.ts`
  provider settings and its database handle.
- Contract changes, `application/problem+json` content type, an `UNCONFIRMED` audit status,
  and multi-replica support.

## Done Criteria

- [ ] Every acceptance criterion in `intent.md` has evidence in `progress.md`.
- [ ] The `sendWithManagedNonce` alias is either kept deliberately or removed in slice 7.
- [ ] Package gate, hygiene, and link checks pass. The licence and node checks pass for 4b.
- [ ] README, DEVELOPMENT, and KNOWN_ISSUES match the implemented behaviour.
- [ ] PR bodies contain no private environment information.
