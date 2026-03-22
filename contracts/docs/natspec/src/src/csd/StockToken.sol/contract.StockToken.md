# StockToken
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/StockToken.sol)

**Inherits:**
[BaseSecurityToken](../BaseSecurityToken.sol/abstract.BaseSecurityToken.md)

**Title:**
StockToken

A contract for stocks that can be traded on a CSD (Central Securities Depository).

A contract for a stock token that inherits from BaseSecurityToken.
This contract includes additional properties specific to stock tokens.
Deploy this contract with the StockFactory, and check BaseSecruityToken for events and custom errors.

**Note:**
inheritance: BaseSecurityToken


## State Variables
### securityIsin

```solidity
string public securityIsin
```


### securityIssuerName

```solidity
string public securityIssuerName
```


## Functions
### constructor


```solidity
constructor() ;
```

### initialize

Constructor for the StockToken contract, and will call on BaseSecurityToken constructor.
After initialization, the contract mints the initial supply of tokens to the initial owner.


```solidity
function initialize(
    string memory tokenName,
    string memory ticker,
    string memory isin,
    string memory issuerName,
    address initialOwner,
    uint256 initialSupply,
    string memory description
) public initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`tokenName`|`string`|The name of the stock token.|
|`ticker`|`string`|The ticker symbol of the stock token.|
|`isin`|`string`|The ISIN code of the stock token.|
|`issuerName`|`string`|The name of the issuer of the stock token.|
|`initialOwner`|`address`|The initial owner of the stock token.|
|`initialSupply`|`uint256`|The initial supply of the stock token.|
|`description`|`string`|A description of the stock token, keep this as simple as possible, and can reference a KIID.|


### securityType

Will always return "Stock" as the security type.

Function to get the security type of the token, which is "Stock" in this implementation


```solidity
function securityType() external pure override returns (string memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string`|A string representing the security type.|


## Events
### StockIssued

```solidity
event StockIssued(address indexed to, uint256 amount);
```

