# ClientList
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/broker/ClientList.sol)

**Inherits:**
AccessControl

**Title:**
ClientList

Maintains a registry of allowed clients and their associated money and securities wallets.

Access control is inherited from OpenZeppelin's AccessControl. Only admins can add or remove clients.


## State Variables
### _clients
Mapping of client addresses to their associated wallet information.


```solidity
mapping(address clientWallet => ClientInfo) private _clients
```


### _allClients

```solidity
ClientAddresses[] private _allClients
```


## Functions
### constructor

Construct a new clientlist.


```solidity
constructor(address owner) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`owner`|`address`|The owner of the new clientlist.|


### addClient

Add client and assign wallets to them, overwrite existing entries


```solidity
function addClient(address clientWallet, address tbdWallet, address securitiesWallet, address tbdContrAddr)
    external
    onlyRole(Roles.CLIENT_ADMIN_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|
|`tbdWallet`|`address`|The wallet address used for cash tokens.|
|`securitiesWallet`|`address`|The wallet address used for securities tokens.|
|`tbdContrAddr`|`address`||


### removeClient

Remove a client's wallet mapping.


```solidity
function removeClient(address clientWallet) external onlyRole(Roles.CLIENT_ADMIN_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|


### getTbdContrAddr

Get a clients securities wallet address


```solidity
function getTbdContrAddr(address clientWallet) public view returns (address);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|


### getTbdWallet

Get a clients money wallet address


```solidity
function getTbdWallet(address clientWallet) internal view returns (address);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The clientWallet address.|


### getSecuritiesWallet

Get a clients securities wallet address


```solidity
function getSecuritiesWallet(address clientWallet) internal view returns (address);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|


### clientExistsGuard

Throws and reverts if the clientWallet is not on the client list


```solidity
function clientExistsGuard(address clientWallet) internal view;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|


### getAllClients

Query the ClientList.


```solidity
function getAllClients() external view returns (ClientAddresses[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`ClientAddresses[]`|_allClients with all addresses that are present on ClientList|


### _removeClient

Remove a client from internal lists. Remove also duplicates


```solidity
function _removeClient(address clientWallet) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`clientWallet`|`address`|The client address.|


## Structs
### ClientInfo
Structure to hold a client's wallet information.


```solidity
struct ClientInfo {
    bool exists;
    bool allowed; // currently, always true
    address tbdWalletAddr;
    address securitiesWalletAddr;
    address tbdContrAddr;
}
```

