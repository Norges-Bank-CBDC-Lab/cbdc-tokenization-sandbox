# Diagram Catalog

This directory contains the maintained visual architecture of the current
sandbox. The diagrams are written in Mermaid so they can be reviewed beside
the code and rendered by GitHub-compatible Markdown viewers.

Unless a diagram explicitly says otherwise, it describes the implementation
in this repository rather than a future plan. In particular, the current bond
token is partitioned ERC-1410; the adopted ERC-3643 direction is documented in
ADR 0002 but is not drawn as deployed software.

## Architecture

- [System context](architecture/system-context.md): people, external tools,
  the sandbox boundary, and the primary interfaces.
- [Runtime deployment](architecture/runtime-deployment.md): host, local
  registry, Kind cluster, namespaces, Gateway API routes, storage, and Besu
  peer topology.
- [Contract topology](architecture/contract-topology.md): registry, cash,
  tokenized deposits, primary bond market, and secondary securities market.
- [NB Bond API internals](architecture/nb-bond-api-components.md): HTTP,
  orchestration, signing, projection, ingestion, and persistence boundaries.
- [Trust boundaries](security/trust-boundaries.md): sandbox trust zones,
  optional Entra authentication, roles, keys, and exposed endpoints.

## Data and synchronization

- [Projection data model](data/projection-data-model.md): rebuildable chain
  projection tables versus preserved system-of-record tables.
- [Mutation and projection catch-up](processes/mutation-projection-sequence.md):
  transaction submission, receipt, serialized ingestion, `200` versus `202`.
- [Live update flow](processes/live-update-sequence.md): authenticated SSE
  notifications, ETag revalidation, reconnect reconciliation, and health.

## Domain processes

- [Auction lifecycle](processes/auction-lifecycle.md): state machine and
  allowed transitions for RATE, PRICE, and BUYBACK auctions.
- [Bond lifecycle](processes/bond-lifecycle.md): projected status classifier,
  normal lifecycle transitions, and the full-buyback edge case.
- [Auction sequence](processes/auction-sequence.md): create, seal, submit,
  close, select, recompute, verify, finalise, and settle.
- [Bid cryptography](processes/bid-cryptography-flow.md): bidder intent,
  encryption, plaintext commitment, and finalisation proof verification.
- [Coupon and redemption](processes/coupon-redemption-sequence.md):
  government TBD cash payments and bond maturity/redemption.
- [TBD cross-bank transfer](processes/tbd-cross-bank-transfer.md): deposit-token
  burn, WNOK reserve movement, callback, and destination mint.
- [Sandbox bank creation](processes/bank-creation-sequence.md): bank-key-signed
  TBD deployment, central-bank registry/allowlist writes, and persistence.
- [Secondary-market settlement](processes/secondary-market-settlement.md):
  broker routing, price-time matching, and security/TBD DvP.

## Operations

- [Sandbox startup](operations/sandbox-startup-flow.md): deployment order,
  readiness gates, optional steps, and service dependencies.

## Generated contract diagrams

`generated/` is intentionally ignored by Git. Run `make diagrams` from the
repository root to regenerate Slither call/inheritance graphs and the sol2uml
class diagram for local review. Generated output complements these maintained
views; it does not replace them because it cannot express runtime boundaries,
trust, off-chain computation, or end-to-end workflows.

## Maintenance rules

- Update a diagram in the same change that alters the behavior it describes.
- Prefer one concern per diagram; link related views instead of building one
  unreadable master diagram.
- Label planned components or flows explicitly and do not mix them into a
  current-state view without a legend.
- Use names from the code, public API, Helm resources, or deployment scripts.
- Keep explanatory prose short and put important semantics on the diagram.
