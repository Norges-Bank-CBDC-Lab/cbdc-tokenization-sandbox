# IBondDvP
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/interfaces/IBondDvP.sol)

Interface for the Bond delivery-versus-payment contract.


## Functions
### name


```solidity
function name() external view returns (string memory);
```

### settle

Generalised settlement entrypoint covering transfer, redeem, buyback and cash-only paths.


```solidity
function settle(Settlement calldata p) external returns (bool);
```

## Events
### DvPEvent

```solidity
event DvPEvent(
    address indexed bond,
    bytes32 indexed partition,
    Operation op,
    address indexed bondFrom,
    address bondTo,
    uint256 bondAmount,
    address cashToken,
    address cashFrom,
    address cashTo,
    uint256 cashAmount,
    address operator
);
```

## Structs
### Settlement
Generalised settlement payload describing both bond and cash legs.


```solidity
struct Settlement {
    address bond;
    bytes32 partition;
    address bondFrom;
    address bondTo;
    uint256 bondAmount;
    address cashToken;
    address cashFrom;
    address cashTo;
    uint256 cashAmount;
    address operator;
    Operation op;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`bond`|`address`|Bond token address.|
|`partition`|`bytes32`|Partition (ISIN) identifier for the bond leg.|
|`bondFrom`|`address`|Sender of the bond units.|
|`bondTo`|`address`|Recipient of the bond units.|
|`bondAmount`|`uint256`|Amount of bond units to move.|
|`cashToken`|`address`|ERC20 token address used for cash leg.|
|`cashFrom`|`address`|Payer address for the cash leg.|
|`cashTo`|`address`|Payee address for the cash leg.|
|`cashAmount`|`uint256`|Amount of cash token to transfer.|
|`operator`|`address`|Authorized operator executing the settlement.|
|`op`|`Operation`|Operation describing bond behaviour (transfer, redeem, buyback).|

## Enums
### Operation
Operation type for the bond leg.


```solidity
enum Operation {
    None,
    TransferPartition,
    Redeem,
    Buyback
}
```

### FailureReason
Enum describing which leg failed in SettlementFailure.


```solidity
enum FailureReason {
    Security,
    Cash,
    Unknown
}
```

