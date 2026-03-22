# BondToken
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondToken.sol)

**Inherits:**
[IBondToken](../interfaces/IBondToken.sol/interface.IBondToken.md), ERC1410, AccessControl

**Title:**
BondToken

ERC1410-compatible token for bonds using partitions keyed by ISIN.

Single deployment for all bonds, with partitions representing different ISINs using a lightweight ERC1410 base.


## Constants
### UNIT_NOMINAL
Each bond unit represents this nominal value in WNOK (e.g., 1 BOND = 1000 WNOK)


```solidity
uint256 public constant UNIT_NOMINAL = 1000
```


## State Variables
### activePartitions
Mapping to track active partitions (ISINs that have been activated)


```solidity
mapping(bytes32 => bool) public activePartitions
```


### _partitionIsin
Mapping from partition to ISIN string for lookups


```solidity
mapping(bytes32 => string) private _partitionIsin
```


### partitionOffering
Mapping to track total supply ceiling (offering size) per partition


```solidity
mapping(bytes32 => uint256) public partitionOffering
```


### maturityDuration
Mapping to track maturity duration per partition (seconds until maturity from distribution)


```solidity
mapping(bytes32 => uint256) public maturityDuration
```


### maturityDate
Mapping to track maturity date per partition (timestamp when bonds can be redeemed)


```solidity
mapping(bytes32 => uint256) public maturityDate
```


### couponDuration
Mapping to track coupon duration (number of payment intervals) per partition


```solidity
mapping(bytes32 => uint256) public couponDuration
```


### couponYield
Mapping to track coupon yield (percentage) per partition


```solidity
mapping(bytes32 => uint256) public couponYield
```


### lastCouponPayment
Mapping to track last coupon payment timestamp per partition


```solidity
mapping(bytes32 => uint256) public lastCouponPayment
```


### couponPaymentCount
Mapping to track number of coupon payments made per partition


```solidity
mapping(bytes32 => uint256) public couponPaymentCount
```


### isMatured
Mapping to track if bond is matured (after final coupon payment) per partition


```solidity
mapping(bytes32 => bool) public isMatured
```


## Functions
### constructor

Constructor initializes ERC1410 token with bond-specific settings


```solidity
constructor(string memory _name, string memory _symbol)
    ERC1410(
        _name, // tokenName
        _symbol, // tokenSymbol
        1 // tokenGranularity (1 = indivisible units, suitable for zero-decimal bonds)
    );
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_name`|`string`|Name of the token|
|`_symbol`|`string`|Symbol of the token|


### addController

Add new controller

To add dedicated manager role


```solidity
function addController(address _controller) external onlyRole(Roles.BOND_ADMIN_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_controller`|`address`|of new controller|


### supportsInterface


```solidity
function supportsInterface(bytes4 interfaceId)
    public
    view
    override(ERC1410, AccessControl, IERC165)
    returns (bool);
```

### isinToPartition

Convert ISIN string to partition bytes32


```solidity
function isinToPartition(string memory _isin) public pure returns (bytes32 partition);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|bytes32 representation|


### partitionToIsin

Retrieve ISIN string for a partition.


```solidity
function partitionToIsin(bytes32 partition) external view returns (string memory);
```

### createPartition

Create a partition for an ISIN (initializes partition without minting)

This explicitly creates the partition in the ERC1410 tracking before any real minting

Sets the partition as active in the activePartitions mapping and stores the offering size and maturity duration

Coupon parameters are set later via setCouponParameters (for RATE auctions, yield comes from clearing rate)


```solidity
function createPartition(string memory _isin, uint256 _offering, uint256 _maturityDuration)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_offering`|`uint256`|Total supply ceiling (offering size) for this partition|
|`_maturityDuration`|`uint256`|Duration in seconds from bond distribution until maturity|


### _createPartition

Internal function to create partition and set offering/duration


```solidity
function _createPartition(bytes32 partition, uint256 _offering, uint256 _maturityDuration) internal;
```

### enableByIsin

Set coupon parameters & start timer

Restricted to CONTROLLER_ROLE

For RATE auctions, _couponYield should be the clearing rate from the auction (with 4 decimal places)

Number of coupon payments = maturityDuration / _couponDuration


```solidity
function enableByIsin(string memory _isin, uint256 _couponDuration, uint256 _couponYield)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_couponDuration`|`uint256`|Coupon internal in seconds (e.g., 1 year = durationScalar)|
|`_couponYield`|`uint256`|Coupon yield with 4 decimal places (e.g., 425 = 4.25%, 400 = 4.00%)|


### _setCouponParameters

Set coupon parameters for a partition (called after RATE auction finalization)

Restricted to CONTROLLER_ROLE

For RATE auctions, _couponYield should be the clearing rate from the auction (with 4 decimal places)

Number of coupon payments = maturityDuration / _couponDuration


```solidity
function _setCouponParameters(bytes32 _partition, uint256 _couponDuration, uint256 _couponYield) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_partition`|`bytes32`|Partition identifier (hashed ISIN)|
|`_couponDuration`|`uint256`|Interval between coupon payments in seconds (e.g., 1 year = durationScalar)|
|`_couponYield`|`uint256`|Coupon yield with 4 decimal places (e.g., 425 = 4.25%, 400 = 4.00%)|


### extendPartitionOffering

Extend the offering size for an existing partition

Requires partition to be active

Increases the total offering ceiling for the partition


```solidity
function extendPartitionOffering(string memory _isin, uint256 _additionalOffering)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_additionalOffering`|`uint256`|Additional offering size to add to the partition|


### reducePartitionOffering

Reduce the offering size for an existing partition (used when auction is cancelled)

Requires partition to be active

Reduces the total offering ceiling for the partition

Ensures the reduction doesn't make offering less than current supply


```solidity
function reducePartitionOffering(string memory _isin, uint256 _reductionAmount)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_reductionAmount`|`uint256`|Amount to reduce from the offering size|


### _updatePartitionOffering

Internal helper to update offering up or down for a partition

Keeps public ISIN functions thin and reuses validation logic.


```solidity
function _updatePartitionOffering(bytes32 partition, string memory _isin, uint256 delta, bool increase)
    internal
    returns (uint256 newOffering);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Partition identifier|
|`_isin`|`string`|ISIN string (used for error context)|
|`delta`|`uint256`|Amount to add or subtract|
|`increase`|`bool`|True to increase offering, false to decrease|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`newOffering`|`uint256`|Updated offering amount for the partition|


### mintByIsin

Mint to a specific partition (ISIN)

Requires partition to be activated

Validates that minting does not exceed the partition's offering size (total supply ceiling)


```solidity
function mintByIsin(string memory _isin, address account, uint256 value)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`account`|`address`|Recipient address|
|`value`|`uint256`|Number of units to mint|


### _startMaturityTimer

Start the maturity timer for a partition (sets maturity date from current time + duration)

Calculates maturity date as current timestamp + stored maturity duration

Initializes coupon payment tracking (sets lastCouponPayment to current time)

Should be called when bonds are distributed (after finaliseAuction)


```solidity
function _startMaturityTimer(bytes32 partition) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`partition`|`bytes32`|Partition identifier (hashed ISIN)|


### redeemFor

Redeem bonds from a specific ISIN partition for WNOK

Validates maturity and burns bonds

WNOK payment is handled via mock DVP in BondManager using REDEEM_EOA

Restricted to CONTROLLER_ROLE


```solidity
function redeemFor(address _holder, string memory _isin, uint256 _value, address _operator)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_holder`|`address`|Address holding the bonds to be redeemed and receiving WNOK payment|
|`_isin`|`string`|ISIN string|
|`_value`|`uint256`|Number of bonds to redeem|
|`_operator`|`address`|Address with BOND_MANAGER_ROLE performing the redemption|


### buybackRedeemFor

Burn bonds before maturity for buyback flows


```solidity
function buybackRedeemFor(address _holder, string memory _isin, uint256 _value, address _operator)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_holder`|`address`|Address selling the bonds back|
|`_isin`|`string`|ISIN string|
|`_value`|`uint256`|Number of bonds to burn|
|`_operator`|`address`|Address with CONTROLLER_ROLE executing the burn|


### updateCouponPayment

Update coupon payment tracking (called by BondManager after coupon payment)

Restricted to CONTROLLER_ROLE


```solidity
function updateCouponPayment(string memory _isin, uint256 _timestamp, uint256 _paymentCount)
    external
    onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|
|`_timestamp`|`uint256`|Timestamp of the payment|
|`_paymentCount`|`uint256`|New payment count|


### setMatured

Mark bond as matured (called after final coupon payment)

Restricted to CONTROLLER_ROLE


```solidity
function setMatured(string memory _isin) external onlyRole(Roles.BOND_CONTROLLER_ROLE);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|


### getCouponDetails

Get all coupon details for a partition in a single call


```solidity
function getCouponDetails(string memory _isin)
    external
    view
    returns (
        uint256 _couponDuration,
        uint256 _couponYield,
        uint256 _maturityDuration,
        uint256 _lastCouponPayment,
        uint256 _couponPaymentCount
    );
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN string|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`_couponDuration`|`uint256`|Interval between coupon payments in seconds|
|`_couponYield`|`uint256`|Coupon yield percentage|
|`_maturityDuration`|`uint256`|Duration in seconds until maturity|
|`_lastCouponPayment`|`uint256`|Timestamp of last coupon payment|
|`_couponPaymentCount`|`uint256`|Number of coupon payments made|


