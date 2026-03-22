# BondOrderBookFactory
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondOrderBookFactory.sol)

**Inherits:**
AccessControl

**Title:**
BondOrderBookFactory

Deploys one BondOrderBook per (bondToken, partition) pair using CREATE2 for determinism.


## Constants
### TBD
Address of the Tbd contract (cash leg)


```solidity
address public immutable TBD
```


### ADMIN
Admin for deployed order books


```solidity
address public immutable ADMIN
```


## State Variables
### getOrderBook
key = keccak256(abi.encode(bondToken, partition))


```solidity
mapping(bytes32 => address) public getOrderBook
```


### allOrderBooks

```solidity
address[] public allOrderBooks
```


## Functions
### constructor


```solidity
constructor(address _admin, address _tbd) ;
```

### allOrderBooksLength


```solidity
function allOrderBooksLength() external view returns (uint256);
```

### createBondOrderBook

Deploy a bond order book for a specific bond partition.


```solidity
function createBondOrderBook(address bondToken, bytes32 partition)
    external
    onlyRole(Roles.ORDER_ADMIN_ROLE)
    returns (address orderBook);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`bondToken`|`address`|Address of the BondToken (ERC1410) contract.|
|`partition`|`bytes32`|Partition (ISIN) identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`orderBook`|`address`|deployed address.|


### computeBondOrderBookAddress

Precompute the order book address for (bondToken, partition).


```solidity
function computeBondOrderBookAddress(address bondToken, bytes32 partition) external view returns (address);
```

## Events
### BondOrderBookCreated

```solidity
event BondOrderBookCreated(address indexed bondToken, bytes32 indexed partition, address indexed orderBook);
```

