# Sandbox Entity Directory & Name Service — Implementation Plan

**Status:** Proposed — design captured for review; no implementation has started.
**Date:** 2026-07-15
**Branch suggestion:** `imp/entity-directory-service`
**Components touched:** new standalone directory service and UI, its own persistent
database and Helm deployment, optional on-chain source adapters, Blockscout/BENS
compatibility, client integration, tests, and docs.
**Related consumer:** [Sandbox FMI Participant Wallet](sandbox-fmi-wallet-plan.md).

## Goal

Create a small, independently deployable sandbox solution for finding and managing
human-readable entities, people, aliases, and blockchain addresses.

It provides:

- a simple browser UI for searching names, aliases, and addresses;
- admin-oriented forms for creating and enriching entity records;
- a public backend API that the wallet, NB UI, and other sandbox UIs can use for
  forward/reverse/batch resolution;
- a separate enriched API for directory administration and synthetic personal data;
- its own persistent database so off-chain metadata can evolve independently;
- optional readers for `GlobalRegistry` and later on-chain identity/eligibility
  registries;
- the small BENS-compatible read surface Blockscout needs.

This solution is not ENS. It has no public ownership, auctions, renewals, resolver
contracts, or transferable names. It is a controlled sandbox directory and address
book shaped around FMI workflows.

## Why This Is Separate From The Wallet

- Many consumers need the same resolution data: wallet, NB UI, Blockscout, scripts,
  and future FMI services.
- Entity/profile data evolves differently from signing and transaction policy.
- The directory may hold descriptions, contacts, people, notes, source provenance,
  and other enrichment that does not belong in a wallet database.
- Optional chain registries are inputs to the directory, not a reason every client
  should understand contract events and registry semantics.
- Keeping one directory API prevents bidder, bank, WNOK, GlobalRegistry, and BENS
  label resolvers from drifting apart.

## Sandbox And Personal-Data Boundary

This is local sandbox software with no production track.

The database is capable of holding person/contact data so the model can be explored,
but the sandbox currently has no meaningful access control in local `none` mode.
Therefore:

- only synthetic personal data may be used;
- real names, emails, phone numbers, identifiers, KYC data, or credentials must not
  be committed, seeded, imported, or entered;
- public search/resolution APIs never return person/contact/private-attribute data;
- logs, metrics, errors, and public audit responses redact private fields;
- the enriched admin API and UI carry a visible synthetic-data-only banner;
- splitting public and admin DTOs limits accidental disclosure but is not a security
  boundary in an unauthenticated local sandbox.

This separation is mandatory. A single `EntityDTO` reused everywhere would
eventually leak personal information into transaction forms, browser caches, logs,
and unrelated services.

## Current-State Evidence

- The existing BENS microservice provides Blockscout-compatible name resolution from
  a Postgres `mapping(domain_name, address)` table seeded from fixture `PK_*` and
  `NAME_*` variables. It has no general entity model, CRUD API, source provenance,
  enrichment, approval status, or dedicated search UI.
- `GlobalRegistry` maps important contract names to contract addresses. It is useful
  as a synchronization source for contract discovery but does not model entities,
  people, multiple address purposes, or reverse lookup directly.
- Bidder and bank names live in preserved NB Bond API tables. WNOK allowlist entries
  and registered contracts are labelled through separate code paths or not labelled
  at all.
- The closed-loop settlement roadmap proposes `PrimaryDealerRegistry`; the accepted
  ERC-3643 direction introduces security identity/compliance registries. Those facts
  should enrich the directory without turning its database into the authority for
  asset eligibility.
- The wallet plan needs stable public name/address DTOs, but must not receive private
  profile enrichment.

## Guiding Invariants

1. **The directory database is the operational profile source of truth.** Names,
   aliases, descriptions, people, contacts, notes, and source links live here.
2. **On-chain registries are optional sources.** The service can read and reconcile
   them, but the first usable release does not require a new registry contract.
3. **Every derived fact has provenance.** Consumers can distinguish manual,
   fixture, GlobalRegistry, WNOK, primary-dealer, and ERC-3643 observations.
4. **Manual enrichment is never silently overwritten by sync.** Source adapters own
   their observations; a reconciliation layer derives the current public view.
5. **Name/address association is not asset eligibility.** Eligibility facts are
   surfaced separately with their source and checkpoint.
6. **Public DTOs contain no private profile data.** Resolution consumers receive
   only the minimum needed to identify an entity and address.
7. **Addresses are chain-scoped.** Store chain ID and checksum address together; do
   not assume the same address means the same thing on every EVM network.
8. **Aliases are convenient, not opaque.** Search/detail results always show the full
   checksum address and source/status.
9. **No free-form alias interpretation.** Alias grammar and normalization are shared
   by writes, reads, search, BENS compatibility, and clients.
10. **History is append-aware.** Address rotation deactivates a binding; it does not
    rewrite earlier relationships or consumer audit records.
11. **One solution owns resolution.** Existing BENS becomes a compatibility surface
    of this service and is retired as a separate name database after cutover.

## Solution Shape

The proposed solution is one deployable service boundary:

```text
services/entity-directory/
  src/server/       API, database, sync adapters, BENS compatibility
  src/web/          small React search/admin UI
  tests/
  helm/
  Dockerfile
  entity-directory.sh
```

The web bundle is built into the same image and served by the backend. This gives
the directory one image, one service, one hostname, one API, one UI, and one
database without creating separate frontend/backend deployments for a small
sandbox capability.

Proposed hostname:

```text
http://directory.cbdc-sandbox.local/
```

Proposed routing:

```text
/                         search/admin SPA
/v1/public/*              minimal consumer API
/v1/admin/*               enrichment and source administration API
/api/v1/{chainId}/*       BENS-compatible Blockscout adapter
/health                   dependency health
```

The service uses the existing Node/TypeScript, Express, React/Vite, ethers, and
SQLite patterns already present in the repository. No new third-party dependency
is planned. Any required package still needs explicit operator approval.

## Architecture

```text
                           optional source adapters
                     ┌──────────────────────────────────┐
                     │ GlobalRegistry                   │
                     │ WNOK allowlist                   │
                     │ PrimaryDealerRegistry (future)   │
                     │ ERC-3643 registries (future)     │
                     └────────────────┬─────────────────┘
                                      │ events/reads + checkpoints
                                      ▼
┌──────────────┐             ┌─────────────────────────┐
│ Directory UI │────────────▶│ Entity Directory Service│
└──────────────┘             │ ├─ public resolution API│
                             │ ├─ admin/enrichment API │
┌──────────────┐             │ ├─ source reconciliation│
│ Wallet / UIs │────────────▶│ └─ BENS adapter routes │
└──────────────┘             └────────────┬────────────┘
                                          │
                                          ▼
                                ┌─────────────────────┐
                                │ Persistent SQLite DB│
                                └─────────────────────┘
                                          ▲
                                          │ BENS-compatible reads
                                  ┌───────┴────────┐
                                  │  Blockscout    │
                                  └────────────────┘
```

## Database Ownership And Persistence

The directory owns a dedicated SQLite database mounted on a PVC because manually
entered enrichment cannot be reconstructed from chain events. The database is not
part of the NB Bond API ingestion DB and is never dropped by chain resync.

It is canonical for off-chain profiles, aliases, contacts, notes, and manual
bindings. For a fact owned by an on-chain contract, the contract remains
authoritative; the directory database stores a checkpointed observation and a
reconciled display/search view rather than redefining that chain state.

Use explicit additive/in-place migrations from the start. Provide a deliberate
local reset command that clears directory state and reseeds synthetic fixtures;
normal service restart preserves data.

### Core tables

| Table | Purpose |
|---|---|
| `entities` | Stable organization/person-group record, display/legal labels, type, status, description, version |
| `aliases` | Searchable canonical and alternate names, normalization, status |
| `address_bindings` | Chain ID, address, entity, purpose, canonical alias, active/history timestamps |
| `people` | Synthetic person profiles associated with entities; admin-only DTO |
| `entity_people` | Person ↔ entity relationship, role/title, status |
| `contacts` | Synthetic contact points associated with entity or person; admin-only DTO |
| `profile_attributes` | Namespaced evolving attributes not yet promoted to typed columns |
| `source_records` | Facts observed from fixture/manual/on-chain/external sources with provenance |
| `sync_checkpoints` | Source/chain/contract checkpoint and last outcome |
| `change_history` | Append-only local create/update/suspend/merge history without secret values |

Stable frequently queried fields belong in typed columns. `profile_attributes` is
for genuinely evolving sandbox experiments, not a replacement for schema design.

### Entity

```text
entityId       stable UUID/string identifier generated by the service
slug           unique lowercase stable slug, e.g. "dnb"
displayName    e.g. "DNB Bank ASA"
legalName      optional synthetic/legal-style label
kind           CENTRAL_BANK | BANK | DEALER | BROKER | CSD | GOVERNMENT | PERSON | OTHER
status         ACTIVE | SUSPENDED | ARCHIVED
description    optional public description
version        monotonic record version
createdAt      timestamp
updatedAt      timestamp
```

### Address binding

```text
bindingId      stable directory identifier
chainId        EVM chain ID
address        checksum address
entityId       owning entity
purpose        DEALER | SETTLEMENT | BROKER | ADMIN | TOKEN_CONTRACT | OTHER
canonicalAlias e.g. "settlement.dnb.fmi"
status         ACTIVE | SUSPENDED | RETIRED
verifiedBy     MANUAL | FIXTURE | GLOBAL_REGISTRY | ON_CHAIN_DIRECTORY | OTHER
sourceVersion  source block/checkpoint when applicable
version        monotonic binding version
validFrom      timestamp/block metadata
validTo        null while current
```

One entity may own many addresses. One chain/address pair has only one active
canonical entity binding. Conflicts are recorded and surfaced for review rather
than silently reassigned.

### Personal/profile enrichment

The initial model supports synthetic:

- person display name;
- organizational role/title;
- email/phone-style contact values;
- notes and namespaced attributes.

None of these fields appear in public search/resolution DTOs. Admin responses mark
private fields explicitly, and tests assert that public serialization cannot include
them.

## Alias Rules

- lowercase ASCII letters, digits, and hyphens;
- dot-separated labels ending in `.fmi`;
- no Unicode, whitespace, case-sensitive variants, or ambiguous normalization;
- canonical address alias: `<purpose>.<entity>.fmi`;
- optional entity landing alias: `<entity>.fmi`;
- unique per chain/namespace as appropriate;
- aliases may be suspended/retired but historical rows remain;
- transaction UIs select search results rather than accepting an unvalidated alias.

The backend owns normalization. Clients receive normalized values and do not
implement independent parsing rules.

## Public API

The public API is intentionally small and contains no private enrichment:

```text
GET  /v1/public/search?q={query}&kind={kind}&purpose={purpose}&chainId={id}
GET  /v1/public/entities/{entityId}
GET  /v1/public/aliases/{alias}
GET  /v1/public/addresses/{chainId}/{address}
POST /v1/public/addresses:batch-resolve
GET  /v1/public/health/sources
```

### Public resolution DTO

```text
entityId
entitySlug
entityDisplayName
entityKind
entityStatus
bindingId
alias
chainId
address
purpose
bindingStatus
recordVersion
sources[]       source kind, status/fact, checkpoint — no private fields
```

Search matches normalized alias, display name, legal/public names, entity slug,
and exact/prefix address. It does not search people or contact values on the public
route.

Every cacheable response gets ETag/md5-style versioning consistent with existing
sandbox clients. Wallet pre-sign checks compare `recordVersion` and all binding
fields, not only the ETag.

## Admin And Enrichment API

```text
GET    /v1/admin/entities
POST   /v1/admin/entities
GET    /v1/admin/entities/{entityId}
PATCH  /v1/admin/entities/{entityId}
POST   /v1/admin/entities/{entityId}/aliases
POST   /v1/admin/entities/{entityId}/addresses
PATCH  /v1/admin/address-bindings/{bindingId}
POST   /v1/admin/address-bindings/{bindingId}/rotate

POST   /v1/admin/entities/{entityId}/people
PATCH  /v1/admin/people/{personId}
POST   /v1/admin/entities/{entityId}/contacts
POST   /v1/admin/people/{personId}/contacts
POST   /v1/admin/entities/{entityId}/attributes

GET    /v1/admin/sources
POST   /v1/admin/sources/{sourceId}/sync
GET    /v1/admin/conflicts
POST   /v1/admin/conflicts/{conflictId}/resolve
GET    /v1/admin/history
```

Writes use optimistic concurrency via `If-Match`/record version so two edits do not
silently overwrite one another. Changes append a redacted history entry.

The admin/public separation is structural preparation for safe DTO ownership, not
access control in local mode.

## UI

### Search home

- one prominent search field accepting name, alias, entity slug, or address;
- filters for entity kind, address purpose, chain, active/suspended, and source;
- results showing display name, kind, alias, full/copyable address, purpose, status,
  and source badges;
- detail view listing all current and retired aliases/addresses;
- direct Blockscout links;
- empty, ambiguous, conflict, source-stale, and service-error states.

### Admin/enrichment views

- create/edit/suspend/archive entity;
- add/retire alias;
- bind/rotate/suspend address;
- add/edit synthetic people, roles, contacts, notes, and attributes;
- inspect provenance and eligibility facts by source;
- trigger source sync/resync and inspect checkpoints/errors;
- resolve binding conflicts explicitly;
- persistent synthetic-data-only banner.

The first UI remains intentionally plain. Search correctness, full address
visibility, provenance, and edit safety matter more than visual polish.

## Source Adapter Model

Each adapter produces source observations without directly overwriting directory
profile rows:

```text
sourceKind
sourceInstance       chain ID + contract address or fixture identifier
subject              entity/address/contract identifier
factType             REGISTERED_CONTRACT | WNOK_ALLOWED | PRIMARY_DEALER | ...
factValue
observedAtBlock
observedAtTime
status               CURRENT | STALE | REMOVED | ERROR
```

The reconciliation layer combines manual bindings and observations into the public
view. Precedence is explicit:

1. manual conflict resolution;
2. active manual/fixture canonical entity binding;
3. unique verified on-chain binding;
4. unresolved conflict, never a guessed winner.

### Initial adapters

1. **Fixture seed:** known Norges Bank, government, DNB, Nordea, bidder, broker, TBD,
   and contract addresses with synthetic metadata.
2. **GlobalRegistry:** replay `ContractAdded`/`ContractUpdated` and resolve the current
   contract address; bind contracts to known owner entities when configured.
3. **NB Bond API roster import:** one-time or transitional import of non-secret
   bidder/bank names and addresses until those records are created directly here.

### Later adapters

- WNOK allowlist status;
- `PrimaryDealerRegistry` admission and dealer/broker relationships;
- ERC-3643 identity/claim/compliance status suitable for a public summary;
- an optional future on-chain entity-directory contract if the sandbox chooses to
  test on-chain registration.

No on-chain write contract is required by this plan. If one is later added, it owns
only public identifiers/bindings and emits events; personal/profile enrichment stays
in this service database.

## BENS And Blockscout Compatibility

The directory service replaces the existing BENS mapping database after endpoint
parity is verified. It exposes only the Blockscout routes actually used by the
sandbox, under the existing upstream-compatible path shape:

```text
POST /api/v1/{chainId}/addresses:batch-resolve-names
GET  /api/v1/{chainId}/addresses/{address}
GET  /api/v1/{chainId}/domains/{name}
GET  /api/v1/{chainId}/addresses:lookup
GET  /api/v1/{chainId}/domains:lookup
GET  /api/v1/{chainId}/protocols
```

These routes adapt the public directory projection; they never read private profile
tables. Unsupported upstream BENS routes return an explicit supported/not-supported
response rather than fabricated data.

Cutover sequence:

1. capture current BENS/Blockscout request/response fixtures;
2. implement compatibility contract tests in the directory service;
3. point Blockscout's BENS URL and gateway route at the directory service;
4. verify forward, reverse, batch, search, mixed-case address normalization, rotation,
   and suspended alias behavior;
5. remove the old BENS deployment, database init job, generated service, image build,
   and obsolete dependency/license notes only after parity;
6. keep upstream Swagger/provenance material only if still used; otherwise remove it
   and update third-party documentation/licenses.

Blockscout compatibility is an adapter, not the primary directory API contract.

## Integration Contract For Consumers

- Wallet uses public search/resolve/batch endpoints and pins `recordVersion` plus
  checksum address in transaction intents.
- NB UI uses the same public resolver for address labels instead of maintaining
  bidder/bank/TBD-specific label functions.
- WNOK allowlist enrichment consumes directory labels plus separate WNOK eligibility
  facts.
- Blockscout uses the BENS adapter routes.
- Scripts may query the public API but keep raw addresses in machine inputs/outputs.

Consumers degrade to `label unavailable + full checksum address` for display if the
directory is down. Signing flows requiring a newly resolved or revalidated alias
pause rather than guessing.

## Delivery Phases

### Phase 0 — Baseline and API lock

- Capture existing BENS endpoints used by Blockscout and example responses.
- Inventory bidder, bank, GlobalRegistry, WNOK, broker, and contract label sources.
- Confirm public/admin DTO split, alias grammar, entity/address-purpose enums, and
  seed data.
- Confirm `services/entity-directory/` as one combined service/UI workspace.
- Verify no new third-party dependency is needed; request explicit approval if one
  becomes necessary.

**Exit:** DTOs, schema sketch, BENS compatibility set, and seed inventory are agreed.

### Phase 1 — Service, database, and persistence

- Scaffold the service, static web serving, Helm chart, route, lifecycle script,
  health endpoints, content-hash image workflow, and root workspace wiring.
- Implement SQLite schema and in-place migrations.
- Add PVC persistence and explicit reset/reseed command.
- Seed synthetic fixture entities, aliases, addresses, people, and contacts.
- Add redacted change history and serialization leak tests.

**Exit:** restart preserves records; reset restores fixtures; public DTO tests cannot
serialize private profile fields.

### Phase 2 — Public resolution API and search UI

- Implement search, entity detail, alias resolve, address reverse resolve, batch
  resolve, filters, versioning, and validation.
- Build the simple search/detail UI with full addresses, copy, status, source, and
  explorer links.
- Add conflict/ambiguous/stale/error presentation.

**Exit:** users can find DNB by name, resolve `settlement.dnb.fmi`, reverse-resolve its
address, and see the same public DTO through API and UI.

### Phase 3 — Admin enrichment and history

- Implement entity/alias/address CRUD, rotation, suspension, optimistic concurrency,
  people, contacts, attributes, and history.
- Build admin/enrichment UI with synthetic-data warning.
- Test that private fields never enter public responses, BENS routes, logs, errors,
  or client caches.

**Exit:** a synthetic contact can be added to DNB and viewed in admin detail but is
absent from every public resolution response.

### Phase 4 — Source adapters and reconciliation

- Implement fixture, GlobalRegistry, and transitional NB Bond API roster adapters.
- Add checkpoint/replay, source health, manual sync, conflict records, and explicit
  resolution.
- Surface eligibility facts separately from binding status.
- Document how later WNOK, primary-dealer, ERC-3643, or on-chain directory adapters
  plug in.

**Exit:** a GlobalRegistry contract update appears as a new observation/current
binding without overwriting manual entity enrichment.

### Phase 5 — BENS compatibility and cutover

- Implement the required compatibility routes from the public projection.
- Run contract fixtures against current Blockscout behavior.
- Point Blockscout/gateway at the directory service.
- Verify all name-resolution paths live.
- Retire the separate BENS service and its mapping database/init job after parity.
- Update image hashing, charts, docs, provenance, and licenses as required.

**Exit:** Blockscout names come directly from the directory service database and no
separate BENS name store remains.

### Phase 6 — Consumer integration

- Integrate participant wallet search/revalidation.
- Replace key NB UI label sites and WNOK enrichment with the public resolver.
- Add shared client-side address rendering behavior: label + alias + full/copyable
  checksum address.
- Add outage fallback tests and end-to-end named transaction test.

**Exit:** directory UI, wallet, NB UI, and Blockscout resolve the same records from
one service.

## Acceptance Criteria

| # | Criterion | Verification evidence |
|---|---|---|
| AC1 | Directory is independently deployable | Own image, Helm release, hostname, health, UI, API, DB, lifecycle commands |
| AC2 | Data survives restart | Created enrichment remains after pod restart; explicit reset removes/reseeds it |
| AC3 | Forward/reverse/batch resolution agree | Alias and chain/address return the same active binding and record version |
| AC4 | One entity has multiple purpose-bound addresses | DNB shows dealer, settlement, broker/TBD-contract bindings without duplicate entity profiles |
| AC5 | Public API never returns private enrichment | Serialization, snapshot, log, error, and BENS tests prove absence of people/contacts/private attributes |
| AC6 | Synthetic personal data is manageable | Admin UI/API creates and edits a synthetic person/contact linked to an entity |
| AC7 | Alias rules are canonical | Case, Unicode, whitespace, collision, and malformed suffix writes are rejected consistently |
| AC8 | Rotation preserves history | Old binding becomes retired, new binding resolves, history remains queryable |
| AC9 | Source facts retain provenance | GlobalRegistry/fixture/manual records show source, checkpoint, observation, and status |
| AC10 | Sync does not overwrite enrichment | Manual description/contact survives source resync and contract address update |
| AC11 | Conflicts are explicit | Competing active bindings produce a conflict requiring resolution, not guessed output |
| AC12 | Name status and eligibility remain separate | Active entity can show `WNOK_ALLOWED=false` without being renamed/unregistered |
| AC13 | Blockscout parity passes | Required BENS routes, forward/reverse/batch/search, case normalization, rotation, and suspension work |
| AC14 | Old BENS store is retired safely | Blockscout stays green after old mapping service/job removal; docs/licenses updated |
| AC15 | Consumers degrade safely | Display shows full address when directory is unavailable; wallet execution pauses on required revalidation |
| AC16 | Repository checks pass | Tests/builds, public hygiene, markdown links, third-party license checks when applicable |

## Verification Matrix

| Area | Minimum checks |
|---|---|
| Database | migration upgrade, restart persistence, reset/reseed, uniqueness/history/conflict tests |
| Public API | search/resolve/batch/version/cache tests and private-field serialization guard |
| Admin API/UI | CRUD/rotation/concurrency/history/synthetic-profile tests and build |
| Sources | GlobalRegistry event replay/current resolve, checkpoint restart, stale/error/conflict cases |
| BENS adapter | captured contract fixtures plus live Blockscout forward/reverse/batch/search |
| Consumers | wallet and NB UI client contract tests, outage fallback, named transaction E2E |
| Public docs | `check-public-repo-hygiene.py` and `check-markdown-links.py` |
| Dependencies/licenses | If manifests or BENS material change, update notes/licenses and run `check-third-party-licenses.py` |

## Estimate

| Work | Estimate |
|---|---:|
| Service/database/deployment foundation | 1–1.5 weeks |
| Public API + search UI | 1–1.5 weeks |
| Admin enrichment/history | 1–1.5 weeks |
| Source adapters/reconciliation | 1.5–2 weeks |
| BENS compatibility/cutover | 1–1.5 weeks |
| Consumer integration/hardening/docs | 1–1.5 weeks |
| **Total** | **6.5–9.5 engineer-weeks** |

A useful first milestone—persistent manual/fixture records, public search/resolve,
and the simple UI without on-chain sync or BENS cutover—is approximately **3–4
weeks** for one engineer. Two engineers can complete the wider plan in roughly
**4–6 calendar weeks**, depending on Blockscout compatibility and reconciliation
edge cases.

## Residual Sandbox Risks

- Local `none` mode does not protect admin/private routes. Synthetic data only.
- Flexible attributes can become an unstructured dumping ground; promote stable
  fields into typed schema/migrations.
- Source adapters can disagree. Conflicts must remain visible rather than choosing
  whichever sync ran last.
- Name search can create false confidence. Full addresses and provenance remain
  visible.
- SQLite/PVC data is independent of chain reset and may become stale; source health,
  reset/reseed, and resync controls are required.
- Blockscout compatibility follows the subset actually used by the sandbox, not the
  entire upstream BENS product.
- Eligibility summaries are cached observations, not replacements for on-chain
  enforcement at transaction time.

## Explicitly Rejected Approaches

- Keeping the directory inside the wallet or NB Bond API.
- Using the existing BENS `mapping` table as the evolving entity database.
- Requiring a new on-chain name registry before basic search works.
- Storing personal/profile enrichment on-chain.
- Returning one large entity DTO to public and admin consumers.
- Letting sync overwrite manual data without provenance/conflict handling.
- Resolving names without chain ID or hiding the full address.
- Maintaining separate bidder, bank, WNOK, Blockscout, and wallet label databases.

## Done Criteria

The directory milestone is done when the standalone service can persist and search
entities, synthetic people, aliases, and chain-scoped addresses; exposes a minimal
private-data-free API to wallet/NB UI consumers; records optional registry facts
with provenance; supplies Blockscout-compatible name resolution from the same
database; and no separate BENS mapping store remains.
