# ERC1410Minimal
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/ERC1410/ERC1410.sol)

**Inherits:**
[IERC1410](../IERC1410.sol/interface.IERC1410.md), ERC165

**Title:**
ERC1410Minimal

Minimal, opinionated ERC1410 implementation for reference and testing.

Uses the EIP-1410 partitioned balance model with owner-controlled minting/burning.


## Constants
### DECIMALS

```solidity
uint8 public constant DECIMALS = 18
```


### _GRANULARITY

```solidity
uint256 private immutable _GRANULARITY
```


### DEFAULT_PARTITION

```solidity
bytes32 public constant DEFAULT_PARTITION = bytes32(0)
```


## State Variables
### name

```solidity
string public name
```


### symbol

```solidity
string public symbol
```


### _balances

```solidity
mapping(address => uint256) private _balances
```


### _totalSupply

```solidity
uint256 private _totalSupply
```


### _totalSupplyByPartition

```solidity
mapping(bytes32 => uint256) private _totalSupplyByPartition
```


### _partitionsOf

```solidity
mapping(address => bytes32[]) private _partitionsOf
```


### _partitionIndex

```solidity
mapping(address => mapping(bytes32 => uint256)) private _partitionIndex
```


### _balanceOfByPartition

```solidity
mapping(address => mapping(bytes32 => uint256)) private _balanceOfByPartition
```


### _totalPartitions

```solidity
bytes32[] private _totalPartitions
```


### _totalPartitionIndex

```solidity
mapping(bytes32 => uint256) private _totalPartitionIndex
```


### _controllers

```solidity
address[] internal _controllers
```


### _isController

```solidity
mapping(address => bool) internal _isController
```


### _authorizedOperators

```solidity
mapping(address => mapping(address => bool)) private _authorizedOperators
```


### _authorizedOperatorsByPartition

```solidity
mapping(address => mapping(bytes32 => mapping(address => bool))) private _authorizedOperatorsByPartition
```


## Functions
### constructor


```solidity
constructor(string memory tokenName, string memory tokenSymbol, uint256 tokenGranularity) ;
```

### granularity

Minimum transferable unit for the token.


```solidity
function granularity() external view returns (uint256 granularityValue);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`granularityValue`|`uint256`|Granularity value (must be a divisor of all transfers).|


### decimals

Decimals used for display purposes.


```solidity
function decimals() public pure returns (uint8 decimalsValue);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`decimalsValue`|`uint8`|Number of decimals.|


### supportsInterface

Returns true if this contract implements the interface defined by
`interfaceId`. See the corresponding
https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
to learn more about how these ids are created.
This function call must use less than 30 000 gas.


```solidity
function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool);
```

### balanceOf

Get total balance for a holder across all partitions.


```solidity
function balanceOf(address tokenHolder) public view override returns (uint256 balance);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`tokenHolder`|`address`|Address being queried.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`balance`|`uint256`|Combined balance across partitions.|


### balanceOfByPartition

Balance of a holder within a specific partition.


```solidity
function balanceOfByPartition(bytes32 partition, address tokenHolder)
    public
    view
    override
    returns (uint256 balance);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Target partition identifier.|
|`tokenHolder`|`address`|Address being queried.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`balance`|`uint256`|Partition-specific balance.|


### partitionsOf

Enumerate partitions held by an address.


```solidity
function partitionsOf(address tokenHolder) public view override returns (bytes32[] memory partitions);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`tokenHolder`|`address`|Address being queried.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`partitions`|`bytes32[]`|List of partition identifiers.|


### totalSupply


```solidity
function totalSupply() public view override returns (uint256 supply);
```

### totalSupplyByPartition

Total supply for a given partition.


```solidity
function totalSupplyByPartition(bytes32 partition) external view returns (uint256 supply);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Partition identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`supply`|`uint256`|Partition total supply.|


### _totalSupplyOfPartition


```solidity
function _totalSupplyOfPartition(bytes32 partition) internal view returns (uint256);
```

### totalPartitions

All partitions that currently have non-zero supply.


```solidity
function totalPartitions() external view returns (bytes32[] memory partitions);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`partitions`|`bytes32[]`|List of active partitions.|


### controllers

Current controller addresses.


```solidity
function controllers() external view returns (address[] memory controllerList);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`controllerList`|`address[]`|Array of controllers.|


### isController

Check if an address is a controller.


```solidity
function isController(address operator) public view returns (bool isCtrl);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address being checked.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`isCtrl`|`bool`|True if operator is a controller.|


### isOperator


```solidity
function isOperator(address operator, address tokenHolder) public view override returns (bool);
```

### isOperatorForPartition


```solidity
function isOperatorForPartition(bytes32 partition, address operator, address tokenHolder)
    public
    view
    override
    returns (bool);
```

### transferByPartition

Transfer value from the caller out of a partition.

If `data` is 32 bytes long, it is treated as the destination partition.


```solidity
function transferByPartition(bytes32 partition, address to, uint256 value, bytes calldata data)
    external
    override
    returns (bytes32);
```

### operatorTransferByPartition

Operator transfer respecting global and partition-level approvals.


```solidity
function operatorTransferByPartition(
    bytes32 partition,
    address from,
    address to,
    uint256 value,
    bytes calldata data,
    bytes calldata operatorData
) external override returns (bytes32);
```

### authorizeOperator

Authorize an operator for all partitions of the caller.


```solidity
function authorizeOperator(address operator) external override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address to authorize.|


### revokeOperator

Revoke operator access for all partitions of the caller.


```solidity
function revokeOperator(address operator) external override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address to revoke.|


### authorizeOperatorByPartition

Authorize an operator for a specific partition.


```solidity
function authorizeOperatorByPartition(bytes32 partition, address operator) external override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Partition identifier.|
|`operator`|`address`|Address to authorize.|


### revokeOperatorByPartition

Revoke operator access for a specific partition.


```solidity
function revokeOperatorByPartition(bytes32 partition, address operator) external override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Partition identifier.|
|`operator`|`address`|Address to revoke.|


### _transferByPartition


```solidity
function _transferByPartition(
    bytes32 fromPartition,
    bytes32 toPartition,
    address operator,
    address from,
    address to,
    uint256 value,
    bytes memory data,
    bytes memory operatorData
) internal returns (bytes32);
```

### _move


```solidity
function _move(bytes32 fromPartition, bytes32 toPartition, address from, address to, uint256 value) internal;
```

### _mint


```solidity
function _mint(
    bytes32 partition,
    address to,
    uint256 value,
    address operator,
    bytes memory data,
    bytes memory operatorData
) internal;
```

### _mint


```solidity
function _mint(bytes32 partition, address to, uint256 value) internal;
```

### _burn


```solidity
function _burn(
    bytes32 partition,
    address from,
    uint256 value,
    address operator,
    bytes memory data,
    bytes memory operatorData
) internal;
```

### _burn


```solidity
function _burn(bytes32 partition, address from, uint256 value) internal;
```

### _issueByPartition


```solidity
function _issueByPartition(bytes32 partition, address operator, address to, uint256 value, bytes memory data)
    internal;
```

### _issueByPartition


```solidity
function _issueByPartition(
    bytes32 partition,
    address operator,
    address to,
    uint256 value,
    bytes memory data,
    bytes memory operatorData
) internal;
```

### _redeemByPartition


```solidity
function _redeemByPartition(bytes32 partition, address operator, address from, uint256 value, bytes memory data)
    internal;
```

### _redeemByPartition


```solidity
function _redeemByPartition(
    bytes32 partition,
    address operator,
    address from,
    uint256 value,
    bytes memory data,
    bytes memory operatorData
) internal;
```

### _addPartition


```solidity
function _addPartition(address holder, bytes32 partition) internal;
```

### _removePartition


```solidity
function _removePartition(address holder, bytes32 partition) internal;
```

### _initializePartition


```solidity
function _initializePartition(bytes32 partition) internal;
```

### _trackPartition


```solidity
function _trackPartition(bytes32 partition) internal;
```

### _untrackPartition


```solidity
function _untrackPartition(bytes32 partition) internal;
```

### _setControllers


```solidity
function _setControllers(address[] memory controllers_) internal;
```

### _enforceGranularity


```solidity
function _enforceGranularity(uint256 value) internal view;
```

### _isMultiple

Check if 'value' is multiple of the granularity.


```solidity
function _isMultiple(uint256 value) internal view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`value`|`uint256`|The quantity that want's to be checked.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|'true' if 'value' is a multiple of the granularity.|


