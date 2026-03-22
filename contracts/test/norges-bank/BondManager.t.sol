// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondManager} from "@norges-bank/BondManager.sol";
import {IBondManager} from "@norges-bank/interfaces/IBondManager.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {BondDvP} from "@norges-bank/BondDvP.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";
import {AuctionHelper} from "../utils/AuctionHelper.sol";

contract BondManagerTest is Test, AuctionHelper {
    BondManager bondManager;
    BondAuction bondAuction;
    BondToken bondToken;
    BondDvP bondDvp;
    Tbd govTbd;

    address deployer = address(this);
    address govReserve = address(0x800);
    address govBank = address(0x900);
    address holder1 = address(0x400);
    address holder2 = address(0x500);
    address bidder1;
    uint256 bidder1Pk;
    address bidder2;
    uint256 bidder2Pk;

    string constant ISIN = "NO0001234567";
    uint256 constant OFFERING = 1000;
    uint256 constant MATURITY_YEARS = 4;
    uint256 constant DURATION_SCALAR = 365 days; // 1 year for testing
    uint256 constant MATURITY_DURATION = MATURITY_YEARS * DURATION_SCALAR; // 4 years
    bytes constant PUB_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    function _getEndTime() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    uint256 constant COUPON_YIELD = 425; // 4.25% in bps
    uint256 constant UNIT_NOMINAL = 1000; // 1 unit = 1000 WNOK
    uint256 constant REDEMPTION_RATE = 1000;
    uint256 constant PERCENTAGE_PRECISION = 10000;
    bytes32 constant PLAINTEXT_HASH = keccak256("plaintext_bid");
    bytes constant CIPHERTEXT = "encrypted_bid_data";

    function setUp() public {
        bondAdmin = makeAddr("BOND_ADMIN");

        // Deploy WNOK
        wnok = new Wnok(deployer, "Wholesale NOK", "WNOK");
        wnok.add(address(this));
        wnok.add(bondAdmin);
        wnok.add(holder1);
        wnok.add(holder2);
        (bidder1, bidder1Pk) = makeBidder("BIDDER1");
        (bidder2, bidder2Pk) = makeBidder("BIDDER2");
        wnok.add(bidder1);
        wnok.add(bidder2);
        wnok.add(govReserve);
        wnok.add(govBank);

        initGlobals(PLAINTEXT_HASH, CIPHERTEXT, UNIT_NOMINAL, PERCENTAGE_PRECISION);
        initActors(bondAdmin);
        registerBidder(bidder1, bidder1Pk);
        registerBidder(bidder2, bidder2Pk);

        // Deploy contracts
        bondAuction = new BondAuction("Bond Auction");
        bondToken = new BondToken("Bond Token", "BOND");
        bondDvp = new BondDvP("Bond DvP", deployer);
        govTbd = new Tbd(deployer, govBank, address(wnok), address(bondDvp), "Gov TBD", "GTBD", govReserve);

        wnok.add(address(govTbd));

        bondManager = new BondManager(
            "Bond Manager",
            address(wnok),
            bondAdmin,
            address(bondAuction),
            address(bondToken),
            address(bondDvp),
            address(govTbd),
            DURATION_SCALAR
        );

        initContracts(bondAuction, bondManager, wnok);

        // Add BondManager/DvP to WNOK allowlist (needed to receive WNOK in finaliseAuction)
        wnok.add(address(bondManager));
        wnok.add(address(bondDvp));

        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, address(bondManager));

        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondManager));
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondDvp));
        bondToken.grantRole(Roles.DEFAULT_ADMIN_ROLE, deployer);
        bondToken.addController(address(bondManager));
        bondToken.addController(address(bondDvp));

        bytes32 bondManagerRole = Roles.BOND_MANAGER_ROLE;
        vm.prank(deployer);
        bondManager.grantRole(bondManagerRole, bondAdmin);

        bytes32 transferFromRole = keccak256("TRANSFER_FROM_ROLE");
        wnok.grantRole(transferFromRole, address(bondDvp));
        wnok.grantRole(transferFromRole, address(govTbd));

        bytes32 minterRole = keccak256("MINTER_ROLE");
        wnok.grantRole(minterRole, bondAdmin);

        govTbd.add(govReserve);
        govTbd.add(bidder1);
        govTbd.add(bidder2);

        uint256 largeAmount = 1_000_000_000 * 10 ** 18;
        wnok.mint(govReserve, largeAmount);
        vm.prank(deployer);
        govTbd.mint(govReserve, largeAmount);

        vm.prank(govReserve);
        wnok.approve(address(govTbd), type(uint256).max);

        vm.prank(govReserve);
        govTbd.approve(address(bondDvp), type(uint256).max);

        vm.startPrank(bidder1);
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bidder2);
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopPrank();

        vm.prank(deployer);
        bondDvp.grantRole(Roles.SETTLE_ROLE, address(bondManager));
    }

    // ============ deployBondWithAuction Tests ============

    function test_DeployBondWithAuction() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        // bondActive is private, verify auction is active instead
        assertTrue(bondManager.bondActive(ISIN));
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        assertEq(uint256(bondAuction.getAuctionStatus(auctionId)), uint256(IBondAuction.AuctionStatus.BIDDING));

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertTrue(bondToken.activePartitions(partition));
        assertEq(bondToken.partitionOffering(partition), OFFERING);

        IBondAuction.AuctionStatus status = bondAuction.getAuctionStatus(auctionId);
        assertEq(uint256(status), uint256(IBondAuction.AuctionStatus.BIDDING));
    }

    function test_DeployBondWithAuction_RevertIf_NotBondAdmin() public {
        vm.expectRevert();
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
    }

    function test_DeployBondWithAuction_RevertIf_AlreadyExists() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.IncorrectBondState.selector, ISIN, false));
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
    }

    // ============ extendBondWithAuction Tests ============

    function test_ExtendBondWithAuction() public {
        // First create and finalize initial auction
        _createAndFinalizeBond();

        uint256 additionalOffering = 500;
        vm.prank(bondAdmin);
        bondManager.extendBondWithAuction(ISIN, _getEndTime(), PUB_KEY, additionalOffering);

        assertTrue(bondManager.bondActive(ISIN));
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        assertEq(uint256(bondAuction.getAuctionStatus(auctionId)), uint256(IBondAuction.AuctionStatus.BIDDING));

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.partitionOffering(partition), OFFERING + additionalOffering);
    }

    function test_ExtendBondWithAuction_RevertIf_ActiveAuction() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.IncorrectBondState.selector, ISIN, false));
        bondManager.extendBondWithAuction(ISIN, _getEndTime(), PUB_KEY, 500);
    }

    function test_ExtendBondWithAuction_RevertIf_BondNotExists() public {
        vm.prank(bondAdmin);
        vm.expectRevert();
        bondManager.extendBondWithAuction(ISIN, _getEndTime(), PUB_KEY, 500);
    }

    // ============ buybackWithAuction Tests ============

    function test_BuybackWithAuction() public {
        _createAndFinalizeBond();

        vm.prank(bondAdmin);
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING / 2);
    }

    function test_BuybackWithAuction_RevertIf_SizeZero() public {
        _createAndFinalizeBond();

        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.BuybackOfferingZero.selector, ISIN));
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, 0);
    }

    function test_BuybackWithAuction_RevertIf_NoPartition() public {
        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.BondDoesNotExist.selector, ISIN));
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, 100);
    }

    function test_BuybackWithAuction_RevertIf_ExceedsSupply() public {
        _createAndFinalizeBond();
        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.totalSupplyByPartition(partition), OFFERING);

        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.BuybackExceedsSupply.selector, ISIN, OFFERING + 1, OFFERING));
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING + 1);
    }

    // ============ finaliseAuction Tests ============

    function test_FinaliseAuction_Rate() public {
        bytes32 auctionId = _deployRateAuction();
        address[] memory bidders = new address[](1);
        bidders[0] = bidder1;
        _submitBids(auctionId, bidders);
        _close(auctionId);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        _prefundAndApprove(bidder1, OFFERING * UNIT_NOMINAL);

        uint256[] memory nonces = new uint256[](1);
        IBondAuction.BidVerification[] memory proofs = _proofs(auctionId, bidders, nonces);

        vm.prank(bondAdmin);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        assertFalse(bondManager.bondActive(ISIN));

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING);

        // Check coupon parameters were set
        assertEq(bondToken.couponYield(partition), COUPON_YIELD);
        assertEq(bondToken.couponDuration(partition), DURATION_SCALAR);
    }

    function test_FinaliseAuction_Price() public {
        // Create, finalize initial bond, then extend
        _createAndFinalizeBond();

        uint256 additionalOffering = 500;
        vm.prank(bondAdmin);
        bondManager.extendBondWithAuction(ISIN, _getEndTime(), PUB_KEY, additionalOffering);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        address[] memory bidders = new address[](1);
        bidders[0] = bidder2;
        _submitBids(auctionId, bidders);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        uint256 pricePer100 = 9875; // 98.75% in bps
        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN,
            bidder: bidder2,
            units: additionalOffering,
            rate: pricePer100,
            auctionType: IBondAuction.AuctionType.PRICE
        });

        // Pre-fund bidder for discounted payment
        uint256 paymentDue = (pricePer100 * (additionalOffering * UNIT_NOMINAL)) / PERCENTAGE_PRECISION;
        _prefundAndApprove(bidder2, paymentDue);

        uint256[] memory nonces = new uint256[](1);
        IBondAuction.BidVerification[] memory proofs = _proofs(auctionId, bidders, nonces);

        vm.prank(bondAdmin);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, bidder2), additionalOffering);
    }

    function test_FinaliseAuction_Buyback() public {
        _createAndFinalizeBond();

        uint256 buybackSize = OFFERING;
        vm.prank(bondAdmin);
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, buybackSize);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        address[] memory bidders = new address[](2);
        bidders[0] = bidder1;
        bidders[1] = bidder1;
        _submitBids(auctionId, bidders);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        uint256 splitOne = 600;
        uint256 splitTwo = buybackSize - splitOne;
        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](2);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: splitOne, rate: 9800, auctionType: IBondAuction.AuctionType.BUYBACK
        });
        allocations[1] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: splitTwo, rate: 9600, auctionType: IBondAuction.AuctionType.BUYBACK
        });

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 supplyBefore = bondToken.totalSupplyByPartition(partition);
        uint256 bidderBalanceBefore = govTbd.balanceOf(bidder1);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](2);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        proofs[1] = _proof(auctionId, 1, bidder1, 1);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        uint256 expectedPayment = ((allocations[0].rate * (splitOne * UNIT_NOMINAL)) / PERCENTAGE_PRECISION)
            + ((allocations[1].rate * (splitTwo * UNIT_NOMINAL)) / PERCENTAGE_PRECISION);

        assertEq(bondToken.totalSupplyByPartition(partition), supplyBefore - buybackSize);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), 0);
        assertEq(govTbd.balanceOf(bidder1) - bidderBalanceBefore, expectedPayment);

        auctionId = bondAuction.getAuctionId(ISIN);
        assertEq(uint256(bondAuction.getAuctionStatus(auctionId)), uint256(IBondAuction.AuctionStatus.FINALISED));
        assertFalse(bondManager.bondActive(ISIN));
    }

    function test_FinaliseAuction_Buyback_DvpFailure() public {
        _createAndFinalizeBond();

        vm.prank(bondAdmin);
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: 9500, auctionType: IBondAuction.AuctionType.BUYBACK
        });

        // Remove allowance so payment leg fails
        vm.prank(govReserve);
        govTbd.approve(address(bondDvp), 0);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 supplyBefore = bondToken.totalSupplyByPartition(partition);
        uint256 bidderBalanceBefore = govTbd.balanceOf(bidder1);

        vm.expectEmit();
        emit IBondManager.BondAllocationFailed(auctionId, ISIN, bidder1, "Cash");
        vm.expectEmit();
        emit IBondManager.BondBuybackComplete(bondAuction.getAuctionId(ISIN), ISIN, OFFERING);
        vm.expectEmit();
        emit IBondManager.BondAuctionFinalised(bondAuction.getAuctionId(ISIN), ISIN, false);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        assertEq(bondToken.totalSupplyByPartition(partition), supplyBefore);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING);
        assertEq(govTbd.balanceOf(bidder1), bidderBalanceBefore);
    }

    // ============ cancelAuction Tests ============

    function test_CancelAuction() public {
        vm.startPrank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        bytes32 partition = bondToken.isinToPartition(ISIN);

        bondManager.cancelAuction(ISIN);

        assertFalse(bondManager.bondActive(ISIN));
        assertEq(bondToken.partitionOffering(partition), 0); // Offering reduced
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        assertEq(uint256(bondAuction.getAuctionStatus(auctionId)), uint256(IBondAuction.AuctionStatus.CANCELLED));
        vm.stopPrank();
    }

    function test_CancelAuction_RevertIf_NotActive() public {
        vm.prank(bondAdmin);
        vm.expectRevert();
        bondManager.cancelAuction(ISIN);
    }

    function test_CancelAuction_RevertIf_Finalised() public {
        _createAndFinalizeBond();

        vm.prank(bondAdmin);
        vm.expectRevert();
        bondManager.cancelAuction(ISIN);
    }

    // ============ payCoupon Tests ============

    function test_PayCoupon() public {
        _createAndFinalizeBond();

        // Bonds are owned by bidder1 after finalization
        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING);

        // Advance time for first coupon payment
        vm.warp(block.timestamp + DURATION_SCALAR + 1);

        address[] memory holders = new address[](1);
        holders[0] = bidder1; // Use bidder1 who actually owns the bonds

        uint256 balanceBefore = govTbd.balanceOf(bidder1);

        vm.prank(bondAdmin);
        bondManager.payCoupon(ISIN, holders);

        uint256 balanceAfter = govTbd.balanceOf(bidder1);
        // Match contract calculation: paymentPerBond = (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION
        // Then paymentAmount = balance * paymentPerBond
        uint256 paymentPerBond = (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION;
        uint256 expectedPayment = OFFERING * paymentPerBond;
        assertEq(balanceAfter - balanceBefore, expectedPayment);
    }

    function test_PayCoupon_RevertIf_NotReady() public {
        _createAndFinalizeBond();

        address[] memory holders = new address[](1);
        holders[0] = bidder1;

        // Calculate expected next payment time
        // startMaturityTimer sets lastCouponPayment to block.timestamp at finalization
        // nextPaymentTime = lastCouponPayment + couponDuration = block.timestamp + DURATION_SCALAR
        uint256 expectedNextPayment = block.timestamp + DURATION_SCALAR;

        vm.prank(bondAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.CouponNotReady.selector, ISIN, expectedNextPayment, block.timestamp)
        );
        bondManager.payCoupon(ISIN, holders);
    }

    function test_PayCoupon_RevertIf_DuplicateHolders() public {
        _createAndFinalizeBond();

        vm.warp(block.timestamp + DURATION_SCALAR + 1);

        address[] memory holders = new address[](2);
        holders[0] = bidder1;
        holders[1] = bidder1; // Duplicate

        vm.prank(bondAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.CouponPaymentBalanceMismatch.selector, ISIN, OFFERING * 2, OFFERING)
        );
        bondManager.payCoupon(ISIN, holders);
    }

    function test_PayCoupon_RevertIf_AllCouponsPaid() public {
        _createAndFinalizeBond();
        _payAllCoupons(); // Pay all 4 coupons

        // Verify payment count is correct
        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 paymentCount = bondToken.couponPaymentCount(partition);
        uint256 maturityDuration = bondToken.maturityDuration(partition);
        uint256 couponDuration = bondToken.couponDuration(partition);
        uint256 expectedPayments = maturityDuration / couponDuration;

        // Debug: Check actual values
        assertEq(paymentCount, 4, "Payment count should be 4 after paying all coupons");
        assertEq(expectedPayments, 4, "Expected payments should be 4");
        assertTrue(bondToken.isMatured(partition), "Bond should be matured");

        // Advance time past the next payment time to ensure we hit AllCouponsPaid check, not CouponNotReady
        vm.warp(block.timestamp + DURATION_SCALAR + 1);

        address[] memory holders = new address[](1);
        holders[0] = bidder1;

        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.AllCouponsPaid.selector, ISIN));
        bondManager.payCoupon(ISIN, holders);
    }

    function test_PayCoupon_MultipleHolders() public {
        _createAndFinalizeBond();

        // Split bonds between two holders (would need transfer, but for simplicity we'll test with one)
        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING);

        vm.warp(block.timestamp + DURATION_SCALAR);

        address[] memory holders = new address[](1);
        holders[0] = bidder1;

        uint256 balanceBefore = govTbd.balanceOf(bidder1);

        vm.prank(bondAdmin);
        bondManager.payCoupon(ISIN, holders);

        uint256 balanceAfter = govTbd.balanceOf(bidder1);
        // Match contract calculation: paymentPerBond = (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION
        // Then paymentAmount = balance * paymentPerBond
        uint256 paymentPerBond = (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION;
        uint256 expectedPayment = OFFERING * paymentPerBond;
        assertEq(balanceAfter - balanceBefore, expectedPayment);
    }

    function testFuzz_PayCoupon_DistributesAcrossCurrentHolders(uint16 transferUnitsSeed) public {
        _createAndFinalizeBond();

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 transferUnits = bound(uint256(transferUnitsSeed), 0, OFFERING);
        if (transferUnits > 0) {
            vm.prank(bidder1);
            bondToken.transferByPartition(partition, bidder2, transferUnits, "");
        }

        vm.warp(block.timestamp + DURATION_SCALAR + 1);

        address[] memory holders = new address[](2);
        holders[0] = bidder1;
        holders[1] = bidder2;

        uint256 bidder1BalanceBefore = govTbd.balanceOf(bidder1);
        uint256 bidder2BalanceBefore = govTbd.balanceOf(bidder2);

        uint256 bidder1Units = bondToken.balanceOfByPartition(partition, bidder1);
        uint256 bidder2Units = bondToken.balanceOfByPartition(partition, bidder2);

        vm.prank(bondAdmin);
        bondManager.payCoupon(ISIN, holders);

        uint256 paymentPerBond = (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION;
        assertEq(govTbd.balanceOf(bidder1) - bidder1BalanceBefore, bidder1Units * paymentPerBond);
        assertEq(govTbd.balanceOf(bidder2) - bidder2BalanceBefore, bidder2Units * paymentPerBond);
        assertEq(
            (govTbd.balanceOf(bidder1) - bidder1BalanceBefore) + (govTbd.balanceOf(bidder2) - bidder2BalanceBefore),
            OFFERING * paymentPerBond
        );
    }

    // ============ redeem Tests ============

    function test_Redeem() public {
        _createAndFinalizeBond();
        _payAllCoupons(); // Mature the bond

        // Advance time to ensure bond is fully matured
        vm.warp(block.timestamp + DURATION_SCALAR);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        // Redeem from bidder1 who owns the bonds
        address[] memory holders = new address[](1);
        holders[0] = bidder1;

        uint256 tbdBalanceBefore = govTbd.balanceOf(bidder1);
        uint256 bondBalanceBefore = bondToken.balanceOfByPartition(partition, bidder1);

        vm.prank(bondAdmin);
        bondManager.redeem(ISIN, holders);

        uint256 tbdBalanceAfter = govTbd.balanceOf(bidder1);
        uint256 bondBalanceAfter = bondToken.balanceOfByPartition(partition, bidder1);

        assertEq(bondBalanceBefore - bondBalanceAfter, OFFERING);
        assertEq(tbdBalanceAfter - tbdBalanceBefore, OFFERING * REDEMPTION_RATE);
    }

    function test_Redeem_RevertIf_NotMatured() public {
        _createAndFinalizeBond();

        address[] memory holders = new address[](1);
        holders[0] = bidder1;

        vm.prank(bondAdmin);
        vm.expectRevert();
        bondManager.redeem(ISIN, holders);
    }

    function test_Redeem_RevertIf_ZeroAddress() public {
        _createAndFinalizeBond();
        _payAllCoupons();

        // Advance time to ensure bond is fully matured
        vm.warp(block.timestamp + DURATION_SCALAR);

        address[] memory holders = new address[](1);
        holders[0] = address(0);

        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.RedemptionIncomplete.selector, ISIN, OFFERING));
        bondManager.redeem(ISIN, holders);
    }

    function testFuzz_Redeem_PaysAllRemainingSupply(uint16 transferUnitsSeed) public {
        _createAndFinalizeBond();

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 transferUnits = bound(uint256(transferUnitsSeed), 0, OFFERING);
        if (transferUnits > 0) {
            vm.prank(bidder1);
            bondToken.transferByPartition(partition, bidder2, transferUnits, "");
        }

        address[] memory holders = new address[](2);
        holders[0] = bidder1;
        holders[1] = bidder2;
        _payAllCoupons(holders);

        vm.warp(block.timestamp + DURATION_SCALAR);

        uint256 tbdBefore = govTbd.balanceOf(bidder1) + govTbd.balanceOf(bidder2);
        uint256 bondBefore =
            bondToken.balanceOfByPartition(partition, bidder1) + bondToken.balanceOfByPartition(partition, bidder2);

        vm.prank(bondAdmin);
        bondManager.redeem(ISIN, holders);

        uint256 tbdAfter = govTbd.balanceOf(bidder1) + govTbd.balanceOf(bidder2);
        uint256 bondAfter =
            bondToken.balanceOfByPartition(partition, bidder1) + bondToken.balanceOfByPartition(partition, bidder2);

        assertEq(bondBefore, OFFERING);
        assertEq(bondAfter, 0);
        assertEq(tbdAfter - tbdBefore, OFFERING * REDEMPTION_RATE);
    }

    // ============ withdrawFailedIssuance Tests ============

    function test_WithdrawFailedIssuance() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        wnok.mint(bidder1, OFFERING * UNIT_NOMINAL);
        vm.stopPrank();

        // Remove bidder1 approval, so DVP will fail
        vm.prank(bidder1);
        wnok.approve(address(bondDvp), 0);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        // Bonds should remain in BondManager
        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 failedIssuance = bondToken.balanceOfByPartition(partition, address(bondManager));
        assertGt(failedIssuance, 0);

        // Withdraw failed issuance
        vm.prank(bondAdmin);
        bondManager.withdrawFailedIssuance(ISIN);

        uint256 failedIssuanceAfter = bondToken.balanceOfByPartition(partition, address(bondManager));
        assertEq(failedIssuanceAfter, 0);
    }

    function test_FinaliseAuction_IssuanceCashLegFailure() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        // Prefund but remove approval so cash leg fails
        vm.prank(bondAdmin);
        wnok.mint(bidder1, OFFERING * UNIT_NOMINAL);
        vm.prank(bidder1);
        wnok.approve(address(bondDvp), 0);

        vm.expectEmit();
        emit IBondManager.BondAllocationFailed(auctionId, ISIN, bidder1, "Cash");
        vm.expectEmit();
        emit IBondManager.BondAuctionFinalised(auctionId, ISIN, false);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        // Bonds should remain in BondManager due to failed cash leg
        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, address(bondManager)), OFFERING);
    }

    function testFuzz_FinaliseAuction_IssuanceCashLegFailure_LeavesFailedIssuance(uint16 unitsSeed) public {
        uint256 units = bound(uint256(unitsSeed), 1, OFFERING);

        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: units, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        vm.prank(bondAdmin);
        wnok.mint(bidder1, units * UNIT_NOMINAL);
        vm.prank(bidder1);
        wnok.approve(address(bondDvp), 0);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, address(bondManager)), units);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), 0);
        assertEq(bondToken.totalSupplyByPartition(partition), units);
    }

    function test_FinaliseAuction_IssuanceSecurityLegFailure() public {
        _createAndFinalizeBond();

        vm.prank(bondAdmin);
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: 9500, auctionType: IBondAuction.AuctionType.BUYBACK
        });

        bytes32 partition = bondToken.isinToPartition(ISIN);

        // Move bond tokens so DvP security leg fails
        vm.prank(bidder1);
        bondToken.transferByPartition(partition, bidder2, OFFERING, "");

        vm.expectEmit();
        emit IBondManager.BondAllocationFailed(auctionId, ISIN, bidder1, "Security");
        vm.expectEmit();
        emit IBondManager.BondBuybackComplete(bondAuction.getAuctionId(ISIN), ISIN, OFFERING);
        vm.expectEmit();
        emit IBondManager.BondAuctionFinalised(bondAuction.getAuctionId(ISIN), ISIN, false);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);
    }

    function test_WithdrawFailedIssuance_RevertIf_None() public {
        vm.prank(bondAdmin);
        vm.expectRevert(abi.encodeWithSelector(Errors.NoFailedIssuance.selector));
        bondManager.withdrawFailedIssuance(ISIN);
    }

    // ============ closeAuction Tests ============

    function test_CloseAuction() public {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        bytes32 auctionId = bondAuction.getAuctionId(ISIN);
        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        auctionId = bondAuction.getAuctionId(ISIN);
        assertEq(uint256(bondAuction.getAuctionStatus(auctionId)), uint256(IBondAuction.AuctionStatus.CLOSED));
    }

    // ============ Helper Functions ============

    function _createAndFinalizeBond() internal {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
        bytes32 auctionId = bondAuction.getAuctionId(ISIN);

        _submitBid(auctionId, bidder1);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocations = new IBondAuction.Allocation[](1);
        allocations[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        vm.prank(bondAdmin);
        wnok.mint(bidder1, OFFERING * UNIT_NOMINAL);

        vm.prank(bidder1);
        wnok.approve(address(bondDvp), OFFERING * UNIT_NOMINAL);

        vm.prank(bondAdmin);
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](1);
        proofs[0] = _proof(auctionId, 0, bidder1, 0);
        bondManager.finaliseAuction(ISIN, allocations, proofs);
    }

    function _payAllCoupons() internal {
        address[] memory holders = new address[](1);
        holders[0] = bidder1;
        _payAllCoupons(holders);
    }

    function _payAllCoupons(address[] memory holders) internal {
        uint256 expectedPayments = MATURITY_YEARS; // 4 payments

        bytes32 partition = bondToken.isinToPartition(ISIN);

        uint256 t = block.timestamp;
        for (uint256 i = 0; i < expectedPayments; i++) {
            t += DURATION_SCALAR + 1;
            vm.warp(t);
            vm.prank(bondAdmin);
            bondManager.payCoupon(ISIN, holders);
        }

        assertTrue(bondToken.isMatured(partition));
    }

    function _deployRateAuction() internal returns (bytes32) {
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);
        return bondAuction.getAuctionId(ISIN);
    }

    function _close(
        bytes32 /*auctionId*/
    )
        internal
    {
        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);
    }
}
