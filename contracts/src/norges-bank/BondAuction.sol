// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondAuction
 * @notice Accepts sealed bids, tracks auction states, and records allocations for each ISIN-specific TempBond.
 * @notice Entrypoint for primary dealers to submit bids and review allocations.
 * @dev BondManager is expected to own the AUCTION_ADMIN_ROLE and orchestrate the phase transitions.
 */
contract BondAuction is IBondAuction, AccessControl, EIP712 {
    /**
     * @notice EIP-712 typehash for bid intent signatures.
     * @dev Used to verify sealed bidder intent on-chain during finalisation.
     */
    bytes32 private constant BID_INTENT_TYPEHASH =
        keccak256("BidIntent(address bidder,bytes32 auctionId,bytes32 plaintextHash,uint256 bidderNonce)");

    string public name;

    /**
     * @notice Auction metadata
     * @dev Auction data is indexed by auction ID (keccak256(ISIN, index)).
     */
    mapping(bytes32 => AuctionMetadata) public auctionMetadata;
    mapping(bytes32 => AuctionStatus) public auctionStatus;

    /**
     * @notice Sealed bids submitted during bid phase.
     */
    mapping(bytes32 => Bid[]) public auctionBids;

    /**
     * @notice Public posting of final allocations per auction ID (unsealed).
     */
    mapping(bytes32 => Allocation[]) public auctionAllocations;

    /**
     * @notice Nonce tracking for bid intents
     * @dev Prevents replay of bid intent signatures.
     */
    mapping(bytes32 => mapping(address => mapping(uint256 => bool))) public bidderNonceUsed;

    /**
     * @notice Auction count per ISIN to derive auction IDs.
     */
    mapping(string => uint256) public isinToAuctionCount;

    /**
     * @notice Modifier to restrict function execution to a specific auction phase.
     * @param _id Target auction ID.
     * @param _status Required auction status for function execution.
     */
    modifier onlyPhase(bytes32 _id, AuctionStatus _status) {
        _onlyPhase(_id, _status);
        _;
    }

    /**
     * @notice Initializes the auction registry and grants DEFAULT_ADMIN_ROLE to the deployer.
     * @dev BondManager is expected to claim AUCTION_ADMIN_ROLE post deployment.
     * @param _name Name of the auction contract.
     */
    constructor(string memory _name) EIP712("BondAuctionBid", "1") {
        _grantRole(Roles.DEFAULT_ADMIN_ROLE, msg.sender);
        name = _name;
    }

    function _onlyPhase(bytes32 _id, AuctionStatus _status) internal view {
        if (auctionStatus[_id] != _status) {
            revert Errors.IncorrectAuctionPhase(_id, uint8(_status), uint8(auctionStatus[_id]));
        }
    }

    /**
     * @notice Create a new auction for a bond partition (ISIN) in the ERC1400 contract.
     * @dev First auction for an ISIN must be RATE type to set yield; subsequent auctions can be PRICE or BUYBACK.
     * @param _isin ISIN for target bond (used as partition identifier).
     * @param _owner Address of the BondManager (auction admin) that can close/finalise.
     * @param _end End timestamp for sealed bidding.
     * @param _auctionPubKey Auctioneer public key used to unseal bids off-chain.
     * @param _bond Address of the BondToken contract (same for all ISINs).
     * @param _offering Total supply ceiling (offering size) for this partition.
     * @param _auctionType Type of auction: RATE for initial bonds, PRICE for extensions.
     * @return id Id of created auction
     */
    function createAuction(
        string memory _isin,
        address _owner,
        uint64 _end,
        bytes calldata _auctionPubKey,
        address _bond,
        uint256 _offering,
        AuctionType _auctionType
    ) external override onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE) returns (bytes32) {
        if (_auctionPubKey.length == 0) revert Errors.AuctioneerPubkeyMissing();
        if (_owner == address(0)) revert Errors.InvalidAuctionOwner();
        if (_end <= block.timestamp) revert Errors.BiddingEndNotFuture();
        if (_offering == 0) revert Errors.OfferingZero();

        uint256 previousCount = isinToAuctionCount[_isin]++;

        if (previousCount == 0) {
            if (_auctionType != AuctionType.RATE) revert Errors.FirstAuctionMustBeRate();
        } else {
            bytes32 previousId = _auctionId(_isin, previousCount);
            if (auctionStatus[previousId] < AuctionStatus.FINALISED) revert Errors.PreviousAuctionActive(previousId);
            if (_auctionType != AuctionType.PRICE && _auctionType != AuctionType.BUYBACK) {
                revert Errors.AuctionTypeMustBePrice();
            }
        }

        bytes32 id = _auctionId(_isin, isinToAuctionCount[_isin]);

        auctionMetadata[id] = AuctionMetadata({
            isin: _isin,
            owner: _owner,
            end: _end,
            auctionPubKey: _auctionPubKey,
            bond: _bond,
            offering: _offering,
            auctionType: _auctionType
        });

        auctionStatus[id] = AuctionStatus.BIDDING;

        emit AuctionCreated(id, _owner, _isin, _offering, _end, _auctionPubKey, _auctionType);

        return id;
    }

    /**
     * @notice Close an auction after the BondManager observes the off-chain timer expiry.
     * @dev Bid phase is soft-enforced via timestamp but this function finalizes the phase transition.
     * @param _id Target auction ID to close.
     * @param _caller Expected to be the BondManager admin wallet.
     * @return bids Array of encrypted bids captured during BIDDING.
     */
    function closeAuction(bytes32 _id, address _caller)
        external
        override
        onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
        onlyPhase(_id, AuctionStatus.BIDDING)
        returns (Bid[] memory)
    {
        AuctionMetadata storage metadata = auctionMetadata[_id];
        if (metadata.owner == address(0)) revert Errors.AuctionNotFound(_id);

        if (_caller != metadata.owner) revert Errors.NotAuctionOwner();
        if (block.timestamp <= metadata.end) revert Errors.InBidPhase();

        auctionStatus[_id] = AuctionStatus.CLOSED;

        uint256 bidCounter = auctionBids[_id].length;

        emit AuctionClosed(_id, metadata.isin, bidCounter);

        Bid[] memory bids = auctionBids[_id];
        return bids;
    }

    /**
     * @notice Cancel an auction in any state except FINALISED.
     * @param _id Target auction ID to cancel.
     * @param _caller Expected to be the BondManager admin wallet.
     * @return offering The offering size of the cancelled auction.
     * @dev Can cancel auctions in BIDDING, CLOSED, ERROR, or CANCELLED states (status < FINALISED && status != NONE).
     * @dev Cannot cancel auctions that are FINALISED or NONE.
     * @dev Sets auction status to CANCELLED.
     */
    function cancelAuction(bytes32 _id, address _caller)
        external
        override
        onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
        returns (uint256 offering)
    {
        AuctionStatus currentStatus = auctionStatus[_id];

        // Allow canceling if status < FINALISED (NONE=0, BIDDING=1, CLOSED=2) but exclude NONE
        if (currentStatus >= AuctionStatus.FINALISED || currentStatus == AuctionStatus.NONE) {
            revert Errors.CannotCancelAuctionInThisState();
        }

        // Validate caller is the owner (auction exists since status != NONE)
        AuctionMetadata storage metadata = auctionMetadata[_id];
        if (metadata.owner == address(0)) revert Errors.AuctionNotFound(_id);
        if (_caller != metadata.owner) revert Errors.NotAuctionOwner();

        offering = metadata.offering;

        auctionStatus[_id] = AuctionStatus.CANCELLED;

        emit AuctionCancelled(_id, metadata.isin);
    }

    /**
     * @notice Finalize the active auction with off-chain computed uniform-rate allocations.
     * @param _id Auction ID being finalised.
     * @param _caller Must match auctionMetadata.owner (BondManager).
     * @param _alloc Clearing rate allocations sorted arbitrarily but priced uniformly.
     * @return total Total units allocated across all bidders.
     * @return clearingRate The shared rate (interest rate or price per 100) set by the marginal bid.
     */
    function finaliseAuction(bytes32 _id, address _caller, Allocation[] memory _alloc, BidVerification[] memory _proofs)
        external
        override
        onlyRole(Roles.BOND_AUCTION_ADMIN_ROLE)
        onlyPhase(_id, AuctionStatus.CLOSED)
        returns (uint256, uint256)
    {
        AuctionMetadata storage metadata = auctionMetadata[_id];
        if (metadata.owner == address(0)) revert Errors.AuctionNotFound(_id);

        if (_caller != metadata.owner) revert Errors.NotAuctionOwner();
        if (_alloc.length == 0) revert Errors.NoAllocations();
        if (_proofs.length != _alloc.length) revert Errors.ProofLengthMismatch(_alloc.length, _proofs.length);

        auctionStatus[_id] = AuctionStatus.FINALISED;

        // Ensure all allocations match the auction type and validate allocations
        AuctionType expectedType = metadata.auctionType;
        uint256 total = 0;
        uint256 clearingRate = 0;

        bool isBuyback = expectedType == AuctionType.BUYBACK;
        if (!isBuyback) {
            clearingRate = _alloc[0].rate;
        }

        // Validate allocations, ensure types and rates match, and accumulate total
        for (uint256 i = 0; i < _alloc.length; i++) {
            Allocation memory allocation = _alloc[i];
            BidVerification memory proof = _proofs[i];

            if (allocation.auctionType != expectedType) revert Errors.AllocationTypeMismatch();
            if (allocation.units == 0) revert Errors.InvalidUnits();
            if (allocation.rate == 0) revert Errors.InvalidRate();

            if (!isBuyback && allocation.rate != clearingRate) revert Errors.RatesMustMatch();

            _verifyBidIntent(_id, allocation.bidder, proof);

            total += allocation.units;
        }

        if (!isBuyback && clearingRate == 0) revert Errors.InvalidRate();
        uint256 offering = metadata.offering;

        if (total > offering) revert Errors.OverAllocation(total, offering);

        // TODO: Does a failed DVP affect the posting?
        for (uint256 i = 0; i < _alloc.length; i++) {
            auctionAllocations[_id].push(_alloc[i]);
        }

        emit AuctionFinalized(_id, metadata.isin);

        return (total, clearingRate);
    }

    /**
     * @notice Submit an encrypted bid for an active auction.
     * @param _id ID of target auction.
     * @param _ciphertext Packed ciphertext blob carrying wrapped keys + symmetric ciphertext.
     * @param _plaintextHash keccak256 hash of the plaintext payload.
     * @return bidIndex Index of the stored bid (used by clients for off-chain reconciliation).
     */
    function submitBid(bytes32 _id, bytes calldata _ciphertext, bytes32 _plaintextHash)
        external
        override
        onlyPhase(_id, AuctionStatus.BIDDING)
        returns (uint256 bidIndex)
    {
        // Don't need validity check as modifier handles that
        AuctionMetadata storage metadata = auctionMetadata[_id];
        if (metadata.owner == address(0)) revert Errors.AuctionNotFound(_id);

        if (block.timestamp > metadata.end) revert Errors.NotInBidPhase();

        if (_ciphertext.length == 0) revert Errors.CiphertextRequired();
        if (_plaintextHash.length == 0) revert Errors.PlaintextHashRequired();

        auctionBids[_id].push(Bid({bidder: msg.sender, ciphertext: _ciphertext, plaintextHash: _plaintextHash}));

        bidIndex = auctionBids[_id].length - 1;

        emit BidSubmitted(_id, msg.sender, metadata.isin, bidIndex, _plaintextHash, _ciphertext);
    }

    function _auctionId(string memory _isin, uint256 _index) internal pure returns (bytes32) {
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encodePacked(_isin, _index));
    }

    /**
     * @notice Verify bidder intent signature via EIP-712 for a specific bid in an auction.
     * @param _id Id of target auction.
     * @param _bidder Expected bidder address.
     * @param _proof Bid verification proof generated off-chain.
     */
    function _verifyBidIntent(bytes32 _id, address _bidder, BidVerification memory _proof) internal {
        Bid[] storage bids = auctionBids[_id];
        if (_proof.bidIndex >= bids.length) revert Errors.InvalidBidIndex(bids.length - 1, _proof.bidIndex);

        Bid storage bid = bids[_proof.bidIndex];
        if (_proof.bidderSig.length == 0) revert Errors.MissingBidSig();

        bytes32 structHash =
        // forge-lint: disable-next-line(asm-keccak256)
        keccak256(abi.encode(BID_INTENT_TYPEHASH, _bidder, _id, bid.plaintextHash, _proof.bidderNonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, _proof.bidderSig);

        if (recovered != _bidder) revert Errors.InvalidBidSig();
        if (bidderNonceUsed[_id][_bidder][_proof.bidderNonce]) revert Errors.InvalidBidNonce();

        bidderNonceUsed[_id][_bidder][_proof.bidderNonce] = true;
    }

    /**
     * @notice Return the current auction ID for an ISIN.
     * @param _isin ISIN for target bond.
     * @return Current auction ID.
     */
    function getAuctionId(string memory _isin) public view override returns (bytes32) {
        uint256 count = isinToAuctionCount[_isin];
        if (count == 0) revert Errors.AuctionNotFoundForIsin(_isin);
        return _auctionId(_isin, count);
    }

    /**
     * @notice Return auction metadata by ID.
     * @param _id Auction identifier.
     * @return auction Auction data.
     */
    function getAuction(bytes32 _id) external view override returns (AuctionMetadata memory) {
        AuctionMetadata memory auction = auctionMetadata[_id];
        return auction;
    }

    /**
     * @notice Return auction status by ID.
     * @param _id Auction identifier.
     * @return auction Auction data.
     */
    function getAuctionStatus(bytes32 _id) external view override returns (AuctionStatus) {
        AuctionStatus status = auctionStatus[_id];
        return status;
    }

    /**
     * @notice Return all sealed bids for auction ID so off-chain tooling can decrypt them.
     * @param _id Auction identifier.
     * @return bids Array of encrypted bids.
     */
    function getSealedBids(bytes32 _id) external view override returns (Bid[] memory) {
        Bid[] memory bids = auctionBids[_id];
        return bids;
    }

    /**
     * @notice Return final allocations for auction ID.
     * @param _id Auction identifier.
     * @return allocations Recorded allocations.
     */
    function getAllocations(bytes32 _id) external view override returns (Allocation[] memory) {
        Allocation[] memory alloc = auctionAllocations[_id];
        return alloc;
    }
}
