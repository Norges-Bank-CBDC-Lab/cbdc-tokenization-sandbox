# DvP
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/csd/DvP.sol)

**Inherits:**
AccessControl


## State Variables
### _supportedInterfaces
ERC165 supported interfaces.


```solidity
mapping(bytes4 => bool) internal _supportedInterfaces
```


## Functions
### constructor


```solidity
constructor(address admin) ;
```

### supportsInterface

See [IERC165-supportsInterface](../OrderBook.sol/contract.OrderBook.md#supportsinterface).


```solidity
function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool);
```

### settle

Trigger a DvP settlement.
"Seller" and "buyer" refer to the securities side, so for the
wholesale settlement the sides appear reversed.


```solidity
function settle(
    address secContrAddr,
    address sellerSecAddr,
    address buyerSecAddr,
    uint256 secValue,
    address sellerTbdAddr,
    address buyerTbdAddr,
    uint256 wholesaleValue,
    address sellerTbdContrAddr,
    address buyerTbdContrAddr
) public onlyRole(Roles.SETTLE_ROLE) returns (bool success);
```

### _compareBytes


```solidity
function _compareBytes(bytes memory b1, bytes memory b2) private pure returns (bool);
```

## Events
### DvPEvent
An event emitted when the contract is successfully invoked by a Order Book
contract for settlement.


```solidity
event DvPEvent(
    address indexed secContrAddr,
    address indexed sellerSecAddr,
    address indexed buyerSecAddr,
    uint256 secValue,
    address sellerTbdContrAddr,
    address buyerTbdContrAddr,
    uint256 wholesaleValue
);
```

## Errors
### SettlementFailure
An error thrown by DvP.settle on failure.


```solidity
error SettlementFailure(FailureReason, bytes lowLevelData);
```

## Enums
### FailureReason
Enum used to track which side was responsible for settlement failure.


```solidity
enum FailureReason {
    Buyer,
    Seller,
    Unknown
}
```

