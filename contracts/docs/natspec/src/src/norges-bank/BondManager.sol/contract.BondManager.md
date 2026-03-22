# BondManager
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondManager.sol)

**Inherits:**
[IBondManager](../interfaces/IBondManager.sol/interface.IBondManager.md), AccessControl

**Title:**
BondManager

Access-controlled entrypoint for issuers to create bond partitions (ISINs), open/close auctions, and settle allocations.

Atomic auction/bond creation & auction finalisation/DVP settlement.


## Constants
### PERCENTAGE_PRECISION

```solidity
uint256 private constant PERCENTAGE_PRECISION = 10000
```


### DURATION_SCALAR
Duration scalar for coupon intervals (for testing vs production)

In production: 31556926 seconds (1 year), for testing: can be minutes


```solidity
uint256 public immutable DURATION_SCALAR
```


### UNIT_NOMINAL
Conversion rate from bond units to nominal value (e.g., 1 BOND = 1000 WNOK)

Used to calculate payment amounts during issuance, buyback, redemption, and coupon


```solidity
uint256 private immutable UNIT_NOMINAL
```


### BOND_AUCTION

```solidity
IBondAuction public immutable BOND_AUCTION
```


### WNOK

```solidity
address public immutable WNOK
```


### BOND_TOKEN

```solidity
IBondToken public immutable BOND_TOKEN
```


### BOND_DVP

```solidity
IBondDvP public immutable BOND_DVP
```


### GOV_TBD
Store target TBD for bond payments (cash leg)


```solidity
address public immutable GOV_TBD
```


### _GOV_RESERVE

```solidity
address private immutable _GOV_RESERVE
```


## State Variables
### name

```solidity
string public name
```


### bondActive
Assert bond active state to prevent parallel auctions on the same ISIN


```solidity
mapping(string => bool) public bondActive
```


## Functions
### isBondActive


```solidity
modifier isBondActive(string calldata _isin, bool _active) ;
```

### _isBondActive


```solidity
function _isBondActive(string calldata _isin, bool _active) internal view;
```

### constructor


```solidity
constructor(
    string memory _name,
    address _wNok,
    address _controller,
    address _bondAuction,
    address _bondToken,
    address _bondDvp,
    address _govTbd,
    uint256 _durationScalar
) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_name`|`string`|Name of the BondManager instance.|
|`_wNok`|`address`|Address of the mock WNOK token used for the cash leg.|
|`_controller`|`address`|Bond issuer address granted BOND_MANAGER_ROLE.|
|`_bondAuction`|`address`|Address of the BondAuction instance coordinating sealed bids.|
|`_bondToken`|`address`|Address of the BondToken contract (single deployment for all bonds).|
|`_bondDvp`|`address`||
|`_govTbd`|`address`|Government nominated TBD.|
|`_durationScalar`|`uint256`|Duration scalar for coupon intervals (31556926 for year, smaller for testing)|


### deployBondWithAuction

Deploys a new bond with a rate auction (initial bond issuance).

Always creates a RATE auction for initial bond issuance.

Coupon yield is set from clearing rate when finalising the auction.

Maturity duration is converted to seconds using DURATION_SCALAR (years * scalar = seconds).


```solidity
function deployBondWithAuction(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _offering,
    uint256 _maturityDuration
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Human ISIN string for the issuance (used as partition identifier).|
|`_end`|`uint64`|Timestamp when sealed bidding closes.|
|`_pubKey`|`bytes`|Auctioneer public key that matches client-side sealing keys.|
|`_offering`|`uint256`|Total supply ceiling (offering size) for this partition.|
|`_maturityDuration`|`uint256`|Duration in years from bond distribution until maturity.|


### extendBondWithAuction

Extends an existing bond with a price auction (bond extension).

Always creates a PRICE auction for bond extensions.

Extends the partition offering size before creating the auction.


```solidity
function extendBondWithAuction(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _additionalOffering
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Human ISIN string for the existing bond.|
|`_end`|`uint64`|Timestamp when sealed bidding closes.|
|`_pubKey`|`bytes`|Auctioneer public key that matches client-side sealing keys.|
|`_additionalOffering`|`uint256`|Additional offering size to add to the partition.|


### buybackWithAuction

Creates a buyback auction for an existing bond without changing the offering ceiling.


```solidity
function buybackWithAuction(string calldata _isin, uint64 _end, bytes calldata _pubKey, uint256 _buybackSize)
    external
    onlyRole(Roles.BOND_MANAGER_ROLE)
    isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Existing ISIN to buy back from.|
|`_end`|`uint64`|Timestamp when sealed bidding closes.|
|`_pubKey`|`bytes`|Auctioneer public key that matches client-side sealing keys.|
|`_buybackSize`|`uint256`|Maximum units targeted for buyback (must not exceed current supply).|


### finaliseAuction

Finalises the auction and performs a naive DVP by transferring WNOK and Bond per allocation.

Settlement enforces a single clearing rate and emits DVPFailed when ERC20 calls revert.

For RATE auctions: payment is at full face value (rate represents interest rate).

For PRICE auctions: payment is discounted based on price per 100 (rate represents price per 100).


```solidity
function finaliseAuction(
    string calldata _isin,
    IBondAuction.Allocation[] memory _alloc,
    IBondAuction.BidVerification[] memory _proofs
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, true);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN to settle.|
|`_alloc`|`IBondAuction.Allocation[]`|Uniform-rate allocations produced off-chain.|
|`_proofs`|`IBondAuction.BidVerification[]`|Bidder signatures proving consent to each allocation.|


### _settleIssuance


```solidity
function _settleIssuance(
    bytes32 _id,
    string calldata _isin,
    bytes32 _partition,
    IBondAuction.AuctionType _auctionType,
    IBondAuction.Allocation[] memory _alloc,
    uint256 _total,
    uint256 _clearingRate
) internal returns (bool);
```

### _settleBuyback


```solidity
function _settleBuyback(
    bytes32 _id,
    string calldata _isin,
    bytes32 _partition,
    IBondAuction.Allocation[] memory _alloc,
    uint256 _total
) internal returns (bool);
```

### closeAuction

Closes bidding and retrieves bids for decryption.


```solidity
function closeAuction(string calldata _isin)
    external
    onlyRole(Roles.BOND_MANAGER_ROLE)
    isBondActive(_isin, true)
    returns (IBondAuction.Bid[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`IBondAuction.Bid[]`|bids Array of sealed bids returned by BondAuction.|


### cancelAuction

Cancel an auction and reduce the offering size while keeping the partition reserved.

Does NOT mint bonds - only reduces offering size and reserves the ISIN partition.

Sets auction status to CANCELLED and marks bond as inactive.

Can cancel auctions in BIDDING or CLOSED states (status < FINALISED && status != NONE).


```solidity
function cancelAuction(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, true);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN to cancel.|


### getSealedBids

Convenience proxy used by monitoring tools to inspect sealed bids.


```solidity
function getSealedBids(string calldata _isin) external view returns (IBondAuction.Bid[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`IBondAuction.Bid[]`|bids Array of sealed bids.|


### withdrawFailedIssuance

Allows the issuer to recover bonds that failed to settle during DVP.


```solidity
function withdrawFailedIssuance(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN with failed issuance.|


### redeem

Redeem bonds on behalf of holders

Restricted to BOND_MANAGER_ROLE

Passes msg.sender (BOND_MANAGER_ROLE holder) as operator

Payment is atomic for all holders


```solidity
function redeem(string calldata _isin, address[] calldata _holders) external onlyRole(Roles.BOND_MANAGER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_holders`|`address[]`|Array of addresses holding the bonds to be redeemed and receiving WNOK payment|


### payCoupon

Pay coupon to bond holders for a specific ISIN

Restricted to BOND_MANAGER_ROLE

Payment is atomic for all holders

Flags bond as matured after final coupon payment


```solidity
function payCoupon(string calldata _isin, address[] calldata _holders) external onlyRole(Roles.BOND_MANAGER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_holders`|`address[]`|Array of holder addresses to receive coupon payments|


### _handleAllocationFailure


```solidity
function _handleAllocationFailure(bytes32 id, string memory isin, address bidder, bytes memory errData) internal;
```

