# Bidders + Central Bank Pages — Implementation Plan

**Status:** Implemented — backend (Phase 1a–1e), chart/fixture wiring (Phase 2), and frontend (Phase 3a–3d) all shipped and verified on the local sandbox. Frontend feature tests added (Phase 3e). Documentation updates landed (Phase 6).
**Branch:** `feature/nb-ui-bidders-and-central-bank`
**Components:** `services/nb-bond-api/` (new resources, new DB table, new env var, no contract change), `services/nb-ui/` (two new pages + bid modal entry from auction detail), `scripts/generate-local-sandbox-fixtures.mjs` (no change — existing roster is reused).

## Goal

Give the sandbox operator browser-driven control over two missing surfaces of the bond lifecycle:

1. **Bidders page** at `#/bidders` — manage a roster of impersonable bidders. The operator can list bidders, add a new bidder (generate a fresh secp256k1 keypair, or import an existing private key), remove a bidder (hard-blocked while they have unrevealed bids on an open auction), and place a sealed bid on their behalf against any auction in `BIDDING` phase. The same "Place bid" modal is also reachable from `AuctionDetailPage` so the operator can drive the flow from either side.
2. **Central Bank page** at `#/central-bank` — manage the Norges Bank operator (`0xf4E18004902a34499bB6E5b23ff4CD99a864Dcd0`) WNOK surface: view the current Wnok allowlist, add / remove addresses, mint, burn, and transfer WNOK from the CB account to any allowlisted holder.

Both pages run end-to-end against the local sandbox after `./sandbox.sh start` and use the existing fixture-derived keys. Both ship with a visible "sandbox-only — private keys are stored in plaintext, never deploy against real money" banner. No on-chain bidder allowlist is introduced; the contract surface is unchanged.

## Current-State Evidence

What was inspected and what was actually verified in this session.

- **Docs read:**
  - Root `AGENTS.md` — operating principles, change hygiene, dependency policy (any new dep needs operator approval), licensing guardrails (Apache-2.0), flag-documentation banner rule.
  - `README.md` — sandbox lifecycle, `*.cbdc-sandbox.local` hostname pattern, `DEPLOY_*` flag surface.
  - `docs/ARCHITECTURE.md` — component diagram, NB UI / NB Bond API trust boundaries, bulky-resource-tree contract.
  - `docs/KNOWN_ISSUES.md` — confirms the `reopenAuction` precedent for "frontend action with no backend yet" and the operator-selectable-winners gap.
  - `docs/DOCUMENTATION_INDEX.md` — links to existing plan documents and per-area READMEs.
  - `docs/plans/nb-ui-frontend-plan.md`, `docs/plans/openapi-v2-plan.md` — current plan-document style and the API-shape conventions (bulky tree, RFC 7807 errors, ETag/md5 caching, dual auth modes).
  - `services/AGENTS.md`, `services/nb-ui/AGENTS.md`, `services/nb-bond-api/README.md`, `services/nb-bond-api/DEVELOPMENT.md`, `contracts/AGENTS.md` — area-specific conventions.
- **Repo declarations inspected:**
  - `services/nb-bond-api/src/index.ts` — full v2 route catalog confirmed; no `/v1/bidders` or `/v1/central-bank` paths exist today.
  - `services/nb-bond-api/src/schemas.ts` — Zod-OpenAPI is the single source of truth; new DTOs and routes are added there.
  - `services/nb-bond-api/src/compose.ts` — `withMd5` stamping pattern used by every cacheable DTO; new DTOs follow the same shape.
  - `services/nb-bond-api/src/chain.ts` — `getBondManager` / `getBondAuction` / `getBondToken` pattern via `GlobalRegistry.tryGetContract(name)`; we'll add `getWnok` keyed off env var `WNOK_CONTRACT_NAME` (default `"Wholesale NOK"`).
  - `services/nb-bond-api/src/keys.ts` — secp256k1 keypair pattern (generate + env-import) reused for per-bidder keys.
  - `services/nb-bond-api/src/encryption.ts` — `encryptBid` accepts `auctioneerPubKey` + `bidderPubKey`; same secp256k1 key serves both signing and encryption.
  - `services/nb-bond-api/src/ingestion-db.ts` — current schema is v2; new `bidders` table is additive (does **not** bump `SCHEMA_VERSION` because it's a system-of-record table, not a chain projection — see §"Decisions" below).
  - `services/nb-bond-api/src/env-vars.ts` — Zod-validated env surface; new `CENTRAL_BANK_PK` + `WNOK_CONTRACT_NAME` vars plug in here.
  - `services/nb-bond-api/.env.example`, `services/nb-bond-api/helm/values.local.example.yaml` — env / values surfaces for the new keys.
  - `contracts/src/norges-bank/BondAuction.sol` — bid intent typehash `BidIntent(address bidder, bytes32 auctionId, bytes32 plaintextHash, uint256 bidderNonce)`, EIP-712 domain `("BondAuctionBid", "1")`. `submitBid()` takes `(bytes32 _id, bytes _ciphertext, bytes32 _plaintextHash)`; **no `cancelBid` exists** — bid removal is intentionally not in scope.
  - `contracts/src/norges-bank/Wnok.sol` — `mint(address, uint256)` (MINTER_ROLE), `burn(address, uint256)` (BURNER_ROLE), `transfer(address, uint256)` (allowlist-gated), `transferFrom(...)` (TRANSFER_FROM_ROLE), `add(address)` / `remove(address)` allowlist (ALLOWLIST_ADMIN_ROLE via parent `Allowlist`).
  - `contracts/script/norges-bank/03_Wnok.s.sol` — confirms `PK_NORGES_BANK` is the WNOK admin (gets `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `BURNER_ROLE`, `ALLOWLIST_ADMIN_ROLE`). WNOK is registered in `GlobalRegistry` under name `"Wholesale NOK"`.
  - `scripts/generate-local-sandbox-fixtures.mjs` — deterministic roster lines 40–62 includes `PK_NORDEA`, `PK_DNB`, `PK_ALICE_TBD` for bidders and `PK_NORGES_BANK` for the central bank. The script already builds `scripts/bid-submitter/examples/bids.keys.json` with `{ privateKey, sealPrivateKey, sealPublicKey }` per bidder — we will **not** reuse `sealPrivateKey`; the per-bidder ethereum private key alone is enough (same curve, same key serves signing + encryption).
  - `services/nb-ui/src/App.jsx`, `useRoute.js`, `Layout.jsx`, `api/{bondsApi,auctionsApi,httpClient,selectors}.js`, `hooks/useApi.js`, `components/ui.jsx`, `pages/CreateAuctionModal.jsx`, `pages/AuctionDetailPage.jsx`, `pages/BondsPage.jsx` — the established UI structure that the two new pages mirror.
- **Live local checks (sandbox up, verified 2026-05-21):**
  - `kind get clusters` → `cluster-cbdc-monoledger`. `kubectl config current-context` → `kind-cluster-cbdc-monoledger`.
  - `docker ps --filter name=kind-registry` → `kind-registry Up 2 hours`.
  - `helm list -A` → `besu`, `blockscout`, `gateway`, `nb-bond-api`, `nb-ui`, `ngf` all `deployed` (revisions current).
  - `curl http://bond-api.cbdc-sandbox.local/v1/health` → `{ status: "ok", contracts: { bondManager: 0xe61a…4eB97, bondAuction: 0xcd15…EDB9b, bondToken: 0x290c…9563 }, sealingPubKey: 0x02bb…71ea }`.
  - `curl -sI http://web.cbdc-sandbox.local/` → `HTTP/1.1 200 OK` from nginx.
  - JSON-RPC at `http://besu.cbdc-sandbox.local/` returns 404 from nginx (the gateway route serves a specific path, not the root); not a blocker — the API talks to Besu via cluster-internal service DNS and `/v1/health` confirms the chain pipeline is live.
- **Blocked or unverified checks:** Wnok contract address is not yet exposed by `/v1/health`. We will resolve it in Phase 1 via `GlobalRegistry.tryGetContract("Wholesale NOK")` and add it to the health payload (additive, backwards-compatible).

## Scope

### In Scope

- New `bidders` table in the nb-bond-api SQLite DB. First-boot seed from `scripts/generate-local-sandbox-fixtures.mjs` roster: Nordea (`PK_NORDEA`), DNB (`PK_DNB`), Alice.tbd (`PK_ALICE_TBD`).
- New nb-bond-api endpoints:
  - `GET /v1/bidders` → `BidderDTO[]`
  - `POST /v1/bidders` → `BidderDTO` (body: `{ name, privateKey? }` — generate if absent)
  - `DELETE /v1/bidders/{address}` → 204 (409 with explicit `affectedAuctions` array if the bidder has unrevealed bids on any auction in `BIDDING` phase)
  - `POST /v1/bidders/{address}/bids` → `BidDTO` (body: `{ auctionId, units, rate? }` — server builds plaintext, signs EIP-712 bid intent, dual-wraps with auctioneer sealing key + bidder pubkey, calls `BondAuction.submitBid` from the bidder's account)
  - `GET /v1/central-bank/allowlist` → `AllowlistEntryDTO[]`
  - `PUT /v1/central-bank/allowlist/{address}` → 204
  - `DELETE /v1/central-bank/allowlist/{address}` → 204
  - `POST /v1/central-bank/wnok/mint` → `TransactionDTO` (body: `{ to, amount }`)
  - `POST /v1/central-bank/wnok/burn` → `TransactionDTO` (body: `{ from, amount }`)
  - `POST /v1/central-bank/wnok/transfer` → `TransactionDTO` (body: `{ from?, to, amount }`; defaults `from = CB address`)
  - `GET /v1/central-bank` → `CentralBankDTO` (address, balance, `wnok` contract address, recent on-chain activity summary) — optional convenience for the dashboard header.
  - `GET /v1/health` is extended with `contracts.wnok` (additive).
- New nb-bond-api env vars:
  - `CENTRAL_BANK_PK` (required when `DEPLOY_NB_BOND_API_CENTRAL_BANK=true`, defaults to the `PK_NORGES_BANK` fixture in `helm/values.local.yaml` via the fixture generator).
  - `WNOK_CONTRACT_NAME` (default `"Wholesale NOK"` — matches `contracts/.env.example`).
- New nb-bond-api modules:
  - `src/bidders.ts` — DB-backed bidder repository (seed, list, create, delete, lookup).
  - `src/bidder-bid.ts` — server-side bid construction (plaintext build, EIP-712 sign, dual-wrap, submit).
  - `src/central-bank.ts` — Wnok contract helpers via a CB-keyed wallet.
- New nb-ui pages and supporting code:
  - `src/pages/BiddersPage.jsx`, `src/pages/AddBidderModal.jsx`, `src/pages/PlaceBidModal.jsx`.
  - `src/pages/CentralBankPage.jsx`, `src/pages/AllowlistEditorModal.jsx`, `src/pages/MintWnokModal.jsx`, `src/pages/BurnWnokModal.jsx`, `src/pages/TransferWnokModal.jsx`.
  - `src/api/biddersApi.js`, `src/api/centralBankApi.js` — new resource APIs following the `bondsApi.js` / `auctionsApi.js` pattern, with mock-mode parity in `mockClient.js`.
  - `src/hooks/useRoute.js` extended with `bidders` and `central-bank` routes.
  - `src/components/Layout.jsx` nav extended with the two new entries.
  - `src/pages/AuctionDetailPage.jsx` gets a "Place bid" entry point that opens `PlaceBidModal` pre-filled with the auction.
  - Visible `SandboxOnlyBanner` reused on both pages (new component under `src/components/ui.jsx` or its own file).
- Test surface:
  - nb-bond-api: jest unit tests for `bidders.ts` (seed idempotency, list, create-with-import, create-generated, delete-blocked-when-active-bids), `bidder-bid.ts` (plaintext shape, EIP-712 sign matches contract recovery, dual-wrap round-trip with auctioneer key decrypts), `central-bank.ts` (mint / burn / transfer / allowlist add / remove call signatures and propagate errors).
  - nb-ui: vitest + Testing Library feature tests for both pages using `mockClient.js` — mirrors the existing test style (real mock client + rendered components).
- Docs: per-component updates in `services/nb-bond-api/README.md` + `DEVELOPMENT.md`, `services/nb-ui/README.md` + `DEVELOPMENT.md`, `docs/ARCHITECTURE.md` (component diagram + trust-boundary note), `docs/DOCUMENTATION_INDEX.md` entry for this plan, `docs/KNOWN_ISSUES.md` entry for "no cancelBid in v1".

### Out Of Scope

- **On-chain bidder allowlist.** `BondAuction.sol` is unchanged; anyone can call `submitBid()` in `BIDDING` phase, gated only by WNOK allowlist at settlement.
- **`cancelBid()` contract function.** No bid removal in v1. Sealed bids are final once submitted, per the existing contract semantics. Documented as a known limitation.
- **Per-bidder key rotation.** No rotate endpoint, no rotate UI. If a bidder's key is compromised in the sandbox, delete and recreate.
- **Auctioneer sealing-key rotation.** Unchanged from current `keys.ts` behavior.
- **Brand-new-bidder ETH gas auto-funding.** Fixture-seeded bidders are pre-funded from genesis; brand-new addresses added via `POST /v1/bidders` may need gas top-up via Besu RPC — flagged in the UI (`ethBalance` is part of `BidderDTO`) but not auto-funded by the API. The operator handles gas via the script-runner notebook environment, the CB transfer flow (for WNOK only), or a separate sandbox helper.
- **Pause / unpause** on WNOK (the contract has no pause function — verified).
- **Role grants / revokes** on WNOK (the dashboard reads who holds which roles for diagnostics, but does not surface a grant UI in v1).
- **Reopen auction.** Already tracked separately in `docs/KNOWN_ISSUES.md`.
- **Promotion of these pages to a non-local deployment.** Plaintext private keys in the DB make this strictly sandbox-only; portability flags are listed below.

## Folder And File Placement

| Item | Path | Rationale |
|---|---|---|
| Bidders DB module | `services/nb-bond-api/src/bidders.ts` | Mirrors the `keys.ts` + `ingestion-db.ts` separation (key handling vs DB). |
| Bid construction module | `services/nb-bond-api/src/bidder-bid.ts` | Keeps server-side bid signing/encryption isolated from the existing `bid.ts` (which is unseal/decrypt only). |
| Central Bank module | `services/nb-bond-api/src/central-bank.ts` | Pairs with `chain.ts` but uses the CB wallet rather than the `BOND_ADMIN` wallet. |
| Bidders page | `services/nb-ui/src/pages/BiddersPage.jsx` | Same folder as `BondsPage.jsx` / `AuctionsPage.jsx`. |
| Central Bank page | `services/nb-ui/src/pages/CentralBankPage.jsx` | Same folder. |
| Sandbox banner component | `services/nb-ui/src/components/ui.jsx` (extend) or `src/components/SandboxOnlyBanner.jsx` | Reused across both pages; small enough to live in `ui.jsx`. |
| API surface (UI) | `services/nb-ui/src/api/biddersApi.js`, `services/nb-ui/src/api/centralBankApi.js` | Same naming as `bondsApi.js` / `auctionsApi.js`. |
| Plan doc (this file) | `docs/plans/bidders-and-central-bank-plan.md` | Same convention as `docs/plans/nb-ui-frontend-plan.md`, `docs/plans/openapi-v2-plan.md`. |
| Index entry | `docs/DOCUMENTATION_INDEX.md` | Required by root `AGENTS.md`. |

No new top-level folder. No new chart. No new image pin. No new chart-version pin.

## Decisions And Open Questions

| Decision | Options | Chosen | Rationale |
|---|---|---|---|
| Bidder list ownership | On-chain allowlist vs off-chain DB | **Off-chain DB** | `BondAuction.sol` has no bidder allowlist; adding one is a contract change. The DB list models the "KYC'd primary dealer" register without coupling to chain state. Operator already agreed. |
| Per-bidder keys | One secp256k1 keypair vs separate signing + encryption keys | **One keypair** | Same curve serves both EIP-712 signing and the dual-wrap encryption (`encryption.ts` already takes a 33-byte compressed pubkey). Halves storage + matches the operator's stated preference. The existing fixture's `sealPrivateKey` field is ignored on seed. |
| Bidder seed source | None (empty until UI add) vs seed from fixtures vs ship a static JSON | **Seed from fixtures** | The fixture generator is the only sandbox-safe key source. Seeding Nordea / DNB / Alice.tbd on first boot makes the page feel populated and aligns addresses with the rest of the stack (`scripts/bid-submitter/examples/bids.keys.json`, deploy scripts). Operator agreed. |
| Page count | Combined "Operator console" vs separate Bidders + Central Bank routes | **Two pages, two routes** | `#/bidders` and `#/central-bank` are different mental models (per-actor vs CB ops). Operator agreed. |
| Bid removal | Skip vs add `cancelBid()` to contract | **Skip in v1** | Contract has no cancellation primitive. Operator agreed; flagged in `docs/KNOWN_ISSUES.md`. |
| Schema versioning | Bump `SCHEMA_VERSION` to v3 vs additive `CREATE TABLE IF NOT EXISTS` only | **Additive only** | `migrateToCurrentVersion` drops the projection on version bump (correct for chain projection, **wrong** for a system-of-record table like `bidders`). The `bidders` table is created additively via `CREATE TABLE IF NOT EXISTS bidders ...` inside `createTables`; no version bump is needed because no existing table changes shape. The drop migration is unchanged. (If we ever need a destructive `bidders` migration, that's a separate small plan.) |
| Where the bidders DB lives | Same `data/ingestion.sqlite` file vs a second SQLite file | **Same file** | One mounted `emptyDir` already exists; adding a sibling file complicates Helm + cleanup. The `bidders` table is namespaced clearly and the drop-migration explicitly preserves it (see migration update below). |
| Central Bank key source | Reuse `BOND_ADMIN_PK` vs new `CENTRAL_BANK_PK` env var | **New env var** | `BOND_ADMIN_PK` (= `PK_BOND_ADMIN`) has `BOND_ADMIN_ROLE` on `BondManager`, not the WNOK admin roles. The WNOK admin is `PK_NORGES_BANK`. Mixing roles in one signer would also obscure the trust boundary in the API logs. |

### Decision That Touches Existing Migration Code

The existing `migrateToCurrentVersion` in `ingestion-db.ts` drops **every** ingestion table on version bump because they are all chain projections. The new `bidders` table is a system of record. The plan amends the drop list to explicitly **exclude** `bidders`:

```sql
-- migrateToCurrentVersion (after change):
DROP TABLE IF EXISTS ingestion_state;
DROP TABLE IF EXISTS auctions;
DROP TABLE IF EXISTS auction_events;
DROP TABLE IF EXISTS partitions;
DROP TABLE IF EXISTS balances;
DROP TABLE IF EXISTS balance_events;
DROP TABLE IF EXISTS bond_events;
-- NB: do NOT drop `bidders` here — it is a system-of-record table, not a chain projection.
PRAGMA user_version = <new>;
```

This is the only edit to existing migration logic. The doc comment above the function is updated to call this distinction out.

## Portability Flags

These are local-acceptable choices that would block a future non-local deployment if not addressed later. Surfaced so the operator knows the cost — not solved in this plan.

- **Plaintext private keys in the DB.** Make these pages fundamentally unsafe outside the sandbox. A non-local deployment must replace the DB-backed roster with a signing service (KMS / HSM) and remove `privateKey` from `BidderDTO`. The sandbox banner is the user-visible warning; the architecture doc gets a trust-boundary update.
- **Server-side EIP-712 signing.** Same family — signing on the server requires the server to hold the key. Acceptable for a sandbox impersonation flow; unacceptable for a real bidder workflow where the bidder signs locally.
- **`CENTRAL_BANK_PK` env-var-injected.** Fine for local fixtures; in a real deployment the CB key would come from KMS, not env.
- **No rate limit on `POST /v1/bidders/{address}/bids` beyond the existing 300/min global limiter.** Sandbox-level fine; production bid throughput would warrant per-bidder limits.
- **Bidders DB is a `emptyDir` mount in Helm.** Pod restart loses the table (which then re-seeds from fixtures on first boot, so the three seeded bidders come back). Operator-added bidders do **not** survive a pod restart. This is acceptable for the sandbox; a real deployment needs a PVC.

## Acceptance Criteria

| # | Criterion | Verification evidence | Target state |
|---|---|---|---|
| AC1 | The seed roster appears in `GET /v1/bidders` after a clean nb-bond-api restart with no operator action. | `curl http://bond-api.cbdc-sandbox.local/v1/bidders \| jq '.[].name'` returns `["Nordea","DNB","Alice.tbd"]` (order-insensitive). | Pass |
| AC2 | Adding a bidder by name only generates a fresh keypair, persists it, and returns the bidder with derived `address` and `publicKey`. | `curl -X POST .../v1/bidders -d '{"name":"Test"}'` → 201, body contains `address`, `publicKey`, `privateKey`. A subsequent `GET /v1/bidders` includes the new bidder. | Pass |
| AC3 | Importing an existing private key produces an idempotent, address-matching bidder. | `curl -X POST .../v1/bidders -d '{"name":"Test2","privateKey":"0x…"}'` → bidder with `address` matching `cast wallet address --private-key 0x…`. | Pass |
| AC4 | Placing a bid via `POST /v1/bidders/{address}/bids` submits a sealed bid that the auctioneer can later unseal. | After bid submission against an auction in `BIDDING`, `GET /v1/auctions/{id}` shows the new sealed bid in `bids[]`. After `PATCH /v1/auctions/{id} { status: "closed" }`, the bid appears as `unsealed` with matching `rate` + `units`. | Pass |
| AC5 | Deletion is hard-blocked while a bidder has unrevealed bids on an auction in `BIDDING`. | `curl -X DELETE .../v1/bidders/{address}` → 409 with `application/problem+json` body listing the offending auction IDs in `errors[]`. | Pass |
| AC6 | The CB allowlist endpoints reflect on-chain state. | `GET /v1/central-bank/allowlist` matches a `cast` query of the Wnok contract's allowlist; `PUT` / `DELETE` change both. | Pass |
| AC7 | CB can mint to an allowlisted address and the new balance appears in `holders[]` for that address (via the Wnok balance API surface). | `POST /v1/central-bank/wnok/mint -d '{"to":"0x…","amount":"500"}'` → 200, body is a `TransactionDTO`; on-chain `balanceOf` reads `500` higher. | Pass |
| AC8 | The Bidders page lists the three seeded bidders, allows adding a fourth, and shows the disabled-rate-tooltip behavior when placing a bid on a non-RATE auction. | Browser at `#/bidders`: rows visible, "Add bidder" modal opens, "Place bid" modal opens for any bidder. With a PRICE auction selected, the rate input renders disabled with a hover tooltip mirroring `CreateAuctionModal`. | Pass |
| AC9 | The Central Bank page renders the CB address, balance, allowlist, and the three action buttons (mint / burn / transfer). | Browser at `#/central-bank`: page renders without errors, modals open and submit. | Pass |
| AC10 | Both pages display the sandbox-only banner. | Visual check + a test (`tests/sandboxBanner.test.jsx`) renders each page and asserts the banner text is present. | Pass |
| AC11 | A bid placed via the Bidders page is identical (same plaintext, hash, ciphertext shape) to one placed via the legacy `scripts/bid-submitter` CLI for the same inputs. | jest test in `services/nb-bond-api/tests/bidder-bid.test.ts` round-trips a plaintext through both `encryptBid` and the server's new code path; the resulting `plaintextHash` matches. | Pass |
| AC12 | nb-bond-api pod becomes `Ready` after Helm upgrade with the new env vars; existing endpoints continue to work. | `kubectl -n nb-bond-api get pods` shows `1/1 Running`; `curl /v1/bonds` still returns the existing bonds tree. | Pass |
| AC13 | Public-repo hygiene scripts pass. | `python3 scripts/verification/check-public-repo-hygiene.py` and `python3 scripts/verification/check-markdown-links.py` both exit 0. | Pass |

## Assumptions

Only assumptions that are safe to proceed with — anything else is in `Decisions And Open Questions`.

- `PK_NORGES_BANK` is and remains the Wnok admin (verified in `contracts/script/norges-bank/03_Wnok.s.sol`).
- Wnok is registered in `GlobalRegistry` under name `"Wholesale NOK"` (verified in `contracts/.env.example`).
- The fixture roster's three bidder addresses (Nordea, DNB, Alice.tbd) are already allowlisted and pre-funded with WNOK by `contracts/script/norges-bank/11_BondSetup.s.sol` and have ETH from genesis. New addresses added via `POST /v1/bidders` are **not** auto-funded.
- Bidder ETH gas: `zeroBaseFee: true` is set in the local genesis (per `docs/ARCHITECTURE.md`), so transactions from new bidder addresses can succeed with zero ETH if their gas price is zero. Where ethers' default fee logic insists on a non-zero priority fee, the new bid endpoint will set `maxFeePerGas: 0n` and `maxPriorityFeePerGas: 0n` explicitly — matching the pattern in `scripts/bid-submitter/`.
- The bulky-tree cache invalidation on the frontend (`httpClient.js` clears the cache on any mutation) is enough; the new pages do not need a separate cache.

## Plan Order

```
Phase 0  Baseline verification
Phase 1  Backend foundations
  1a  Bidders DB + seed (additive table; migration comment update)
  1b  Bidder endpoints (CRUD)
  1c  Bid submission endpoint (server-side encrypt + sign + submit)
  1d  Central Bank endpoints (mint / burn / transfer / allowlist)
  1e  Health payload extended with wnok address
  1f  Backend tests
Phase 2  Chart + values + env wiring
Phase 3  Frontend implementation
  3a  Router + nav + sandbox banner
  3b  BiddersPage + AddBidderModal + PlaceBidModal
  3c  CentralBankPage + allowlist / mint / burn / transfer modals
  3d  AuctionDetailPage gets PlaceBidModal entry point
  3e  Frontend tests
Phase 4  Local apply + restart
Phase 5  Post-change end-to-end verification
Phase 6  Documentation + hygiene
```

## Phase 0: Baseline Verification

### Goal

Prove the starting state before changing anything.

### Steps

- `kind get clusters` shows `cluster-cbdc-monoledger`; `kubectl config current-context` matches.
- `helm list -A` shows `nb-bond-api` and `nb-ui` releases `deployed`.
- `curl http://bond-api.cbdc-sandbox.local/v1/health` returns the existing payload (no `wnok` field yet).
- `curl http://bond-api.cbdc-sandbox.local/v1/bonds | jq 'length'` returns the current bond count (capture for diff).
- `curl http://web.cbdc-sandbox.local/` returns 200 with the SPA shell.
- `node -e 'console.log(require("./services/nb-bond-api/openapi.json").paths)' | grep -E "bidders|central-bank"` → no matches. Confirms the gap.
- Save `/tmp/baseline-openapi.json` and `/tmp/baseline-helm-values.yaml` (`helm -n nb-bond-api get values nb-bond-api`).

### Verification Stop

- All four checks above pass; baselines saved.

### Fix Iteration / Rollback

- If sandbox is down, run `./sandbox.sh start` and re-verify. No state change yet, so nothing to roll back.

### Exit Criteria

- Baseline files in `/tmp/`. Confidence that the live sandbox matches the docs.

## Phase 1: Backend Foundations

### Goal

Add the API surface and the DB-backed bidder repository without touching any chart yet. All work is in `services/nb-bond-api/src/`.

### Phase 1a — Bidders DB + Seed

**Steps**

- Extend `ingestion-db.ts`:
  - Inside `createTables`, add `CREATE TABLE IF NOT EXISTS bidders (address TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at INTEGER NOT NULL);`.
  - In `migrateToCurrentVersion`, update the doc comment to explicitly call out that `bidders` is a system-of-record table and is **not** dropped on version bumps. (No code change to the drop list yet — `bidders` is not in the list. The doc comment is updated to prevent a future contributor from adding it.)
- New module `bidders.ts`:
  - `interface BidderRecord { address: string; name: string; publicKey: string; privateKey: string; createdAt: number; }`
  - `seedBiddersFromFixturesIfEmpty(db)` — reads `scripts/bid-submitter/examples/bids.keys.json` (already generated by the fixture script before the API boots) and inserts Nordea, DNB, Alice.tbd if the table is empty. Names come from a small const map keyed by the fixture address. Pubkey is derived from privkey via `@noble/secp256k1`.
  - `listBidders(db)`, `getBidderByAddress(db, address)`, `getBidderByName(db, name)`, `createBidder(db, { name, privateKey })`, `deleteBidder(db, address)`.
  - `createBidder` generates a fresh keypair when `privateKey` is absent (reuses `generateKeypair()` from `encryption.ts`), derives the address using ethers' `computeAddress`, normalizes inputs, returns the new record.
- Wire seed into the boot sequence in `index.ts`: after `openDatabase` and before the auth gate, call `seedBiddersFromFixturesIfEmpty(historyDb)`. Note: `historyDb` is opened read-only; the seeder needs a write-mode handle — easiest fix is to open a second short-lived write handle inside the seeder (`openDatabase({ dbPath: …, readonly: false })`), insert, close. Tests cover this.

**Verification stop**

- jest unit tests for `bidders.ts` pass: seed idempotency (running twice does not duplicate), list returns three on fresh DB, create generates a usable keypair, delete removes the row.

**Fix iteration / rollback**

- If the seed read of `bids.keys.json` fails because the fixture generator did not run, log a warning and continue (`seedBiddersFromFixturesIfEmpty` is non-fatal). Operator can `POST /v1/bidders` manually.

**Exit criteria**

- `services/nb-bond-api/src/bidders.ts` shipped with unit tests; ingestion DB changes do not break the existing event-table tests.

### Phase 1b — Bidder Endpoints

**Steps**

- Add Zod-OpenAPI schemas to `schemas.ts`:
  - `bidderSchema` — `{ address, name, publicKey, privateKey, ethBalance: BigIntString, wnokBalance: BigIntString, createdAt: unixMillisSchema, md5 }`.
  - `createBidderBodySchema` — `{ name: z.string().min(1).max(64), privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional() }`.
  - `bidderAddressParamSchema` — bidder address path param (reuses `addressSchema`).
  - `submitBidBodySchema` — `{ auctionId: auctionIdSchema, units: bigIntStringSchema, rate: bpsSchema.optional() }`.
- Add routes in `index.ts`:
  - `GET /v1/bidders` → composes a `BidderDTO[]` from `listBidders`, augmenting each row with `ethBalance` and `wnokBalance` read from the provider / Wnok contract.
  - `POST /v1/bidders` → validated body, `createBidder`, returns the new DTO.
  - `DELETE /v1/bidders/{address}` → looks up the address; queries `BondAuction.getSealedBids(...)` against every auction currently in `BIDDING` (sourced from `composeAllAuctions` filtered by `status === 'open'`); if any include this bidder, return 409 with `errors: [{ field: 'address', message: 'bidder has unrevealed bids on auction <id>' }, …]`.
- DTOs include the per-row `md5` via `withMd5`, consistent with the existing pattern.

**Verification stop**

- jest tests: validated payload parsing, 409 on delete with active bids, 204 on delete without active bids, generate-vs-import branching.
- `npm run regen:openapi` updates `openapi.json` without errors.

**Exit criteria**

- All four endpoints respond cleanly when hit from `npm run dev`.

### Phase 1c — Bid Submission Endpoint

**Steps**

- New module `bidder-bid.ts`:
  - `submitImpersonatedBid({ bidder, auctionId, units, rate })`:
    - Reads `BondAuction.getAuction(auctionId)` and `getAuctionStatus(auctionId)`. Asserts status is `BIDDING` and `block.timestamp <= metadata.end`.
    - Reads the auction's sealing public key (`metadata.auctionPubKey`) and `metadata.auctionType` to know whether `rate` is required.
    - Builds the plaintext: `{ isin, bidder: bidder.address, nonce, rate, units, salt, bidderNonce, bidderSig }`. `nonce` is a random 12-byte hex string; `salt` is a random 8-byte hex string; `bidderNonce` is `Date.now()` cast to string for monotonic uniqueness per bidder (verified non-replay by the contract's `bidderNonceUsed` map).
    - Signs the EIP-712 bid intent. Domain: `{ name: 'BondAuctionBid', version: '1', chainId: <on-chain>, verifyingContract: bondAuctionAddress }`. Type: `BidIntent(address bidder, bytes32 auctionId, bytes32 plaintextHash, uint256 bidderNonce)`. Signed with `bidder.privateKey` via ethers `Wallet.signTypedData`.
    - Dual-wraps via `encryptBid({ plaintext, auctioneerPubKey: sealingKeys.publicKey, bidderPubKey: bidder.publicKey })`.
    - Sends `BondAuction.submitBid(auctionId, ciphertext, plaintextHash)` from a freshly constructed `Wallet(bidder.privateKey, provider)` with managed nonce + `maxFeePerGas: 0n` to honor `zeroBaseFee`.
    - Returns `{ tx, receipt, bidIndex }`.
- Route `POST /v1/bidders/{address}/bids`:
  - Validates body, looks up bidder, calls `submitImpersonatedBid`, returns a `BidDTO` (sealed shape).

**Verification stop**

- jest round-trip test: build a plaintext, encrypt with `encryptBid`, decrypt with `decryptBid(ciphertext, auctioneerPriv, 'auctioneer')` — verify the same `plaintextHash` and that the bidder address recovered from the signature matches the bidder's private key.
- Live smoke: with the dev server running, create a bond + auction via the existing UI, then `curl -X POST .../v1/bidders/<nordea-address>/bids -d '{"auctionId":"0x…","units":"100","rate":"425"}'`. `GET /v1/auctions/<id>` shows the sealed bid. After close, the bid unseals with matching units / rate.

**Exit criteria**

- The end-to-end bid path works without involving the off-chain CLIs.

### Phase 1d — Central Bank Endpoints

**Steps**

- New module `central-bank.ts`:
  - Reads `CENTRAL_BANK_PK` and `WNOK_CONTRACT_NAME` from `env-vars.ts`.
  - `getWnok()` — caches a `Contract` instance bound to the CB wallet, address resolved from `GlobalRegistry.tryGetContract(WNOK_CONTRACT_NAME)`.
  - `getCbAddress()` — `new Wallet(CENTRAL_BANK_PK).address`.
  - Helpers `mintWnok(to, amount)`, `burnWnok(from, amount)`, `transferWnok(from, to, amount)`, `addToAllowlist(address)`, `removeFromAllowlist(address)`, `listAllowlist()`.
  - `listAllowlist()` is the tricky one: the Wnok contract uses a `mapping(address => bool)` for the allowlist with no enumeration. Two options:
    - **(a)** Scan `_allowlist` events (the parent `Allowlist.sol` should emit add / remove events — verify in Phase 1d-i below).
    - **(b)** Track allowlist membership in the ingestion DB.
  - Phase 1d-i: read `contracts/src/common/Allowlist.sol` to confirm events exist. If they do, prefer (a) — scan events on-demand (no DB needed). If they do not, prefer (b) and extend `ingestion.ts` to maintain a `wnok_allowlist` table.
- Add routes in `index.ts` under the auth gate:
  - `GET /v1/central-bank` → `{ address, wnok: { contractAddress, balance, allowlist: AllowlistEntryDTO[] }, md5 }`.
  - `GET /v1/central-bank/allowlist` → `AllowlistEntryDTO[]`.
  - `PUT /v1/central-bank/allowlist/{address}` → calls `addToAllowlist`. Returns 204.
  - `DELETE /v1/central-bank/allowlist/{address}` → calls `removeFromAllowlist`. Returns 204.
  - `POST /v1/central-bank/wnok/mint` → returns `TransactionDTO` (`{ hash, block }`).
  - `POST /v1/central-bank/wnok/burn` → returns `TransactionDTO`.
  - `POST /v1/central-bank/wnok/transfer` → defaults `from = getCbAddress()`. Returns `TransactionDTO`.

**Verification stop**

- jest tests for `central-bank.ts` (mock the contract methods, assert correct args and error mapping).
- Live smoke: `curl -X POST .../v1/central-bank/wnok/mint -d '{"to":"<bidder>","amount":"1000"}'`. `cast call <wnok> "balanceOf(address)(uint256)" <bidder>` shows the new balance.

**Exit criteria**

- All CB endpoints respond; round-trip mint shows up on chain.

### Phase 1e — Extend Health

**Steps**

- In `index.ts`, extend `/v1/health` to include `contracts.wnok = await getWnokAddress()`. Wrap in a try/catch so a missing Wnok registration does not break the health probe.
- Update `schemas.ts` `healthSchema` to add the optional `contracts.wnok` field (additive, backwards-compatible).

**Verification stop**

- `curl /v1/health` returns the existing payload plus `contracts.wnok`.

### Phase 1f — Backend Tests

**Steps**

- Add tests under `services/nb-bond-api/tests/`:
  - `bidders.test.ts`
  - `bidder-bid.test.ts`
  - `central-bank.test.ts`
  - Smoke-test additions to `index.test.ts` (or equivalent) for the new routes.
- `npm test` is green.

**Verification stop**

- `npm test` exits 0. `npm run lint` exits 0. `npm run format:check` exits 0.

## Phase 2: Chart + Values + Env Wiring

### Goal

Make `./nb-bond-api.sh start` deploy the new code path with the right env vars and `./nb-ui.sh start` rebuild the bundle with the two new pages.

### Steps

- Extend `services/nb-bond-api/helm/values.local.example.yaml`:
  - Add `centralBankPrivateKey: "<base64-encoded-local-sandbox-private-key>"` placeholder under `secrets:`.
  - Add `wnokContractName: "Wholesale NOK"` under config.
- Extend `services/nb-bond-api/helm/templates/deployment.yaml` to pass `CENTRAL_BANK_PK` (from the secret) and `WNOK_CONTRACT_NAME` (from the configmap) into the pod env.
- Extend `services/nb-bond-api/.env.example` with the two new vars (with placeholder values, never real keys).
- Extend `scripts/generate-local-sandbox-fixtures.mjs`:
  - In `buildNbBondApiHelmValues`, add the CB key substitution: `rendered.replace('<base64-encoded-local-cb-private-key>', Buffer.from(txAccounts.PK_NORGES_BANK.privateKey).toString('base64'))`.
- `helm template nb-bond-api services/nb-bond-api/helm --values services/nb-bond-api/helm/values.local.yaml` shows the new env vars rendered.

### Verification Stop

- `helm template` succeeds.
- `diff -u /tmp/baseline-helm-rendered.yaml /tmp/proposed-helm-rendered.yaml` shows only additive env-var keys + ConfigMap entries; no unexplained deletes.

### Fix Iteration / Rollback

- If `helm template` fails, fix the chart and re-render. Do **not** apply until rendered output is clean.

### Exit Criteria

- Clean render, additive diff only.

## Phase 3: Frontend Implementation

### Goal

Two new pages render against the new API. The bid modal is reachable from both `#/bidders` and `#/auctions/{auctionId}`.

### Phase 3a — Router + Nav + Sandbox Banner

**Steps**

- Extend `useRoute.js`:
  - Add `bidders` and `central-bank` cases. `#/bidders` → `{ name: 'bidders' }`. `#/central-bank` → `{ name: 'central-bank' }`.
- Extend `App.jsx` to dispatch the new route names to `<BiddersPage />` and `<CentralBankPage />`.
- Extend `Layout.jsx`:
  - Add two nav entries between Auctions and the env pill: "Bidders" → `#/bidders`, "Central Bank" → `#/central-bank`.
- Add `SandboxOnlyBanner` to `ui.jsx` (or a dedicated file under `components/`):
  - Renders a yellow-warning-styled block: "Sandbox-only — private keys are stored in plaintext in the local SQLite DB. Never deploy this configuration against real funds."
  - Reused on both pages.

**Verification stop**

- `npm run dev`; clicking the two nav entries navigates without console errors. Layout active-link styling matches the existing pattern.

### Phase 3b — BiddersPage + Modals

**Steps**

- `src/api/biddersApi.js`:
  - Exports `listBidders`, `createBidder`, `deleteBidder`, `placeBid` (POST `/bids` under the bidder).
  - Each method dispatches to `MockClient.*` when `AppConfig.USE_MOCK`, otherwise `HttpClient.*`.
- `src/api/mockClient.js`: parallel mock implementations using an in-memory roster (Nordea, DNB, Alice.tbd seeded).
- `src/pages/BiddersPage.jsx`:
  - Top page header + sandbox banner.
  - KPI grid (count, total WNOK across roster, total ETH across roster).
  - Table of bidders: name, address, public-key short hex, WNOK balance, ETH balance, "Place bid", "Delete".
  - "+ Add bidder" button opens `AddBidderModal`.
  - Delete confirms inline; on 409, the toast names the offending auction(s) and offers a "View auction" link.
- `src/pages/AddBidderModal.jsx`:
  - Field: name (required, unique-checked client-side).
  - Radio: "Generate new keypair" (default) vs "Import existing private key".
  - Conditional textarea for the import path; client-side regex check for `/^0x[a-fA-F0-9]{64}$/`.
  - Submit → `BiddersApi.createBidder`. On success, parent reloads + toasts.
- `src/pages/PlaceBidModal.jsx`:
  - Props: `bidder` (required), `defaultAuctionId?` (optional — pre-fills when launched from `AuctionDetailPage`).
  - Loads the cached bonds tree via `BondsApi.listBonds()` (already in the cache from the layout) and computes the auctions-in-`BIDDING` list via a new selector `selectOpenAuctions(bonds)`.
  - Fields: auction picker (dropdown, disabled when `defaultAuctionId` is supplied), units, rate.
  - Rate is disabled when the selected auction's type does not honor rate — UI mirrors `CreateAuctionModal.jsx`'s disabled-radio + tooltip pattern (e.g. tooltip "RATE is set when the auction is finalised; bid only on units."). The exact type-vs-rate matrix is: `RATE` honors rate, `PRICE` honors rate, `BUYBACK` honors rate. (All three currently honor rate per the contract; rate is therefore **not** disabled today. The disabled tooltip pattern is wired in anyway so a future type that does not need rate slots in cleanly. Documented inline.)
  - Submit → `BiddersApi.placeBid`. On success, toast "Sealed bid submitted" + parent reloads.

**Verification stop**

- `npm test` passes the new BiddersPage feature tests.
- `npm run dev`: full flow works against the live backend.

### Phase 3c — CentralBankPage + Modals

**Steps**

- `src/api/centralBankApi.js`: `getCentralBank`, `listAllowlist`, `addToAllowlist`, `removeFromAllowlist`, `mintWnok`, `burnWnok`, `transferWnok`. Mock parity in `mockClient.js`.
- `src/pages/CentralBankPage.jsx`:
  - Sandbox banner.
  - KPI grid: CB address, CB WNOK balance, allowlist size.
  - Allowlist table with "+ Add address" / "Remove" actions per row.
  - WNOK actions panel: three buttons launching `MintWnokModal`, `BurnWnokModal`, `TransferWnokModal`.
- The three WNOK modals each take `{ to | from, amount }` with client-side numeric validation and `BigIntString` formatting.

**Verification stop**

- `npm test` passes the new CentralBankPage feature tests.
- `npm run dev`: mint $X to a fixture bidder, see the change on Bidders page balances after a refresh.

### Phase 3d — AuctionDetailPage Entry Point

**Steps**

- Add a "Place bid" button to `AuctionDetailPage.jsx`'s `actions` area, visible only when `auction.status === 'open'`.
- Clicking it opens `PlaceBidModal` with `defaultAuctionId={auction.id}` and a bidder picker (loads from `BiddersApi.listBidders()`).
- The picker defaults to the first bidder in the roster; the operator can change it before submitting.

**Verification stop**

- Both entry points produce the same result (a sealed bid stored on chain, visible in `auction.bids` after reload).

### Phase 3e — Frontend Tests

**Steps**

- `tests/biddersPage.test.jsx` — render with mock client; assert seed rows, "Add bidder" flow, "Delete" flow with 409 handling.
- `tests/centralBankPage.test.jsx` — assert CB rendering, mint modal submit, allowlist add / remove.
- `tests/placeBidModal.test.jsx` — assert auction dropdown filters to BIDDING-only; rate-disabled tooltip behavior.
- `tests/sandboxBanner.test.jsx` — assert banner is on both pages.

**Verification stop**

- `npm test` exits 0. `npm run lint` exits 0. `npm run format:check` exits 0.

## Phase 4: Local Apply / Restart

### Goal

Apply the smallest safe change to the running sandbox.

### Steps

- Re-run `node scripts/generate-local-sandbox-fixtures.mjs` so `services/nb-bond-api/helm/values.local.yaml` contains the new CB key.
- `./services/nb-bond-api/nb-bond-api.sh start` — rebuilds the image (new content hash), pushes to the local registry, helm-upgrades the release. The pod restarts, the new `bidders` table is created, the seed runs.
- `./services/nb-ui/nb-ui.sh start` — rebuilds the SPA bundle and helm-upgrades the release.

### Verification Stop

- `kubectl -n nb-bond-api get pods` shows `1/1 Running` for the new pod.
- `kubectl -n nb-bond-api logs <pod> | grep -E "bidders seed|listening"` shows the seed log line and the listening line.
- `kubectl -n nb-ui get pods` shows `1/1 Running` for the new nb-ui pod.
- `helm -n nb-bond-api history nb-bond-api` shows a new `deployed` revision; same for `nb-ui`.

### Fix Iteration / Rollback

- If the nb-bond-api pod crash-loops, `kubectl logs` it and read the error.
- If the issue is config (missing `CENTRAL_BANK_PK`), regenerate fixtures and re-apply.
- For a true rollback: `helm -n nb-bond-api rollback nb-bond-api <previous-revision>` and / or `helm -n nb-ui rollback nb-ui <previous-revision>`.

### Exit Criteria

- Both pods steady-state with new revisions.

## Phase 5: Post-Change End-To-End Verification

### Goal

Prove the feature works end-to-end on the running sandbox.

### Steps

- `curl http://bond-api.cbdc-sandbox.local/v1/health | jq` shows the new `contracts.wnok` field.
- `curl http://bond-api.cbdc-sandbox.local/v1/bidders | jq` shows three rows (the seed roster).
- Browser flow on `http://web.cbdc-sandbox.local/`:
  1. Navigate to `#/central-bank`. Confirm the CB address matches the fixture's `PK_NORGES_BANK` address. Confirm the allowlist shows the expected entries (Nordea, DNB at minimum, plus any tbd / dvp / order-book entries from the setup script).
  2. Mint 1000 WNOK to Nordea. Confirm balance change on the Bidders page.
  3. Navigate to `#/bidders`. Click "Place bid" on Nordea. Pick a `BIDDING`-phase auction. Submit a bid with `units=100, rate=425`.
  4. Open the auction's detail page. Confirm the new sealed bid appears in `bids[]` with Nordea's address and a fresh ciphertext.
  5. Wait for the auction to end, close it from `AuctionDetailPage`. Confirm the bid unseals with `units=100, rate=425` matching the input.
  6. Add a new bidder "TestX" via the UI's "Generate new keypair" flow. Confirm the row appears with a fresh address. Delete it and confirm it disappears.
- Repeat the bid flow but launch the modal from `AuctionDetailPage` instead. Confirm both entry points behave identically.

### Verification Stop

- Every step above completes without an unexpected error toast.
- `eth_blockNumber` advances at least once during the test (proves chain is live).
- `kubectl -n nb-bond-api get events --sort-by=.lastTimestamp | tail -10` shows no warnings on the new pod.

### Fix Iteration / Rollback

- Any failure: capture the relevant pod log + the API response and decide whether to fix in code (next phase iteration) or roll back the Helm revision.

### Exit Criteria

- Both flows green. All AC# criteria above demonstrably pass.

## Phase 6: Documentation And Public-Repo Hygiene

### Goal

Leave the repo's documentation in a maintainable, public-safe state.

### Steps

- Update `services/nb-bond-api/README.md`: list the new env vars (`CENTRAL_BANK_PK`, `WNOK_CONTRACT_NAME`) and the new endpoint set.
- Update `services/nb-bond-api/DEVELOPMENT.md`: add a §"Bidder impersonation" section linking to this plan; add a §"Central Bank operations" section.
- Update `services/nb-ui/README.md` + `DEVELOPMENT.md`: list the two new pages and the route names.
- Update `docs/ARCHITECTURE.md`: extend the component diagram with the two new UI pages; add a trust-boundary paragraph reinforcing "private keys in DB ⇒ sandbox only".
- Update `docs/KNOWN_ISSUES.md`: new entry "no `cancelBid` in BondAuction.sol" with a one-line description and a link to this plan.
- Update `docs/DOCUMENTATION_INDEX.md`: add an entry for `docs/plans/bidders-and-central-bank-plan.md`.
- Update `contracts/.env.example` only if a new contract role / fixture key is added (no change expected — `PK_NORGES_BANK` already exists).

### Verification Stop

- `python3 scripts/verification/check-public-repo-hygiene.py` exits 0.
- `python3 scripts/verification/check-markdown-links.py` exits 0.
- `python3 scripts/verification/check-third-party-licenses.py` exits 0 (no third-party material added; verify anyway).

### Fix Iteration / Rollback

- If hygiene scripts flag a real-keylike string, replace it with the placeholder pattern used elsewhere (`0x…`).

### Exit Criteria

- All three scripts exit 0; docs cross-link correctly.

## Documentation And PR Plan

- **PR 1** (recommended single PR): "Bidders + Central Bank pages — UI + backend"
  - All `services/nb-bond-api/` changes (Phase 1).
  - All `services/nb-ui/` changes (Phase 3).
  - `scripts/generate-local-sandbox-fixtures.mjs` extension (Phase 2).
  - Docs updates (Phase 6).
  - Rationale: tightly coupled — the UI is unusable without the backend endpoints, and the backend endpoints have no consumer without the UI. Splitting would force a stub-and-fill PR sequence with no validation between steps.
- **PR body must include** the Phase 5 verification screenshots or curl logs as evidence, the rendered Helm diff from Phase 2, and a confirmation that the hygiene scripts pass.

## Residual Risks

- **First-boot seed race.** The seeder opens a write-mode SQLite handle while the read-only one is also open. SQLite WAL mode handles this, but the seed must run before any write from the ingestion loop touches a new table. Mitigation: seed step is fully synchronous before `app.listen` and before the ingestion loop import.
- **Nordea's existing balance on chain.** Seeded bidders are already WNOK-holding and ETH-funded, so they're "ready to bid" out of the box. Operator-added bidders need the CB allowlist + WNOK mint step (and ETH gas — see Portability Flags). The UI clearly shows zero balances so the operator knows. Not a defect; documented behavior.
- **`bidderNonce` collision.** Using `Date.now()` as the EIP-712 `bidderNonce` is fine for sandbox impersonation but theoretically collides if two bids submit in the same millisecond. Mitigation: use `Date.now() * 1000 + counter` for safety.
- **bulky-tree cache and mutation.** The frontend cache is cleared on any mutation, so a placed bid will re-prime bonds + auctions on next view. Risk that the operator sees a stale balance on Bidders page if it doesn't trigger a refetch — mitigated by an explicit `reload` after every CB-affecting modal close.
- **Wnok allowlist event source.** If `Allowlist.sol` does not emit events for `add` / `remove`, Phase 1d-i falls back to maintaining a `wnok_allowlist` ingestion table. That's strictly more code than option (a); flagged as a small extension within Phase 1d.

## Done Criteria

- All AC#1–AC#13 verifiable on a running sandbox.
- PR merged; `main` builds clean with the new code path.
- This plan moves from "Planned" → "Implemented" in its header, and `docs/DOCUMENTATION_INDEX.md` reflects that.
