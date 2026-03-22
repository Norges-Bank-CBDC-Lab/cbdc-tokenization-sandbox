# BondDvP
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondDvP.sol)

**Inherits:**
AccessControl, [IBondDvP](../interfaces/IBondDvP.sol/interface.IBondDvP.md)

**Title:**
BondDvP

Delivery-versus-Payment for ERC1410 bond partitions against an ERC20 cash token (e.g., WNOK).


## State Variables
### name

```solidity
string public name
```


## Functions
### constructor

Grants DEFAULT_ADMIN_ROLE to `_admin`.


```solidity
constructor(string memory _name, address _admin) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_name`|`string`|Name of the BondDvP instance.|
|`_admin`|`address`|Bond issuer address granted BOND_MANAGER_ROLE.|


### settle

Generalised settlement entrypoint covering transfer, redeem, buyback and cash-only paths.

Caller must have SETTLE_ROLE.

Contract must have operator rights on bond partitions being settled.


```solidity
function settle(Settlement calldata p) external override onlyRole(Roles.SETTLE_ROLE) returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`Settlement`|Settlement parameters describing both bond and cash legs.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|true if settlement succeeded.|


### _settleSecurityLeg


```solidity
function _settleSecurityLeg(Settlement calldata p) internal;
```

### _settleCashLeg


```solidity
function _settleCashLeg(Settlement calldata p) internal;
```

### _revertSecurity


```solidity
function _revertSecurity(bytes memory lowLevelData) private pure;
```

