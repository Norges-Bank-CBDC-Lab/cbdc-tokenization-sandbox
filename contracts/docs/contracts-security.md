# Contracts Security And Trust Assumptions

This document is an engineering trust-model draft for the contracts in
[`contracts/`](../README.md). It is intended to help external readers
understand the current security posture and operational assumptions of the
sandbox.

It is not a formal audit report, a threat model, or a production readiness
statement.

## Current posture

As of March 12, 2026, this repository does not publish an external smart
contract audit in-tree. Treat the contract system as experimental and
unaudited unless a future release states otherwise.

The contract set is designed for a sandbox and local development workflow. Some
components are explicitly test-environment oriented, for example
[`GlobalRegistry`](../src/common/GlobalRegistry.sol), which states in
code that it is not intended for production use.

## Main trust assumptions

- Privileged roles are assigned correctly during deployment and are operated by
  trusted parties.
- The off-chain auction operator correctly decrypts bids, computes allocations,
  and submits matching bidder proofs during auction finalisation.
- The deployment environment keeps contract addresses, role grants, and token
  permissions coherent across `BondManager`, `BondAuction`, `BondDvP`,
  `BondToken`, `Wnok`, and the private-bank cash components.
- The cash-side integrations and allowlists are configured correctly before any
  issuance, coupon, redemption, or buyback flow is executed.
- External observers understand that Blockscout verification and local helper
  scripts improve visibility, but they are not consensus or security controls.

## Privileged roles

The system uses `AccessControl` heavily. The most important roles are defined
in [`contracts/src/common/Roles.sol`](../src/common/Roles.sol).

| Role | Used by | Why it matters |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | multiple contracts | Can grant and revoke other roles. This is the highest-trust role and should be tightly controlled. |
| `BOND_MANAGER_ROLE` | `BondManager` | Can open, close, cancel, and finalise auctions, recover failed issuance, pay coupons, and redeem bonds. |
| `BOND_AUCTION_ADMIN_ROLE` | `BondAuction` | Can create, close, cancel, and finalise auctions. In practice this should align with the `BondManager` control path. |
| `BOND_CONTROLLER_ROLE` | `BondToken` | Can create partitions, extend or reduce offering, mint by ISIN, update coupon state, and mark bonds matured. |
| `SETTLE_ROLE` | `BondDvP` | Can execute settlement, including bond-leg and cash-leg transfers. Misconfiguration here directly affects issuance, buyback, coupon, and redemption flows. |
| `MINTER_ROLE` / `BURNER_ROLE` / `TRANSFER_FROM_ROLE` | `Wnok` and related cash flows | Control the tokenized cash leg and the ability to move cash during settlement. |

## Critical workflow boundaries

### Issuance and extension

- [`BondManager`](../src/norges-bank/BondManager.sol) is the main
  issuer-facing orchestration contract.
- New issuance uses a RATE auction and creates a new ISIN-backed partition in
  [`BondToken`](../src/norges-bank/BondToken.sol).
- Extensions use a PRICE auction and increase an existing partition offering.
- Final allocation data is not derived on-chain from sealed bids. It is
  computed off-chain and then submitted back on-chain together with bidder
  proofs.

### Buyback

- Buyback uses the same manager and auction pattern, but the settlement path is
  reversed: the government-side reserve pays holders and the security leg
  redeems the bought-back bonds.
- The buyback amount is checked against current partition supply, but correct
  operational behavior still depends on accurate role and allowance setup.

### Coupon and redemption

- Coupon and redemption flows are initiated by `BondManager`, but depend on
  `BondDvP` having the right operator permissions and cash-transfer rights.
- Coupon payment correctness depends on the holder list passed in from
  off-chain. The contract checks that the processed balances match total supply
  before updating coupon state.
- Redemption correctness depends on the provided holder list covering the full
  remaining supply for the ISIN.

## Known sandbox limitations

- Bid decryption and allocation are off-chain responsibilities. The current
  on-chain flow verifies bidder consent but does not independently derive the
  clearing result.
- [`BondManager`](../src/norges-bank/BondManager.sol) includes a
  `TODO` to publish a bid root for stronger transparency around finalisation.
- `GlobalRegistry` is explicitly documented in code as a test-environment
  helper, not a production registry design.
- The repository contains strong unit and integration coverage, but does not
  yet publish dedicated invariant or property-based tests for the bond system.
- This document does not replace a deployment runbook, key-management policy,
  or external review.

