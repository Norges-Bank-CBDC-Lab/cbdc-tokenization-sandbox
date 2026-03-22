# IBondAuction
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/norges-bank/interfaces/IBondAuction.sol)

Interface for the Bond Auction contract.


## Functions
### createAuction


```solidity
function createAuction(
    string memory _isin,
    address _owner,
    uint64 _end,
    bytes calldata _auctionPubKey,
    address _bond,
    uint256 _offering,
    AuctionType _auctionType
) external returns (bytes32);
```

### getAuctionId


```solidity
function getAuctionId(string memory _isin) external view returns (bytes32);
```

### submitBid


```solidity
function submitBid(bytes32 _id, bytes calldata _ciphertext, bytes32 _plaintextHash)
    external
    returns (uint256 bidIndex);
```

### closeAuction


```solidity
function closeAuction(bytes32 _id, address _caller) external returns (Bid[] memory);
```

### cancelAuction


```solidity
function cancelAuction(bytes32 _id, address _caller) external returns (uint256 offering);
```

### finaliseAuction


```solidity
function finaliseAuction(
    bytes32 _id,
    address _caller,
    Allocation[] memory allocations,
    BidVerification[] memory proofs
) external returns (uint256, uint256);
```

### getSealedBids


```solidity
function getSealedBids(bytes32 _id) external view returns (Bid[] memory);
```

### getAllocations


```solidity
function getAllocations(bytes32 _id) external view returns (Allocation[] memory);
```

### getAuction


```solidity
function getAuction(bytes32 _id) external view returns (AuctionMetadata memory);
```

### getAuctionStatus


```solidity
function getAuctionStatus(bytes32 _id) external view returns (AuctionStatus);
```

## Events
### AuctionCreated

```solidity
event AuctionCreated(
    bytes32 indexed id,
    address indexed admin,
    string isin,
    uint256 offering,
    uint64 end,
    bytes auctionPubKey,
    AuctionType auctionType
);
```

### BidSubmitted

```solidity
event BidSubmitted(
    bytes32 indexed id, address indexed bidder, string isin, uint256 index, bytes32 plaintextHash, bytes ciphertext
);
```

### BidCancelled

```solidity
event BidCancelled(bytes32 indexed id, address indexed bidder, string isin, bytes32 plaintextHash);
```

### AuctionClosed

```solidity
event AuctionClosed(bytes32 indexed id, string isin, uint256 bidCount);
```

### AuctionFinalized

```solidity
event AuctionFinalized(bytes32 indexed id, string isin);
```

### AuctionCancelled

```solidity
event AuctionCancelled(bytes32 indexed id, string isin);
```

## Structs
### AuctionMetadata
Metadata required to run each sealed-bid auction.


```solidity
struct AuctionMetadata {
    string isin;
    address owner;
    uint64 end;
    bytes auctionPubKey;
    address bond;
    uint256 offering;
    AuctionType auctionType;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|ISIN string identifying the bond partition.|
|`owner`|`address`|Controller that owns the auction (BondManager).|
|`end`|`uint64`|Timestamp when sealed bidding closes.|
|`auctionPubKey`|`bytes`|Public key used to encrypt sealed bids.|
|`bond`|`address`|Address of the bond token being auctioned.|
|`offering`|`uint256`|Maximum units offered in the auction.|
|`auctionType`|`AuctionType`|Auction type (rate, price, or buyback).|

### Bid
Encrypted bid submitted by a dealer.


```solidity
struct Bid {
    address bidder;
    bytes ciphertext;
    bytes32 plaintextHash;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`bidder`|`address`|Address submitting the bid.|
|`ciphertext`|`bytes`|Packed encrypted payload.|
|`plaintextHash`|`bytes32`|Hash of the plaintext bid contents.|

### Allocation
Final allocation for a bidder at the uniform clearing rate.


```solidity
struct Allocation {
    string isin;
    address bidder;
    uint256 units; /* number of 1,000 NOK nominal units */
    uint256 rate; /* RATE: interest rate in bps (1e4 precision). PRICE/BUYBACK: price per 100 in bps (e.g., 9875 = 98.75) */
    AuctionType auctionType;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`isin`|`string`|ISIN string for the auctioned bond.|
|`bidder`|`address`|Bidder receiving the allocation.|
|`units`|`uint256`|Number of 1,000 NOK nominal units allocated.|
|`rate`|`uint256`|Clearing rate (bps interest for RATE, price per 100 for PRICE/BUYBACK).|
|`auctionType`|`AuctionType`|Auction flavour for the allocation.|

### BidVerification
Proof that a bidder consented to the submitted ciphertext/plaintext hash for this auction.


```solidity
struct BidVerification {
    uint256 bidIndex;
    uint256 bidderNonce;
    bytes bidderSig;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`bidIndex`|`uint256`|Index of the bid being proven.|
|`bidderNonce`|`uint256`|Bidder-provided nonce included in the signature.|
|`bidderSig`|`bytes`|EIP-712 Bidder signature over ciphertext/plaintext hash context.|

## Enums
### AuctionStatus

```solidity
enum AuctionStatus {
    NONE,
    BIDDING,
    CLOSED,
    FINALISED,
    CANCELLED
}
```

### AuctionType

```solidity
enum AuctionType {
    RATE, /* Initial bond auctions: bid on lowest interest rate */
    PRICE, /* Bond extensions: bid on price per 100 (highest preferred) */
    BUYBACK /* Buyback: bid on price per 100 (lowest preferred) */
}
```

