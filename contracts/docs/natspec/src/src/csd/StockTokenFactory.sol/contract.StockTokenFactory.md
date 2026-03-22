# StockTokenFactory
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/StockTokenFactory.sol)

**Title:**
StockTokenFactory

A factory contract for creating new instances of the StockToken contract, which also checks for unique ISINs.

This contract is used to create new instances of the StockToken contract.
It uses the OpenZeppelin Clones library to create minimal proxy contracts.
The factory ensures that each ISIN is unique and prevents the creation of duplicate tokens.

**Notes:**
- inheritance: StockToken, OpenZeppelin Clones

- events: event StockTokenCreated(bytes32 indexed stockId, address token, string name, string symbol)

- custom-errors: StockTokenCloneFailed(string name, string symbol, address implementation), DuplicateStockToken(bytes32 stockId, string isin, address token)


## Constants
### IMPLEMENTATION

```solidity
address public immutable IMPLEMENTATION
```


### DEPLOYER

```solidity
address public immutable DEPLOYER
```


## State Variables
### _deployedStockTokens

```solidity
mapping(bytes32 => address) private _deployedStockTokens
```


### _deployedStockTokenIsins

```solidity
string[] private _deployedStockTokenIsins
```


## Functions
### onlyDeployer


```solidity
modifier onlyDeployer() ;
```

### uniqueIsin

Checks if the ISIN is unique (not already deployed).

**Note:**
custom-errors: DuplicateStockToken(string isin, address token)


```solidity
modifier uniqueIsin(string memory isin) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|The ISIN of the stock.|


### constructor


```solidity
constructor(address _implementation, address _deployer) ;
```

### createStockToken

Creates a new instance of the StockToken contract with the specified parameters.

This function uses the OpenZeppelin Clones library to create a minimal proxy contract, and checks for unique ISINs.

**Note:**
events: StockTokenCreated(bytes32 indexed stockId, address token, string name, string symbol)


```solidity
function createStockToken(
    string memory name,
    string memory symbol,
    string memory isin,
    uint256 initialSupply,
    string memory description,
    string memory issuerName
) external onlyDeployer uniqueIsin(isin) returns (address token);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name`|`string`|The name of the stock token.|
|`symbol`|`string`|The symbol of the stock token.|
|`isin`|`string`|The ISIN code of the stock token.|
|`initialSupply`|`uint256`|The initial supply of the stock token.|
|`description`|`string`|A description of the stock token, keep this as simple as possible, and can reference a KIID.|
|`issuerName`|`string`|The name of the issuer of the stock token.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`|The address of the newly created StockToken contract.|


### getDeployedStockToken

Returns the address of the deployed StockToken contract for a given ISIN, check boolean to see if it exists.

If boolean is false, the token was not created by this factory or does not exist.


```solidity
function getDeployedStockToken(string memory isin) external view returns (bool, address);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|The ISIN of the stock.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|token The address of the deployed StockToken contract.|
|`<none>`|`address`||


### getAllDeployedStockTokenIsins

Returns all deployed StockToken ISINs.


```solidity
function getAllDeployedStockTokenIsins() external view returns (string[] memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string[]`|deployedTokens The array with ISINs of all deployed StockToken contracts.|


### isVerifiedStockToken

Use this to check if a stock token has been created for a given ISIN and by this factory contract.

Only the factory contract can create stock tokens, which means that only stocks from this factory should be traded.
IMPORTANT: report to the CSD if a stock token is created by another factory.


```solidity
function isVerifiedStockToken(string memory isin) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|The ISIN of the stock.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|bool True if the stock token exists and created by this factory.|


### getStockId

Checks if the stockId already exists (have been previously created).

**Note:**
custom-errors: DuplicateStockToken(bytes32 stockID, string isin, address token)


```solidity
function getStockId(string memory isin) private pure returns (bytes32 stockId);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|The ISIN of the stock.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`stockId`|`bytes32`|The hashed unique identifier for the stock.|


### _onlyDeployer


```solidity
function _onlyDeployer() internal view;
```

### _uniqueIsin


```solidity
function _uniqueIsin(string memory isin) internal view;
```

## Events
### StockTokenCreated
Emitted when a new StockToken is successfully created/cloned.


```solidity
event StockTokenCreated(bytes32 indexed stockId, address indexed token, string name, string symbol);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`stockId`|`bytes32`|The unique identifier, indexed, for the stock, derived from the ISIN.|
|`token`|`address`|The address, indexed, of the newly created StockToken contract.|
|`name`|`string`|The name of the stock token.|
|`symbol`|`string`|The symbol of the stock token.|

## Errors
### NotDeployer

```solidity
error NotDeployer();
```

### DeployerAddressZero

```solidity
error DeployerAddressZero();
```

### ImplementationAddressZero

```solidity
error ImplementationAddressZero();
```

### StockTokenCloneFailed

```solidity
error StockTokenCloneFailed(string name, string symbol, address implementation);
```

### DuplicateStockToken

```solidity
error DuplicateStockToken(string isin, address token);
```

