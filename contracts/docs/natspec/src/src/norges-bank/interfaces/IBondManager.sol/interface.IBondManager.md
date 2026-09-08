# IBondManager
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e1ad13913c0726f3f8165cafaa1413435020decc/src/norges-bank/interfaces/IBondManager.sol)

Interface for the Bond Manager contract.


## Events
### BondCreated

```solidity
event BondCreated(string isin, address bondAddress, uint256 maturityDurationSeconds);
```

### BondDisabled

```solidity
event BondDisabled(string isin);
```

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

### CouponPaid

```solidity
event CouponPaid(string indexed isin, address indexed holder, uint256 paymentAmount, uint256 paymentNumber);
```

### BondRedeemed

```solidity
event BondRedeemed(string indexed isin, address indexed holder, uint256 value, uint256 wnokAmount);
```

### BondMatured

Emitted once when the final coupon closes the bond: every unit is burned, holders
were paid coupon plus principal, and unsold units held by the manager were burned
without payment.

```solidity
event BondMatured(
    string indexed isin, uint256 paymentCount, uint256 principalPaid, uint256 couponPaid, uint256 unsoldBurned
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|ISIN of the closed bond.|
|`paymentCount`|`uint256`|Number of coupon periods paid over the bond's life.|
|`principalPaid`|`uint256`|Total nominal repaid to holders in WNOK.|
|`couponPaid`|`uint256`|Total coupon paid in the final period in WNOK.|
|`unsoldBurned`|`uint256`|Units held by the manager that were burned without payment.|

