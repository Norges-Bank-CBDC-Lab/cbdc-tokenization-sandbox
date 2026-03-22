# OrderBookFactory
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/OrderBookFactory.sol)

**Inherits:**
AccessControl

**Title:**
OrderBookFactory

Factory contract for creating OrderBook instances for different securities.

Uses CREATE2 for deterministic deployment addresses. Similar to UniswapV2Factory.
One OrderBook per security: Since wNOK is the fixed quote currency, each security
(ISIN) gets exactly one OrderBook for trading that security against wNOK.
For example: wNOK:ISIN1 has one OrderBook, wNOK:ISIN2 has another OrderBook.
The salt used for CREATE2 is the security contract address directly, ensuring
deterministic addresses and preventing duplicate order books for the same security.


## Constants
### WNOK
Address of the wNOK contract (fixed quote currency)


```solidity
address public immutable WNOK
```


### DVP
Address of the DvP contract


```solidity
address public immutable DVP
```


### ADMIN
Address of the admin who will manage deployed order books


```solidity
address public immutable ADMIN
```


## State Variables
### getOrderBook
Mapping from security contract address to deployed OrderBook address


```solidity
mapping(address => address) public getOrderBook
```


### allSecurities
Array of all deployed security addresses (for enumeration)


```solidity
address[] public allSecurities
```


## Functions
### constructor

Creates a new OrderBookFactory.


```solidity
constructor(address _admin, address _wnok, address _dvp) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_admin`|`address`|The admin address for deployed OrderBooks.|
|`_wnok`|`address`|The wNOK contract address (quote currency).|
|`_dvp`|`address`|The DvP contract address.|


### allSecuritiesLength

Returns the total number of securities with deployed order books.


```solidity
function allSecuritiesLength() external view returns (uint256);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|The number of deployed order books.|


### createOrderBook

Creates a new OrderBook for a security if it doesn't already exist.

Uses CREATE2 for deterministic address calculation.

Only callable by accounts with ORDER_ADMIN_ROLE.


```solidity
function createOrderBook(address security) external onlyRole(Roles.ORDER_ADMIN_ROLE) returns (address orderBook);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`security`|`address`|The security contract address.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`orderBook`|`address`|The address of the deployed (or existing) OrderBook.|


### computeOrderBookAddress

Computes the address where an OrderBook would be deployed for a given security.

Uses CREATE2 address computation: keccak256(0xff ++ factoryAddress ++ salt ++ keccak256(bytecode))[12:]


```solidity
function computeOrderBookAddress(address security) external view returns (address);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`security`|`address`|The security contract address.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`address`|The deterministic address where the OrderBook would be deployed.|


### getAllSecurities

Returns all security addresses that have deployed order books.


```solidity
function getAllSecurities() external view returns (address[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`address[]`|An array of security contract addresses.|


## Events
### OrderBookCreated
Emitted when a new OrderBook is created.


```solidity
event OrderBookCreated(address indexed security, address indexed orderBook);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`security`|`address`|The security contract address (indexed)|
|`orderBook`|`address`|The deployed OrderBook address (indexed)|

