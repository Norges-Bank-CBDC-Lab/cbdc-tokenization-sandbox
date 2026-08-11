# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for the cbdc-tokenization-sandbox — one
file per architecturally significant decision, capturing the **context** that forced it, the
**decision** itself, and its **consequences**.

ADRs are **immutable once accepted**. A decision that later changes is not rewritten — a new ADR is
written that supersedes it, and the old record's `Status:` is updated to point at its successor.
This preserves the "why it was once like this", which a future maintainer needs as much as the
current answer.

ADRs **complement** the other docs, they do not replace them:

- `docs/plans/` — forward-looking *implementation plans* (living, multi-phase, archived when
  shipped). A plan describes *how* we will build something; an ADR records *why* a load-bearing
  choice inside it was made, in a form that outlives the plan's archival.
- `docs/ARCHITECTURE.md` — the synthesized *current* architecture. An ADR is the point-in-time
  record behind a line in ARCHITECTURE.md; link the two.
- `docs/post-mortems/` — incident write-ups, not decisions.

## Conventions

- **Filename:** `NNNN-kebab-case-title.md`, zero-padded sequential number (`0001-…`, `0002-…`).
- **One decision per file.** Each ADR has its own number and its own lifecycle.
- **Status:** `Proposed` → `Accepted` → (`Deprecated` | `Superseded by NNNN`). `Rejected` records a
  decision that was considered and declined. Once `Accepted`, the only edit to a record is a status
  pointer when it is later superseded or deprecated.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-local-chain-besu-clique-london-baseline.md) | Local chain runs Hyperledger Besu on a Clique + London baseline | Superseded by 0003 |
| [0002](0002-adopt-erc-3643-for-tokenized-securities.md) | Adopt ERC-3643 (T-REX) for tokenized securities, retiring the ERC-1410 model | Accepted |
| [0003](0003-adopt-besu-qbft-osaka-with-archive-rpc.md) | Adopt Besu QBFT and Osaka with a separate archive/RPC node | Accepted |
