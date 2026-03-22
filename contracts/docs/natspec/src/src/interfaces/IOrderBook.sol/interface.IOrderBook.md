# IOrderBook
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/interfaces/IOrderBook.sol)


## Functions
### buy


```solidity
function buy(
    address secContrAddr,
    uint256 amount,
    uint256 bidPrice,
    address buyerSecAddr,
    address buyerTbdAddr,
    address buyerBankTbdContrAddr
) external returns (SettlementInfo memory);
```

### sell


```solidity
function sell(
    address secContrAddr,
    uint256 amount,
    uint256 askPrice,
    address sellerSecAddr,
    address sellerTbdAddr,
    address sellerBankTbdContrAddr
) external returns (SettlementInfo memory);
```

### getBuyOrders


```solidity
function getBuyOrders() external view returns (Order[] memory);
```

### getSellOrders


```solidity
function getSellOrders() external view returns (Order[] memory);
```

### getBuyOrders


```solidity
function getBuyOrders(address investorSecAddr) external view returns (Order[] memory);
```

### getSellOrders


```solidity
function getSellOrders(address investorSecAddr) external view returns (Order[] memory);
```

### getAllBuyOrders


```solidity
function getAllBuyOrders() external view returns (Order[] memory);
```

### getAllSellOrders


```solidity
function getAllSellOrders() external view returns (Order[] memory);
```

### revokeBuyOrder


```solidity
function revokeBuyOrder(bytes32 orderId) external returns (bool);
```

### revokeSellOrder


```solidity
function revokeSellOrder(bytes32 orderId) external returns (bool);
```

### initializeSellOrders


```solidity
function initializeSellOrders(
    uint256 numIssuance,
    uint256 price,
    address secContrAddr,
    address tbdContrAddr,
    address investorSecAddr,
    address investorTbdAddr
) external returns (bool);
```

## Events
### OrderSubmittedEvent
An event emitted when an order is successfully submitted by a broker.


```solidity
event OrderSubmittedEvent(
    address indexed secContrAddr,
    uint256 amount,
    uint256 price,
    address indexed investorSecAddr,
    address indexed investorBankTbdContrAddr
);
```

### OrderMatchedEvent
An event emitted when an order from the order book is matched.


```solidity
event OrderMatchedEvent(bytes32 orderId);
```

### OrderRevokedEvent
An event emitted when an order is revoked (and thus removed from the order book).


```solidity
event OrderRevokedEvent(bytes32 orderId);
```

## Errors
### RethrowError
This error can be used to re-throw low level data from a caught revert.


```solidity
error RethrowError(string message, bytes lowLevelData);
```

## Structs
### Order
Represents a limit order in the CLOB.


```solidity
struct Order {
    bytes32 id;
    address broker;
    address investorSecAddr;
    address secContrAddr;
    uint256 amount;
    uint256 price;
    address investorTbdAddr;
    address tbdContrAddr;
    bool isBuySide;
    bytes32 next;
    bytes32 prev;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`id`|`bytes32`|Unique order identifier.|
|`broker`|`address`|Address that submitted the order.|
|`investorSecAddr`|`address`|Bond holder for the security leg.|
|`secContrAddr`|`address`|Bond token address (ERC1410).|
|`amount`|`uint256`|Units to trade.|
|`price`|`uint256`|Quote price (per unit).|
|`investorTbdAddr`|`address`|Cash address for the counter leg.|
|`tbdContrAddr`|`address`|Cash token address (TBD/ERC20).|
|`isBuySide`|`bool`|True for buy orders, false for sell orders.|
|`next`|`bytes32`|Next order id in the price-level linked list.|
|`prev`|`bytes32`|Previous order id in the price-level linked list.|

### PriceLevel
Represents a price level in the CLOB. A price level is a group of orders
that all have the same price. Price levels form a doubly-linked list, with each
level containing a linked list of orders at that price.


```solidity
struct PriceLevel {
    uint256 price;
    bytes32 head;
    bytes32 tail;
    uint256 prev;
    uint256 next;
    uint256 volume;
    bool exists;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`price`|`uint256`|The price level value (e.g., 100 NOK)|
|`head`|`bytes32`|First order ID at this price level (bytes32(0) if empty)|
|`tail`|`bytes32`|Last order ID at this price level (bytes32(0) if empty)|
|`prev`|`uint256`|Previous price level (0 if best price)|
|`next`|`uint256`|Next price level (0 if worst price)|
|`volume`|`uint256`|Total amount of all orders at this price level|
|`exists`|`bool`|Whether this price level has been initialized|

