# BondOrderBook
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondOrderBook.sol)

**Inherits:**
AccessControl, ReentrancyGuard

**Title:**
BondOrderBook

Limit order book for ERC1410 bond partitions vs ERC20 cash (wNOK).

Simplified matching: maker price, immediate matching with linked price levels.


## Constants
### _TBD

```solidity
Tbd private immutable _TBD
```


### _BOND

```solidity
IBondToken private immutable _BOND
```


### PARTITION

```solidity
bytes32 public immutable PARTITION
```


### BOND_TOKEN

```solidity
address public immutable BOND_TOKEN
```


## State Variables
### _supportedInterfaces

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


```solidity
constructor(address admin, address tbdToken, address bondToken, bytes32 partition) ;
```

### buy

submit buy: caller must have SUBMIT_ORDER_ROLE


```solidity
function buy(address secContrAddr, uint256 amount, uint256 price, address bondReceiver, address cashPayer)
    external
    nonReentrant
    onlyRole(Roles.SUBMIT_ORDER_ROLE)
    returns (bytes32);
```

### revokeBuyOrder

Revoke a buy order


```solidity
function revokeBuyOrder(bytes32 orderId) external nonReentrant returns (bool);
```

### revokeSellOrder

Revoke a sell order


```solidity
function revokeSellOrder(bytes32 orderId) external nonReentrant returns (bool);
```

### initializeSellOrders

Initialize sell orders (1-unit each) for issuance bootstrap


```solidity
function initializeSellOrders(
    uint256 numIssuance,
    uint256 price,
    address secContrAddr,
    address tbdContrAddr,
    address investorSecAddr,
    address investorTbdAddr
) external nonReentrant onlyRole(Roles.ORDER_ADMIN_ROLE) returns (bool);
```

### getBuyOrders

Get buy orders for caller broker


```solidity
function getBuyOrders() external view returns (Order[] memory);
```

### getSellOrders

Get sell orders for caller broker


```solidity
function getSellOrders() external view returns (Order[] memory);
```

### getBuyOrders

Get buy orders filtered by investor


```solidity
function getBuyOrders(address investorSecAddr) external view returns (Order[] memory);
```

### getSellOrders

Get sell orders filtered by investor


```solidity
function getSellOrders(address investorSecAddr) external view returns (Order[] memory);
```

### getAllBuyOrders

Get all buy orders (no broker/investor filter)


```solidity
function getAllBuyOrders() external view returns (Order[] memory);
```

### getAllSellOrders

Get all sell orders (no broker/investor filter)


```solidity
function getAllSellOrders() external view returns (Order[] memory);
```

### sell

submit sell: caller must have SUBMIT_ORDER_ROLE


```solidity
function sell(address secContrAddr, uint256 amount, uint256 price, address bondSeller, address cashReceiver)
    external
    nonReentrant
    onlyRole(Roles.SUBMIT_ORDER_ROLE)
    returns (bytes32);
```

### revoke


```solidity
function revoke(bytes32 orderId) external nonReentrant returns (bool);
```

### _settleBuy


```solidity
function _settleBuy(Order memory buyOrder) internal returns (bool settled, uint256 remaining);
```

### _settleSell


```solidity
function _settleSell(Order memory sellOrder) internal returns (bool settled, uint256 remaining);
```

### _dvpsettle

Executes both legs atomically; reverts on unexpected errors.


```solidity
function _dvpsettle(
    address sellerBondHolder,
    address buyerBondHolder,
    uint256 units,
    address cashPayer,
    address cashPayee,
    uint256 cashAmount
) internal returns (bool, FailureReason);
```

### _safeTransferFrom

helper to use try/catch with SafeERC20


```solidity
function _safeTransferFrom(address from, address to, uint256 amount) external;
```

### _generateOrderId


```solidity
function _generateOrderId() internal returns (bytes32);
```

### _appendToBuyLevel


```solidity
function _appendToBuyLevel(bytes32 _orderId, uint256 _price) internal;
```

### _appendToSellLevel


```solidity
function _appendToSellLevel(bytes32 _orderId, uint256 _price) internal;
```

### _ensureBuyLevel


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

### _fetchOrders


```solidity
function _fetchOrders(bool isBuySide, address broker, address investor) internal view returns (Order[] memory);
```

## Events
### OrderSubmitted

```solidity
event OrderSubmitted(
    bytes32 indexed orderId, bool indexed isBuy, uint256 amount, uint256 price, address bondHolder, address cashAddr
);
```

### OrderMatched

```solidity
event OrderMatched(bytes32 indexed orderId);
```

### OrderRevoked

```solidity
event OrderRevoked(bytes32 indexed orderId);
```

### DVPSuccess

```solidity
event DVPSuccess(bytes32 indexed orderId);
```

### DVPFailed

```solidity
event DVPFailed(bytes32 indexed orderId, FailureReason reason);
```

## Structs
### Order
Kept structurally consistent with IOrderBook.Order for ease of tooling.
- investorSecAddr: bond holder (receives on buy, sends on sell)
- secContrAddr: bond token address (immutable BOND_TOKEN)
- investorTbdAddr: cash address (pays on buy, receives on sell)
- tbdContrAddr: cash token address (immutable _cash)


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

### PriceLevel
Aligned with IOrderBook.PriceLevel field ordering for consistency.


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

## Enums
### FailureReason

```solidity
enum FailureReason {
    Buyer,
    Seller,
    Unknown
}
```

