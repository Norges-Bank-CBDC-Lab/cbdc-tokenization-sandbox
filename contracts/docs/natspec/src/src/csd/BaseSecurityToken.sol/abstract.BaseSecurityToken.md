# BaseSecurityToken
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/BaseSecurityToken.sol)

**Inherits:**
Initializable, ERC20Upgradeable, AccessControlUpgradeable, [AllowlistUpgradeable](../../common/AllowlistUpgradeable.sol/abstract.AllowlistUpgradeable.md)

**Title:**
BaseSecurityToken

All security tokens must inherit from this contract in order to be compliant in CSD setup.
This contract provides basic functionality for custodial transfers and role management.
CSD_ROLE, SECURITY_OPERATOR_ROLE, and DEFAULT_ADMIN_ROLE are the three roles implemented.
This is initializable and intended to be used with OpenZeppelin's upgradeable contracts.

!Intended for test environments and not for production use!
Each category of securities (stocks, bonds, etc.) should inherit from this contract.

**Notes:**
- custom-errors: NotApprovedOperator(address caller),InvalidRole(bytes32 role)

- events: event CustodialTransferred(address indexed from,address indexed to,uint256 amount)

- inheritance: ERC20Upgradeable, AccessControlUpgradeable


## State Variables
### securityDescription

```solidity
string public securityDescription
```


## Functions
### onlyOperator

Modifier to check if the caller has the SECURITY_OPERATOR_ROLE.

This modifier is used to restrict access to certain functions to only those with the SECURITY_OPERATOR_ROLE.

**Note:**
error: NotApprovedOperator if the caller does not have the SECURITY_OPERATOR_ROLE


```solidity
modifier onlyOperator() ;
```

### onlyKnownRoles

Modifier to check if the role is one of the known roles (CSD_ROLE or SECURITY_OPERATOR_ROLE).

This modifier is used to restrict access to certain functions to only those with the known roles.

**Note:**
error: InvalidRole if the role is not one of the known roles


```solidity
modifier onlyKnownRoles(bytes32 role) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`role`|`bytes32`|The role to check.|


### onlyAdmin

Modifier to check if the caller has the DEFAULT_ADMIN_ROLE.

This modifier is used to restrict access to certain functions to only those with the DEFAULT_ADMIN_ROLE.

**Note:**
error: NotAdmin if the caller does not have the DEFAULT_ADMIN_ROLE


```solidity
modifier onlyAdmin() ;
```

### _onlyOperator


```solidity
function _onlyOperator() internal view;
```

### _onlyKnownRoles


```solidity
function _onlyKnownRoles(bytes32 role) internal pure;
```

### _onlyAdmin


```solidity
function _onlyAdmin() internal view;
```

### constructor

Constructor for the BaseSecurityToken contract.

This constructor is used to disable the initializers and prevent the contract from being initialized multiple times.
It is called only once when the contract is deployed.


```solidity
constructor() ;
```

### baseSecurityInit

Initialize the contract with the name, symbol, and initial owner.

This function is called only once when the contract is deployed.
This will call the ERC20 and Ownable initializers and grant the roles to the initial owner.


```solidity
function baseSecurityInit(
    string memory tokenName,
    string memory tokenSymbol,
    string memory description,
    address initialOwner
) internal onlyInitializing;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`tokenName`|`string`|The name of the token.|
|`tokenSymbol`|`string`|The symbol of the token.|
|`description`|`string`|A description of the security token, keep this as simple as possible, and can reference a KIID.|
|`initialOwner`|`address`|The address of the initial owner of the token.|


### custodialTransfer

Transfer security tokens from any account without permission from users.
Only preapproved CSDs can perform this action

Uses ERC20._transfer function to transfer tokens after validating role permissions from caller.

**Note:**
event: CustodialTransferred(from, to, amount)


```solidity
function custodialTransfer(address from, address to, uint256 amount)
    external
    onlyRole(Roles.CUSTODIAL_TRANSFER_ROLE)
    returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|The address to transfer tokens from.|
|`to`|`address`|The address to transfer tokens to.|
|`amount`|`uint256`|The amount of tokens to transfer.|


### grantRoleTo

Grant a role to an account, and only the SECURITY_OPERATOR can perform this action.

Function to grant a role to an account and uses AccessControl's _grantRole function after verifying the caller role.

**Note:**
error: InvalidRole if you try to grant a role that is not listed in the role parameter


```solidity
function grantRoleTo(bytes32 role, address account) external onlyOperator onlyKnownRoles(role);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`role`|`bytes32`|The role to grant. Valid roles are CSD_ROLE and SECURITY_OPERATOR_ROLE.|
|`account`|`address`|The address of the account to grant the role to.|


### revokeRoleFrom

Revoke a role from an account, and only the SECURITY_OPERATOR can perform this action.

Function to revoke a role from an account and uses AccessControl's _revokeRole function after verifying the caller role.

**Note:**
error: InvalidRole if you try to revoke a role that is not listed in the role parameter


```solidity
function revokeRoleFrom(bytes32 role, address account) external onlyOperator onlyKnownRoles(role);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`role`|`bytes32`|The role to revoke. Valid roles are CSD_ROLE and SECURITY_OPERATOR_ROLE.|
|`account`|`address`|The address of the account to revoke the role from.|


### securityType

Function to get the security type of the token

Function to get the security type of the token, implement this in the derived contract.


```solidity
function securityType() external view virtual returns (string memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string`|A string representing the security type.|


### isCSDApproved

Function to check if an address is a CSD approved operator.

You can use this function to check if an address is a CSD approved operator before calling custodialTransfer.
Reverting is very costly, so please verify before calling custodialTransfer.


```solidity
function isCSDApproved(address csd) public view virtual returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`csd`|`address`|The address to check.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|A boolean indicating whether the address is a CSD approved operator.|


### _update

Overwritten default transfer function to include also an allowlist check.
Alternatively mints (or burns) if from (or to) is the zero address


```solidity
function _update(address from, address to, uint256 amount) internal override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|Account from which to transfer the tokens|
|`to`|`address`|Account to which to transfer the tokens|
|`amount`|`uint256`|Amount to transfer in token units|


### decimals

Function to check how many decimals are supported, which is 0

BaseSecurityToken do not support fractional shares, so this function returns 0.


```solidity
function decimals() public pure override returns (uint8);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint8`|The number of decimals.|


## Events
### CustodialTransferred
Emitted when a custodial transfer is made.


```solidity
event CustodialTransferred(address indexed from, address indexed to, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|The address, indexed, from which the tokens are transferred.|
|`to`|`address`|The address, indexed, to which the tokens are transferred.|
|`amount`|`uint256`|The amount of tokens transferred.|

## Errors
### InvalidRole
Error to indicate that an invalid role was provided.

This error is used in the onlyKnownRoles modifier to ensure only valid roles are processed.


```solidity
error InvalidRole(bytes32 role);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`role`|`bytes32`|hashed role name|

### NotApprovedOperator
Error to indicate that the caller is not an approved operator.

This error is used in the onlyOperator modifier to ensure that only approved operators can call certain functions.


```solidity
error NotApprovedOperator(address caller);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`caller`|`address`|The address of the caller who triggered the error.|

