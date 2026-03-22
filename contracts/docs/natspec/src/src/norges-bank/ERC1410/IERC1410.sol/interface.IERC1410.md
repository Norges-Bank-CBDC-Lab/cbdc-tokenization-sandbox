# IERC1410
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/ERC1410/IERC1410.sol)

**Inherits:**
IERC165

ERC1410 interface (Partially Fungible Token) as per EIP-1410.


## Functions
### balanceOf


```solidity
function balanceOf(address tokenHolder) external view returns (uint256);
```

### balanceOfByPartition


```solidity
function balanceOfByPartition(bytes32 partition, address tokenHolder) external view returns (uint256);
```

### partitionsOf


```solidity
function partitionsOf(address tokenHolder) external view returns (bytes32[] memory);
```

### totalSupply


```solidity
function totalSupply() external view returns (uint256);
```

### transferByPartition


```solidity
function transferByPartition(bytes32 partition, address to, uint256 value, bytes calldata data)
    external
    returns (bytes32);
```

### operatorTransferByPartition


```solidity
function operatorTransferByPartition(
    bytes32 partition,
    address from,
    address to,
    uint256 value,
    bytes calldata data,
    bytes calldata operatorData
) external returns (bytes32);
```

### isOperator


```solidity
function isOperator(address operator, address tokenHolder) external view returns (bool);
```

### isOperatorForPartition


```solidity
function isOperatorForPartition(bytes32 partition, address operator, address tokenHolder)
    external
    view
    returns (bool);
```

### authorizeOperator


```solidity
function authorizeOperator(address operator) external;
```

### revokeOperator


```solidity
function revokeOperator(address operator) external;
```

### authorizeOperatorByPartition


```solidity
function authorizeOperatorByPartition(bytes32 partition, address operator) external;
```

### revokeOperatorByPartition


```solidity
function revokeOperatorByPartition(bytes32 partition, address operator) external;
```

### totalSupplyByPartition


```solidity
function totalSupplyByPartition(bytes32 partition) external view returns (uint256);
```

## Events
### TransferByPartition

```solidity
event TransferByPartition(
    bytes32 indexed fromPartition,
    address operator,
    address from,
    address to,
    uint256 value,
    bytes data,
    bytes operatorData
);
```

### ChangedPartition

```solidity
event ChangedPartition(bytes32 indexed fromPartition, bytes32 indexed toPartition, uint256 value);
```

### AuthorizedOperator

```solidity
event AuthorizedOperator(address indexed operator, address indexed tokenHolder);
```

### RevokedOperator

```solidity
event RevokedOperator(address indexed operator, address indexed tokenHolder);
```

### AuthorizedOperatorByPartition

```solidity
event AuthorizedOperatorByPartition(
    bytes32 indexed partition, address indexed operator, address indexed tokenHolder
);
```

### RevokedOperatorByPartition

```solidity
event RevokedOperatorByPartition(bytes32 indexed partition, address indexed operator, address indexed tokenHolder);
```

