# IBondToken
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/interfaces/IBondToken.sol)

**Inherits:**
[IERC1410](../../ERC1410/IERC1410.sol/interface.IERC1410.md)

Interface for the ERC1410-partitioned bond token keyed by ISIN.


## Functions
### UNIT_NOMINAL


```solidity
function UNIT_NOMINAL() external view returns (uint256);
```

### activePartitions


```solidity
function activePartitions(bytes32 partition) external view returns (bool);
```

### partitionOffering


```solidity
function partitionOffering(bytes32 partition) external view returns (uint256);
```

### maturityDuration


```solidity
function maturityDuration(bytes32 partition) external view returns (uint256);
```

### maturityDate


```solidity
function maturityDate(bytes32 partition) external view returns (uint256);
```

### couponDuration


```solidity
function couponDuration(bytes32 partition) external view returns (uint256);
```

### couponYield


```solidity
function couponYield(bytes32 partition) external view returns (uint256);
```

### lastCouponPayment


```solidity
function lastCouponPayment(bytes32 partition) external view returns (uint256);
```

### couponPaymentCount


```solidity
function couponPaymentCount(bytes32 partition) external view returns (uint256);
```

### isMatured


```solidity
function isMatured(bytes32 partition) external view returns (bool);
```

### addController


```solidity
function addController(address _controller) external;
```

### isinToPartition


```solidity
function isinToPartition(string memory _isin) external pure returns (bytes32 partition);
```

### partitionToIsin


```solidity
function partitionToIsin(bytes32 partition) external view returns (string memory);
```

### createPartition


```solidity
function createPartition(string memory _isin, uint256 _offering, uint256 _maturityDuration) external;
```

### enableByIsin


```solidity
function enableByIsin(string memory _isin, uint256 _couponDuration, uint256 _couponYield) external;
```

### extendPartitionOffering


```solidity
function extendPartitionOffering(string memory _isin, uint256 _additionalOffering) external;
```

### reducePartitionOffering


```solidity
function reducePartitionOffering(string memory _isin, uint256 _reductionAmount) external;
```

### mintByIsin


```solidity
function mintByIsin(string memory _isin, address account, uint256 value) external;
```

### redeemFor


```solidity
function redeemFor(address _holder, string memory _isin, uint256 _value, address _operator) external;
```

### buybackRedeemFor


```solidity
function buybackRedeemFor(address _holder, string memory _isin, uint256 _value, address _operator) external;
```

### updateCouponPayment


```solidity
function updateCouponPayment(string memory _isin, uint256 _timestamp, uint256 _paymentCount) external;
```

### setMatured


```solidity
function setMatured(string memory _isin) external;
```

### getCouponDetails


```solidity
function getCouponDetails(string memory _isin)
    external
    view
    returns (
        uint256 _couponDuration,
        uint256 _couponYield,
        uint256 _maturityDuration,
        uint256 _lastCouponPayment,
        uint256 _couponPaymentCount
    );
```

## Events
### IsinIssued

```solidity
event IsinIssued(string isin, uint256 offering);
```

### IsinEnabled

```solidity
event IsinEnabled(string isin, uint256 couponDuration, uint256 couponYield);
```

### IsinExtended

```solidity
event IsinExtended(string isin, uint256 delta, uint256 newOffering);
```

### IsinReduced

```solidity
event IsinReduced(string isin, uint256 delta, uint256 newOffering);
```

### IsinMinted

```solidity
event IsinMinted(string isin, address dst, uint256 value);
```

### IsinRedeemed

```solidity
event IsinRedeemed(string isin, address indexed holder, uint256 value, address operator);
```

