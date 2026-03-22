# Errors
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/Errors.sol)


## Errors
### AllowlistViolation

```solidity
error AllowlistViolation(string contractname, address account, string message);
```

### AdminAddressZero

```solidity
error AdminAddressZero();
```

### WnokAddressZero

```solidity
error WnokAddressZero();
```

### DvpAddressZero

```solidity
error DvpAddressZero();
```

### OrderBookAddressZero

```solidity
error OrderBookAddressZero();
```

### SecurityMismatch

```solidity
error SecurityMismatch();
```

### InvalidAmount

```solidity
error InvalidAmount();
```

### InvalidPrice

```solidity
error InvalidPrice();
```

### OrderNotFound

```solidity
error OrderNotFound();
```

### UnauthorizedBroker

```solidity
error UnauthorizedBroker();
```

### DuplicateOrderBook

```solidity
error DuplicateOrderBook(address security);
```

### SecurityAddressZero

```solidity
error SecurityAddressZero();
```

### OfferingZero

```solidity
error OfferingZero();
```

### MaturityDurationZero

```solidity
error MaturityDurationZero();
```

### AdditionalOfferingZero

```solidity
error AdditionalOfferingZero();
```

### NoAllocations

```solidity
error NoAllocations();
```

### SettlementFailure

```solidity
error SettlementFailure(uint8 reason, bytes lowLevelData);
```

### InvalidRecipient

```solidity
error InvalidRecipient();
```

### InvalidHolder

```solidity
error InvalidHolder(address holder);
```

### InsufficientBalance

```solidity
error InsufficientBalance();
```

### InsufficientPartitionBalance

```solidity
error InsufficientPartitionBalance();
```

### NotMultipleOfGranularity

```solidity
error NotMultipleOfGranularity();
```

### UnauthorizedOperator

```solidity
error UnauthorizedOperator();
```

### TbdAddressZero

```solidity
error TbdAddressZero();
```

### PartitionZero

```solidity
error PartitionZero();
```

### ContractNotFound

```solidity
error ContractNotFound(string contractAddress);
```

### InvalidContractAddress

```solidity
error InvalidContractAddress(address contractAddress);
```

### NotDeployer

```solidity
error NotDeployer();
```

### DeployerAddressZero

```solidity
error DeployerAddressZero();
```

### ImplementationAddressZero

```solidity
error ImplementationAddressZero();
```

### StockTokenCloneFailed

```solidity
error StockTokenCloneFailed(string name, string symbol, address implementation);
```

### DuplicateStockToken

```solidity
error DuplicateStockToken(string isin, address token);
```

### MissingRole

```solidity
error MissingRole(bytes32 role, address account);
```

### NotInAllowlist

```solidity
error NotInAllowlist(string list, address addr);
```

### BankAddressZero

```solidity
error BankAddressZero();
```

### CallbackFailed

```solidity
error CallbackFailed(bytes4 received);
```

### InvalidReceiver

```solidity
error InvalidReceiver();
```

### TokenTransferFailed

```solidity
error TokenTransferFailed();
```

### CctFailed

```solidity
error CctFailed();
```

### NotGovernmentNominated

```solidity
error NotGovernmentNominated();
```

### BondTokenAddressZero

```solidity
error BondTokenAddressZero();
```

### DurationScalarZero

```solidity
error DurationScalarZero();
```

### BondUnitNominalZero

```solidity
error BondUnitNominalZero();
```

### BondDoesNotExist

```solidity
error BondDoesNotExist(string isin);
```

### IncorrectBondState

```solidity
error IncorrectBondState(string isin, bool expected);
```

### NoFailedIssuance

```solidity
error NoFailedIssuance();
```

### InvalidGovTbd

```solidity
error InvalidGovTbd();
```

### RedemptionIncomplete

```solidity
error RedemptionIncomplete(string _isin, uint256 remaining);
```

### BuybackExceedsSupply

```solidity
error BuybackExceedsSupply(string isin, uint256 buybackSize, uint256 currentSupply);
```

### BuybackOfferingZero

```solidity
error BuybackOfferingZero(string isin);
```

### CouponNotReady

```solidity
error CouponNotReady(string isin, uint256 nextPaymentTime, uint256 currentTime);
```

### AllCouponsPaid

```solidity
error AllCouponsPaid(string isin);
```

### CouponPaymentBalanceMismatch

```solidity
error CouponPaymentBalanceMismatch(string isin, uint256 processedBalance, uint256 totalSupply);
```

### IncorrectAuctionPhase

```solidity
error IncorrectAuctionPhase(bytes32 id, uint8 expected, uint8 actual);
```

### AuctioneerPubkeyMissing

```solidity
error AuctioneerPubkeyMissing();
```

### InvalidAuctionOwner

```solidity
error InvalidAuctionOwner();
```

### BiddingEndNotFuture

```solidity
error BiddingEndNotFuture();
```

### FirstAuctionMustBeRate

```solidity
error FirstAuctionMustBeRate();
```

### PreviousAuctionActive

```solidity
error PreviousAuctionActive(bytes32 id);
```

### AuctionTypeMustBePrice

```solidity
error AuctionTypeMustBePrice();
```

### AuctionNotFound

```solidity
error AuctionNotFound(bytes32 id);
```

### AuctionNotFoundForIsin

```solidity
error AuctionNotFoundForIsin(string isin);
```

### NotAuctionOwner

```solidity
error NotAuctionOwner();
```

### InBidPhase

```solidity
error InBidPhase();
```

### CannotCancelAuctionInThisState

```solidity
error CannotCancelAuctionInThisState();
```

### AllocationTypeMismatch

```solidity
error AllocationTypeMismatch();
```

### InvalidUnits

```solidity
error InvalidUnits();
```

### RatesMustMatch

```solidity
error RatesMustMatch();
```

### InvalidRate

```solidity
error InvalidRate();
```

### OverAllocation

```solidity
error OverAllocation(uint256 total, uint256 offering);
```

### NotInBidPhase

```solidity
error NotInBidPhase();
```

### CiphertextRequired

```solidity
error CiphertextRequired();
```

### PlaintextHashRequired

```solidity
error PlaintextHashRequired();
```

### ProofLengthMismatch

```solidity
error ProofLengthMismatch(uint256 expected, uint256 actual);
```

### InvalidBidIndex

```solidity
error InvalidBidIndex(uint256 max, uint256 actual);
```

### MissingBidSig

```solidity
error MissingBidSig();
```

### InvalidBidSig

```solidity
error InvalidBidSig();
```

### InvalidBidNonce

```solidity
error InvalidBidNonce();
```

### ControllerAddressZero

```solidity
error ControllerAddressZero();
```

### CouponDurationZero

```solidity
error CouponDurationZero();
```

### CouponYieldZero

```solidity
error CouponYieldZero();
```

### ReductionAmountZero

```solidity
error ReductionAmountZero();
```

### ReductionExceedsOffering

```solidity
error ReductionExceedsOffering(uint256 offering, uint256 reduction);
```

### ReductionBelowSupply

```solidity
error ReductionBelowSupply(uint256 currentSupply, uint256 offeringAfterReduction);
```

### PartitionNotActive

```solidity
error PartitionNotActive(string isin);
```

### DuplicatePartition

```solidity
error DuplicatePartition(string isin);
```

### ExceedsOffering

```solidity
error ExceedsOffering(string isin, uint256 currentSupply, uint256 mintAmount, uint256 offering);
```

### NotMatured

```solidity
error NotMatured(string isin, uint256 maturityDate, uint256 currentTime);
```

### MaturityDateZero

```solidity
error MaturityDateZero();
```

### InvalidGranularity

```solidity
error InvalidGranularity();
```

### ControllerZeroAddress

```solidity
error ControllerZeroAddress();
```

### PayerOrPayeeZero

```solidity
error PayerOrPayeeZero();
```

### InvalidOperation

```solidity
error InvalidOperation();
```

### NotAdmin

```solidity
error NotAdmin();
```

