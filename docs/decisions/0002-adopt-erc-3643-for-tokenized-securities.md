# 0002. Adopt ERC-3643 (T-REX) for tokenized securities, retiring the ERC-1410 model

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** sandbox operator, Norges Bank
- **Tags:** contracts, erc-3643, securities, identity, compliance

## Context

The sandbox tokenizes two classes of securities — bonds (primary market) and equities (CSD /
secondary market) — alongside a cash leg (WNOK). It exists to *test and compare* tokenization
foundations, not to ship a fixed product, so the first contract designs were chosen deliberately as
a baseline of features to learn from:

- **Bonds** used an **ERC-1410-style partitioned model** (`BondToken`): one contract holds many
  ISINs as partitions, with controller / operator roles. The partition design was attractive
  because it looked *simpler* than an upgradeable-proxy pattern (and its attendant complexity), and
  it mapped cleanly onto one issuer contract carrying multiple instruments.
- **Equities** used an **upgradeable ERC-20** (`BaseSecurityToken` / `StockToken`) with an allowlist.
- **Cash** (`Wnok`) used an inline ERC-20 allowlist.

ERC-1400 / ERC-1410 was a recognized "security token standard" and a reasonable thing to test;
ERC-3643 (T-REX) was, at the time, far less proven and less widely known. Implementing ERC-20 +
ERC-1400 / ERC-1410 + partitions first gave us a concrete baseline against which to understand *why*
a regulated-asset token needs more than structure.

What that experiment surfaced:

- **The model standardizes structure, not eligibility.** ERC-1410 defines *partitions*, not
  *compliance*. The bond transfer path (`transferByPartition` / `operatorTransferByPartition` →
  `_move`) has no identity, allowlist, or compliance check anywhere — any address that has ever held
  a bond can transfer it to any address. Nothing in the standard required the check, and we never
  added one.
- **No identity layer and no regulatory hooks.** The 1400 / 1410 model carries no notion of a
  verified participant or on-chain identity — precisely what regulated RWA handling turns on. This
  was the hardest gap to live with.
- **Three divergent eligibility mechanisms.** Bonds (partition + controller), equities (ERC-20 +
  allowlist), and cash (ERC-20 + allowlist) each invented their own rules, with no shared
  "is this party verified?" source of truth.
- **ERC-1400 never finalized.** We only ever implemented the ERC-1410 partition slice of a draft
  umbrella; audits, tooling, and institutional adoption have since coalesced around ERC-3643.
- **Concerns accrete into a monolith.** ERC-1410 keeps everything inside the token — partition
  accounting, controller / operator powers, ISIN lifecycle, and (as they are added) compliance,
  documents (ERC-1643), and controller operations (ERC-1644). The more it scales, the more it
  becomes one coupled contract with no seam between *what the asset is*, *who may hold it*, and *how
  it transfers*; and because `BondToken` is non-upgradeable, changing any one concern means
  redeploying the whole token.
- **A non-standard surface that generic tooling does not speak.** `BondToken` is `IERC1410` /
  `ERC165`, not an ERC-20: it tracks `balanceOfByPartition` and emits `TransferByPartition`, with no
  standard ERC-20 `Transfer` event. Block explorers, wallets, and indexers — including the sandbox's
  own Blockscout — build their holder / balance / history views off the canonical ERC-20 interface
  and `Transfer` event, so a partitioned token is effectively invisible to them without bespoke,
  per-tool customization.

The standards landscape is still moving — SATP (Secure Asset Transfer Protocol), for example,
addresses the *transfer / interoperability* layer rather than the token / identity / compliance
layer — so this is explicitly a choice of the best available *testing foundation* for regulatory
features, not a prediction of the permanent winner. Even if ERC-3643 is not the eventual RWA
standard, it resembles what regulatory RWA handling will require closely enough to be the right base
for the regulatory test cases the sandbox exists to run.

## Decision

We will adopt **ERC-3643 (T-REX)** as the single token standard for tokenized securities in the
sandbox, retiring the ERC-1410 partitioned model and the bespoke ERC-20 security tokens:

- **Bonds:** replace the partitioned `BondToken` with **canonical ERC-3643** bond tokens (one token
  per ISIN, via a token factory), bound to a shared on-chain **identity registry** and **modular
  compliance**. The single-contract, multi-partition model is dropped; because `BondToken` is
  non-upgradeable, this is a redeploy, not an in-place upgrade.
- **Equities:** build a **greenfield ERC-3643** equity token and retire `BaseSecurityToken` /
  `StockToken`; existing holders and state are migrated to the new token.
- **Shared securities identity:** bonds and equities reference **one** ERC-3643 identity registry
  and compliance stack, giving transfer-time eligibility enforcement, standardized agent powers
  (pause / freeze / forced transfer / recovery), and reusable compliance modules.
- **Cash (WNOK) stays on its own allowlist** for now and is *not* brought onto the securities
  identity registry under this decision.
- The retired ERC-1410 and ERC-20 security contracts are **removed from the repository**; their git
  history, and this record, are where the comparison survives.

The original decision kept the contract toolchain on the **London EVM** baseline
from ADR 0001. ADR 0003 supersedes that toolchain constraint: the ERC-3643
contracts now compile with Solidity 0.8.36 for `evm_version = "osaka"`.

## Consequences

- **Easier:** eligibility is enforced *inside the transfer path* for every security, closing the
  bond gap by construction; one verified-participant set spans bonds and equities (onboard once);
  compliance rules become modular and swappable without touching token code; freeze / forced
  transfer / pause / key recovery become standardized; and the design now tracks the de-facto
  institutional RWA standard, with its audited reference implementation and tooling.
- **Separation of concerns instead of a monolith.** ERC-3643 splits the security token into
  single-responsibility contracts it *composes* — identity registry, modular compliance, and
  pluggable per-rule compliance modules — the on-chain analogue of decomposing a monolith into
  smaller, independently deployable parts. A rule changes by binding or swapping a module and
  re-pointing a setter, not by redeploying the token.
- **Idiomatic ERC-20, so standard tooling works out of the box.** ERC-3643 tokens are ERC-20 at the
  core (standard `Transfer` events), so wallets, indexers, and the sandbox's Blockscout render
  holders, balances, and history natively — removing the bespoke explorer / indexer work a
  partitioned ERC-1410 token would otherwise require.
- **A real, deliberately accepted migration cost.** This is the most disruptive of the options
  considered: bonds redeploy (no proxy, so partitions / holders are reissued under the new tokens)
  and equities are greenfield (holder + state migration). Accepted up front in exchange for a clean,
  single standard.
- **Loss of the single-contract, multi-ISIN model.** Bonds move to one ERC-3643 token per ISIN
  (factory pattern), so there are more token contracts to deploy and track.
- **A larger contract surface to secure and audit:** identity registry, modular-compliance modules,
  and (eventually) claim issuers / ONCHAINID, instead of one token contract per asset class — the
  price of the modular decomposition is more contracts, more cross-contract calls per transfer, and
  more wiring to get right. The token itself is now standard, but the identity / compliance
  contracts are not, so tooling that wants to surface *eligibility* state still needs bespoke
  awareness (the core holder / balance / transfer views, however, come for free).
- **Cash and securities have separate eligibility sources.** WNOK keeps its allowlist, so there is
  *not* a single verified-participant set across all assets; operators maintain two mechanisms.
  Deliberate for now; revisit if cash needs the same identity guarantees.
- **This redirects the Proposed `docs/plans/erc-3643-incremental-adoption-plan.md`,** which kept the
  partitioned bond (its "Path B"). That plan must be updated to reflect full migration; this ADR is
  the load-bearing record of the new direction.
- **A foundation for further regulatory test cases.** Identity + modular compliance lets us model
  investor caps, country restrictions, lock-ups, and similar rules — the regulatory scenarios the
  sandbox exists to explore — without re-architecting the token each time.

## Alternatives considered

- **Keep ERC-1410 and bolt compliance on externally (the plan's "Path B").** Rejected: it preserves
  a fragmented, three-model design and a non-upgradeable token, and treats compliance as an add-on
  to a standard that was never built for it. We learned what we needed from the partitioned model;
  carrying it forward adds complexity without converging the design.
- **Implement the full ERC-1400 family (1594 / 1643 / 1644).** Rejected: ERC-1400 never finalized.
  Investing further in a stalled umbrella deepens lock-in to a fading ecosystem instead of the one
  the market is standardizing on.
- **Stay on plain ERC-20 + allowlists everywhere.** Rejected: no standardized identity or
  compliance, no agent powers, and it does not scale across asset classes or support the regulatory
  scenarios we want to test.
- **Do nothing for now.** Rejected: it leaves the bond transfer-eligibility gap open and postpones
  the identity layer the sandbox's next phase depends on.

## Lessons learned (ERC-1400 / ERC-1410)

Recorded here because the contracts themselves are being removed — this ADR is where the comparison
survives:

- **A standard that gives you *structure* is not one that gives you *compliance*.** Partitions are
  an organizing device, not an eligibility control. Assume a standard enforces nothing it does not
  explicitly require.
- **Verify the transfer path actually calls a compliance hook.** The bond eligibility gap was
  invisible until someone read `_move`; "it's a security-token standard" did not mean transfers were
  gated.
- **Converge on one identity source early.** Three per-asset allowlists were the symptom; a shared
  verified-participant registry is the cure.
- **Prefer finalized, audited, actively adopted standards over draft umbrellas** once you have
  learned what you need from the experiment.
- **Structure scales into a monolith unless concerns are externalized.** A token that absorbs
  accounting, lifecycle, *and* compliance becomes one coupled, hard-to-change contract; keep
  identity and compliance in separate, swappable contracts from the start.
- **A standard interface is a tooling contract.** Diverging from ERC-20 (partitions, custom transfer
  events) silently opts a token out of the wallet / explorer / indexer ecosystem; the bill arrives
  later as per-tool integration work.
- **The experiment paid off.** Testing ERC-20 / 1400 / 1410 / partitions first is *why* we can now
  state precisely what ERC-3643 must give us — the comparison, not the code, was the deliverable.

## References

- `docs/plans/erc-3643-incremental-adoption-plan.md` — the prior incremental roadmap this decision
  redirects (it kept the partitioned bond; its direction is now superseded by this ADR)
- `docs/decisions/0003-adopt-besu-qbft-osaka-with-archive-rpc.md` — the active Besu, EVM, Solidity,
  and OpenZeppelin baseline
- `docs/ARCHITECTURE.md` — on-chain token model (to be updated to the ERC-3643 design)
- `contracts/README.md` — contract set and reuse guidance (to be updated as the ERC-1410 / ERC-20
  security tokens are removed)
