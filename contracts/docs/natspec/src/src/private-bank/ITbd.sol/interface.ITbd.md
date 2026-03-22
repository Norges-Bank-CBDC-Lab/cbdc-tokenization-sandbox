# ITbd
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/private-bank/ITbd.sol)


## Functions
### cctFrom

Moves a `value` amount of tokens from the from account to `to`
via the customer credit transfer (cct) settlement process, using the CBDC.


```solidity
function cctFrom(address from, address to, address toTbdContract, uint256 value) external returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|The TBD address from which tokens are being transferred.|
|`to`|`address`|The TBD address to which tokens are being transferred.|
|`toTbdContract`|`address`|The receiving TBD contract.|
|`value`|`uint256`|The amount of tokens to be transferred.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|A boolean value indicating the operation succeeded unless throwing.|


### cctSetToAddr

Sets a client payout address for the caller within the receiving TBD contract


```solidity
function cctSetToAddr(address to) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`to`|`address`|The client's TBD address to which tokens are being transferred during all following cct calls from the same sending TBC contract.|


### govReserve

Returns government reserve address if nominated.


```solidity
function govReserve() external view returns (address);
```

### isGovernmentNominated

Returns if TBD has been government nominated for reserve access.


```solidity
function isGovernmentNominated() external view returns (bool);
```

