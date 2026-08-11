# Sandbox FMI Participant Wallet — Implementation Plan

**Status:** Proposed — design captured for review; no implementation has started.
**Date:** 2026-07-15
**Branch suggestion:** `imp/sandbox-fmi-wallet`
**Components touched:** new participant-wallet API and UI services, shared bid
library, NB Bond API bidder-flow migration, deployment wiring, tests, and docs.
**External sandbox dependency:**
[Sandbox Entity Directory & Name Service](sandbox-entity-directory-and-name-service-plan.md).

## Goal

Add a deliberately sandbox-only institutional wallet that lets FMI participants
create, review, approve, sign, submit, and track a small set of supported
transactions without exposing private keys or requiring users to manage raw
Ethereum addresses.

The main boundary change is that the NB Bond API stops signing as a dealer. The
participant wallet constructs and signs dealer actions; the operator API remains
responsible for auction operation and settlement orchestration.

Human-readable recipient search and address resolution come from the separate
Entity Directory & Name Service. The wallet consumes its public API and does not
own entity profiles, personal data, aliases, or on-chain registry synchronization.

## Sandbox Boundary

This plan has no production track. It does not contain HSM/KMS integration, high
availability, disaster recovery, certification, key ceremonies, mobile or browser
extension wallets, or production identity-provider work.

The wallet is a multi-participant simulator running locally in the sandbox. Its
logical participant and maker/checker boundaries exercise FMI workflows, but they
are not security isolation against someone who controls the host, Kubernetes
cluster, database, or configuration. UI and documentation must say this plainly.

## Current-State Evidence

- The NB Bond API currently generates/imports bidder keys, stores private keys in
  plaintext SQLite, signs EIP-712 `BidIntent` messages, encrypts bids, and submits
  transactions from bidder-bound wallets (`services/nb-bond-api/src/bidders.ts`,
  `bidder-bid.ts`, and `ingestion-db.ts`). This is the wallet capability to extract,
  not duplicate.
- Central-bank and bank keys are also selected server-side for WNOK and TBD
  operations. They remain in place for the first participant-wallet slice and move
  only if the optional operator-key phase is later selected.
- The existing bid-encryption CLI and NB Bond API contain overlapping bid logic.
  Adding a third copy would make signature and ciphertext compatibility brittle.
- The NB UI already has `none` and Entra modes, but sandbox-local mode has no human
  identity. The wallet therefore needs local actor profiles to simulate
  maker/checker behavior; an actor selector must not be called authentication.
- The separate directory plan owns searchable entity names, aliases, address
  bindings, public resolution DTOs, and optional registry-derived facts. The wallet
  should not rebuild another address book from bidder/bank tables.

## Guiding Invariants

1. **The operator does not sign as a dealer.** Bidder private keys and bidder
   transaction submission leave the NB Bond API.
2. **No private key crosses an API boundary.** Key import is write-only; no response,
   list endpoint, log, audit record, or problem detail returns key material.
3. **Names aid humans; addresses are signed.** Every intent stores and displays the
   resolved checksum address.
4. **No unregistered recipient in basic templates.** The wallet selects an active
   directory result. Arbitrary raw-address sending is out of scope.
5. **Directory resolution is pinned and revalidated.** An approved intent cannot
   silently target an alias that was rebound before signing.
6. **Directory presence is not asset eligibility.** WNOK allowlists, dealer
   admission, ERC-3643 identity/compliance, and contract roles still determine what
   an address may do.
7. **Only supported transaction templates are signable.** There is no arbitrary
   calldata or generic dApp connector.
8. **Maker and checker are distinct simulated actors.** The same actor cannot both
   propose and approve an intent requiring two-person approval.
9. **Execution is idempotent.** Retrying an intent must not create another economic
   instruction or consume a second nonce accidentally.
10. **Reuse one bid implementation.** EIP-712 types, plaintext hashing, encryption,
    and signature recovery live in one shared internal module used by the reference
    CLI and wallet.
11. **Personal data stays out of the wallet.** It consumes the directory's public
    resolution view only; it never caches or persists directory contacts, persons,
    notes, or private attributes.

## Architecture

```text
Browser
  │
  ▼
Participant Wallet UI
  │ typed intent / approval
  ▼
Participant Wallet API ───── public resolve/search ─────▶ Entity Directory API
  ├─ local actor profiles
  ├─ encrypted software keystore
  ├─ policy + maker/checker
  ├─ intent and attempt audit
  └─ transaction adapters
                │
                ├─ sealed bid / transfer ──────────────▶ Besu
                └─ read auction/asset state ───────────▶ Besu or existing APIs

NB Bond API
  ├─ operates auctions and settlement
  └─ does not possess or use bidder private keys
```

### Component placement

| Component | Proposed path | Responsibility |
|---|---|---|
| Wallet API | `services/participant-wallet-api/` | Local actors, encrypted keys, intents, approvals, signing, submission, receipts |
| Wallet UI | `services/participant-wallet-ui/` | Participant selector, balances, intent forms, approvals, history |
| Shared bid library | Internal workspace extracted from existing bid code | Canonical EIP-712 and sealed-bid implementation |
| Directory client | Wallet API feature module | Public search/resolve calls and pre-sign revalidation |
| NB Bond API migration | Existing bidders/bid routes and storage | Remove server-side participant keys/signing after wallet cutover |

The shared-library directory name is selected during Phase 0 after checking the
cleanest import path for the CLI and wallet. No new third-party dependency is
planned. Any required dependency still needs explicit operator approval before
implementation.

## Wallet Model

### Local actor simulation

Seed at least two actors per participant:

- `<participant> Maker`
- `<participant> Checker`

The UI selects an actor and sends its actor ID on wallet requests. This is workflow
simulation, not authentication. Actor records bind to one entity and have `MAKER`,
`CHECKER`, or `ADMIN` roles. Cross-entity approval is rejected.

### Software keystore

- Generate or import secp256k1 keys through a write-only operation.
- Encrypt private keys at rest using Node's built-in cryptography with a versioned
  envelope: scrypt-derived key, AES-256-GCM, and a unique salt/IV per key.
- Keep the local keystore passphrase in ignored sandbox configuration.
- Store address and public key separately for reads; decrypt only for signing.
- Support `ACTIVE` and `SUSPENDED` key states plus rotation.
- Never log, list, return, export, or include private keys in errors.
- Document that this only prevents casual plaintext inspection; local host/config
  access defeats the encryption.

### Preserved wallet tables

The wallet database is a system of record, not a disposable chain projection:

| Table | Purpose |
|---|---|
| `actors` | Local maker/checker/admin profiles and participant binding |
| `wallet_keys` | Public metadata and encrypted private-key envelopes |
| `intents` | Canonical transaction request, directory snapshot, state, policy result |
| `approvals` | Append-only actor decision history |
| `transaction_attempts` | Append-only preflight/send/receipt/failure attempts |

Schema changes use additive/in-place migrations. A chain resync must never erase
these tables.

### Intent state machine

```text
DRAFT
  └─ submit ─▶ PENDING_APPROVAL
                 ├─ reject ─▶ REJECTED
                 └─ approve ─▶ APPROVED
                                  └─ preflight/sign ─▶ SIGNED
                                                        └─ send ─▶ SUBMITTED
                                                                      ├─ mined ─▶ SUCCEEDED
                                                                      ├─ revert ─▶ REVERTED
                                                                      └─ transport error ─▶ FAILED

DRAFT / PENDING_APPROVAL / APPROVED ── cancel ─▶ CANCELLED
```

Every transition is validated server-side and recorded. Retrying execution uses
the same intent and idempotency key.

## Directory API Contract

The wallet relies only on the directory service's public DTOs:

```text
GET  /v1/public/search?q={name-or-alias-or-address}
GET  /v1/public/aliases/{alias}
GET  /v1/public/addresses/{chainId}/{address}
POST /v1/public/addresses:batch-resolve
```

The wallet does not call directory admin/profile endpoints and does not receive
person/contact/private-attribute fields.

When an intent is submitted:

1. The user searches and selects a directory result; aliases are not free-typed.
2. The wallet requires an active entity and active address binding.
3. It stores alias, entity ID/display name, chain ID, checksum address, address
   purpose, directory record version, and resolution timestamp.
4. The review screen displays entity, alias, purpose, and full address.
5. Immediately before signing, the wallet resolves again. If owner, address,
   purpose, status, or record version changed, it records `DIRECTORY_CHANGED` and
   returns the intent for review.
6. It signs the pinned address only after successful revalidation.

If the directory is unavailable, new named intents and execution pause with a
clear dependency error. Already submitted transactions and historical views remain
available from captured intent data.

## Minimal Policies

- signer entity matches the selected participant;
- key and participant are active;
- directory entity and recipient binding are active;
- recipient purpose is allowed by the transaction template;
- contract targets come from configured/registered contracts, never user input;
- amounts/units are positive integers within token rules;
- bid targets an auction in `BIDDING` before its end time;
- maker cannot approve their own two-person intent;
- signer/recipient satisfy transaction-specific allowlist, role, or registry checks;
- chain preflight runs before signing/sending where possible;
- policy results are stored even when rejected before broadcast.

## Supported Transaction Templates

### First vertical slice

- sealed primary-market bid from a registered dealer wallet;
- WNOK transfer between active directory bindings;
- TBD transfer between active directory bindings.

### Later adapters

- security-token transfer after the ERC-3643 surface is available;
- EIP-712 secondary-market order when the broker-level venue exists;
- selected central-bank/bank actions if the optional operator-key migration is
  approved.

ERC-3643 and the broker venue are dependencies for those adapters, not part of this
plan. The wallet core stays token-model independent.

## Wallet API Surface

The exact DTOs remain OpenAPI/Zod-first:

```text
GET    /v1/actors
GET    /v1/participants
GET    /v1/participants/{entityId}/wallets
POST   /v1/participants/{entityId}/wallets
PATCH  /v1/wallets/{walletId}

GET    /v1/directory/search?q={query}
GET    /v1/directory/aliases/{alias}

GET    /v1/intents
POST   /v1/intents
GET    /v1/intents/{intentId}
POST   /v1/intents/{intentId}/submit
POST   /v1/intents/{intentId}/approve
POST   /v1/intents/{intentId}/reject
POST   /v1/intents/{intentId}/cancel
POST   /v1/intents/{intentId}/execute
```

Private-key import is `writeOnly: true` in OpenAPI. Intent creation accepts a
transaction-template name and typed payload, never raw calldata.

## Wallet UI

- persistent sandbox-only banner;
- local actor and participant selector;
- participant home with wallet alias/address, balances, and active/suspended state;
- create-intent forms using the directory search API;
- review showing transaction meaning, amount, asset, alias, entity, address purpose,
  full checksum address, contract target, and policy result;
- pending approvals queue;
- history with state, hash, receipt, failure reason, and explorer link;
- directory-change warning and re-review flow;
- key generate/import/rotate/suspend controls without private-key readback.

The shared address renderer uses:

```text
DNB Bank ASA
settlement.dnb.fmi
0x1234...cDEF   [copy] [Blockscout]
```

Tables may abbreviate addresses; confirmations show them in full.

## Delivery Phases

### Phase 0 — Design lock and baseline

- Confirm the directory public DTO/version contract with the separate service plan.
- Choose the internal shared-bid-library path.
- Inventory every private-key read and signer construction in NB Bond API; classify
  bidder, bank, central-bank, bond-admin, and auction-sealing keys.
- Capture current bidder behavior and OpenAPI snapshots.

**Exit:** API boundaries, signer inventory, and baseline tests are agreed.

### Phase 1 — Wallet foundations

- Scaffold wallet API/UI services and local deployment wiring.
- Implement additive DB migrations, local actors, participant views, and encrypted
  software keystore.
- Seed fixture participant keys without exposing them through reads.
- Implement key generation/import/suspend/rotation.
- Add health endpoints distinguishing RPC, directory, and DB failures.

**Exit:** seeded participants have active named wallets; DB inspection finds
ciphertext rather than plaintext keys; APIs never return key material.

### Phase 2 — Directory client and intent engine

- Implement public directory search/resolve and cached display data.
- Implement typed templates, canonical intent hashing, state transitions,
  idempotency, policy results, maker/checker, cancellation, preflight, nonce
  serialization, send, receipts, and decoded failures.
- Implement resolution snapshot and pre-sign revalidation.
- Build create/review/approval/history UI.

**Exit:** a WNOK intent can be proposed by DNB Maker, approved by DNB Checker,
revalidated, signed, submitted once, and reconciled to a receipt.

### Phase 3 — Transaction vertical slices

- Extract the shared bid library and prove byte/hash/signature parity with the CLI
  and current NB Bond API.
- Implement dealer bid, WNOK transfer, and TBD transfer adapters.
- Enforce active aliases and relevant allowlist/role preconditions.
- Add end-to-end tests for success, insufficient balance, inactive recipient,
  changed binding, auction closed, revert, RPC failure, and duplicate execute.

**Exit:** all three flows work against the running sandbox.

### Phase 4 — Remove bidder impersonation from NB Bond API

- Switch bidder workflows to create or deep-link to participant-wallet intents.
- Remove bidder private-key creation/import/readback and server-side bid signing.
- Move fixture bidder keys into the wallet seed path.
- Preserve non-secret bidder roster information needed by auction operation.
- Remove or hard-disable the impersonated bid endpoint.
- Update banners, OpenAPI, architecture docs, and tests.

**Exit:** NB Bond API contains no bidder private-key storage or bidder
`Wallet(privateKey)` construction; sealed bids still work end to end.

### Phase 5 — Optional operator-key migration

After participant flows stabilize, decide separately which central-bank, bank, and
bond-admin actions should become wallet templates. Migrate one role at a time and
remove the corresponding NB Bond API key only after verification. Auction sealing
keys remain an auction-service concern.

## Acceptance Criteria

| # | Criterion | Verification evidence |
|---|---|---|
| AC1 | Private keys never leave the wallet | API/OpenAPI/log tests and repository search; DB contains ciphertext, not plaintext keys |
| AC2 | Maker cannot self-approve | Same actor receives typed conflict; distinct same-entity checker succeeds |
| AC3 | Raw recipients are unavailable | Basic forms select directory results; API rejects unregistered/raw recipient payloads |
| AC4 | Resolution is pinned and revalidated | Rebind alias after approval; execute records `DIRECTORY_CHANGED` and requires review without signing |
| AC5 | Directory PII is not copied | Wallet DTO/storage tests contain only public entity/address resolution fields |
| AC6 | Execution is idempotent | Repeated execute with one idempotency key yields one on-chain transaction |
| AC7 | Sealed bid remains compatible | Shared-library/CLI hash and signature recovery match; auction finalises successfully |
| AC8 | WNOK and TBD transfers work by alias | Balances/receipts match chain; review shows alias and full address |
| AC9 | NB Bond API cannot impersonate bidders | No private-key column/API field/signer construction remains |
| AC10 | Failures are durable | Policy, preflight, broadcast, and mined-revert results remain in intent history |
| AC11 | Existing workflows remain green | Service/UI/OpenAPI/end-to-end/docs checks pass |

## Verification Matrix

| Area | Minimum checks |
|---|---|
| NB Bond API | lint, format, Jest, OpenAPI regeneration/snapshot, private-key path search |
| Wallet API/UI | lint, format, unit/API/UI tests, builds, key-leak search |
| Shared bid library | CLI parity, deterministic vectors, EIP-712 recovery, dual-wrap round trip |
| End to end | directory result → intent → maker/checker → revalidate → sign → receipt |
| Public docs | `check-public-repo-hygiene.py` and `check-markdown-links.py` |
| Dependencies/licenses | If manifests change, update notes/licenses and run `check-third-party-licenses.py` |

## Estimate

Excluding the separate Entity Directory & Name Service:

| Work | Estimate |
|---|---:|
| Wallet service/UI + encrypted keystore | 2–3 weeks |
| Directory client + intents/policy/maker-checker/audit | 2–3 weeks |
| Three adapters + removal of bidder impersonation | 2–3 weeks |
| End-to-end hardening/docs | 1–2 weeks |
| **Total** | **7–11 engineer-weeks** |

A focused first milestone with one named WNOK transfer, one sealed bid, directory
revalidation, and removal of bidder signing is approximately **4–6 weeks** for one
engineer. Two engineers can complete the wider wallet plan in roughly **5–7 calendar
weeks**, depending on integration failures.

## Residual Sandbox Risks

- One local wallet service holds every simulated participant key. Host or cluster
  control defeats participant separation and keystore encryption.
- Local actor selection can be spoofed. Maker/checker tests workflow logic, not
  authentication.
- The wallet depends on the directory for new recipients and pre-sign validation.
- Human-readable names can create false confidence; the full address remains visible.
- Directory status and asset eligibility may disagree; the UI must explain both.
- Current and ERC-3643 token surfaces differ; adapters may change, while intent,
  policy, directory-client, and audit models remain stable.

## Explicitly Rejected Approaches

- Copying bidder signing while leaving keys in NB Bond API.
- Putting directory tables or personal/entity profiles in the wallet database.
- Resolving a name only at execution time.
- Hiding addresses entirely behind names.
- Adding a raw-calldata or generic dApp signing endpoint.
- Building a general-purpose MetaMask clone.
- Combining wallet signing and future omnibus beneficial-owner accounting into one
  database or source of truth.

## Done Criteria

The wallet milestone is done when a dealer maker can create a sealed bid or transfer
using a directory result, a distinct checker can approve it, the wallet pins and
revalidates the underlying address, signs/submits exactly once, records the result,
and the NB Bond API no longer possesses or uses bidder private keys.
