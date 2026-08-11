# 0003. Adopt Besu QBFT and Osaka with a separate archive/RPC node

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** sandbox operator
- **Tags:** besu, qbft, osaka, archive, contracts

## Context

Besu 26.4.0 removed pure Clique support, preventing the sandbox from remaining
on Clique while upgrading to current Besu releases. The existing combined node
also made block production, application RPC, Blockscout tracing, and historical
state dependent on one process. Solidity and OpenZeppelin were held back by the
London execution target.

An isolated Besu 26.7.0 spike validated QBFT with Osaka active from genesis,
Solidity 0.8.36, OpenZeppelin 5.6.1, a separate Forest archive node, Blockscout
indexing and verification, complete contract deployment, and the live bond
auction/settlement workflow.

## Decision

The local chain will use Besu 26.7.0 with QBFT and Osaka active from genesis.
The default sandbox has one QBFT validator and one non-validator archive/RPC
node. Applications, deployment tools, and Blockscout use only the archive/RPC
service. Both nodes use explicit static peers and distinct identities, storage,
and keys. The archive uses `FULL` sync with `FOREST`; the validator uses Bonsai.
Kubernetes headless-service DNS is resolved to pod IPs by init containers because
Besu requires literal IP addresses for `--p2p-host` and static enodes.

The chain retains ID 2018, zero base fee, and the fixed predeployed
`GlobalRegistry`. Both nodes use the sequenced transaction pool because the
sandbox deliberately submits zero-fee transactions from unfunded signing roles.

No Ethereum beacon or consensus-layer client is deployed. QBFT consensus is
implemented inside Besu. A Besu bootnode profile is also outside the accepted
scope. Additional test nodes require deliberate peer configuration, and peer
discovery would not add a QBFT validator in any case.

Ethereum proof-of-stake request-processing system contracts are intentionally
not predeployed. They serve beacon-chain withdrawals, consolidation, and
deposit requests; this private QBFT network has no beacon chain or Engine API
consensus client to originate or consume those requests.

## Consequences

- The one-validator default is deterministic but is not Byzantine fault
  tolerant. Meaningful QBFT resilience testing needs at least four validators.
- Archive/RPC outages no longer stop consensus, and validator RPC is not exposed
  to applications.
- Clique storage, Blockscout data, and application projections cannot be reused.
  The upgrade is a destructive clean-chain replacement.
- Solidity 0.8.36, Osaka, and OpenZeppelin 5.6.1 change bytecode and CREATE2
  addresses. Public ABIs remain stable, but old predicted addresses are invalid.
- Osaka caps individual transactions at 16,777,216 gas even though the block gas
  limit is 60,000,000.

## References

- `docs/plans/archive/besu-qbft-osaka-upgrade-plan.md`
- `infra/besu/`
- `contracts/foundry.toml`
- `docs/ARCHITECTURE.md`
