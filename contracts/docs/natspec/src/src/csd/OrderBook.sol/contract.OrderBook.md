# OrderBook
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/OrderBook.sol)

**Inherits:**
[IOrderBook](../../interfaces/IOrderBook.sol/interface.IOrderBook.md), AccessControl, ReentrancyGuard

To prevent re-entrant manipulation of order book states by other contract in
the settlement stack, all external/public functions of this contract which
access the order book arrays should have the nonReentrant modifier.


## Constants
### _wnok

```solidity
Wnok private immutable _wnok
```


### _dvp

```solidity
DvP private immutable _dvp
```


### SECURITY

```solidity
address public immutable SECURITY
```


## State Variables
### _supportedInterfaces
ERC165 supported interfaces.


```solidity
mapping(bytes4 => bool) internal _supportedInterfaces
```


### bestBidPrice

```solidity
uint256 public bestBidPrice
```


### bestAskPrice

```solidity
uint256 public bestAskPrice
```


### orders

```solidity
mapping(bytes32 => Order) public orders
```


### buyLevels

```solidity
mapping(uint256 => PriceLevel) internal buyLevels
```


### sellLevels

```solidity
mapping(uint256 => PriceLevel) internal sellLevels
```


### _orderIdNonce

```solidity
uint256 private _orderIdNonce
```


## Functions
### constructor

Constructor for the OrderBook contract.


```solidity
constructor(address admin, address wnokContrAddr, address dvpContrAddr, address securityAddr) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`admin`|`address`|The address of the admin.|
|`wnokContrAddr`|`address`|The address of the Wnok contract.|
|`dvpContrAddr`|`address`|The address of the DvP contract.|
|`securityAddr`|`address`|The address of the security contract this OrderBook handles.|


### supportsInterface

See [IERC165-supportsInterface](../../norges-bank/BondToken.sol/contract.BondToken.md#supportsinterface).


```solidity
function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool);
```

### _settleBuyOrder

Tries to settle a buy order by looking for a matching sell order in the order book.


```solidity
function _settleBuyOrder(Order memory buyOrder) internal returns (SettlementInfo memory, uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`buyOrder`|`Order`|The buy order to settle.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|settlementInfo containing settlement details.|
|`<none>`|`uint256`|remainingAmount the amount that was not settled.|


### _settleSellOrder

Tries to settle a sell order by looking for a matching buy order in the order book.


```solidity
function _settleSellOrder(Order memory sellOrder) internal returns (SettlementInfo memory, uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`sellOrder`|`Order`|The sell order to settle.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|settlementInfo containing settlement details.|
|`<none>`|`uint256`|remainingAmount the amount that was not settled.|


### _ordersMatch


```solidity
function _ordersMatch(Order memory buyOrder, Order memory sellOrder) internal pure returns (bool);
```

### _createSettlementInfo

Helper function to create a SettlementInfo struct.


```solidity
function _createSettlementInfo(bool settled, bool validOrder, bytes32 orderId, uint256 settlementAmount)
    internal
    pure
    returns (SettlementInfo memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`settled`|`bool`||
|`validOrder`|`bool`||
|`orderId`|`bytes32`||
|`settlementAmount`|`uint256`|The total quantity/amount of securities traded (0 if unmatched or dropped).|


### _createOrder

Helper function to create an Order struct.


```solidity
function _createOrder(
    bytes32 orderId,
    address broker,
    address investorSecAddr,
    address secContrAddr,
    uint256 amount,
    uint256 price,
    address investorTbdAddr,
    address tbdContrAddr,
    bool isBuySide
) internal pure returns (Order memory);
```

### _settle

Settles a matched pair of buy and sell orders via the DvP contract.


```solidity
function _settle(Order memory buyOrder, Order memory sellOrder, uint256 amount, uint256 settlementPrice)
    internal
    returns (bool, DvP.FailureReason);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`buyOrder`|`Order`|The buy order.|
|`sellOrder`|`Order`|The sell order.|
|`amount`|`uint256`|The amount to trade.|
|`settlementPrice`|`uint256`|The price at which to settle.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|success Whether the settlement succeeded.|
|`<none>`|`DvP.FailureReason`|reason The failure reason if settlement failed.|


### trimBytes

Due to restrictions in Solidity, we cannot slice a `bytes memory`, only `bytes calldata`.
Wrapping this operation in an external function with calldata argument is a
possible workaround without resorting to assembly.
This function must be external/public and must be called as `this.trimBytes`.


```solidity
function trimBytes(bytes calldata data, uint256 ix) external pure returns (bytes calldata);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`data`|`bytes`|The bytes data to trim.|
|`ix`|`uint256`|The index from which to start the slice.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes`|The trimmed bytes data.|


### buy

Submit a buy order to the order book.
Orders are always limit orders.

A function for brokers to submit a limit order to the order book, to buy a security.


```solidity
function buy(
    address secContrAddr,
    uint256 amount,
    uint256 bidPrice,
    address buyerSecAddr,
    address buyerTbdAddr,
    address buyerBankTbdContrAddr
) public override nonReentrant onlyRole(Roles.SUBMIT_ORDER_ROLE) returns (SettlementInfo memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`secContrAddr`|`address`|The address of the contract of the security that the broker wants to buy.|
|`amount`|`uint256`|The amount of securities to be bought.|
|`bidPrice`|`uint256`|The maximum price at which to trade the security.|
|`buyerSecAddr`|`address`|The address that will own the bought security.|
|`buyerTbdAddr`|`address`|The address that owns the TBD funds to buy the security.|
|`buyerBankTbdContrAddr`|`address`|The address of the TBD contract with which to buy the security.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|SettlementInfo containing settlement details.|


### sell

Submit a sell order to the order book.
Orders are always limit orders.

A function for brokers to submit a limit order to the order book, to sell a security.


```solidity
function sell(
    address secContrAddr,
    uint256 amount,
    uint256 askPrice,
    address sellerSecAddr,
    address sellerTbdAddr,
    address sellerBankTbdContrAddr
) public override nonReentrant onlyRole(Roles.SUBMIT_ORDER_ROLE) returns (SettlementInfo memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`secContrAddr`|`address`|The address of the contract of the security that the broker wants to sell.|
|`amount`|`uint256`|The amount of securities to be sold.|
|`askPrice`|`uint256`|The minimum price for which to trade the security.|
|`sellerSecAddr`|`address`|The address that owns the security to be sold.|
|`sellerTbdAddr`|`address`|The address that will receive the TBD funds in exchange for the security.|
|`sellerBankTbdContrAddr`|`address`|The address of the TBD contract with which to receive the funds for the security.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|SettlementInfo containing settlement details.|


### getBuyOrders

The following getter functions are provided for backwards compatibility.
For production use, these should be indexed off-chain from events to scale efficiently.


```solidity
function getBuyOrders() external view override returns (Order[] memory);
```

### getSellOrders


```solidity
function getSellOrders() external view override returns (Order[] memory);
```

### getBuyOrders


```solidity
function getBuyOrders(address investorSecAddr) external view override returns (Order[] memory);
```

### getSellOrders


```solidity
function getSellOrders(address investorSecAddr) external view override returns (Order[] memory);
```

### getAllBuyOrders


```solidity
function getAllBuyOrders() external view override returns (Order[] memory);
```

### getAllSellOrders


```solidity
function getAllSellOrders() external view override returns (Order[] memory);
```

### _fetchOrders


```solidity
function _fetchOrders(bool isBuySide, address broker, address investor) internal view returns (Order[] memory);
```

### revokeBuyOrder


```solidity
function revokeBuyOrder(bytes32 orderId) external override nonReentrant returns (bool);
```

### revokeSellOrder


```solidity
function revokeSellOrder(bytes32 orderId) external override nonReentrant returns (bool);
```

### initializeSellOrders

Initializes sell orders for a security issuance. Creates individual orders for each unit.


```solidity
function initializeSellOrders(
    uint256 numIssuance,
    uint256 price,
    address secContrAddr,
    address tbdContrAddr,
    address investorSecAddr,
    address investorTbdAddr
) external override nonReentrant onlyRole(Roles.ORDER_ADMIN_ROLE) returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`numIssuance`|`uint256`|The number of individual sell orders to create.|
|`price`|`uint256`|The price for each sell order.|
|`secContrAddr`|`address`|The address of the security contract.|
|`tbdContrAddr`|`address`|The address of the TBD contract.|
|`investorSecAddr`|`address`|The address that owns the securities.|
|`investorTbdAddr`|`address`|The address that will receive the TBD funds.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|true if successful.|


### _generateOrderId

Returns a unique order id.


```solidity
function _generateOrderId() internal returns (bytes32);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes32`|A unique bytes32 order identifier.|


### _getSettlementPrice

Calculates the total settlement value using the maker's price.
The maker is the order already in the book (resting order), and the taker is the incoming order.
The settlement price is always the maker's price per unit, multiplied by the trade amount.


```solidity
function _getSettlementPrice(uint256 makerPrice, uint256 tradeAmount) internal pure returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`makerPrice`|`uint256`|The price per unit from the maker (order already in the book).|
|`tradeAmount`|`uint256`|The amount of securities being traded.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|The total settlement value (makerPrice * tradeAmount).|


### _appendToBuyLevel


```solidity
function _appendToBuyLevel(bytes32 _orderId, uint256 _price) internal;
```

### _appendToSellLevel


```solidity
function _appendToSellLevel(bytes32 _orderId, uint256 _price) internal;
```

### _ensureBuyLevel

The following internal price level management functions (_ensureBuyLevel, _ensureSellLevel) are provided for on-chain
operations. For production use, price level management should be handled off-chain with on-chain
validation. Off-chain systems can track price level structure and validate against
on-chain state to reduce gas costs.


```solidity
function _ensureBuyLevel(uint256 _price) internal returns (PriceLevel storage);
```

### _ensureSellLevel


```solidity
function _ensureSellLevel(uint256 _price) internal returns (PriceLevel storage);
```

### _insertBuyLevel


```solidity
function _insertBuyLevel(uint256 _price) internal;
```

### _insertSellLevel


```solidity
function _insertSellLevel(uint256 _price) internal;
```

### _removeOrderFromLevel


```solidity
function _removeOrderFromLevel(bytes32 _orderId) internal;
```

### _removeBuyLevel


```solidity
function _removeBuyLevel(uint256 _price) internal;
```

### _removeSellLevel


```solidity
function _removeSellLevel(uint256 _price) internal;
```

