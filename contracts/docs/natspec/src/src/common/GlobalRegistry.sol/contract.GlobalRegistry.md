# GlobalRegistry
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/GlobalRegistry.sol)

**Inherits:**
Ownable

**Title:**
GlobalRegistry

A contract that holds addresses of important contracts on the network.
Allows the owner to register and update contract addresses
by name, and provides functions to retrieve these addresses.

!Intended for test environments and not for production use!
This contract should be published first on the newtwork and given a preknown address
When you deploy new versions of deployed contracts, remember to update the address here.

**Notes:**
- inheritance: Ownable

- events: ContractAdded(string name, address newAddress), ContractUpdated(string name, address oldAddress, address newAddress)

- custom-errors: ContractNotFound(string contractAddress), InvalidContractAddress(address contractAddress)


## State Variables
### registry

```solidity
mapping(bytes32 => address) private registry
```


## Functions
### validParams


```solidity
modifier validParams(address contractAddress) ;
```

### _validParams


```solidity
function _validParams(address contractAddress) internal pure;
```

### constructor


```solidity
constructor() Ownable(msg.sender);
```

### setContract

Registers or updates a contract address in the registry, and emits events

Only owner can call this function, and the address cann not be zero. The name set is hashed to create a unique key.

**Notes:**
- events: ContractAdded(string name, address newAddress), ContractUpdated(string name, address oldAddress, address newAddress)

- custom-errors: InvalidContractAddress(address contractAddress)


```solidity
function setContract(string calldata name, address contractAddress)
    external
    onlyOwner
    validParams(contractAddress);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name`|`string`|The name of the contract to register or update.|
|`contractAddress`|`address`|The address of the contract to register or update.|


### getContract

Retrieves the address of a contract by its name.

This function will revert with a custom error if the contract is not found, so calling exists() is preferrable.
Use tryGetContract to avoid error handling.
The name provided is hashed to check in the registry.

**Note:**
custom-errors: ContractNotFound(string contractAddress)


```solidity
function getContract(string calldata name) external view returns (address contractAddress);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name`|`string`|The name of the contract to retrieve.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`contractAddress`|`address`|The address of the contract.|


### tryGetContract

Tries to retrieve the address of a contract by its name. Check returned boolean to see if the contract was found.

This function will return a boolean indicating if the contract was found, and the address of the contract.


```solidity
function tryGetContract(string calldata name) external view returns (bool found, address contractAddress);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name`|`string`|The name of the contract to retrieve.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`found`|`bool`|A boolean indicating if the contract was found.|
|`contractAddress`|`address`|The address of the contract, or address(0) if not found.|


### exists

Checks if a contract exists in the registry by its name.

This function will return a boolean indicating if the contract was found.


```solidity
function exists(string calldata name) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name`|`string`|The name of the contract to check.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|exists A boolean indicating if the contract was found.|


## Events
### ContractAdded

```solidity
event ContractAdded(string name, address newAddress);
```

### ContractUpdated

```solidity
event ContractUpdated(string name, address oldAddress, address newAddress);
```

