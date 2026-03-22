# Contracts Reference

This document is a curated onboarding and reference guide to the main runtime
contracts in [`contracts/`](../README.md).

`Reference` is a better fit than `API` here. The file is descriptive and
integration-oriented, not a formal or exhaustive specification. The generated
NatSpec reference in [`natspec/`](./natspec/README.md) complements this file,
and a separate spec can be added later if the project needs a normative
contract definition.

## Scope

This reference focuses on the contracts that shape the sandbox at runtime:

- repo-wide registry and lookup
- primary bond issuance, auction, and lifecycle management
- bond-side and generic settlement flows
- cash-side contracts (`Wnok` and `Tbd`)
- secondary-market order books used in the repo

It does not try to document every factory, helper, or test-only script
contract in the tree.

For the shortest end-to-end integration path, see
[`bond-lifecycle-walkthrough.md`](./bond-lifecycle-walkthrough.md).

For ABI and compatibility expectations, see
[`contracts-versioning.md`](./contracts-versioning.md).

## System map

The current contract set falls into four main groups:

- Registry and shared infrastructure:
  `GlobalRegistry`, `Roles`, common errors and allowlists
- Primary bond lifecycle:
  `BondManager`, `BondAuction`, `BondDvP`, `BondToken`
- Cash and bank-money side:
  `Wnok`, `Tbd`
- Secondary market and generic CSD settlement:
  `BondOrderBook`, `OrderBook`, `DvP`, `BaseSecurityToken`

## Bond issuance lifecycle

1. Deploy the contract set and grant roles.
2. Use
   [`BondManager.deployBondWithAuction()`](../src/norges-bank/BondManager.sol)
   to create a new ISIN partition and open the initial sealed-bid auction.
3. Dealers submit encrypted bids through
   [`BondAuction.submitBid()`](../src/norges-bank/BondAuction.sol).
4. After bidding ends, the manager closes the auction and retrieves sealed
   bids.
5. Off-chain tooling decrypts bids, computes a uniform clearing result, and
   assembles bidder proofs.
6. The manager finalises the auction, which posts allocations and triggers DvP
   settlement.
7. Later lifecycle events use the same contract set for coupon payment,
   redemption, extension, and buyback flows.

## Secondary-market settlement lifecycle

1. A broker or admin submits a buy or sell order to an order-book contract.
2. The order book tries to match against the best available opposite-side
   orders.
3. If a match is found, the relevant settlement engine is called.
4. The security leg and cash leg either both succeed or the failure is mapped
   into a domain-specific reason so the order book can react accordingly.

In practice the repo contains two settlement styles:

- [`BondDvP`](../src/norges-bank/BondDvP.sol) for partitioned bond flows
  controlled by `BondManager`
- [`DvP`](../src/csd/DvP.sol) for the more generic CSD-style order-book flow
  using `BaseSecurityToken` and `Tbd`

## Core runtime contracts

### `GlobalRegistry`

Source:
[`contracts/src/common/GlobalRegistry.sol`](../src/common/GlobalRegistry.sol)

Role in system:
Registry of important deployed contract addresses for local lookup and
integration convenience.

Key functions:

- `setContract(name, contractAddress)`: owner-only registration or update.
- `getContract(name)`: strict lookup that reverts if the name is missing.
- `tryGetContract(name)`: tolerant lookup that returns `(found, address)`.
- `exists(name)`: quick existence check.

Important notes:

- The contract explicitly says it is intended for test environments and not
  production use.
- It is useful as a sandbox address directory, but it is not a substitute for
  a stronger production deployment registry model.

### `BondManager`

Source:
[`contracts/src/norges-bank/BondManager.sol`](../src/norges-bank/BondManager.sol)

Role in system:
Issuer-facing orchestration contract for the bond lifecycle. This is usually
the first contract to understand for the primary issuance flow.

Key functions:

- `deployBondWithAuction(isin, end, pubKey, offering, maturityDuration)`:
  creates a new bond partition and opens the initial RATE auction.
- `extendBondWithAuction(isin, end, pubKey, additionalOffering)`:
  increases an existing partition offering and opens a PRICE auction.
- `buybackWithAuction(isin, end, pubKey, buybackSize)`:
  opens a BUYBACK auction without increasing the partition offering.
- `closeAuction(isin)`:
  closes bidding after the configured end time and returns the sealed bids for
  off-chain processing.
- `finaliseAuction(isin, allocations, proofs)`:
  finalises the auction using off-chain computed allocations and bidder proofs,
  then runs DvP settlement for each allocation.
- `cancelAuction(isin)`:
  cancels an active auction and reduces the reserved offering accordingly.
- `withdrawFailedIssuance(isin)`:
  recovers unsold or failed-to-settle bonds still held by the manager contract.
- `payCoupon(isin, holders)`:
  pays the next coupon to the provided holder list and advances coupon state.
- `redeem(isin, holders)`:
  redeems the remaining supply for the provided holder list and checks that the
  partition is fully redeemed.

Important notes:

- `BondManager` depends on privileged role setup across `BondAuction`,
  `BondToken`, `BondDvP`, and the cash-side contracts.
- Auction allocation is not calculated on-chain. Finalisation assumes the
  off-chain auction operator provides correct allocations and matching proofs.
- Coupon and redemption flows depend on the caller providing a complete and
  correct holder list.
- This contract is powerful and already owns many lifecycle responsibilities,
  so new features should be added carefully to avoid turning it into a catch-all
  orchestrator.

### `BondAuction`

Source:
[`contracts/src/norges-bank/BondAuction.sol`](../src/norges-bank/BondAuction.sol)

Role in system:
Sealed-bid auction state machine for bond issuance, extension, and buyback.

Key functions:

- `createAuction(isin, owner, end, auctionPubKey, bond, offering, auctionType)`:
  admin-only creation of a RATE, PRICE, or BUYBACK auction.
- `submitBid(id, ciphertext, plaintextHash)`:
  called by bidders during the `BIDDING` phase.
- `closeAuction(id, caller)`:
  admin-only transition from `BIDDING` to `CLOSED`; returns the sealed bids.
- `finaliseAuction(id, caller, allocations, proofs)`:
  admin-only transition from `CLOSED` to `FINALISED`; validates proofs and
  posts allocations.
- `cancelAuction(id, caller)`:
  admin-only cancellation path for active auctions.
- `getAuction(id)`, `getAuctionStatus(id)`, `getSealedBids(id)`,
  `getAllocations(id)`:
  read-side inspection helpers.

Important notes:

- The first auction for an ISIN must be a RATE auction.
- Later auctions for the same ISIN must be PRICE or BUYBACK.
- For non-buyback finalisation, all allocations must share the same clearing
  rate.
- The contract validates bidder consent and allocation shape, but does not
  independently compute the auction result from raw sealed bids.

### `BondDvP`

Source:
[`contracts/src/norges-bank/BondDvP.sol`](../src/norges-bank/BondDvP.sol)

Role in system:
Delivery-versus-payment settlement engine for the bond lifecycle managed by
`BondManager`.

Key function:

- `settle(Settlement p)`:
  executes the security leg when required, then executes the cash leg, and
  returns `true` on success.

Important notes:

- Only callers with `SETTLE_ROLE` can invoke `settle`.
- Settlement behavior depends on `p.op`, which selects transfer, redeem,
  buyback, or cash-only behavior.
- Cash-leg failures and security-leg failures are normalized into the repo’s
  settlement error model.
- This contract is specific to the bond-side lifecycle. It is not the same as
  the generic CSD settlement contract in `src/csd/DvP.sol`.

### `BondToken`

Source:
[`contracts/src/norges-bank/BondToken.sol`](../src/norges-bank/BondToken.sol)

Role in system:
Partitioned bond token. A single deployment can represent multiple ISINs, with
each ISIN mapped to a partition.

Key functions:

- `createPartition(isin, offering, maturityDuration)`:
  creates a new active partition for an ISIN.
- `enableByIsin(isin, couponDuration, couponYield)`:
  activates coupon parameters and starts the maturity timer.
- `extendPartitionOffering(isin, additionalOffering)`:
  increases partition capacity.
- `reducePartitionOffering(isin, reductionAmount)`:
  decreases partition capacity, typically after cancellation.
- `mintByIsin(isin, account, value)`:
  mints bond units into an account for a specific ISIN.
- `redeemFor(holder, isin, value, operator)`:
  burns bond units during redemption.
- `buybackRedeemFor(holder, isin, value, operator)`:
  burns bond units during buyback settlement.
- `updateCouponPayment(isin, timestamp, paymentCount)`:
  advances coupon accounting.
- `setMatured(isin)`:
  marks the partition matured after the final coupon payment.
- `isinToPartition(isin)`, `partitionToIsin(partition)`, `getCouponDetails(isin)`:
  useful lookup helpers for integrations and operational tooling.

Important notes:

- The preferred integration path is usually through `BondManager`, not by
  calling `BondToken` mutation functions directly.
- Coupon yield is set from the clearing rate of the initial RATE auction.
- The implementation is ERC1410-inspired and partition-based, but external
  integrators should still review the repo-specific semantics before assuming
  drop-in compatibility with other security-token systems.

### `Wnok`

Source:
[`contracts/src/norges-bank/Wnok.sol`](../src/norges-bank/Wnok.sol)

Role in system:
Tokenized central-bank-style cash leg used by local settlement flows and by
cross-bank movements into `Tbd`.

Key functions:

- `mint(account, value)` and `burn(account, value)`:
  privileged supply management.
- `transfer(to, value)`:
  allowlist-checked user transfer.
- `transferFrom(from, to, value)`:
  role-gated cash movement used during settlement.
- `transferFromAndCall(from, to, value)`:
  settlement-oriented helper that invokes `onTransferReceived` on the receiver.

Important notes:

- The contract uses allowlist checks on cash movement.
- It implements one ERC1363-style helper, but it is not a full IERC1363 token.
- In the bank-money flow, `transferFromAndCall` is the bridge used to move
  value into a receiving `Tbd` contract.

### `Tbd`

Source:
[`contracts/src/private-bank/Tbd.sol`](../src/private-bank/Tbd.sol)

Role in system:
Tokenized bank-deposit contract used for the bank-money leg of settlement and
cross-bank customer credit transfer style movements.

Key functions:

- `cctFrom(from, to, toTbdContract, value)`:
  moves value within the same bank or across banks via the `Wnok` bridge.
- `cctSetToAddr(to)`:
  sets the payout address used by the receiving `Tbd` during cross-bank flows.
- `getBankAddress()`:
  returns the bank address associated with this `Tbd`.
- `govReserve()` and `isGovernmentNominated()`:
  expose whether the contract is configured for government-reserve-backed
  flows.
- `mint(account, value)` and `burn(account, value)`:
  privileged supply management.

Important notes:

- Same-bank transfer uses local `_transfer`; cross-bank transfer burns locally,
  prepares the receiver via `cctSetToAddr`, then moves `Wnok` into the target
  `Tbd` using `transferFromAndCall`.
- The receiver-side mint path is driven by `onTransferReceived`.
- Government nomination changes behavior: transfers from the reserve can mint
  from reserve-backed `Wnok` on demand.

### `BondOrderBook`

Source:
[`contracts/src/norges-bank/BondOrderBook.sol`](../src/norges-bank/BondOrderBook.sol)

Role in system:
Partition-specific bond order book for secondary trading against a `Tbd`
cash-side token.

Key functions:

- `buy(secContrAddr, amount, price, bondReceiver, cashPayer)`:
  submits a buy order and immediately tries to match it.
- `sell(secContrAddr, amount, price, bondSeller, cashReceiver)`:
  submits a sell order and immediately tries to match it.
- `initializeSellOrders(numIssuance, price, secContrAddr, tbdContrAddr, investorSecAddr, investorTbdAddr)`:
  bootstraps issuance-side sell liquidity.
- `revokeBuyOrder(orderId)` and `revokeSellOrder(orderId)`:
  remove an outstanding order.
- `getBuyOrders()`, `getSellOrders()`, `getAllBuyOrders()`,
  `getAllSellOrders()`:
  inspect open book state.

Important notes:

- The contract is simplified and partition-specific.
- Matching is immediate and uses maker price.
- This is separate from the auction-based primary issuance flow.

### `DvP`

Source:
[`contracts/src/csd/DvP.sol`](../src/csd/DvP.sol)

Role in system:
Generic CSD-style delivery-versus-payment engine used by the order-book stack.

Key function:

- `settle(secContrAddr, sellerSecAddr, buyerSecAddr, secValue, sellerTbdAddr, buyerTbdAddr, wholesaleValue, sellerTbdContrAddr, buyerTbdContrAddr)`:
  settles the security leg via a custodial transfer and the cash leg via
  `Tbd.cctFrom`.

Important notes:

- The security contract is expected to be `BaseSecurityToken`-compatible and
  expose `custodialTransfer`.
- Settlement failures are mapped to `Buyer`, `Seller`, or `Unknown` so the
  order book can decide whether to preserve or revoke orders.
- This contract serves a different slice of the system than `BondDvP`.

### `OrderBook`

Source:
[`contracts/src/csd/OrderBook.sol`](../src/csd/OrderBook.sol)

Role in system:
Generic central limit order book used with `BaseSecurityToken`-style
securities, `Tbd`, and the generic `DvP`.

Key functions:

- `buy(secContrAddr, amount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr)`:
  places a buy order and attempts immediate settlement.
- `sell(secContrAddr, amount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr)`:
  places a sell order and attempts immediate settlement.
- `initializeSellOrders(numIssuance, price, secContrAddr, tbdContrAddr, investorSecAddr, investorTbdAddr)`:
  seeds initial sell-side book state.
- `revokeBuyOrder(orderId)` and `revokeSellOrder(orderId)`:
  cancel open orders.
- `getBuyOrders()`, `getSellOrders()`, `getAllBuyOrders()`,
  `getAllSellOrders()`:
  inspect open book state.

Important notes:

- The order book is tightly coupled to the settlement model in `DvP`.
- Unknown settlement errors are intentionally treated differently from
  buyer-side or seller-side faults so matching can continue where appropriate.
- The contract uses `nonReentrant` because it sits on top of a multi-contract
  settlement stack.

### `BaseSecurityToken`

Source:
[`contracts/src/csd/BaseSecurityToken.sol`](../src/csd/BaseSecurityToken.sol)

Role in system:
Upgradeable base contract for CSD-style securities used with the generic
`OrderBook` and `DvP` stack.

Key functions:

- `baseSecurityInit(tokenName, tokenSymbol, description, initialOwner)`:
  initializer for derived security tokens.
- `custodialTransfer(from, to, amount)`:
  privileged transfer entrypoint used during settlement.
- `grantRoleTo(role, account)` and `revokeRoleFrom(role, account)`:
  operator-managed role control for known security roles.
- `isCSDApproved(csd)`:
  tells integrators whether a CSD operator can call `custodialTransfer`.
- `securityType()`:
  abstract function implemented by derived securities.

Important notes:

- The contract is upgradeable and explicitly documented as test-environment
  oriented rather than production-ready.
- `DvP` assumes the security side exposes the behavior defined here, especially
  `custodialTransfer`.
- All transfer paths still run through the allowlist checks inherited from
  `AllowlistUpgradeable`.

