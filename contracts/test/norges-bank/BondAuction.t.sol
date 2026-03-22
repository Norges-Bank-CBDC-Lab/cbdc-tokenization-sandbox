// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";
import {BidIntentHelper} from "../utils/BidIntentHelper.sol";

contract BondAuctionTest is Test, BidIntentHelper {
    BondAuction bondAuction;
    BondToken bondToken;
    Wnok wnok;

    address admin = address(this);
    address auctionAdmin;
    address bidder1;
    uint256 bidder1Pk;
    address bidder2;
    uint256 bidder2Pk;

    string constant ISIN = "NO0001234567";
    uint256 constant OFFERING = 1000;
    bytes constant PUB_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    bytes constant CIPHERTEXT = "encrypted_bid_data";
    bytes32 constant PLAINTEXT_HASH = keccak256("plaintext_bid");

    function _proof(
        bytes32 auctionId,
        uint256 bidIndex,
        address bidder,
        uint256 bidderPk,
        uint256 bidderNonce,
        bytes32 plaintextHash
    ) internal view returns (IBondAuction.BidVerification memory) {
        bytes memory sig = signBidIntent(
            bidderPk, bidder, auctionId, plaintextHash, bidderNonce, address(bondAuction), block.chainid
        );
        return IBondAuction.BidVerification({bidIndex: bidIndex, bidderNonce: bidderNonce, bidderSig: sig});
    }

    function _getEndTime() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function setUp() public {
        wnok = new Wnok(admin, "Wholesale NOK", "WNOK");
        wnok.add(address(this));

        bondToken = new BondToken("Bond Token", "BOND");
        bondAuction = new BondAuction("Bond Auction");

        // Setup auction admin (simulating BondManager)
        auctionAdmin = address(0x999);
        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, auctionAdmin);

        (bidder1, bidder1Pk) = makeBidder("BIDDER_1");
        (bidder2, bidder2Pk) = makeBidder("BIDDER_2");
    }

    // ============ createAuction Tests ============

    function test_CreateAuction_Rate() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        IBondAuction.AuctionMetadata memory metadata = bondAuction.getAuction(id);
        assertEq(metadata.owner, auctionAdmin);
        assertEq(metadata.offering, OFFERING);
        assertEq(uint256(metadata.auctionType), uint256(IBondAuction.AuctionType.RATE));
        assertEq(uint256(bondAuction.getAuctionStatus(id)), uint256(IBondAuction.AuctionStatus.BIDDING));
    }

    function test_CreateAuction_RevertIf_NotAdmin() public {
        vm.expectRevert();
        bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );
    }

    function test_CreateAuction_RevertIf_EmptyPubKey() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.AuctioneerPubkeyMissing.selector));
        bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), "", address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );
    }

    function test_CreateAuction_RevertIf_InvalidOwner() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidAuctionOwner.selector));
        bondAuction.createAuction(
            ISIN, address(0), _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );
    }

    function test_CreateAuction_RevertIf_EndTimeInPast() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.BiddingEndNotFuture.selector));
        bondAuction.createAuction(
            ISIN,
            auctionAdmin,
            uint64(block.timestamp - 1),
            PUB_KEY,
            address(bondToken),
            OFFERING,
            IBondAuction.AuctionType.RATE
        );
    }

    function test_CreateAuction_RevertIf_ZeroOffering() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.OfferingZero.selector));
        bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), 0, IBondAuction.AuctionType.RATE
        );
    }

    function test_CreateAuction_RevertIf_FirstAuctionNotRate() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.FirstAuctionMustBeRate.selector));
        bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.PRICE
        );
    }

    function test_CreateAuction_Extension_Price() public {
        // Create first RATE auction
        vm.prank(auctionAdmin);
        bytes32 rateId = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        // Submit bids
        vm.prank(bidder1);
        bondAuction.submitBid(rateId, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        // Close and finalize first auction
        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(rateId, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 500, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(rateId, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);

        bondAuction.finaliseAuction(rateId, auctionAdmin, allocations, proofs);

        // Now create PRICE auction for extension
        uint64 newEndTime = uint64(block.timestamp + 1 days);
        bytes32 priceId = bondAuction.createAuction(
            ISIN, auctionAdmin, newEndTime, PUB_KEY, address(bondToken), 500, IBondAuction.AuctionType.PRICE
        );

        IBondAuction.AuctionMetadata memory metadata = bondAuction.getAuction(priceId);
        assertEq(uint256(metadata.auctionType), uint256(IBondAuction.AuctionType.PRICE));
        vm.stopPrank();
    }

    function test_CreateAuction_Buyback() public {
        vm.prank(auctionAdmin);
        bytes32 rateId = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        // Submit bid
        vm.prank(bidder1);
        bondAuction.submitBid(rateId, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(rateId, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(rateId, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(rateId, auctionAdmin, allocations, proofs);

        uint64 endTime = uint64(block.timestamp + 1 days);
        uint256 buybackSize = OFFERING / 2;
        bytes32 buybackId = bondAuction.createAuction(
            ISIN, auctionAdmin, endTime, PUB_KEY, address(bondToken), buybackSize, IBondAuction.AuctionType.BUYBACK
        );

        IBondAuction.AuctionMetadata memory metadata = bondAuction.getAuction(buybackId);
        assertEq(uint256(metadata.auctionType), uint256(IBondAuction.AuctionType.BUYBACK));
        assertEq(metadata.offering, buybackSize);
        assertEq(uint256(bondAuction.getAuctionStatus(buybackId)), uint256(IBondAuction.AuctionStatus.BIDDING));
        vm.stopPrank();
    }

    // ============ submitBid Tests ============

    function test_SubmitBid() public {
        vm.startPrank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );
        vm.stopPrank();

        vm.prank(bidder1);
        uint256 bidIndex = bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        assertEq(bidIndex, 0);
        IBondAuction.Bid[] memory bids = bondAuction.getSealedBids(id);
        assertEq(bids.length, 1);
        assertEq(bids[0].bidder, bidder1);
    }

    function test_SubmitBid_RevertIf_NotBiddingPhase() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.warp(_getEndTime() + 1);
        vm.prank(auctionAdmin);
        bondAuction.closeAuction(id, auctionAdmin);

        vm.prank(bidder1);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.IncorrectAuctionPhase.selector,
                id,
                uint8(IBondAuction.AuctionStatus.BIDDING),
                uint8(IBondAuction.AuctionStatus.CLOSED)
            )
        );
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
    }

    function test_SubmitBid_RevertIf_BidPhaseExpired() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.warp(_getEndTime() + 1);
        vm.prank(bidder1);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInBidPhase.selector));
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
    }

    function test_SubmitBid_RevertIf_EmptyCiphertext() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        vm.expectRevert(abi.encodeWithSelector(Errors.CiphertextRequired.selector));
        bondAuction.submitBid(id, "", PLAINTEXT_HASH);
    }

    // ============ closeAuction Tests ============

    function test_CloseAuction() public {
        vm.startPrank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );
        vm.stopPrank();

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.warp(_getEndTime() + 1);
        vm.prank(auctionAdmin);
        IBondAuction.Bid[] memory bids = bondAuction.closeAuction(id, auctionAdmin);

        assertEq(bids.length, 1);
        assertEq(uint256(bondAuction.getAuctionStatus(id)), uint256(IBondAuction.AuctionStatus.CLOSED));
    }

    function test_CloseAuction_RevertIf_NotBiddingPhase() public {
        vm.prank(auctionAdmin);
        bytes32 id = bytes32(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.IncorrectAuctionPhase.selector,
                id,
                uint8(IBondAuction.AuctionStatus.BIDDING),
                uint8(IBondAuction.AuctionStatus.NONE)
            )
        );
        bondAuction.closeAuction(id, auctionAdmin);
    }

    function test_CloseAuction_RevertIf_NotOwner() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        // Grant role to bidder1 so it passes the role check and fails on owner check
        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bidder1);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotAuctionOwner.selector));
        bondAuction.closeAuction(id, bidder1);
    }

    function test_CloseAuction_RevertIf_StillInBidPhase() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.InBidPhase.selector));
        bondAuction.closeAuction(id, auctionAdmin);
    }

    // ============ cancelAuction Tests ============

    function test_CancelAuction_BiddingPhase() public {
        vm.startPrank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        uint256 offering = bondAuction.cancelAuction(id, auctionAdmin);

        assertEq(offering, OFFERING);
        assertEq(uint256(bondAuction.getAuctionStatus(id)), uint256(IBondAuction.AuctionStatus.CANCELLED));
        vm.stopPrank();
    }

    function test_CancelAuction_ClosedPhase() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
        vm.prank(bidder2);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);
        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        uint256 offering = bondAuction.cancelAuction(id, auctionAdmin);

        assertEq(offering, OFFERING);
        assertEq(uint256(bondAuction.getAuctionStatus(id)), uint256(IBondAuction.AuctionStatus.CANCELLED));
        vm.stopPrank();
    }

    function test_CancelAuction_RevertIf_Finalised() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);
        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 500, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);

        vm.expectRevert(abi.encodeWithSelector(Errors.CannotCancelAuctionInThisState.selector));
        bondAuction.cancelAuction(id, auctionAdmin);
        vm.stopPrank();
    }

    function test_CancelAuction_RevertIf_None() public {
        vm.prank(auctionAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.CannotCancelAuctionInThisState.selector));
        bondAuction.cancelAuction(bytes32(0), auctionAdmin);
    }

    function test_CancelAuction_RevertIf_NotOwner() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        // Grant role to bidder1 so it passes the role check and fails on owner check
        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, bidder1);

        vm.prank(bidder1);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotAuctionOwner.selector));
        bondAuction.cancelAuction(id, bidder1);
    }

    // ============ finaliseAuction Tests ============

    function test_FinaliseAuction() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
        vm.prank(bidder2);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](2);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 300, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });
        allocations[1] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder2, units: 200, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });

        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](2);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        proofs[1] = _proof(id, 1, bidder2, bidder2Pk, 0, PLAINTEXT_HASH);

        (uint256 total, uint256 clearingRate) = bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);

        assertEq(total, 500);
        assertEq(clearingRate, 425);
        assertEq(uint256(bondAuction.getAuctionStatus(id)), uint256(IBondAuction.AuctionStatus.FINALISED));
        vm.stopPrank();
    }

    function test_FinaliseAuction_RevertIf_NotClosed() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 500, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });

        vm.prank(auctionAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.IncorrectAuctionPhase.selector,
                id,
                uint8(IBondAuction.AuctionStatus.CLOSED),
                uint8(IBondAuction.AuctionStatus.BIDDING)
            )
        );
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);
    }

    function test_FinaliseAuction_RevertIf_RateMismatch() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
        vm.prank(bidder2);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](2);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 300, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });
        allocations[1] = IBondAuction.Allocation({
            isin: ISIN,
            bidder: bidder2,
            units: 200,
            rate: 450, // Different rate
            auctionType: IBondAuction.AuctionType.RATE
        });

        vm.expectRevert(abi.encodeWithSelector(Errors.RatesMustMatch.selector));
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](2);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        proofs[1] = _proof(id, 1, bidder2, bidder2Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);
        vm.stopPrank();
    }

    function test_FinaliseAuction_RevertIf_OverAllocation() public {
        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN,
            bidder: bidder1,
            units: OFFERING + 1, // Exceeds offering
            rate: 425,
            auctionType: IBondAuction.AuctionType.RATE
        });

        vm.expectRevert(abi.encodeWithSelector(Errors.OverAllocation.selector, OFFERING + 1, OFFERING));
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);
        vm.stopPrank();
    }

    function test_FinaliseAuction_Buyback_AllowsDifferentRates() public {
        vm.prank(auctionAdmin);
        bytes32 rateId = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(rateId, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);

        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(rateId, auctionAdmin);

        IBondAuction.Allocation[] memory initialAlloc = new IBondAuction.Allocation[](1);
        initialAlloc[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 100, rate: 400, auctionType: IBondAuction.AuctionType.RATE
        });
        IBondAuction.BidVerification[] memory initialProofs = new IBondAuction.BidVerification[](1);
        initialProofs[0] = _proof(rateId, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(rateId, auctionAdmin, initialAlloc, initialProofs);

        uint64 buybackEnd = uint64(block.timestamp + 1 days);
        bytes32 buybackId = bondAuction.createAuction(
            ISIN, auctionAdmin, buybackEnd, PUB_KEY, address(bondToken), 400, IBondAuction.AuctionType.BUYBACK
        );

        vm.stopPrank();

        vm.prank(bidder1);
        bondAuction.submitBid(buybackId, CIPHERTEXT, PLAINTEXT_HASH);
        vm.prank(bidder2);
        bondAuction.submitBid(buybackId, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);
        vm.warp(buybackEnd + 1);
        bondAuction.closeAuction(buybackId, auctionAdmin);

        IBondAuction.Allocation[] memory buybackAlloc = new IBondAuction.Allocation[](2);
        buybackAlloc[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 250, rate: 9750, auctionType: IBondAuction.AuctionType.BUYBACK
        });
        buybackAlloc[1] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder2, units: 150, rate: 9900, auctionType: IBondAuction.AuctionType.BUYBACK
        });

        IBondAuction.BidVerification[] memory buybackProofs = new IBondAuction.BidVerification[](2);
        buybackProofs[0] = _proof(buybackId, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        buybackProofs[1] = _proof(buybackId, 1, bidder2, bidder2Pk, 0, PLAINTEXT_HASH);

        (uint256 total, uint256 clearingRate) =
            bondAuction.finaliseAuction(buybackId, auctionAdmin, buybackAlloc, buybackProofs);

        assertEq(total, 400);
        assertEq(clearingRate, 0); // BUYBACK auctions do not enforce a uniform clearing rate
        assertEq(uint256(bondAuction.getAuctionStatus(buybackId)), uint256(IBondAuction.AuctionStatus.FINALISED));
        vm.stopPrank();
    }

    function testFuzz_FinaliseAuction_UniformRateReturnsExpectedTotal(
        uint16 units1Seed,
        uint16 units2Seed,
        uint16 rateSeed
    ) public {
        uint256 units1 = bound(uint256(units1Seed), 1, OFFERING - 1);
        uint256 units2 = bound(uint256(units2Seed), 1, OFFERING - units1);
        uint256 rate = bound(uint256(rateSeed), 1, 10_000);

        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);
        vm.prank(bidder2);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);
        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](2);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: units1, rate: rate, auctionType: IBondAuction.AuctionType.RATE
        });
        allocations[1] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder2, units: units2, rate: rate, auctionType: IBondAuction.AuctionType.RATE
        });

        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](2);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        proofs[1] = _proof(id, 1, bidder2, bidder2Pk, 0, PLAINTEXT_HASH);

        (uint256 total, uint256 clearingRate) = bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);

        assertEq(total, units1 + units2);
        assertEq(clearingRate, rate);
        vm.stopPrank();
    }

    function testFuzz_FinaliseAuction_RevertIf_OverAllocation(uint16 extraUnitsSeed) public {
        uint256 extraUnits = bound(uint256(extraUnitsSeed), 1, type(uint16).max);

        vm.prank(auctionAdmin);
        bytes32 id = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        vm.prank(bidder1);
        bondAuction.submitBid(id, CIPHERTEXT, PLAINTEXT_HASH);

        vm.startPrank(auctionAdmin);
        vm.warp(_getEndTime() + 1);
        bondAuction.closeAuction(id, auctionAdmin);

        uint256 units = OFFERING + extraUnits;
        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: units, rate: 425, auctionType: IBondAuction.AuctionType.RATE
        });

        vm.expectRevert(abi.encodeWithSelector(Errors.OverAllocation.selector, units, OFFERING));
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(id, 0, bidder1, bidder1Pk, 0, PLAINTEXT_HASH);
        bondAuction.finaliseAuction(id, auctionAdmin, allocations, proofs);
        vm.stopPrank();
    }

    // ============ getAuctionId Tests ============

    function test_GetAuctionId() public {
        vm.prank(auctionAdmin);
        bytes32 id1 = bondAuction.createAuction(
            ISIN, auctionAdmin, _getEndTime(), PUB_KEY, address(bondToken), OFFERING, IBondAuction.AuctionType.RATE
        );

        bytes32 id2 = bondAuction.getAuctionId(ISIN);
        assertEq(id1, id2);
    }
}
