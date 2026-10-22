# nb-bond-api operational hardening — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

`services/nb-bond-api` stays correct and diagnosable when requests overlap, when the chain is
slow or down, and when the pod is restarted or upgraded. Concurrent operator actions that sign
with the same key no longer fail on nonce collisions. One stuck transaction no longer blocks
every later mutation. Clients get an honest status for every failure: a client mistake gets a
4xx, an unreachable chain gets a 503, an unknown route gets a JSON 404, and a transaction that
was broadcast but not confirmed says so instead of inviting a blind retry. The pod is no longer
restarted because Besu is down, is never run twice against the same SQLite volume, and picks
up configuration changes on `./nb-bond-api.sh start`. The runtime image stops shipping
another workspace's dependencies. The small leftovers from earlier reviews are cleaned up.

## Why This Change

A repository review on 2026-09-28 found these gaps, and this plan re-verified them against the
code and the running sandbox:

- Only the `BOND_ADMIN` key has a managed nonce. The Central Bank key, the bank TBD keys, the
  bidder keys, and created-bank keys rely on the ethers pending-nonce lookup. Two overlapping
  requests for the same key read the same nonce and one of them fails. The Nordea fixture key
  signs both bids and TBD Nordea mutations, so the collision can even cross features.
- The `BOND_ADMIN` nonce lock is held across `tx.wait()` with no timeout. One transaction that
  never confirms blocks every later admin mutation for as long as the process lives.
- Malformed JSON returns `500` and is logged as an unhandled error. An unknown route returns
  the Express HTML page. `RpcUnavailableError` is not mapped, so a chain outage shows up as a
  `500` (the open `docs/KNOWN_ISSUES.md` entry "nb-bond-api request-path chain reads bubble up
  as opaque 500s"). `500` responses and `/v1/health` `recentErrors` carry raw ethers messages
  that embed request and transaction payloads. In `entra` mode a `401` echoes the JWT
  library's validation text.
- On 2026-09-28 the live pod's readiness and liveness probes both timed out against
  `/v1/health` after a host restart. Liveness calls a chain-dependent endpoint, so a Besu
  outage can put the pod into a restart loop that cannot fix anything.
- The chart has the default `RollingUpdate` strategy on a `ReadWriteOnce` SQLite volume. An
  image upgrade briefly runs two pods, which means two ingestion loops and two nonce caches on
  the same key. It has no resource requests or limits, and no config checksum, so a
  ConfigMap-only change is never picked up.
- The runtime image copies the whole workspace `node_modules`, including the React and
  browser-auth packages that only nb-ui uses.
- `src/abi/TbdBytecode.json` was compiled before the QBFT and Osaka baseline, so banks created
  through the API deploy TBD code built by an older compiler, for an older EVM target, against
  older OpenZeppelin code than the fixture TBDs.

## Scope

### In Scope

1. A per-signer transaction sender, keyed by address, used by every signing path. It bounds
   confirmation with a timeout and returns an explicit "broadcast but unconfirmed" outcome.
   Bounded RPC request timeouts on the request-path provider.
2. Error envelope: body-parser errors keep their 4xx status. A JSON ProblemDetails 404
   fallback. Chain-unavailable and registry-resolution errors become `503`. `500` detail and
   health `recentErrors` are sanitised. A generic `401` detail in `entra` mode. Handled
   outcomes are no longer logged as "unhandled". `If-None-Match` handles weak tags, lists,
   and `*`. The related OpenAPI text changes and `openapi.json` is regenerated.
3. Probes and chart: a process-local `GET /livez` for liveness, a time-bounded `/v1/health`,
   `strategy: Recreate`, a guard against `replicaCount > 1`, resource requests and a memory
   limit, config and secret checksum annotations, `readOnlyRootFilesystem`, and chart defaults
   that actually reach existing sandboxes.
4. Dockerfile: runtime `node_modules` limited to nb-bond-api's production dependencies. The
   `touch` workaround removed by opening the writable database handle first. Stale comments
   fixed. An optional slim runtime base, which needs operator approval.
5. Cleanup: refresh the stale `TbdBytecode.json`, shared amount and address parsing,
   `createBidder` key-range validation, a transaction around the fixture-override migration,
   `.env.example` completeness, the stale gas-limit note, the misplaced RBAC comment, the
   redundant `/v1/banking` role gate, and a clarified legacy `REDEMPTION` operation type.
6. Optional drift guards: an OpenAPI snapshot test, and an ABI and bytecode sync check. Each
   needs operator approval.
7. Optional, later: extract route modules per feature from `src/app.ts`, following the
   auctions service precedent. This is a larger refactor and needs its own go-ahead.

### Out of Scope

- Items owned by a separate hardening change, including role gating on routes. This plan only moves one comment and removes one no-op
  duplicate gate.
- Ingestion, projection, history, and finalise-bid defects, and how ingestion opens its own
  database handle. These belong to the ingestion and projection correctness plan. This plan
  does not edit `src/ingestion.ts`.
- Contract source changes and redeployment.
- Content type `application/problem+json` on error responses. This is recorded as a
  follow-up.
- Running more than one API replica. This plan makes one replica an enforced rule rather than
  designing for more.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Two concurrent mutations signed by the same key (Central Bank, bank TBD, bidder, or `BOND_ADMIN`) get consecutive nonces and both succeed | Nonce collision (A9) | `tx-sender` unit test with a fake signer; live: two parallel `curl` WNOK mints both return 200 |
| A transaction that does not confirm within `NB_BOND_API_TX_WAIT_TIMEOUT_MS` releases the signer and returns an "unconfirmed" outcome carrying the hash (202 for bond and auction mutations, 504 ProblemDetails elsewhere). The next mutation proceeds | Global hang (A9) | Unit test with a never-confirming fake tx; error-middleware test |
| Malformed JSON gives 400, an oversized body gives 413, and neither logs "unhandled" | Wrong status (A10) | `app.test.ts` requests; log assertion |
| An unknown path returns a JSON ProblemDetails 404 | HTML 404 (A10) | `app.test.ts` |
| Chain unreachable on a request path gives 503 with a stable detail; the known-issue entry is closed | Opaque 500 (A10) | Middleware tests for `RpcUnavailableError`, `RegistryResolutionError`, ethers `NETWORK_ERROR`/`TIMEOUT`; `docs/KNOWN_ISSUES.md` diff |
| `500` detail and `recentErrors` contain no `transaction=`/`info=`/`request=` payload and no URL path or credentials | Payload leakage (A10) | Sanitiser unit tests with recorded ethers error shapes |
| An `entra` 401 for a bad token returns a generic detail | Validation-hint leak (A10) | `auth.test.ts` |
| `If-None-Match: W/"<md5>"`, `"a", "<md5>"`, and `*` each yield 304 on GET | Missed revalidation (A10) | `http.test.ts` |
| `/livez` answers 200 in under 50 ms with `RPC_URL` pointing at a closed port; `/v1/health` answers within its bound with `status: down` | Probe restart loop (A11) | Local `npm run dev` run against a dead RPC; chart renders liveness on `/livez` |
| Rendered chart has `strategy.type: Recreate`, resources, checksum annotations, and `readOnlyRootFilesystem: true`; `replicaCount: 2` fails to render | Double pod on one SQLite volume, silent config drift (A11) | `helm template` output; live `kubectl get deploy -o jsonpath` |
| Runtime `node_modules` has no `react`, `react-dom`, or nb-ui browser-auth package; the container starts without the `touch` in `CMD` | Image bloat, workaround (A14) | `docker run --rm <image> ls node_modules`; live start |
| `src/abi/TbdBytecode.json` equals `contracts/out/Tbd.sol/Tbd.json` `bytecode.object` from a current `forge build` | Created banks deploy outdated code | Local compare command in `plan.md` |
| `createBidder` with a zero or out-of-range key returns 400 | 500 on bad input | `bidders.test.ts` |
| Package gate, `forge build` (for the artifact), hygiene and link checks pass | Regression | CI plus local gate |

## Constraints

- Sandbox-sized and local-first. New settings are environment variables with safe defaults,
  so a non-local deployment can tune them without code changes.
- Public repo: no secrets, private identifiers, or home-directory paths. Fixture keys are
  referenced by file path only.
- No new npm packages. ethers already provides `FetchRequest`, `staticNetwork`, and
  `tx.wait(confirms, timeout)`.
- A new image tag, a new CI check, or a new verification script needs explicit operator
  approval (root `AGENTS.md`).

## Open Questions

- Whether a pod should report Ready while the chain is unreachable (see the `design.md`
  decision "Readiness semantics"). The recommendation is yes. The operator decides before
  Phase 3.
