// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondManager} from "@norges-bank/BondManager.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {BondDvP} from "@norges-bank/BondDvP.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Roles} from "@common/Roles.sol";
import {AuctionHelper} from "../utils/AuctionHelper.sol";

contract BondLifecycleIntegrationTest is Test, AuctionHelper {
    BondManager bondManager;
    BondAuction bondAuction;
    BondToken bondToken;
    BondDvP bondDvp;
    Tbd govTbd;

    address deployer = address(this);
    address govReserve = address(0x6);
    address govBank = address(0x7);
    address bidder1;
    uint256 bidder1Pk;
    address bidder2;
    uint256 bidder2Pk;

    string constant ISIN = "NO0001234567";
    uint256 constant OFFERING = 1000;
    uint256 constant ADDITIONAL_OFFERING = 500;
    uint256 constant BUYBACK_SIZE = 400;
    uint256 constant MATURITY_YEARS = 4;
    uint256 constant DURATION_SCALAR = 365 days; // 1 year for testing
    bytes constant PUB_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    uint256 constant COUPON_YIELD = 425; // 4.25% in bps
    uint256 constant UNIT_NOMINAL = 1000; // 1 bond = 1000 WNOK
    uint256 constant REDEMPTION_RATE = 1000;
    uint256 constant PERCENTAGE_PRECISION = 10000;
    bytes32 constant PLAINTEXT_HASH = keccak256("plaintext_bid");
    bytes constant CIPHERTEXT = "encrypted_bid_data";

    function setUp() public {
        bondAdmin = makeAddr("BOND_ADMIN");

        wnok = new Wnok(deployer, "Wholesale NOK", "WNOK");
        wnok.add(address(this));
        wnok.add(bondAdmin);
        (bidder1, bidder1Pk) = makeBidder("BIDDER1_INTEGRATION");
        (bidder2, bidder2Pk) = makeBidder("BIDDER2_INTEGRATION");
        wnok.add(bidder1);
        wnok.add(bidder2);
        wnok.add(govReserve);
        wnok.add(govBank);

        initGlobals(PLAINTEXT_HASH, CIPHERTEXT, UNIT_NOMINAL, PERCENTAGE_PRECISION);
        initActors(bondAdmin);
        registerBidder(bidder1, bidder1Pk);
        registerBidder(bidder2, bidder2Pk);

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

        // permissions
        wnok.add(address(bondManager));
        wnok.add(address(bondDvp));
        bytes32 transferFromRole = keccak256("TRANSFER_FROM_ROLE");
        wnok.grantRole(transferFromRole, address(bondDvp));
        wnok.grantRole(transferFromRole, address(govTbd));
        wnok.grantRole(keccak256("MINTER_ROLE"), bondAdmin);

        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, address(bondManager));
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondManager));
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondDvp));
        bondToken.grantRole(Roles.DEFAULT_ADMIN_ROLE, deployer);
        bondToken.addController(address(bondManager));
        bondToken.addController(address(bondDvp));
        bondManager.grantRole(Roles.BOND_MANAGER_ROLE, bondAdmin);

        vm.prank(deployer);
        bondDvp.grantRole(Roles.SETTLE_ROLE, address(bondManager));

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
    }

    function _getEndTime() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _paymentPerBond() internal pure returns (uint256) {
        return (REDEMPTION_RATE * COUPON_YIELD) / PERCENTAGE_PRECISION;
    }

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

    function test_FullFlow_WithExtension() public {
        // --- Initial issuance (RATE auction) ---
        vm.prank(bondAdmin);
        bondManager.deployBondWithAuction(ISIN, _getEndTime(), PUB_KEY, OFFERING, MATURITY_YEARS);

        bytes32 auctionIdRate = bondAuction.getAuctionId(ISIN);
        address[] memory rateBidders = new address[](1);
        rateBidders[0] = bidder1;
        _submitBids(auctionIdRate, rateBidders);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocRate = new IBondAuction.Allocation[](1);
        allocRate[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: OFFERING, rate: COUPON_YIELD, auctionType: IBondAuction.AuctionType.RATE
        });

        _prefundAndApprove(bidder1, OFFERING * UNIT_NOMINAL);

        vm.prank(bondAdmin);
        uint256[] memory rateNonces = new uint256[](1);
        IBondAuction.BidVerification[] memory rateProofs = _proofs(auctionIdRate, rateBidders, rateNonces);
        bondManager.finaliseAuction(ISIN, allocRate, rateProofs);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING);

        // --- Extension issuance (PRICE auction) ---
        vm.prank(bondAdmin);
        bondManager.extendBondWithAuction(ISIN, _getEndTime(), PUB_KEY, ADDITIONAL_OFFERING);

        bytes32 auctionIdPrice = bondAuction.getAuctionId(ISIN);
        address[] memory priceBidders = new address[](1);
        priceBidders[0] = bidder2;
        _submitBids(auctionIdPrice, priceBidders);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        uint256 pricePer100 = 9875; // 98.75% in bps
        IBondAuction.Allocation[] memory allocPrice = new IBondAuction.Allocation[](1);
        allocPrice[0] = IBondAuction.Allocation({
            isin: ISIN,
            bidder: bidder2,
            units: ADDITIONAL_OFFERING,
            rate: pricePer100,
            auctionType: IBondAuction.AuctionType.PRICE
        });

        uint256 paymentDue = (pricePer100 * (ADDITIONAL_OFFERING * UNIT_NOMINAL)) / PERCENTAGE_PRECISION;
        _prefundAndApprove(bidder2, paymentDue);

        vm.prank(bondAdmin);
        uint256[] memory priceNonces = new uint256[](1);
        IBondAuction.BidVerification[] memory priceProofs = _proofs(auctionIdPrice, priceBidders, priceNonces);
        bondManager.finaliseAuction(ISIN, allocPrice, priceProofs);

        assertEq(bondToken.partitionOffering(partition), OFFERING + ADDITIONAL_OFFERING);
        assertEq(bondToken.balanceOfByPartition(partition, bidder2), ADDITIONAL_OFFERING);

        // --- Buyback (BUYBACK auction) ---
        vm.prank(bondAdmin);
        bondManager.buybackWithAuction(ISIN, _getEndTime(), PUB_KEY, BUYBACK_SIZE);

        bytes32 auctionIdBuyback = bondAuction.getAuctionId(ISIN);
        address[] memory buybackBidders = new address[](2);
        buybackBidders[0] = bidder1;
        buybackBidders[1] = bidder1;
        _submitBids(auctionIdBuyback, buybackBidders);

        vm.warp(_getEndTime() + 1);
        vm.prank(bondAdmin);
        bondManager.closeAuction(ISIN);

        IBondAuction.Allocation[] memory allocBuyback = new IBondAuction.Allocation[](2);
        allocBuyback[0] = IBondAuction.Allocation({
            isin: ISIN, bidder: bidder1, units: 250, rate: 9700, auctionType: IBondAuction.AuctionType.BUYBACK
        });
        allocBuyback[1] = IBondAuction.Allocation({
            isin: ISIN,
            bidder: bidder1,
            units: BUYBACK_SIZE - 250,
            rate: 9600,
            auctionType: IBondAuction.AuctionType.BUYBACK
        });

        uint256 bidder1BeforeBuyback = govTbd.balanceOf(bidder1);
        vm.prank(bondAdmin);
        uint256[] memory buybackNonces = new uint256[](2);
        buybackNonces[0] = 0;
        buybackNonces[1] = 1;
        IBondAuction.BidVerification[] memory buybackProofs = _proofs(auctionIdBuyback, buybackBidders, buybackNonces);
        bondManager.finaliseAuction(ISIN, allocBuyback, buybackProofs);

        uint256 expectedBuybackPayment = (allocBuyback[0].rate * (allocBuyback[0].units * UNIT_NOMINAL))
            / PERCENTAGE_PRECISION + (allocBuyback[1].rate * (allocBuyback[1].units * UNIT_NOMINAL))
            / PERCENTAGE_PRECISION;
        assertEq(govTbd.balanceOf(bidder1) - bidder1BeforeBuyback, expectedBuybackPayment);

        uint256 remainingSupply = OFFERING + ADDITIONAL_OFFERING - BUYBACK_SIZE;
        assertEq(bondToken.totalSupplyByPartition(partition), remainingSupply);
        assertEq(bondToken.balanceOfByPartition(partition, bidder1), OFFERING - BUYBACK_SIZE);

        // --- Pay all coupons across both holders ---
        address[] memory holders = new address[](2);
        holders[0] = bidder1;
        holders[1] = bidder2;

        uint256 paymentPerBond = _paymentPerBond();
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < MATURITY_YEARS; i++) {
            t += DURATION_SCALAR + 1;
            vm.warp(t);
            uint256 before1 = govTbd.balanceOf(bidder1);
            uint256 before2 = govTbd.balanceOf(bidder2);

            vm.prank(bondAdmin);
            bondManager.payCoupon(ISIN, holders);

            uint256 expectedPayment = remainingSupply * paymentPerBond;
            uint256 delta = (govTbd.balanceOf(bidder1) - before1) + (govTbd.balanceOf(bidder2) - before2);
            assertEq(delta, expectedPayment);
        }

        assertTrue(bondToken.isMatured(partition));

        // --- Redeem both holders ---
        vm.warp(block.timestamp + DURATION_SCALAR + 1);

        address[] memory redeemHolders = new address[](2);
        uint256[] memory redeemValues = new uint256[](2);
        redeemHolders[0] = bidder1;
        redeemHolders[1] = bidder2;
        redeemValues[0] = OFFERING - BUYBACK_SIZE;
        redeemValues[1] = ADDITIONAL_OFFERING;

        uint256 tbdBefore = govTbd.balanceOf(bidder1) + govTbd.balanceOf(bidder2);
        uint256 bondBefore =
            bondToken.balanceOfByPartition(partition, bidder1) + bondToken.balanceOfByPartition(partition, bidder2);

        vm.prank(bondAdmin);
        bondManager.redeem(ISIN, redeemHolders);

        uint256 tbdAfter = govTbd.balanceOf(bidder1) + govTbd.balanceOf(bidder2);
        uint256 bondAfter =
            bondToken.balanceOfByPartition(partition, bidder1) + bondToken.balanceOfByPartition(partition, bidder2);

        assertEq(bondBefore - bondAfter, remainingSupply);
        assertEq(tbdAfter - tbdBefore, remainingSupply * REDEMPTION_RATE);
    }
}
