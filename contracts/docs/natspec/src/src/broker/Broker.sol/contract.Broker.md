# Broker
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/broker/Broker.sol)

**Inherits:**
[ClientList](../ClientList.sol/contract.ClientList.md)

**Title:**
The Broker

broker contract that accepts buy and sell orders from registered retail clients
and routes them to a central OrderBook contract for execution and settlement.

This contract inherits from `ClientList` which maps each client wallet to a TBD money wallet address
and a  securities wallet address as well as the broker bank TBD contract for that client.


## Constants
### _ORDER_BOOK
Reference to the shared OrderBook contract.


```solidity
OrderBook private immutable _ORDER_BOOK
```


## State Variables
### _supportedInterfaces
ERC165 supported interfaces.


```solidity
mapping(bytes4 => bool) internal _supportedInterfaces
```


## Functions
### constructor

Initializes the Broker contract.

Grants DEFAULT_ADMIN_ROLE to the provided `admin` address.
Sets up support for ERC165 and Broker interface function selectors.


```solidity
constructor(address admin, address orderBookContrAddr) ClientList(admin);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`admin`|`address`|The administrator address for access control.|
|`orderBookContrAddr`|`address`|The address of the OrderBook contract.|


### name

Returns the name of the contract.


```solidity
function name() public pure returns (string memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string`|The string literal "Broker".|


### buy

Submits a buy order for the given security the orderbook contract.

The caller must be a registered client. Wallet addresses are resolved from ClientList.


```solidity
function buy(address secContrAddr, uint256 amount, uint256 bidPrice) public returns (SettlementInfo memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`secContrAddr`|`address`|The address of the security (ERC20 or similar).|
|`amount`|`uint256`|The amount of the security to buy.|
|`bidPrice`|`uint256`|The price offered per unit.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|A `SettlementInfo` struct representing the result of the order.|


### sell

Submits a sell order for the given security to the orderbook contract.

The caller must be a registered client. Wallet addresses are resolved from ClientList.


```solidity
function sell(address secContrAddr, uint256 amount, uint256 askPrice) public returns (SettlementInfo memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`secContrAddr`|`address`|The address of the security to sell.|
|`amount`|`uint256`|The amount of the security to sell.|
|`askPrice`|`uint256`|The asking price per unit.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`SettlementInfo`|A `SettlementInfo` struct representing the result of the order.|


### revokeBuyOrder

Revokes a buy order.

The caller must be a registered client. Wallet addresses are resolved from ClientList.


```solidity
function revokeBuyOrder(bytes32 orderId) public returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`orderId`|`bytes32`|The unique identifier of the Order.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|true/false representing the success of the transaction.|


### revokeSellOrder

Revokes a sell order.

The caller must be a registered client. Wallet addresses are resolved from ClientList.


```solidity
function revokeSellOrder(bytes32 orderId) public returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`orderId`|`bytes32`|The unique identifier of the Order.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|true/false representing the success of the transaction.|


### getSellOrders

Retrieves the current sell orders for the calling client.

The caller must be a registered client. The sec. wallet addresses is resolved from ClientList.


```solidity
function getSellOrders() public view returns (IOrderBook.Order[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`IOrderBook.Order[]`|Order[] -> An array of the caller's active sell orders from the order book.|


### getBuyOrders

Retrieves the current buy orders for the calling client.

The caller must be a registered client. The sec. wallet addresses is resolved from ClientList.


```solidity
function getBuyOrders() public view returns (IOrderBook.Order[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`IOrderBook.Order[]`|Order[] -> An array of the caller's active buy orders from the order book.|


