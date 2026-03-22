// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/**
 * @notice Interface for the Bond Auction contract.
 */
interface IBondAuction {
    enum AuctionStatus {
        NONE,
        BIDDING,
        CLOSED,
        FINALISED,
        CANCELLED
    }

    enum AuctionType {
        RATE, /* Initial bond auctions: bid on lowest interest rate */
        PRICE, /* Bond extensions: bid on price per 100 (highest preferred) */
        BUYBACK /* Buyback: bid on price per 100 (lowest preferred) */
    }

    /**
     * @notice Metadata required to run each sealed-bid auction.
     * @param isin ISIN string identifying the bond partition.
     * @param owner Controller that owns the auction (BondManager).
     * @param end Timestamp when sealed bidding closes.
     * @param auctionPubKey Public key used to encrypt sealed bids.
     * @param bond Address of the bond token being auctioned.
     * @param offering Maximum units offered in the auction.
     * @param auctionType Auction type (rate, price, or buyback).
     */
    struct AuctionMetadata {
        string isin;
        address owner;
        uint64 end;
        bytes auctionPubKey;
        address bond;
        uint256 offering;
        AuctionType auctionType;
    }

    /**
     * @notice Encrypted bid submitted by a dealer.
     * @param bidder Address submitting the bid.
     * @param ciphertext Packed encrypted payload.
     * @param plaintextHash Hash of the plaintext bid contents.
     */
    struct Bid {
        address bidder;
        bytes ciphertext;
        bytes32 plaintextHash;
    }

    /**
     * @notice Final allocation for a bidder at the uniform clearing rate.
     * @param isin ISIN string for the auctioned bond.
     * @param bidder Bidder receiving the allocation.
     * @param units Number of 1,000 NOK nominal units allocated.
     * @param rate Clearing rate (bps interest for RATE, price per 100 for PRICE/BUYBACK).
     * @param auctionType Auction flavour for the allocation.
     */
    struct Allocation {
        string isin;
        address bidder;
        uint256 units; /* number of 1,000 NOK nominal units */
        uint256 rate; /* RATE: interest rate in bps (1e4 precision). PRICE/BUYBACK: price per 100 in bps (e.g., 9875 = 98.75) */
        AuctionType auctionType;
    }

    /**
     * @notice Proof that a bidder consented to the submitted ciphertext/plaintext hash for this auction.
     * @param bidIndex Index of the bid being proven.
     * @param bidderNonce Bidder-provided nonce included in the signature.
     * @param bidderSig EIP-712 Bidder signature over ciphertext/plaintext hash context.
     */
    struct BidVerification {
        uint256 bidIndex;
        uint256 bidderNonce;
        bytes bidderSig;
    }

    event AuctionCreated(
        bytes32 indexed id,
        address indexed admin,
        string isin,
        uint256 offering,
        uint64 end,
        bytes auctionPubKey,
        AuctionType auctionType
    );
    event BidSubmitted(
        bytes32 indexed id, address indexed bidder, string isin, uint256 index, bytes32 plaintextHash, bytes ciphertext
    );
    event BidCancelled(bytes32 indexed id, address indexed bidder, string isin, bytes32 plaintextHash);
    event AuctionClosed(bytes32 indexed id, string isin, uint256 bidCount);
    event AuctionFinalized(bytes32 indexed id, string isin);
    event AuctionCancelled(bytes32 indexed id, string isin);

    function createAuction(
        string memory _isin,
        address _owner,
        uint64 _end,
        bytes calldata _auctionPubKey,
        address _bond,
        uint256 _offering,
        AuctionType _auctionType
    ) external returns (bytes32);

    function getAuctionId(string memory _isin) external view returns (bytes32);

    function submitBid(bytes32 _id, bytes calldata _ciphertext, bytes32 _plaintextHash)
        external
        returns (uint256 bidIndex);

    function closeAuction(bytes32 _id, address _caller) external returns (Bid[] memory);

    function cancelAuction(bytes32 _id, address _caller) external returns (uint256 offering);

    function finaliseAuction(
        bytes32 _id,
        address _caller,
        Allocation[] memory allocations,
        BidVerification[] memory proofs
    ) external returns (uint256, uint256);

    function getSealedBids(bytes32 _id) external view returns (Bid[] memory);

    function getAllocations(bytes32 _id) external view returns (Allocation[] memory);

    function getAuction(bytes32 _id) external view returns (AuctionMetadata memory);

    function getAuctionStatus(bytes32 _id) external view returns (AuctionStatus);
}
