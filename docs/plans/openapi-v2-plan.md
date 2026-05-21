# nb-bond-api OpenAPI v2 — implementation plan

**Status:** ✅ Implemented and shipped. No outstanding work items.
Retained as design rationale — production code in
`services/nb-bond-api/src/` and `services/nb-ui/src/api/` deep-links
into specific sections of this document (e.g. "See §3.7" for auth
modes, "§3.5–§3.6" for the caching protocol).

**Shipped via:** PR #105 (initial implementation, 2026-05-20),
followed by PR #107 (CreateAuctionModal RATE-default fix),
PR #108 (ingestion-DB idempotency precondition),
PR #109 (disabled RATE radio UX),
PR #111 (move into `docs/plans/`).

**Created:** 2026-05-20. **Completed:** 2026-05-21.

## 1. Goals

- Restate the public API around **resource trees** (Bond → Auctions → Bids/
  Allocations + Holders), not UI features. Backend shape stops following
  UI shape.
- Adopt OpenAPI best practices: `tags`, `operationId`, `securitySchemes`,
  `problem+json` errors, reusable components.
- Add caching primitives: `md5` per DTO, `ETag` per response, 304 on
  `If-None-Match`, mutations return the updated parent.
- One canonical DTO per entity. No `Summary` / `Output` / `Response`
  variants. No array-wrapper objects.
- Reorganize `schemas.ts` into regions of shared context.
- Update nb-ui to consume the bulky tree and slice it client-side.

## 2. Non-goals

- Streaming (SSE/WebSocket) for live bid feeds. Polling with ETag is the
  story for now; SSE is a future escape hatch.
- Real auth implementation. Declare `bearerAuth` in the spec so the
  contract is stated, but no enforcement change.
- Operator-selectable winners. Remains mock-only.
- Pagination on anything except `/history`.

## 3. Architecture decisions

### 3.1 Bulky resource tree, with granular GET aliases

`GET /v1/bonds` returns the full Bond[] tree. Each Bond carries its
auctions, each Auction carries its bids and allocation, each Bond
carries its holders. `GET /v1/bonds/{isin}` and
`GET /v1/auctions/{id}` exist for deep-linking and "refresh this one"
flows — they return the identical sub-DTO that would be nested in the
list response.

### 3.2 History stays separate

Bond and auction events grow unboundedly per block. Embedding them in
Bond would defeat ETag freshness. Keep `GET /v1/bonds/{isin}/history`
paginated and orthogonal to the resource tree.

### 3.3 Mutations return the updated parent

Every POST/PATCH/PUT/DELETE that changes state responds with the new
parent DTO (Bond or Auction). The UI swaps the cached object atomically
— no follow-up GET, no manual invalidation.

### 3.4 State transitions via standard verbs

- Close: `PATCH /v1/auctions/{id}` body `{ status: "closed" }`
  (only valid PATCH target today; enum extensible later)
- Cancel: `DELETE /v1/auctions/{id}` (soft-delete; auction stays
  on-chain with `status="cancelled"`)
- Finalise/reject: `PUT /v1/auctions/{id}/finalisation` body
  `{ allocationHash, approve }` (finalisation is a noun → PUT is fine)

No more `/close`, `/cancel`, `/create` action paths.

### 3.5 Caching protocol

- Server computes `md5` of canonical (key-sorted) JSON serialization of
  each cacheable DTO, embeds it in a `md5` field, and emits `ETag:
  "<root-md5>"` on the response.
- Client sends `If-None-Match: "<etag>"` on subsequent GETs. Server
  returns 304 + empty body when nothing changed.
- Per-DTO `md5` lets the UI skip re-rendering unchanged subtrees
  (`cached.auctions[i].md5 === fresh.auctions[i].md5`).
- `md5` is server-computed only; client never recomputes (avoids
  serialization-agreement bugs).

### 3.6 Errors: RFC 7807 problem+json

Every 4xx/5xx returns a `ProblemDetails` body. One shared schema and
shared `responses` components reused across operations.

### 3.7 Authentication: two modes, backend-enforced

The API supports two deployment modes, selected at startup via env var:

- **`none`** (default for the local sandbox) — backend accepts the
  Authorization header and ignores it. All requests pass.
- **`entra`** (production-style, configured by ArgoCD) — backend
  validates the bearer token as a JWT issued by Microsoft Entra ID
  (`aud`, `iss`, `exp`, signature against the tenant's JWKS).

The OpenAPI document **always** declares `bearerAuth` as the security
scheme on every operation; the `none` mode is a runtime override
mentioned in the scheme's description. This way the doc represents
the intended secure deployment and one spec serves both modes.

**Backend env vars** (added to `services/nb-bond-api/src/env-vars.ts`):
- `NB_BOND_API_AUTH_MODE` — `none` | `entra` (default `none`)
- When `entra`:
  - `NB_BOND_API_AUTH_ENTRA_TENANT_ID` — tenant GUID
  - `NB_BOND_API_AUTH_ENTRA_AUDIENCE` — expected `aud` claim (the
    bond-api's app-registration client ID)
  - Issuer auto-derived from tenant; JWKS fetched and cached.

**Frontend (nb-ui)** already has the abstraction in place:
- [services/nb-ui/src/auth/noneAuth.js](../../services/nb-ui/src/auth/noneAuth.js) returns no Authorization header
- [services/nb-ui/src/auth/entraAuth.js](../../services/nb-ui/src/auth/entraAuth.js) acquires a token (MSAL-style) and returns `Authorization: Bearer <token>`
- [services/nb-ui/src/api/httpClient.js](../../services/nb-ui/src/api/httpClient.js) already pulls auth headers per request

This means: SPA stays as-is, backend gains the validation layer.
Helm values (configured by ArgoCD) must keep the two ends in sync —
both `none` or both `entra`. Mismatches are a Helm-chart bug, not a
runtime fallback.

### 3.8 Cost/benefit on the caching protocol (you asked)

**Implementation cost** — one-shot, ~250–300 LOC:
| Where | What | LOC |
|---|---|---|
| Server | `computeMd5(dto)` canonical-JSON helper | ~15 |
| Server | ETag/If-None-Match middleware | ~30 |
| Server | `md5` field on cacheable DTOs (Bond, Auction, Bid, Allocation, HolderBalance) | ~10 |
| Client | ETag cache in `httpClient.js` (Map: path → {etag, body}) | ~50 |
| Client | Selectors slicing the bulky tree | ~20 |
| Tests | md5 stability + ETag/304 round-trip | ~40 |

**Runtime cost**: one md5 of the root DTO per response (~50KB JSON →
<1ms at sandbox scale). One header set/compare. Negligible.

**Benefits**:
- **304 short-circuit on polling**: when an operator stays on an
  open-auction page and the page polls every few seconds, the server
  returns 304 + empty body for most polls. Difference between "ship
  50KB every poll" and "ship ~200 bytes". Even at sandbox scale this
  is the difference between visible flicker and smooth refresh.
- **Per-DTO `md5` for partial re-renders**: UI can compare
  `cached.auctions[i].md5 === fresh.auctions[i].md5` and skip
  re-rendering unchanged subtrees. Cheaper than deep-equal checks.
- **Stable IDs for React keys**: `md5` doubles as a stable key,
  better than array indices.

**Cost of deferring**: adding caching to a UI that's used to "fetch
and replace" is a re-architecture (every fetch site changes), not an
addition. Every new DTO shipped without `md5` needs retrofit later.

**Maintenance**: once added, transparent. New DTOs need one `md5`
field. The only ongoing risk is canonical-JSON-serialization bugs,
but **md5 is server-computed only — client compares strings, never
recomputes** — so there's no agreement-bug surface.

**My recommendation**: add it now. Modest cost, real benefit
(smooth polling), easier than retrofitting, and the sandbox is a
reference implementation — showing caching done right is educational
value. The "complex for this simple UI" concern is bounded: pages
that don't care about caching just call the API and ignore the cache
underneath; only polling pages opt into ETag behavior explicitly.

If you later decide it's not worth it, ripping it out is one PR —
ETag is isolated to one middleware + one client module.

## 4. DTO catalog

### 4.1 Primitives (mostly unchanged)

| Name | Type | Notes |
|------|------|-------|
| `Address` | string, `^0x[a-fA-F0-9]{40}$` | Ethereum address |
| `HexString` | string, `^0x[a-fA-F0-9]+$` | arbitrary-length hex |
| `BigIntString` | string, `^[0-9]+$` | uint256 as decimal string |
| `Bps` | string, `^[0-9]+$` | bps (1e4 precision). **Renamed from `BpsString`** for brevity since every value of this type is a bps string. |
| `Isin` | string, `min(1)` | bond ISIN |
| `AuctionId` | string, `^0x[a-fA-F0-9]{64}$` | bytes32 |
| `AuctionType` | enum `"RATE" \| "PRICE" \| "BUYBACK"` | |
| `AuctionStatus` | enum `"open" \| "closed" \| "finalised" \| "rejected" \| "cancelled"` | |
| `BondStatus` | enum `"minting" \| "maturing" \| "matured" \| "redeemed" \| "unknown"` | |
| `BidState` | enum `"sealed" \| "unsealed"` | |

### 4.2 `Bond` — root resource

```ts
{
  isin: Isin
  status: BondStatus
  totalSupply: BigIntString | null
  contracts: {
    token: Address       // ERC20 bond token
    auction: Address     // BondAuction factory
    manager: Address     // BondManager
  }
  maturity: {
    duration: BigIntString | null   // seconds
    date: BigIntString | null       // unix seconds
    remaining: BigIntString | null  // seconds until maturity
  } | null
  coupon: {
    duration: BigIntString | null   // seconds between payments
    yieldBps: Bps | null            // APR
    payments: {
      total: BigIntString | null
      made: BigIntString | null
      remaining: BigIntString | null
    }
  } | null
  holders: HolderBalance[]
  auctions: Auction[]
  md5: string
}
```

Notes:
- `maturity` and `coupon` are nested per rule 8 (no more flat
  `couponDuration` / `couponYield` / `couponPaymentsTotal` etc.).
- `contracts` is nested so addresses aren't smeared across the top
  level.
- `md5` covers the entire Bond subtree (used for ETag).

### 4.3 `Auction` — sub-resource, also addressable at `/v1/auctions/{id}`

```ts
{
  id: AuctionId
  isin: Isin                       // denormalised for cross-reference
  type: AuctionType
  status: AuctionStatus
  end: BigIntString | null         // unix seconds
  size: BigIntString | null        // offering or buyback, in 1000-NOK units
  maturityDuration: BigIntString | null  // required for RATE
  owner: Address
  sealingPubKey: HexString
  contracts: { auction: Address, token: Address }
  bids: Bid[]                      // sealed during open, unsealed once closed
  allocation: Allocation | null    // set on close
  txs: {
    create:   TxRef
    close:    TxRef | null
    finalise: TxRef | null
    cancel:   TxRef | null
  }
  md5: string
}

type TxRef = { hash: HexString, block: number | null }
```

### 4.4 `Bid` — discriminated by `state`

```ts
{
  bidder: Address
  state: BidState
  // when sealed:
  ciphertext?: HexString
  plaintextHash?: HexString
  // when unsealed:
  rate?: Bps
  units?: BigIntString
  md5: string
}
```

Replaces both `SealedBid` and `UnsealedBid`. The discriminator is
`state`; OpenAPI emits a `oneOf` via `discriminator`.

### 4.5 `Allocation` — replaces both `Allocation` and `AllocationResult`

```ts
{
  clearingRate: Bps
  totalAllocated: BigIntString
  hash: HexString                 // renamed from `allocationHash` (parent is Allocation)
  auctionType: AuctionType
  computedAt: number              // unix ms
  entries: AllocationEntry[]
  md5: string
}

AllocationEntry {
  bidder: Address
  units: BigIntString
  rate: Bps
}
```

`AllocationEntry` has no `md5` — it's never cached independently of
its parent.

### 4.6 `HolderBalance`

```ts
{
  holder: Address
  balance: BigIntString
  md5: string
}
```

### 4.7 `HistoryEvent` — unified for auction and bond events

```ts
{
  isin: Isin
  auctionId: AuctionId | null     // null for bond-level events
  type: string                     // event name (e.g. "BidSubmitted", "CouponPaid")
  block: number
  txHash: HexString
  payload: unknown                 // event-specific opaque blob
}
```

Returned as `HistoryEvent[]` directly — no wrapper, no `bondEvents`
split. Type discriminates auction-scoped vs bond-scoped events.

### 4.8 `Health`

```ts
{
  status: "ok" | "degraded"
  contracts: {
    bondManager: Address
    bondAuction: Address
    bondToken: Address
  }
  sealingPubKey: HexString
}
```

### 4.9 `ProblemDetails` — RFC 7807

```ts
{
  type: string         // URI reference categorising the error
  title: string        // short summary
  status: number       // HTTP status
  detail?: string      // operator-readable detail
  instance?: string    // path that produced the error
  errors?: Array<{     // populated for validation failures
    field: string
    message: string
  }>
}
```

### 4.10 Request bodies (kept minimal, no `*Request` clutter)

- `CreateAuctionBody`: `{ type, end, size, maturityDuration? }`
- `CloseAuctionBody`: `{ status: "closed" }` (enum extensible later)
- `FinaliseBody`: `{ allocationHash, approve }`
- `CouponPaymentBody`: `{ holders?: Address[] }`
- `RedemptionBody`: `{ holders?: Address[] }`

These are the only request DTOs. Responses always reuse `Bond` /
`Auction` / `HistoryEvent[]`. (DELETE for cancel has no body.)

## 5. Endpoint catalog

### Tag `system`
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/health` | — | `Health` |

### Tag `bonds`
| Method | Path | Body | Response | OperationId |
|---|---|---|---|---|
| GET | `/v1/bonds` | — | `Bond[]` | `listBonds` |
| GET | `/v1/bonds/{isin}` | — | `Bond` | `getBond` |
| POST | `/v1/bonds/{isin}/coupon-payments` | `CouponPaymentBody` | `Bond` | `payCoupon` |
| POST | `/v1/bonds/{isin}/redemptions` | `RedemptionBody` | `Bond` | `redeem` |
| GET | `/v1/bonds/{isin}/history` (`?before=<block>&limit=N`) | — | `HistoryEvent[]` | `listBondHistory` |

### Tag `auctions`
| Method | Path | Body | Response | OperationId |
|---|---|---|---|---|
| GET | `/v1/auctions` | — | `Auction[]` | `listAuctions` |
| GET | `/v1/auctions/{id}` | — | `Auction` | `getAuction` |
| POST | `/v1/bonds/{isin}/auctions` | `CreateAuctionBody` | `Bond` | `createAuction` |
| PATCH | `/v1/auctions/{id}` | `CloseAuctionBody` | `Auction` | `closeAuction` |
| DELETE | `/v1/auctions/{id}` | — | `Auction` (status=cancelled) | `cancelAuction` |
| PUT | `/v1/auctions/{id}/finalisation` | `FinaliseBody` | `Auction` | `finaliseAuction` |

Both `listBonds` and `listAuctions` return **full trees** — each
`Bond` carries its `auctions[]` with bids and allocations; each
`Auction` (whether nested or top-level) carries the same DTO.
`listBonds` is the canonical "one call for everything" — the UI can
prime its cache off this single call and slice every page from it.
`listAuctions` exists for tooling/UIs that prefer the flat view; at
sandbox scale the duplicate payload is fine. The data is identical:
`listAuctions` ≡ `listBonds.flatMap(b => b.auctions)`.

### Removed (vs current spec)
| Old | Replaced by |
|---|---|
| `POST /v1/auctions/{id}/close` | `PATCH /v1/auctions/{id}` with `{status:"closed"}` |
| `POST /v1/auctions/{id}/cancel` | `PATCH /v1/auctions/{id}` with `{status:"cancelled"}` |
| `GET /v1/auctions/{id}/bids` | nested in `Auction.bids` |
| `GET /v1/auctions/{id}/allocations` | nested in `Auction.allocation` |
| `GET /v1/bonds/{isin}/holders` | nested in `Bond.holders` |
| `GET /v1/bonds/{isin}/auctions` | nested in `Bond.auctions` (and `listBonds` returns all) |

### Headers protocol (all routes)
- Request: `Authorization: Bearer <token>` (declared `bearerAuth`).
- GET requests: optional `If-None-Match: "<etag>"` → 304 if unchanged.
- All responses on success: `ETag: "<md5-of-root-dto>"` and
  `Cache-Control: no-cache, must-revalidate`.
- Mutation responses: include `ETag` of the new state.

### Error responses (shared `components.responses`)
| Status | When |
|---|---|
| 400 | Validation failure (`errors[]` populated) |
| 401 | Auth required / invalid |
| 404 | Resource missing |
| 409 | State conflict (e.g. close on already-closed) |
| 500 | Internal error |

All return `ProblemDetails`.

## 6. OpenAPI document structure

Top-level:
```yaml
openapi: 3.1.0
info:
  title: NB Bond Auction Service
  version: 2.0.0
  description: |
    Public API for the CBDC tokenization sandbox bond service.
    Sandbox-scale demo backing the nb-ui reference frontend.
  license: { name: Apache-2.0, url: https://www.apache.org/licenses/LICENSE-2.0 }
servers:
  - url: http://bond-api.cbdc-sandbox.local
    description: Local Kind sandbox
tags:
  - { name: system,   description: Service health }
  - { name: bonds,    description: Bond resources }
  - { name: auctions, description: Auction resources }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  responses:
    BadRequest:    { description: ..., content: application/json + ProblemDetails }
    Unauthorized:  { ... }
    NotFound:      { ... }
    Conflict:      { ... }
    InternalError: { ... }
  schemas: { ...all DTOs... }
security:
  - bearerAuth: []
paths: { ... }
```

`schemas.ts` reorganised into regions with `// #region` comments:

```
1. // #region Primitives        (Address, HexString, BigIntString, Bps, …)
2. // #region Enums              (AuctionType, AuctionStatus, BondStatus, BidState)
3. // #region Bond
4. // #region Auction
5. // #region Bid
6. // #region Allocation
7. // #region HistoryEvent
8. // #region Health
9. // #region ProblemDetails
10. // #region Request bodies
11. // #region Path parameters
12. // #region OpenAPI document  (paths + tags + servers + securitySchemes)
```

## 7. Implementation phases

### Phase 1 — schemas.ts rewrite
- Define new DTOs per §4, in region order per §6.
- Configure `zod-openapi` to suppress the `*Output` duplicates: either
  use `outputAlways: false` or restructure schemas so input and output
  Zod schemas are identical (drop `.transform()` chains in shared
  schemas).
- Add `md5: z.string()` to every cacheable DTO.
- Drop dead `bidsQuerySchema` / `auctionsQuerySchema`.
- Add `tags`, `operationId`, `security`, shared `responses`,
  `ProblemDetails`.

### Phase 2 — index.ts handlers
- New routes per §5.
- `computeMd5(dto)` helper: canonical key-sorted JSON → md5 hex.
- ETag middleware: hash root DTO → set `ETag`; if request has
  `If-None-Match` matching, short-circuit to 304.
- ProblemDetails error helper.
- Replace per-resource handlers with bulky composers:
  `composeBond(isin)` builds the full Bond by joining chain state +
  ingestion DB.
- Mutation handlers return the recomposed parent.

### Phase 3 — regen + tests
- `npm run regen:openapi` → fresh `openapi.json`.
- Update existing tests under `services/nb-bond-api/tests/`.
- New tests: md5 stability (same DTO → same hash; field reorder →
  same hash), ETag/304 round-trip, ProblemDetails schema match.

### Phase 4 — nb-ui client
- `httpClient.js`: add an ETag cache (Map: `path → { etag, body }`).
  On GET, send `If-None-Match` from cache; on 304, return cached body;
  on 200, update cache.
- `bondsApi.js`, `auctionsApi.js`: collapse around `listBonds` / `getBond` /
  `getAuction`. Delete `getBondHolders`, `getAuctionBids`,
  `getAuctionAllocations`, `listAuctionsForBond`.
- New selectors (e.g. in `src/api/selectors.js`):
  `selectBond(state, isin)`, `selectAuction(state, isin, auctionId)`,
  `selectBids(state, isin, auctionId)`, etc. Pages call selectors,
  not endpoints.
- Mutation responses replace the cached parent in one swap.

### Phase 5 — mockClient alignment
- Mock returns the new bulky shapes.
- Mock keeps the `winners` mock-only extension on `FinaliseBody`, but
  the real path strips it.

### Phase 6 — docs
- `services/nb-bond-api/README.md`: new endpoint table, caching
  protocol.
- `services/nb-ui/DEVELOPMENT.md`: cache-first pattern note.
- `docs/ARCHITECTURE.md`: short paragraph on the bulky-tree decision.

### Out of scope (deliberately)
- SSE/WebSocket
- Real auth enforcement
- Operator-selectable winners (mock only)
- Pagination beyond `/history`

## 8. Risks & migration notes

- **Breaking change for the UI** — accepted; UI and API ship in the
  same branch.
- **CLI consumers under `scripts/`** — ✅ audited during PR #105.
  `grep -rn "/v1/auctions\|/v1/bonds" scripts/` returned no HTTP
  callers; the bid CLIs (`scripts/bid-encryption`, `scripts/bid-submitter`)
  talk to the chain directly via ethers / JSON-RPC, not to the
  operator service. No `scripts/` changes required.
- **Bulky payload size** — at sandbox scale (~10 bonds × ~5 auctions ×
  ~20 bids) ≈ 50KB worst case. Acceptable.
- **md5 agreement** — server-computed only. Client compares strings,
  never recomputes.
- **zod-openapi `*Output` duplicates** — known library behavior when
  input/output Zod schemas differ. Two options: avoid `.transform()`
  in shared schemas (preferred), or post-process the generated JSON
  to drop `*Output` schemas not referenced anywhere.

## 9. Verification

- `npm run test` (nb-bond-api, nb-ui).
- `npm run regen:openapi` and confirm `openapi.json` parses.
- Live: `curl http://bond-api.cbdc-sandbox.local/v1/bonds | jq` shows
  the full tree.
- Live: second `curl ... -H 'If-None-Match: "<etag>"'` returns 304.
- UI smoke: load `/bonds`, navigate to a bond detail, navigate to an
  auction, mutate (cancel/close/finalise) — observe one bulky fetch
  on initial load, no fetches on cached navigations, single fetch on
  mutation.

## 10. Open questions for the operator

### Resolved (2026-05-20 review)
1. ✅ Rename `BpsString` → `Bps`. (Accepted with §3 batch.)
3. ✅ `md5` on cacheable parents only (Bond, Auction, Bid, Allocation,
   HolderBalance). Nested helpers (AllocationEntry, TxRef,
   coupon.payments, maturity) skip md5.
4. ✅ Backend supports **both** `none` and `entra` auth modes,
   selected by env var. OpenAPI always declares `bearerAuth`; runtime
   chooses enforcement. See §3.7.
5. ✅ `Bond.contracts` nested.
6. ✅ `txs` on Auction: latest-only per action.
8. ✅ Both `listBonds` and `listAuctions` return full trees. UI can
   pick one as primary cache.
   License → Apache-2.0 (fixed).
   Caching protocol → keep, per §3.8 cost/benefit.

### Resolved (continued)
2. ✅ PATCH body is `{ status: "closed" }` (REST-idiomatic state assignment).
7. ⏸ ~~`HistoryEvent.payload: unknown` — type-narrow per event type via
   `oneOf` discriminator?~~ **Deferred (not pending).** Payloads vary
   widely and the UI treats them opaquely; the `unknown` shape is
   sufficient for current and foreseeable needs. Revisit only if a
   future consumer needs typed payload access — at that point this
   becomes a fresh ticket, not leftover work from this plan.
9. ✅ DELETE for cancel, PATCH for close. Two separate verbs for two
   semantically different actions.
