# nb-bond-api operational hardening — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan drafted; findings re-verified against code and the live sandbox
**Current phase:** Not started
**Next action:** Operator reviews `intent.md` and the `design.md` Decisions table, in
particular the readiness semantics, the signer-lock scope, and the 500 detail policy. Then run
Phase 0 step 1 (the package gate baseline) and step 2 (the local dead-RPC health timing) on a
`feature/nb-bond-api-error-envelope` branch.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline and characterisation | Not started | | |
| 1 — Error envelope and contract text | Not started | | |
| 2 — Per-signer transaction sender | Not started | | |
| 3 — Liveness, bounded health, chart | Not started | | |
| 4a — Runtime dependencies and `touch` removal | Not started | | |
| 4b — Slim runtime base (approval) | Not started | | |
| 5 — Cleanup and TBD bytecode refresh | Not started | | |
| 6 — Drift guards (approval) | Not started | | |
| 7 — Route-module extraction (go-ahead) | Not started | | |
| 8 — Close-out | Not started | | |

## Deviations From the Plan

Deviations from the review findings, recorded while the plan was written:

- **Lock release after broadcast** was not adopted. The per-signer lock is held through
  confirmation with a timeout instead. The reason is in `design.md` Alternatives: a 1-second
  block period gives little pipelining gain, and releasing early would let preflights run
  against stale same-signer state.
- **`REDEMPTION` removal** is corrected to a clarifying comment. The value is deliberately
  kept (#276) so stored `operation_attempts` rows, a preserved system-of-record, still
  validate. Removing it would change the contract and break those rows.
- **"ABI in sync today"** holds for the six ABIs, but `TbdBytecode.json` is stale: it was
  written in #200, before #232 changed the compiler, EVM target, and OpenZeppelin version.
  Its refresh is added to Phase 5.
- **Sharing the ingestion provider** is handed to the ingestion correctness plan. Backfill
  `getLogs` needs a different timeout than request paths, and `src/ingestion.ts` is that
  plan's file.
- **`/livez` and OpenAPI:** kept outside the contract, following the `/docs` precedent.
- **Chart defaults** move from `values.local.example.yaml` to `values.yaml`. This was not in
  the review. It was found while checking how the example reaches a sandbox: it is copied
  once, so edits never apply to an existing `values.local.yaml`.

## Verified So Far

- Only `BOND_ADMIN` sends use a managed nonce. The CB, bank TBD, bidder, and created-bank
  paths call ethers without a nonce and `tx.wait()` without a timeout. Verified by reading
  `src/chain.ts`, `src/central-bank.ts`, `src/banks.ts`, `src/banking-tbd.ts`, and
  `src/bidder-bid.ts` on 2026-09-28.
- The Nordea bank signing key and the Nordea bidder key are the same fixture role key.
  Verified through `configuredBankSigningKey` and `FIXTURE_ROSTER` on 2026-09-28.
- Malformed JSON to `POST /v1/bidders` returns 500 with the parser message, and
  `GET /v1/nope` returns `404 text/html`. Verified live against
  `bond-api.cbdc-sandbox.local` on 2026-09-28.
- The gateway passes a strong `ETag` without `Content-Encoding`. Verified with `curl -D -`
  on 2026-09-28.
- The live pod restarted after `SandboxChanged`. Readiness and liveness probes on
  `/v1/health` failed with "context deadline exceeded" (`timeoutSeconds: 1`). The strategy is
  `RollingUpdate` 25%/25% and `resources` is `{}`. Verified with read-only `kubectl` on
  2026-09-28.
- Container memory is about 182 MiB current and 203 MiB peak. The runtime `node_modules` is
  96 MB and contains `react`, `react-dom`, and nb-ui's browser-auth package. The image is
  about 2.0 GB. Verified with `kubectl exec` (read-only) and `docker image inspect` on
  2026-09-28.
- In ethers 6.17, the `JsonRpcProvider` boot loop retries network detection every second and
  holds queued requests. Verified by reading `node_modules/ethers/lib.commonjs/providers/provider-jsonrpc.js`
  on 2026-09-28.
- `openapi.json` equals a fresh generation from `src/schemas.ts`. Verified by generating to a
  scratch file and running `diff` on 2026-09-28.
- The six ABIs match `contracts/out`, and `TbdBytecode.json` does not match (at 13 815
  differing hex positions). The `contracts/out` build from 2026-09-25 postdates the last
  contracts change (2026-09-14). Verified locally on 2026-09-28.
- `check-node-version-consistency.py` pins the nb-bond-api runtime base to
  `SANDBOX_NODE_IMAGE`. Verified by reading the script on 2026-09-28.
- The generator copies `values.local.example.yaml` to `values.local.yaml` only when missing,
  unless `--force`. The live file already differs from the example. Verified by reading the
  generator and diffing on 2026-09-28.

## Blocked / Waiting On

- Readiness-semantics decision, needed before Phase 3. Owner: sandbox operator.
- Approval for slim runtime image (4b), drift guards (6), and route extraction (7). Owner:
  sandbox operator.
- Go-ahead for the live mutations used as proof (parallel WNOK mints, parallel bid plus TBD
  mint, bank creation, optional Besu scale-down), and for the one-time `values.local.yaml`
  regeneration. Owner: sandbox operator.
- Sequencing with a separate hardening change (route role gates, `auth.ts`) and the
  ingestion correctness plan (`docs/plans/ingestion-projection-correctness/`, which covers
  `src/ingestion.ts` and database handle opening). Both edit
  `src/app.ts`, so land PRs one at a time and rebase.

## Follow-ups Found Along the Way

- Error responses are sent as `application/json` rather than `application/problem+json`,
  which differs from the documented RFC 7807 convention. Proposed handling: a separate small
  change coordinated with the nb-ui client.
- An `UNCONFIRMED` operation status would describe timed-out transactions more honestly than
  `FAILED`. It needs an `OperationStatus` enum change. Proposed handling: follow-up if
  timeouts are ever observed.
- `helm/templates/pvc.yaml` cites a `docs/KNOWN_ISSUES.md` entry ("bidders disappear on helm
  upgrade") that no longer exists. Proposed handling: fix the comment in the chart slice if
  the reviewer agrees, otherwise a docs sweep.
- The close-auction fallback retries with an explicit gas limit and so skips simulation. It
  was already recorded in `docs/plans/archive/backend-design-improvements-backlog.md`, and is
  not addressed here.
- Some pre-existing committed comments in `src/env-vars.ts`, `helm/values.yaml`,
  `README.md`, and `DEVELOPMENT.md` name the non-local deployment tooling. Proposed handling:
  a public-repo wording sweep, outside this plan.
- The ingestion provider (`src/ingestion.ts:41`) has no `staticNetwork` and no request
  timeout. It is handed to the ingestion correctness plan.

## Changes Since Planning (2026-09-28)

Changes merged after this plan was written (#300, #302, #304, #305).
Effects on this plan:

- `src/abi/TbdBytecode.json` was regenerated from a current `forge build` in #300, so the Phase 5
  bytecode refresh is done; keep only the optional Phase 6 drift guard.
- Route role gates for bond and auction mutations and the route-authorization suite landed in
  #305, so the Phase 7 prerequisite ("after the security change lands") is met. The redundant
  `app.use('/v1/banking', ...)` gate is still present and stays in Phase 5.
- The `testMode` descriptions in `src/contracts/{bonds,auctions}.ts` no longer name deployment
  tooling (#304); the names remain in `src/env-vars.ts` and `src/auth.ts` comments.
- `app.ts` line references in `design.md` predate these changes; re-check them in Phase 0.

## Session Handoff

- No code has changed. The plan was written against `development` at `db92409`.
- Scratch artifacts from verification (the regenerated OpenAPI) live outside the repo and are
  not needed to resume.
- A local `contracts/out` build exists (2026-09-25). Phase 0 step 6 rebuilds it anyway.
