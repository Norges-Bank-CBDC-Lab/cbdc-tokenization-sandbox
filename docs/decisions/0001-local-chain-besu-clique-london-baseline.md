# 0001. Local chain runs Hyperledger Besu on a Clique + London baseline

- **Status:** Accepted
- **Date:** 2026-06-19
- **Deciders:** sandbox operator
- **Tags:** besu, infra, contracts

## Context

The sandbox needs a deterministic, single-node chain that any contributor can run locally with no
external network and no real cost, and whose behaviour is identical on every machine so contract
builds, Foundry tooling, and Blockscout indexing are reproducible.

The chain is configured in `infra/besu/config/genesis.json`:

- `chainId: 2018`
- Clique proof-of-authority consensus with a single signer, `blockperiodseconds: 1`, and
  `createemptyblocks: false` (blocks are minted only when there is a transaction)
- `londonBlock: 0` — the EVM is at the London milestone from genesis
- `zeroBaseFee: true` / `baseFeePerGas: 0x0` — a zero-base-fee deploy path

The Solidity toolchain is pinned to match: `evm_version = "london"` in `contracts/foundry.toml`.
Newer EVM milestones and QBFT consensus have not been re-validated end-to-end across contract
deployment, fee handling, and Blockscout behaviour in this repo (see `docs/KNOWN_ISSUES.md` and the
"When Revisiting The Chain Baseline" section of `infra/DEVELOPMENT.md`).

## Decision

We will run the local chain as a single-node Hyperledger Besu network using Clique proof-of-authority
consensus pinned to the London EVM milestone, with a zero-base-fee genesis, and keep the contract
toolchain's `evm_version` pinned to `london` to match. This is the known-good local baseline.

## Consequences

- Easier: deterministic, near-instant, single-signer block production with no external dependency, a
  stable EVM target, and a zero-base-fee path that avoids local gas-funding mechanics.
- Harder: post-London opcodes are unavailable — notably `PUSH0` — so any contract or compiler that
  drifts off the London baseline can fail to deploy with `Invalid opcode: 0x5f`. Foundry deploys may
  also need explicit gas settings to avoid `upfront cost exceeds account balance`.
- Because `createemptyblocks: false`, the chain clock advances only on transactions and lags
  wall-clock; time-sensitive flows (e.g. closing a sealed-bid auction after its scheduled end) must
  account for stale-block gas estimation. These accepted limitations are tracked in
  `docs/KNOWN_ISSUES.md`.
- Moving to QBFT or a later EVM milestone is a future decision that requires re-validating the full
  local workflow. When taken, it will be recorded as a new ADR that supersedes this one — not an
  edit to it.

## References

- `infra/besu/config/genesis.json` — chain configuration
- `infra/DEVELOPMENT.md` — "Current Besu Baseline" and "When Revisiting The Chain Baseline"
- `contracts/foundry.toml` — `evm_version = "london"`
- `docs/KNOWN_ISSUES.md` — Besu baseline, `PUSH0`, and Foundry fee notes
- `docs/ARCHITECTURE.md` — current local chain baseline
