# Tbd
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/private-bank/Tbd.sol)

**Inherits:**
[ITbd](../ITbd.sol/interface.ITbd.md), IERC1363Receiver, ERC20, AccessControl, [Allowlist](../../common/Allowlist.sol/abstract.Allowlist.md)

**Title:**
The TBD tokenized bank money

A contract for a tokenized bank deposit that adheres to the ERC20 token standard.


## Constants
### _BANK

```solidity
address private immutable _BANK
```


### _WNOK

```solidity
Wnok private immutable _WNOK
```


## State Variables
### _supportedInterfaces
ERC165 supported interfaces.


```solidity
mapping(bytes4 => bool) internal _supportedInterfaces
```


### _cctFromToList
mapping which allows to set a to for each TBD contract
TBD will be minted to this address during cct calls


```solidity
mapping(address from => address to) private _cctFromToList
```


### govReserve
Defined government reserve account;


```solidity
address public govReserve
```


## Functions
### constructor

Create a new TBD token.


```solidity
constructor(
    address admin,
    address bank,
    address wnok,
    address dvp,
    string memory name_,
    string memory symbol_,
    address _govReserve
) Allowlist(admin) ERC20(name_, symbol_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`admin`|`address`|The user to receive DEFAULT_ADMIN_ROLE|
|`bank`|`address`|The bank which owns the token|
|`wnok`|`address`|The global central bank contract|
|`dvp`|`address`|The global DvP contract|
|`name_`|`string`|of the TBD contract|
|`symbol_`|`string`|of the TBD token|
|`_govReserve`|`address`||


### supportsInterface

See [IERC165-supportsInterface](../../csd/DvP.sol/contract.DvP.md#supportsinterface).


```solidity
function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool);
```

### onTransferReceived

Whenever ERC-1363 tokens are transferred to this contract via `transferAndCall` or `transferFromAndCall`
by `operator` from `from`, this function is called.
NOTE: To accept the transfer, this must return
`bytes4(keccak256("onTransferReceived(address,address,uint256,bytes)"))`
(i.e. 0x88a7ca5c, or its own function selector).


```solidity
function onTransferReceived(address operator, address, uint256 value, bytes calldata) external returns (bytes4);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|The address which called `transferAndCall` or `transferFromAndCall` function.|
|`<none>`|`address`||
|`value`|`uint256`|The amount of tokens transferred.|
|`<none>`|`bytes`||

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes4`|`bytes4(keccak256("onTransferReceived(address,address,uint256,bytes)"))` if transfer is allowed unless throwing.|


### cctSetToAddr

Sets a client payout address for the caller within the receiving TBD contract


```solidity
function cctSetToAddr(address to) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`to`|`address`|The client's TBD address to which tokens are being transferred during all following cct calls from the same sending TBC contract.|


### cctFrom

Moves a `value` amount of tokens from the from account to `to`
via the customer credit transfer (cct) settlement process, using the CBDC.


```solidity
function cctFrom(address from, address to, address toTbdContrAddr, uint256 value)
    external
    onlyRole(Roles.CCT_FROM_CALLER_ROLE)
    returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|The TBD address from which tokens are being transferred.|
|`to`|`address`|The TBD address to which tokens are being transferred.|
|`toTbdContrAddr`|`address`||
|`value`|`uint256`|The amount of tokens to be transferred.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|A boolean value indicating the operation succeeded unless throwing.|


### getBankAddress

Get the registered bank address for this contract.


```solidity
function getBankAddress() external view returns (address);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`address`|The bank address.|


### isGovernmentNominated

Is TBD used for government issuance.


```solidity
function isGovernmentNominated() public view returns (bool);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|Boolean if TBD has been nominated.|


### _mintFromGovReserve

A mint function to convert gov. WNOK to TBD.


```solidity
function _mintFromGovReserve(uint256 _value) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_value`|`uint256`|Value to mint in token units.|


### mint

A mint function callable by MINTER_ROLE.


```solidity
function mint(address account, uint256 value) public onlyRole(Roles.MINTER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Receiving account of the newly minted tokens|
|`value`|`uint256`|Value to mint in token units|


### burn

A burn function callable by the BURNER_ROLE.


```solidity
function burn(address account, uint256 value) public onlyRole(Roles.BURNER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Account from which to remove the burned tokens|
|`value`|`uint256`|Value to burn in token units|


### _update

Overwritten default transfer function to include also an allowlist check.
Alternatively mints (or burns) if spender (or recipient) is the zero address


```solidity
function _update(address spender, address recipient, uint256 value) internal override;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`spender`|`address`|Account from which to transfer the tokens|
|`recipient`|`address`|Account to which to transfer the tokens|
|`value`|`uint256`|Value to transfer in token units|


### decimals

Returns the number of decimals used to get its user representation.
For example, if `decimals` equals `2`, a balance of `505` tokens should
be displayed to a user as `5.05` (`505 / 10 ** 2`).
Tokens usually opt for a value of 18, imitating the relationship between
Ether and Wei. This is the default value returned by this function, unless
it's overridden.
NOTE: This information is only used for _display_ purposes: it in
no way affects any of the arithmetic of the contract, including
{IERC20-balanceOf} and {IERC20-transfer}.


```solidity
function decimals() public view virtual override returns (uint8);
```

