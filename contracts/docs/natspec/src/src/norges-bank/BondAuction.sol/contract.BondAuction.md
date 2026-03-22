# BondAuction
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/BondAuction.sol)

**Inherits:**
[IBondAuction](../interfaces/IBondAuction.sol/interface.IBondAuction.md), AccessControl, EIP712

**Title:**
BondAuction

Accepts sealed bids, tracks auction states, and records allocations for each ISIN-specific TempBond.

Entrypoint for primary dealers to submit bids and review allocations.

BondManager is expected to own the AUCTION_ADMIN_ROLE and orchestrate the phase transitions.


## Constants
### BID_INTENT_TYPEHASH
EIP-712 typehash for bid intent signatures.

Used to verify sealed bidder intent on-chain during finalisation.


```solidity
bytes32 private constant BID_INTENT_TYPEHASH =
    keccak256("BidIntent(address bidder,bytes32 auctionId,bytes32 plaintextHash,uint256 bidderNonce)")
```


## State Variables
### name

```solidity
string public name
```


### auctionMetadata
Auction metadata

Auction data is indexed by auction ID (keccak256(ISIN, index)).


```solidity
mapping(bytes32 => AuctionMetadata) public auctionMetadata
```


### auctionStatus

```solidity
mapping(bytes32 => AuctionStatus) public auctionStatus
```


### auctionBids
Sealed bids submitted during bid phase.


```solidity
mapping(bytes32 => Bid[]) public auctionBids
```


### auctionAllocations
Public posting of final allocations per auction ID (unsealed).


```solidity
mapping(bytes32 => Allocation[]) public auctionAllocations
```


### bidderNonceUsed
Nonce tracking for bid intents

Prevents replay of bid intent signatures.


```solidity
mapping(bytes32 => mapping(address => mapping(uint256 => bool))) public bidderNonceUsed
```


### isinToAuctionCount
Auction count per ISIN to derive auction IDs.


```solidity
mapping(string => uint256) public isinToAuctionCount
```


## Functions
### onlyPhase

Modifier to restrict function execution to a specific auction phase.


```solidity
modifier onlyPhase(bytes32 _id, AuctionStatus _status) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Target auction ID.|
|`_status`|`AuctionStatus`|Required auction status for function execution.|


### constructor

Initializes the auction registry and grants DEFAULT_ADMIN_ROLE to the deployer.

BondManager is expected to claim AUCTION_ADMIN_ROLE post deployment.


```solidity
constructor(string memory _name) EIP712("BondAuctionBid", "1");
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_name`|`string`|Name of the auction contract.|


### _onlyPhase


```solidity
function _onlyPhase(bytes32 _id, AuctionStatus _status) internal view;
```

### createAuction

Create a new auction for a bond partition (ISIN) in the ERC1400 contract.

First auction for an ISIN must be RATE type to set yield; subsequent auctions can be PRICE or BUYBACK.


```solidity
function createAuction(
    string memory _isin,
    address _owner,
    uint64 _end,
    bytes calldata _auctionPubKey,
    address _bond,
    uint256 _offering,
    AuctionType _auctionType
) external override onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE) returns (bytes32);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN for target bond (used as partition identifier).|
|`_owner`|`address`|Address of the BondManager (auction admin) that can close/finalise.|
|`_end`|`uint64`|End timestamp for sealed bidding.|
|`_auctionPubKey`|`bytes`|Auctioneer public key used to unseal bids off-chain.|
|`_bond`|`address`|Address of the BondToken contract (same for all ISINs).|
|`_offering`|`uint256`|Total supply ceiling (offering size) for this partition.|
|`_auctionType`|`AuctionType`|Type of auction: RATE for initial bonds, PRICE for extensions.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes32`|id Id of created auction|


### closeAuction

Close an auction after the BondManager observes the off-chain timer expiry.

Bid phase is soft-enforced via timestamp but this function finalizes the phase transition.


```solidity
function closeAuction(bytes32 _id, address _caller)
    external
    override
    onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
    onlyPhase(_id, AuctionStatus.BIDDING)
    returns (Bid[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Target auction ID to close.|
|`_caller`|`address`|Expected to be the BondManager admin wallet.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`Bid[]`|bids Array of encrypted bids captured during BIDDING.|


### cancelAuction

Cancel an auction in any state except FINALISED.

Can cancel auctions in BIDDING, CLOSED, ERROR, or CANCELLED states (status < FINALISED && status != NONE).

Cannot cancel auctions that are FINALISED or NONE.

Sets auction status to CANCELLED.


```solidity
function cancelAuction(bytes32 _id, address _caller)
    external
    override
    onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
    returns (uint256 offering);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Target auction ID to cancel.|
|`_caller`|`address`|Expected to be the BondManager admin wallet.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`offering`|`uint256`|The offering size of the cancelled auction.|


### finaliseAuction

Finalize the active auction with off-chain computed uniform-rate allocations.


```solidity
function finaliseAuction(bytes32 _id, address _caller, Allocation[] memory _alloc, BidVerification[] memory _proofs)
    external
    override
    onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
    onlyPhase(_id, AuctionStatus.CLOSED)
    returns (uint256, uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Auction ID being finalised.|
|`_caller`|`address`|Must match auctionMetadata.owner (BondManager).|
|`_alloc`|`Allocation[]`|Clearing rate allocations sorted arbitrarily but priced uniformly.|
|`_proofs`|`BidVerification[]`||

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|total Total units allocated across all bidders.|
|`<none>`|`uint256`|clearingRate The shared rate (interest rate or price per 100) set by the marginal bid.|


### submitBid

Submit an encrypted bid for an active auction.


```solidity
function submitBid(bytes32 _id, bytes calldata _ciphertext, bytes32 _plaintextHash)
    external
    override
    onlyPhase(_id, AuctionStatus.BIDDING)
    returns (uint256 bidIndex);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|ID of target auction.|
|`_ciphertext`|`bytes`|Packed ciphertext blob carrying wrapped keys + symmetric ciphertext.|
|`_plaintextHash`|`bytes32`|keccak256 hash of the plaintext payload.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`bidIndex`|`uint256`|Index of the stored bid (used by clients for off-chain reconciliation).|


### _auctionId


```solidity
function _auctionId(string memory _isin, uint256 _index) internal pure returns (bytes32);
```

### _verifyBidIntent

Verify bidder intent signature via EIP-712 for a specific bid in an auction.


```solidity
function _verifyBidIntent(bytes32 _id, address _bidder, BidVerification memory _proof) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Id of target auction.|
|`_bidder`|`address`|Expected bidder address.|
|`_proof`|`BidVerification`|Bid verification proof generated off-chain.|


### getAuctionId

Return the current auction ID for an ISIN.


```solidity
function getAuctionId(string memory _isin) public view override returns (bytes32);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isin`|`string`|ISIN for target bond.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes32`|Current auction ID.|


### getAuction

Return auction metadata by ID.


```solidity
function getAuction(bytes32 _id) external view override returns (AuctionMetadata memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Auction identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`AuctionMetadata`|auction Auction data.|


### getAuctionStatus

Return auction status by ID.


```solidity
function getAuctionStatus(bytes32 _id) external view override returns (AuctionStatus);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Auction identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`AuctionStatus`|auction Auction data.|


### getSealedBids

Return all sealed bids for auction ID so off-chain tooling can decrypt them.


```solidity
function getSealedBids(bytes32 _id) external view override returns (Bid[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Auction identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`Bid[]`|bids Array of encrypted bids.|


### getAllocations

Return final allocations for auction ID.


```solidity
function getAllocations(bytes32 _id) external view override returns (Allocation[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_id`|`bytes32`|Auction identifier.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`Allocation[]`|allocations Recorded allocations.|


