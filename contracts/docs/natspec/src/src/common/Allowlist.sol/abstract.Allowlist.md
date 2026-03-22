# Allowlist
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/Allowlist.sol)

**Inherits:**
AccessControl

A simple on-chain allowlist based on the `mapping` type.


## State Variables
### _allowlist
The names of key and value are only relevant for the ABI.
See <https://docs.soliditylang.org/en/v0.8.29/types.html#mapping-types>


```solidity
mapping(address account => bool allowed) _allowlist
```


### _allAllowed

```solidity
address[] _allAllowed
```


## Functions
### constructor

Construct a new allowlist.


```solidity
constructor(address owner) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`owner`|`address`|The owner of the new allowlist.|


### add

Add a new address to the allowlist.


```solidity
function add(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The address to be added.|


### remove

Remove an address from the allowlist. Succeeds also if the address
was not previously included in the list.


```solidity
function remove(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The address to be removed.|


### allowlistQuery

Query the allowlist.


```solidity
function allowlistQuery(address account) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The account for which to query the allowlist status|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|True if `account` is present on the allowlist, false otherwise|


### allowlistQueryAll

Query the allowlist.


```solidity
function allowlistQueryAll() external view returns (address[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`address[]`|allowlist The array of all allowed addresses|


