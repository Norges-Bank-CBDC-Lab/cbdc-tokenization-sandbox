# BondManager
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e1ad13913c0726f3f8165cafaa1413435020decc/src/norges-bank/BondManager.sol)

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


### deployBond

Deploys a new bond without scheduling an auction.

Creates a partition with offering 0; the first auction added via
`deployAuctionForBond` bumps the offering to its size.

Maturity duration is converted to seconds using DURATION_SCALAR.


```solidity
function deployBond(string calldata _isin, uint256 _maturityDuration)
    external
    onlyRole(Roles.BOND_MANAGER_ROLE)
    isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Human ISIN string for the issuance (used as partition identifier).|
|`_maturityDuration`|`uint256`|Duration in years from bond distribution until maturity.|


### deployAuctionForBond

Schedules an auction for an existing bond partition.


```solidity
function deployAuctionForBond(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _offering,
    IBondAuction.AuctionType _auctionType
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN of an existing partition.|
|`_end`|`uint64`|Timestamp when sealed bidding closes.|
|`_pubKey`|`bytes`|Auctioneer public key that matches client-side sealing keys.|
|`_offering`|`uint256`|Auction size. For RATE/PRICE: added to the partition offering ceiling. For BUYBACK: must not exceed current supply (and the offering ceiling is unchanged).|
|`_auctionType`|`IBondAuction.AuctionType`|RATE, PRICE, or BUYBACK. The first auction for an ISIN must be RATE (enforced by BondAuction); subsequent auctions must be PRICE or BUYBACK.|


### deployBondWithAuction

Deploys a new bond and its initial RATE auction in one call.

Back-compat composition of `deployBond` + `deployAuctionForBond(.., RATE)` so
existing call sites and tests keep their semantics.


```solidity
function deployBondWithAuction(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _offering,
    uint256 _maturityDuration
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```

### extendBondWithAuction

Schedule a PRICE auction (bond extension) for an existing bond.

Back-compat wrapper for `deployAuctionForBond(.., PRICE)`.


```solidity
function extendBondWithAuction(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _additionalOffering
) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```

### buybackWithAuction

Schedule a BUYBACK auction for an existing bond.

Back-compat wrapper for `deployAuctionForBond(.., BUYBACK)`.


```solidity
function buybackWithAuction(string calldata _isin, uint64 _end, bytes calldata _pubKey, uint256 _buybackSize)
    external
    onlyRole(Roles.BOND_MANAGER_ROLE)
    isBondActive(_isin, false);
```

### _deployBond


```solidity
function _deployBond(string calldata _isin, uint256 _maturityDuration) internal;
```

### _deployAuctionForBond


```solidity
function _deployAuctionForBond(
    string calldata _isin,
    uint64 _end,
    bytes calldata _pubKey,
    uint256 _offering,
    IBondAuction.AuctionType _auctionType
) internal;
```

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

### disableBond

Disable a bond that has no minted units, no in-flight auction, and no FINALISED auction history.

Gates: `bondActive[_isin] == false` (no in-flight auction — modifier), partition has zero
supply (checked by BondToken.disablePartition), and no auction for this ISIN has reached
FINALISED status (checked here).

On success the partition is soft-deleted in BondToken: `activePartitions[partition]` flips
to false and every per-partition mapping is cleared. The ISIN can be re-used with a fresh
`deployBond` afterward.


```solidity
function disableBond(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|Target ISIN to disable.|


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

