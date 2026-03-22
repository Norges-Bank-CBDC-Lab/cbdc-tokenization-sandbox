# Wnok
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/Wnok.sol)

**Inherits:**
ERC20, AccessControl, [Allowlist](../../common/Allowlist.sol/abstract.Allowlist.md)

**Title:**
The wNOK tokenized currency

A contract for a currency that adheres to the ERC20 token standard.
This contract implements an ERC1363 function (transferFromAndCall), but is
not IERC1363-compliant because no other functions from that standard are
currently needed by our protocol. It would be straightforward to make this
token ERC1363-compliant by implementing the remaining functions.


## State Variables
### _supportedInterfaces
ERC165 supported interfaces.


```solidity
mapping(bytes4 => bool) internal _supportedInterfaces
```


## Functions
### constructor

Create a new wNOK token.


```solidity
constructor(address admin, string memory name_, string memory symbol_) Allowlist(admin) ERC20(name_, symbol_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`admin`|`address`|The admin account of the token|
|`name_`|`string`|of the Wnok contract|
|`symbol_`|`string`|of the Wnok token|


### supportsInterface

See IERC165-supportsInterface.


```solidity
function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool);
```

### mint

A mint function callable by the contract admin.


```solidity
function mint(address account, uint256 value) public onlyRole(Roles.MINTER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Receiving account of the newly minted tokens|
|`value`|`uint256`|Value to mint in token units|


### burn

A burn function callable by the contract admin.


```solidity
function burn(address account, uint256 value) public onlyRole(Roles.BURNER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Account from which to remove the burned tokens|
|`value`|`uint256`|Value to burn in token units|


### decimals

Returns the number of decimals used to get its user representation.
For example, if `decimals` equals `2`, a balance of `505` tokens should
be displayed to a user as `5.05` (`505 / 10 ** 2`).
NOTE: This information is only used for _display_ purposes: it in
no way affects any of the arithmetic of the contract, including
IERC20-balanceOf and IERC20-transfer.


```solidity
function decimals() public view virtual override returns (uint8);
```

### transfer

Override transfer with allowlist checks for the sender and {to}, but
otherwise identical to the OpenZeppelin ERC20 implementation.


```solidity
function transfer(address to, uint256 value) public virtual override(ERC20) returns (bool);
```

### transferFrom

Override transferFrom with allowlist checks for {from} and {to}, but
otherwise identical to the OpenZeppelin ERC20 implementation.
Note: The caller of this function needs only TRANSFER_FROM_ROLE and does
not have to be allowlisted.


```solidity
function transferFrom(address from, address to, uint256 value)
    public
    override(ERC20)
    onlyRole(Roles.TRANSFER_FROM_ROLE)
    returns (bool);
```

### transferFromAndCall

Trigger a transfer and call {onTransferReceived} on the receiver
contract.


```solidity
function transferFromAndCall(address from, address to, uint256 value) external returns (bool);
```

## Events
### Settlement
An event emitted when the contract is successfully invoked by a TBD
contract for settlement.


```solidity
event Settlement(address indexed fromBankAddr, address indexed toTbdContrAddr, uint256 value);
```

