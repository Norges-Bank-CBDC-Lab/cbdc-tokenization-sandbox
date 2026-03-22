# AllowlistUpgradeable
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/AllowlistUpgradeable.sol)

**Inherits:**
AccessControlUpgradeable

A simple on-chain allowlist based on the `mapping` type.


## Constants
### ALLOWLIST_STORAGE_LOCATION

```solidity
bytes32 private constant ALLOWLIST_STORAGE_LOCATION =
    0x681f0e71da647f540c6449ed1596871848c3cbd7ee0430f865b5103cdaaee500
```


## Functions
### _getAllowlistStorage


```solidity
function _getAllowlistStorage() private pure returns (AllowlistStorage storage $);
```

### __Allowlist_init

Construct a new allowlist.


```solidity
function __Allowlist_init(address owner) internal onlyInitializing;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`owner`|`address`|The owner of the new allowlist.|


### __Allowlist_init_unchained


```solidity
function __Allowlist_init_unchained(address owner) internal onlyInitializing;
```

### __Allowlist_initAndAddOwnerToAllowlist


```solidity
function __Allowlist_initAndAddOwnerToAllowlist(address owner) internal onlyInitializing;
```

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
|`<none>`|`address[]`|_allAllowed with all addresses that are present on allowlist|


### allowlistQueryInternal


```solidity
function allowlistQueryInternal(address account) internal view returns (bool);
```

## Structs
### AllowlistStorage
The names of key and value are only relevant for the ABI.
See <https://docs.soliditylang.org/en/v0.8.29/types.html#mapping-types>

**Note:**
storage-location: erc7201:cbdc.Allowlist


```solidity
struct AllowlistStorage {
    mapping(address account => bool allowed) _allowlist;
    address[] _allAllowed;
}
```

