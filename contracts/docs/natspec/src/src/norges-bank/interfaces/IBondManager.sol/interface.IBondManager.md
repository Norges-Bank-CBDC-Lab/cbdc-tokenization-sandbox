# IBondManager
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/interfaces/IBondManager.sol)

Interface for the Bond Manager contract.


## Events
### BondAuctionInitialised

```solidity
event BondAuctionInitialised(
    bytes32 indexed id, string isin, address bondAddress, uint256 offering, uint256 maturityDurationSeconds
);
```

### BondExtensionAuctionInitialised

```solidity
event BondExtensionAuctionInitialised(
    bytes32 indexed id, string isin, address bondAddress, uint256 additionalOffering
);
```

### BondBuybackAuctionInitialised

```solidity
event BondBuybackAuctionInitialised(bytes32 indexed id, string isin, address bondAddress, uint256 buybackSize);
```

### BondAuctionClosed

```solidity
event BondAuctionClosed(bytes32 indexed id, string isin);
```

### BondAuctionFinalised

```solidity
event BondAuctionFinalised(bytes32 indexed id, string isin, bool dvpSuccess);
```

### BondAuctionCancelled

```solidity
event BondAuctionCancelled(bytes32 indexed id, string isin, uint256 offeringReduced);
```

### BondAllocationFailed

```solidity
event BondAllocationFailed(bytes32 indexed id, string isin, address indexed bidder, string reason);
```

### BondIssuanceComplete

```solidity
event BondIssuanceComplete(bytes32 indexed id, string isin, uint256 total);
```

### BondBuybackComplete

```solidity
event BondBuybackComplete(bytes32 indexed id, string isin, uint256 total);
```

### BondRedeemed

```solidity
event BondRedeemed(string indexed isin, address indexed holder, uint256 value, uint256 wnokAmount);
```

### BondRedemptionComplete

```solidity
event BondRedemptionComplete(string indexed isin);
```

### CouponPaid

```solidity
event CouponPaid(string indexed isin, address indexed holder, uint256 paymentAmount, uint256 paymentNumber);
```

### AllCouponsPaid

```solidity
event AllCouponsPaid(string indexed isin);
```

