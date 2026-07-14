# NB Application Architecture Improvements — Implementation Plan

**Status:** ✅ Implemented — core architecture increments shipped via #224; the projection and feature-contract follow-up is implemented in #225. Further feature slices remain intentionally incremental.
**Date:** 2026-07-13
**Owner / operator:** sandbox operator (this repo)
**Branch suggestion:** `imp/nb-application-architecture-improvements` — use separate PRs for the phases below rather than one large refactor PR.
**Components touched:** `services/nb-bond-api/`, `services/nb-ui/`, generated NB Bond API OpenAPI, and relevant documentation.
**Related:** `docs/plans/backend-design-improvements-backlog.md` owns the remaining backend backlog; `docs/plans/archive/sse-live-updates-plan.md` owns authenticated live-update transport and Azure streaming constraints.

## Decision Summary

Keep the solution as a **modular monolith** and improve its internal boundaries incrementally.

- Keep Express, React, SQLite, the in-process ingestion loop, and the in-process SSE broadcaster.
- Do not add microservices, a distributed event bus, Redux, React Router, a query library, an OpenAPI client generator, or a generic repository framework.
- Fix correctness and externally visible contract problems before moving files.
- Make the backend entry point construct dependencies and start the process; move HTTP composition into a testable app factory and business orchestration into feature services.
- Preserve the frontend's existing `page -> feature API -> HttpClient` network boundary.
- Move auction and integer-value calculations out of React components into pure domain modules using integer strings and `BigInt`.
- Treat chain-read failure explicitly. A required chain read must not silently remove a resource from a successful collection response.
- Keep Zod as the source of truth for validation, TypeScript DTO types, and OpenAPI, but split the current schema catalog by feature.
- Use the existing dependency set. HTTP contract tests can start an ephemeral Express listener and use the Node runtime's native `fetch`; no Supertest dependency is required.

## Goal

Improve the maintainability, correctness, and testability of the NB UI and NB Bond API without changing their sandbox deployment shape or building production-scale infrastructure.

The finished architecture should make it easy to answer these questions from the code structure:

1. Where is an HTTP request validated and authorized?
2. Where does the use case or business operation run?
3. Which chain/database capabilities does that operation require?
4. Which response and failure contract is exposed to the UI?
5. Which frontend code owns transport, server state, domain calculations, and presentation?

## Current-State Evidence

Verified on 2026-07-13:

- `services/nb-bond-api/src/index.ts` creates the process-wide infrastructure, configures Express, declares all routes, performs substantial business orchestration, emits live events, starts ingestion, and starts the listener.
- `services/nb-bond-api/src/schemas.ts` combines shared primitives, request/response schemas, exported DTO types, OpenAPI paths, tags, security, and document construction.
- Pure or focused backend modules already exist for allocation, parsing, authentication, HTTP responses, ingestion persistence, encryption, and health. `banks.ts` already demonstrates useful dependency injection through its chain-operations argument.
- `compose.ts` merges checkpoint-height SQLite data with live chain-head reads. Some broad chain-read failures return `null`; list composers filter those results, allowing resources to disappear from an otherwise successful `200` response.
- `http.ts` returns an unknown thrown error's message in the public `500` response body.
- Banking runtime authorization accepts recognized operator and tester roles, while current OpenAPI prose still says operator-only. UI copy/comments contain the same drift.
- API/UI version labels mix `/v1`, OpenAPI `2.0.0`, and v1/v2 prose.
- NB UI pages access the backend only through feature API modules and `HttpClient`; this boundary is intentional and should remain.
- `AuctionLifecyclePanel.jsx` mirrors backend allocation rules with JavaScript `Number`. Its marginal-rate calculation orders PRICE bids highest-first, while `autoFill()` currently orders every auction lowest-rate-first.
- `useApi()` sets `loading=true` for initial fetches and every revalidation, so an SSE-driven background refresh can replace already-rendered data with a loading state.
- The backend and frontend maintain separate copies of the SSE resource-key vocabulary, and callers can use raw strings.
- Backend module tests and frontend component tests are broad, but there is no direct HTTP contract suite around a dependency-injected Express application.

## Target Architecture

```text
NB UI
  page/controller hook
    -> pure domain helpers
    -> feature API module
      -> HttpClient (the only fetch/auth-header boundary)
        -> NB Bond API

NB Bond API
  index.ts (bootstrap only)
    -> createApp(dependencies)
      -> feature router (HTTP validation/auth/response mapping)
        -> feature service (use-case orchestration)
          -> chain gateway / projection DB / system-of-record DB / live events
```

The target is a dependency direction, not a demand for one file per box. Small features may keep route and service code together when the operation is already trivial.

## Guardrails

### Sandbox Scope

- Keep the in-process SSE broadcaster and document its single-replica delivery limit; do not add Redis or Azure Service Bus.
- Keep SQLite and the current ingestion process. Projection expansion is a separate incremental exercise, not a database replacement.
- Keep the hash router and local React state.
- Prefer a few explicit feature services over framework-like base classes, service locators, or generic CRUD repositories.
- Do not optimize live-read fan-out before measuring it at sandbox data volumes; fix ambiguous correctness semantics first.

### Public-Repository Safety

- Tests and docs use synthetic addresses, tenant placeholders, and fabricated error messages only.
- Never place Azure tenant IDs, client IDs, tokens, private endpoints, account identifiers, private keys, or real transaction data in code, fixtures, snapshots, logs, or documentation.
- Unknown `500` responses intentionally expose the thrown message for sandbox diagnostics. This is not a production-safe disclosure policy; do not include credentials or tokens in thrown messages.
- Generated OpenAPI is regenerated from source; never hand-edit `services/nb-bond-api/openapi.json`.
- No dependency manifest changes are expected. If implementation later requires one, stop and obtain explicit approval before adding it.

## Acceptance Criteria

| Area | Acceptance criterion |
|---|---|
| Auction correctness | RATE/BUYBACK and PRICE bid ordering have one pure frontend implementation, tested against backend-compatible vectors; PRICE auto-fill selects highest-rate bids first |
| Integer safety | Auction sizes, units, rates, and other `BigIntString` calculations avoid unsafe `Number` conversion; formatting-only conversion is documented and bounded |
| Read failures | A failed required chain read produces an explicit problem response, normally `503`, rather than a `200` collection with silently omitted resources |
| Error diagnostics | Unknown server errors return the thrown message in RFC 7807 `detail`, as an explicit sandbox-only diagnostic choice |
| Authorization contract | Runtime role checks, OpenAPI security/prose, frontend capability checks, and user-facing copy agree for banking, central-bank, admin, and SSE endpoints |
| Version contract | `/v1` is consistently described as the HTTP API version; application/release versioning is labelled separately or omitted from UI copy |
| Test seam | Tests can construct the Express app with controlled dependencies without starting ingestion or binding the configured production port |
| Route separation | Non-trivial route handlers validate/map HTTP and delegate orchestration to a feature service |
| Frontend refresh | Initial loading and background refreshing are distinct; live revalidation retains existing data and exposes refresh failure without blanking the page |
| Schema organization | Feature contract modules remain the source of Zod schemas and types; one OpenAPI aggregator produces the same complete document |
| SSE protocol | Resource keys are constants at both boundaries and the generated OpenAPI enum is verified against the frontend catalog |
| Dependencies | No new runtime or development package is introduced |

## Plan Order

```text
Phase 0  Baseline and contract inventory
Phase 1  Correctness and safe failure semantics
Phase 2  API and live-event contract alignment
Phase 3  Testable backend application boundary
Phase 4  Backend vertical-slice separation
Phase 5  Read consistency and request-level composition
Phase 6  Frontend server-state and component separation
Phase 7  Schema/OpenAPI modularization
Phase 8  Documentation, cleanup, and end-to-end verification
```

Each phase should be independently reviewable and leave all tests green. Do not combine Phases 3-7 into a sweeping directory rewrite.

## Implementation Progress

Implemented in the first architecture batch:

- BigInt-safe auction ordering, marginal clearing, auto-fill, formatting, and positive-integer validation; PRICE now selects highest-rate bids first.
- Explicit required-chain-read failures, plaintext sandbox `500` diagnostics, `503` mapping, and fail-closed bidder deletion when outstanding commitments cannot be verified.
- Banking-role/version/success-response/SSE-resource contract alignment, including a generated-OpenAPI cross-service test.
- Process/application separation: `src/index.ts` starts the process; `src/app.ts` constructs Express and accepts database dependencies for HTTP tests.
- Explicit database-bound banking service; the former mutable `setCreatedBanksDb(...)` module global is removed.
- Initial-loading versus background-refresh state in `useApi()`, retaining stale data and exposing `refreshError` during SSE/manual revalidation.
- Required bond core fields and auction allocations now fail the request explicitly when their chain reads reject instead of degrading to partial/null data.

Implemented in the follow-up architecture batch:

- Auction create/close/cancel/finalise orchestration moved to a directly tested
  feature service; Express retains validation, authorization, and response
  mapping.
- Bond and auction mutation responses use a bounded projection checkpoint wait
  through the mined receipt block. Timeout remains warning-only to avoid
  duplicate retries after a committed transaction.
- An explicit request-scoped compose context deduplicates contract handles and
  chain-wide reads. Ingested auction lifecycle status now comes from the event
  projection, with chain status only for chain-only fallback.
- Live pages show refreshing/refresh-failure state without discarding stale
  data, and the allocation-review modal is separated from lifecycle
  presentation.
- Shared primitives, internal bid payload validation, and operation-audit Zod
  contracts moved under `src/contracts/`; one central assembler still produces
  the complete OpenAPI document.
- Architecture, service, and backlog documentation reconciled with these
  semantics.

Additional feature services and projection fields should continue as bounded
follow-up slices when their handlers or mixed-source reads justify the extra
files; they are not required to validate the modular-monolith pattern.

## Phase 0 — Baseline And Contract Inventory

### Steps

1. Record clean test, lint, format, build/typecheck, OpenAPI regeneration, and public-repository hygiene baselines for both services.
2. Record the current modified working tree before implementation and avoid mixing the ongoing SSE work with unrelated architecture phases.
3. Create a route inventory containing method, path, request schema, success status, response schema, authentication middleware, allowed roles, cache/ETag policy, application operation, mutation resource keys, and required data sources.
4. Classify each composed DTO field as:
   - required chain state;
   - optional chain enrichment;
   - disposable projection state;
   - preserved local system-of-record state.
5. Capture shared auction-allocation test vectors covering RATE, BUYBACK, PRICE, ties, partial final fills, over-allocation, zero/invalid values, and values above `Number.MAX_SAFE_INTEGER`.
6. Confirm the Node runtime used by tests supports native `fetch`; use `http.request` if it does not rather than adding a dependency.

### Exit Criteria

- Current behavior and intended contracts are explicit, test baselines are green, and every phase below has a bounded file/route inventory.

## Phase 1 — Correctness And Safe Failure Semantics

### 1A. Frontend Auction And Integer Domain Helpers

Add focused pure modules such as:

- `services/nb-ui/src/domain/amounts.js`
- `services/nb-ui/src/domain/auctionAllocation.js`

Steps:

1. Parse API integer strings to `BigInt` for comparison, addition, capacity tracking, and allocation math.
2. Define one bid comparator: PRICE prefers higher rates; RATE and BUYBACK prefer lower rates; equal rates preserve the backend's documented tie-break rule.
3. Use that comparator for both auto-fill and marginal-clearing calculation.
4. Keep form input as strings until validation/submission. Reject fractional, negative, empty, or out-of-range values at the UI boundary without first coercing them through `Number`.
5. Retain `Number` only for bounded display concerns such as percentages or dates, with an explicit conversion point.
6. Test the shared vectors. Mirror them in backend allocation tests so rule changes fail in both suites.

### 1B. Explicit Chain-Read Failures

1. Introduce a small application error for an unavailable required dependency, mapped to RFC 7807 `503 Service Unavailable`.
2. Stop returning `null` for a top-level auction/bond solely because its required chain state could not be read.
3. Stop filtering dependency failures from collection results. A required failure rejects the request; a genuinely missing identifier remains `404`.
4. Keep best-effort enrichment nullable only where the route inventory marks it optional. Log that degradation with the resource identifier.
5. Add tests for missing resource, required RPC failure, optional enrichment failure, and mixed collection failure.

### 1C. Sandbox Unknown-Error Diagnostics

1. Return the thrown `Error.message` (or `String(thrownValue)`) in unknown `500` problem details so sandbox failures are directly observable.
2. Log the original error, stack, route, and method server-side using the existing logger. Do not log request authorization headers or bodies that may contain sensitive material.
3. Preserve deliberate `HttpError` details and field-validation errors.
4. Test both `Error` and non-`Error` thrown values. Treat this behavior as sandbox-only and never throw credentials or tokens.

### Exit Criteria

- The probable PRICE auto-fill defect is fixed, large integer cases are safe, missing resources cannot be confused with RPC failures, and unknown sandbox errors expose their thrown message.

## Phase 2 — API And Live-Event Contract Alignment

### Steps

1. Make the route inventory executable as focused contract tests where practical.
2. Correct banking documentation and UI copy to state that authenticated users with a recognized operator or tester role may access it; keep central-bank and admin operator-only.
3. Verify SSE remains available to any recognized authenticated Entra user while subsequent GET endpoints enforce their own roles.
4. Standardize version language:
   - `/v1` is the HTTP API version;
   - remove UI and comments that call the same route catalog both v1 and v2;
   - if `info.version` represents an application release rather than a route contract, label that distinction explicitly.
5. Replace direct success `res.status(...).json(...)` calls with a response helper that accepts the success status and cache policy. Verify `201`, `202`, `200`, ETag, and no-store behavior against OpenAPI.
6. Move the frontend resource vocabulary to a single constants/protocol module. Pages and hooks import constants rather than spelling resource strings.
7. Keep the backend `LIVE_RESOURCE_KEYS` catalog as the server source of truth and expose the same enum in the generated OpenAPI SSE schema.
8. Add a dependency-free test that loads the generated OpenAPI JSON and compares its live-resource enum with the frontend catalog. This is a contract check, not a runtime shared package.
9. Regenerate OpenAPI and verify there is no unrelated generated diff.

### Exit Criteria

- Runtime policy, UI capabilities/copy, OpenAPI, success statuses, caching, version terminology, and SSE resource names agree.

## Phase 3 — Testable Backend Application Boundary

### Target Files

- `services/nb-bond-api/src/app.ts`: `createApp(dependencies)` and middleware/route composition.
- `services/nb-bond-api/src/index.ts`: environment-driven dependency construction, ingestion lifecycle, signal handling, and `listen()` only.
- A small dependency type/module if `app.ts` would otherwise import process-wide singletons.

### Steps

1. Define the minimum application dependencies actually used by routes: databases, chain operations/gateways, operation recorder, live-event publisher, logger, and auth configuration.
2. Create `createApp(dependencies)` with no port binding and no ingestion startup.
3. Keep `index.ts` as the current executable entry so package scripts and container commands do not change.
4. Remove route-time dependence on the mutable `setCreatedBanksDb(...)` global by constructing a banking service with its database and chain dependencies.
5. Do not force every existing chain helper behind a new interface at once. Wrap/inject capabilities only when a route or service needs a deterministic test seam.
6. Add HTTP tests that bind the returned app to an ephemeral loopback port and use native runtime HTTP/fetch.
7. Cover representative public, authenticated, role-protected, validation-failure, success, not-found, `503`, and unknown-`500` paths.
8. Verify importing `app.ts` opens no listener, starts no timer/ingestion loop, and performs no chain call.

### Exit Criteria

- The HTTP application is testable without process startup; `index.ts` is a small composition root; runtime commands and deployment behavior remain unchanged.

## Phase 4 — Backend Vertical-Slice Separation

Implement one feature at a time, beginning with auctions because they currently contain the densest orchestration.

### Recommended Shape

```text
src/features/auctions/
  routes.ts       HTTP schemas, middleware, status/response mapping
  service.ts      create/close/cancel/finalise orchestration

src/features/bonds/
src/features/central-bank/
src/features/banking/
src/features/bidders/
src/features/admin/
```

This naming is illustrative; preserve existing names where moving a focused module would reduce clarity.

### Steps Per Feature

1. Characterize the existing route with tests before moving it.
2. Extract an explicit service operation with a typed input and result independent of Express `Request`/`Response`.
3. Inject only the chain, projection, system-of-record, operation-recording, and event-publication capabilities used by that operation.
4. Keep request parsing/Zod validation, authentication/authorization, and HTTP response mapping in the router.
5. Keep transaction orchestration, preconditions, receipt waiting, recomposition, audit recording, and notification policy in the service.
6. Preserve current endpoint paths and JSON shapes.
7. Complete auctions first, then bonds, central-bank/banking, bidders/registry, and admin/health/SSE.
8. Leave genuinely small read-only routes in the router when a separate service would merely rename one function call.

### Exit Criteria

- Non-trivial route handlers are short transport adapters, service operations have direct tests, and `index.ts` no longer owns feature behavior.

## Phase 5 — Read Consistency And Request-Level Composition

This phase coordinates with items 1 and 2 in `backend-design-improvements-backlog.md`; it must not create a competing projection strategy.

### 5A. Read-Your-Writes

1. After a successful mutation receipt, ensure the projection has ingested through the receipt block before composing a response that promises projected state.
2. Prefer one explicit synchronous ingestion-to-block operation or a bounded checkpoint wait over UI timing delays.
3. Publish projected SSE resource changes only after the projection commit remains visible, preserving the current readiness rule.
4. Remove remaining delayed UI refetch workarounds only after the relevant mutation response and SSE path are verified.

### 5B. Request Read Context

1. Create a request-scoped read context for values shared across a composition pass, such as latest block timestamp and resolved contract handles/state.
2. Reuse required reads across bond/auction composition rather than repeating identical calls.
3. Pass the context explicitly; do not introduce ambient request globals.
4. Add call-count tests for the few shared reads being deduplicated. Do not pursue a generalized cache.

### 5C. Projection-First Increment

1. Select one high-value, event-reproducible read family from backlog item 2, preferably auction lifecycle/status or bond supply/coupon counters.
2. Extend ingestion and projection schema while preserving the projection-purity rule.
3. Switch its composer fields to one checkpoint-consistent source.
4. Document any remaining chain-head fields and their consistency semantics.
5. Treat further read families as follow-up increments rather than expanding this PR indefinitely.

### Exit Criteria

- Mutation responses that promise updated projected state are fresh, repeated shared reads are bounded per request, and at least one important DTO slice no longer mixes checkpoint and chain-head state.

## Phase 6 — Frontend Server-State And Component Separation

### 6A. Stale-While-Revalidate Hook State

1. Evolve `useApi()` to expose `initialLoading` and `refreshing` while retaining a compatibility `loading` field during migration if useful.
2. Preserve the current data during reload/SSE reconciliation.
3. Keep a background refresh error visible without discarding successful stale data; initial failure still uses the full error state.
4. Ensure overlapping requests cannot let an older result replace a newer one. Use request generations and optionally `AbortSignal` where the existing API seam can accept it without broad churn.
5. Update live pages incrementally and test initial load, successful refresh, failed refresh with stale data, unmount, and rapid successive reloads.

### 6B. Split Only Large, Mixed-Responsibility Components

Start with `AuctionLifecyclePanel`, `AuctionDetailPage`, `BankingPage`, and `CentralBankPage`.

1. Move domain rules to pure domain modules, not hooks.
2. Move page-specific fetch/mutation coordination to a controller hook only when it materially shortens the component.
3. Extract substantial modal/table sections that have independent state or tests.
4. Keep small markup local; do not build a generic component framework.
5. Preserve existing feature API imports and keep all `fetch`/authorization logic in `HttpClient` and auth modules.

### 6C. HttpClient Responsibility Check

1. Keep actual network `fetch`, authorization headers, RFC 7807 conversion, and ETag cache behavior in `HttpClient` as required by the UI architecture guide.
2. Move pure SSE framing/resource validation into the live-update protocol module if it can be tested independently without creating a second fetch seam.
3. Defer resource-tagged mutation cache invalidation unless measurements show that clearing the small sandbox cache is a problem.

### Exit Criteria

- Live updates no longer blank loaded pages, stale refresh failures are intelligible, large components separate domain/orchestration/presentation concerns, and the single network seam remains intact.

## Phase 7 — Schema And OpenAPI Modularization

### Target Shape

```text
src/contracts/
  common.ts
  bonds.ts
  auctions.ts
  bidders.ts
  central-bank.ts
  banking.ts
  operations.ts
  live-events.ts

src/openapi/
  document.ts
  paths.ts (or feature-owned path fragments)
```

### Steps

1. Move common primitives first, then one feature's schemas/types at a time.
2. Keep request/response Zod schemas and their inferred TypeScript types together by feature.
3. Keep OpenAPI path registration close enough to the feature contract that status/security drift is obvious, while assembling one document centrally.
4. Move domain-only schemas used by encryption/allocation out of the transport/OpenAPI module so domain code does not depend on the full API document.
5. Preserve all exported contract names during migration where practical to keep diffs small.
6. Regenerate OpenAPI after each feature move and require semantic equivalence except for deliberate Phase 2 corrections.
7. Add a generated-document smoke test for unique operation IDs, declared security, response schema references, and resolvable component references.

### Exit Criteria

- No single schema file owns every feature and the OpenAPI document, while Zod remains the one contract source and generated output remains stable.

## Phase 8 — Documentation, Cleanup, And End-To-End Verification

### Steps

1. Update `docs/ARCHITECTURE.md` with the app/router/service/infrastructure boundary and frontend data-flow boundary.
2. Update service READMEs/DEVELOPMENT docs for the testable app factory, error semantics, authorization matrix, and read consistency model.
3. Reconcile completed items in `backend-design-improvements-backlog.md` rather than leaving duplicate active instructions.
4. Remove tracked compiled test artifacts only after confirming they are generated, unused by Jest, and covered by ignore rules. Keep this cleanup in its own mechanical commit.
5. Run full API/UI test, lint, format, build/typecheck, OpenAPI regeneration, public-repository hygiene, and markdown-link verification.
6. Run local end-to-end flows for:
   - RATE and PRICE auction auto-fill/finalisation preview;
   - missing resource versus stopped/unreachable chain;
   - operator and tester access to banking;
   - tester denial from central-bank/admin;
   - authenticated SSE plus background refresh retaining rendered data;
   - representative `200`, `201`, `202`, `304`, `400`, `401`, `403`, `404`, `503`, and generic `500` responses.
7. Perform deployed Entra/Azure smoke verification after the relevant phases reach the deployment repository. Reuse the SSE Azure handoff requirements; do not add deployment secrets or tenant-specific values here.

### Exit Criteria

- Architecture and runtime documentation match the code; checks are green; both local auth modes and deployed Entra behavior have explicit evidence; no secrets or environment-specific identifiers enter the repository.

## Recommended PR Slices

| PR | Scope | Why this boundary |
|---|---|---|
| 1 | Auction domain helpers, PRICE fix, integer safety tests | Small correctness change with no backend structure churn |
| 2 | Required-read `503`, plaintext sandbox `500`, API/role/version/response contract corrections | Externally visible semantics reviewed together |
| 3 | Live-resource protocol constants and OpenAPI contract check | Small cross-boundary drift prevention |
| 4 | `createApp(dependencies)` plus representative HTTP tests | Establishes the seam needed by subsequent refactors |
| 5 | Auction router/service vertical slice | Proves the target pattern on the hardest feature |
| 6 | Remaining feature route/service extraction in two or more bounded PRs | Avoids one high-conflict mechanical move |
| 7 | Read-your-writes, request read context, first projection-first increment | Consistency work after service boundaries are testable |
| 8 | `useApi` refresh state and selected component splits | Frontend behavior and organization, independently releasable |
| 9 | Feature schema/OpenAPI split | Mostly structural; easier to review after contract corrections |
| 10 | Docs reconciliation and generated-artifact cleanup | Keeps mechanical cleanup out of behavior diffs |

## Explicitly Out Of Scope

- A production multi-replica SSE fan-out mechanism.
- A separate backend-for-frontend, API gateway service, GraphQL layer, or microservice split.
- Replacing SQLite, Express, React, MSAL, Ethers, or the current ingestion model.
- A frontend state/query/router framework.
- Automatic OpenAPI client generation.
- A generic dependency-injection container, unit-of-work framework, or repository abstraction for every data source.
- Full projection of every contract state field in one change.
- Contract migrations, ERC-3643 work, settlement redesign, preflight simulation, bond-status redesign, and other independently tracked backlog items.
- Production observability platforms. Existing structured logging plus sandbox problem responses are sufficient for this plan.

## Residual Risks And Trade-Offs

- Returning `503` for a required chain read is more visibly disruptive than silently returning partial data, but it is honest and recoverable. The UI can retain stale data during revalidation.
- Waiting for ingestion on mutation responses increases response latency by up to the checkpoint catch-up bound. Bound and measure it; never wait indefinitely.
- Feature-service extraction temporarily creates more files. The benefit comes only if Express types stop at the router and infrastructure dependencies are explicit.
- Frontend and backend cannot literally import one shared protocol module without introducing packaging/build coupling. A generated-OpenAPI contract check is the simpler sandbox compromise.
- Schema splitting is conflict-prone while other API work is active. Schedule it after behavior changes and move one feature at a time.
- Projection-first reads are the long-term consistency improvement, but expanding the projection too broadly would dominate this architecture work. Land one proven slice, then reassess.

## Done Criteria

- All acceptance criteria pass.
- The backend has a testable app factory, a small bootstrap entry point, and feature services for non-trivial operations.
- Required dependency failures are explicit and safe; top-level resources do not silently disappear.
- Frontend allocation/integer rules are pure and tested; background reconciliation retains current data.
- Runtime authorization, OpenAPI, UI copy, response metadata, version terminology, and SSE resource catalogs agree.
- Zod/OpenAPI contracts are organized by feature without adding another source of truth.
- Documentation and the existing backend backlog are reconciled, validation is green, and no public-repository safety issue or new dependency is introduced.
