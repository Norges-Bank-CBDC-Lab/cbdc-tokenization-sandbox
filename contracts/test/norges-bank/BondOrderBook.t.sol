// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondOrderBook} from "@norges-bank/BondOrderBook.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Roles} from "@common/Roles.sol";
import {Errors} from "@common/Errors.sol";

contract BondOrderBookHarness is BondOrderBook {
    constructor(address admin, address tbd, address bondToken, bytes32 partition)
        BondOrderBook(admin, tbd, bondToken, partition)
    {}

    function getBuyLevelVolume(uint256 price) external view returns (uint256) {
        return buyLevels[price].volume;
    }

    function getSellLevelVolume(uint256 price) external view returns (uint256) {
        return sellLevels[price].volume;
    }
}

contract BondOrderBookTest is Test {
    BondOrderBookHarness orderBook;
    BondToken bondToken;
    Wnok wnok;
    Tbd tbd;

    address admin = address(this);
    address buyer = address(0x1);
    address seller = address(0x2);
    address payer = address(0x3);
    address payee = address(0x4);
    address otherBroker = address(0x5);
    address otherBuyer = address(0x6);

    bytes32 constant PARTITION = keccak256("ISIN1");
    string constant ISIN = "ISIN1";
    uint256 constant ASK_PRICE = 10;
    uint256 constant BID_PRICE = 10;
    uint256 constant UNITS = 3;
    uint256 constant CASH_PER_UNIT = 1000;

    function setUp() public {
        wnok = new Wnok(admin, "Wholesale NOK", "WNOK");
        tbd = new Tbd(admin, address(0xAA), address(wnok), address(0xBB), "TBD", "TBD", address(0xCC));
        bondToken = new BondToken("Bond Token", "BOND");

        // Roles and partition
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, admin);
        bondToken.createPartition(ISIN, 1_000_000, 365 days);
        bondToken.mintByIsin(ISIN, seller, UNITS);

        // Order book
        orderBook = new BondOrderBookHarness(admin, address(tbd), address(bondToken), PARTITION);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, admin);

        // Allowlist Tbd participants
        tbd.add(admin);
        tbd.add(buyer);
        tbd.add(seller);
        tbd.add(payer);
        tbd.add(payee);
        tbd.add(address(orderBook));
        tbd.add(otherBroker);
        tbd.add(otherBuyer);

        // Authorize operator for bond transfers
        vm.prank(seller);
        bondToken.authorizeOperator(address(orderBook));

        // Fund and approve cash leg
        tbd.mint(payer, UNITS * CASH_PER_UNIT);
        vm.prank(payer);
        tbd.approve(address(orderBook), type(uint256).max);

        // Seller also can receive cash
        vm.prank(payee);
        tbd.approve(address(orderBook), type(uint256).max);
    }

    function test_constructor_adminHasDefaultAdmin() public view {
        assertTrue(orderBook.hasRole(Roles.DEFAULT_ADMIN_ROLE, admin));
    }

    function test_buy_unmatched_addsOrder() public {
        bytes32 orderId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertTrue(orderId != bytes32(0));
        BondOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyer);
        assertEq(buyOrders.length, 1);
        assertEq(buyOrders[0].amount, 1);
    }

    function test_sell_unmatched_addsOrder() public {
        bytes32 orderId = orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        assertTrue(orderId != bytes32(0));
        BondOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(seller);
        assertEq(sellOrders.length, 1);
        assertEq(sellOrders[0].amount, 1);
    }

    function test_buy_matchesSell_andRemovesBoth() public {
        // list a sell
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // buyer needs bonds to stay unchanged; buyer receives bonds
        // place buy at or above ask
        bytes32 buyId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertTrue(buyId != bytes32(0));
        assertEq(orderBook.getBuyOrders(buyer).length, 0);
        assertEq(orderBook.getSellOrders(seller).length, 0);
        assertEq(bondToken.balanceOfByPartition(PARTITION, buyer), 1);
        assertEq(tbd.balanceOf(payer), UNITS * CASH_PER_UNIT - ASK_PRICE);
        assertEq(tbd.balanceOf(payee), ASK_PRICE);
    }

    function test_sell_matchesBuy_andRemovesBoth() public {
        // fund buyer
        tbd.mint(payer, CASH_PER_UNIT);
        vm.prank(payer);
        tbd.approve(address(orderBook), type(uint256).max);

        // create buy
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        // seller sells
        bytes32 sellId = orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        assertTrue(sellId != bytes32(0));
        assertEq(orderBook.getBuyOrders(buyer).length, 0);
        assertEq(orderBook.getSellOrders(seller).length, 0);
        assertEq(bondToken.balanceOfByPartition(PARTITION, buyer), 1);
        assertEq(tbd.balanceOf(payee), ASK_PRICE);
    }

    function test_partialFill_buyLeavesRemainder() public {
        // seller lists 1 unit
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // buy 3 units: matches 1, leaves 2 in book
        orderBook.buy(address(bondToken), 3, BID_PRICE, buyer, payer);
        BondOrderBook.Order[] memory buys = orderBook.getBuyOrders(buyer);
        assertEq(buys.length, 1);
        assertEq(buys[0].amount, 2);
        assertEq(orderBook.getSellOrders(seller).length, 0);
    }

    function test_revokeBuyOrder() public {
        bytes32 orderId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertEq(orderBook.getBuyOrders(buyer).length, 1);
        orderBook.revokeBuyOrder(orderId);
        assertEq(orderBook.getBuyOrders(buyer).length, 0);
    }

    function test_revokeSellOrder() public {
        bytes32 orderId = orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        assertEq(orderBook.getSellOrders(seller).length, 1);
        orderBook.revokeSellOrder(orderId);
        assertEq(orderBook.getSellOrders(seller).length, 0);
    }

    function test_revokeBuyOrder_revertIf_idNotFound() public {
        vm.expectRevert(Errors.OrderNotFound.selector);
        // forge-lint: disable-next-line(unsafe-typecast)
        orderBook.revokeBuyOrder(bytes32("fake"));
    }

    function test_revokeSellOrder_revertIf_idNotFound() public {
        vm.expectRevert(Errors.OrderNotFound.selector);
        // forge-lint: disable-next-line(unsafe-typecast)
        orderBook.revokeSellOrder(bytes32("fake"));
    }

    function test_revokeBuyOrder_revertIf_otherBroker() public {
        bytes32 orderId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.prank(otherBroker);
        vm.expectRevert(Errors.UnauthorizedBroker.selector);
        orderBook.revokeBuyOrder(orderId);
    }

    function test_revokeSellOrder_revertIf_otherBroker() public {
        bytes32 orderId = orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.prank(otherBroker);
        vm.expectRevert(Errors.UnauthorizedBroker.selector);
        orderBook.revokeSellOrder(orderId);
    }

    function test_revoke_generic() public {
        bytes32 orderId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertEq(orderBook.getBuyOrders(buyer).length, 1);
        orderBook.revoke(orderId);
        assertEq(orderBook.getBuyOrders(buyer).length, 0);
    }

    function test_getBuyOrders_filtersByBroker() public {
        // broker admin places two orders
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        // other broker places one
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.buy(address(bondToken), 1, BID_PRICE, otherBuyer, payer);
        BondOrderBook.Order[] memory otherOrders = orderBook.getBuyOrders();
        vm.stopPrank();
        assertEq(otherOrders.length, 1);
        BondOrderBook.Order[] memory adminOrders = orderBook.getBuyOrders();
        assertEq(adminOrders.length, 2);
    }

    function test_initializeSellOrders_revertIf_nonAdmin() public {
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.prank(otherBroker);
        vm.expectRevert();
        orderBook.initializeSellOrders(1, ASK_PRICE, address(bondToken), address(tbd), seller, payee);
    }

    function test_cashLegFails_storesOrder() public {
        // break cash leg by removing payer from allowlist
        tbd.remove(payer);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        bytes32 orderId = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        BondOrderBook.Order[] memory buys = orderBook.getBuyOrders(buyer);
        assertEq(buys.length, 1);
        assertEq(buys[0].id, orderId);
        assertEq(buys[0].amount, 1);
    }

    function test_securityLegFails_storesOrder() public {
        // seller only has 3 units; sell 5 to trigger insufficient balance
        orderBook.buy(address(bondToken), 5, BID_PRICE, buyer, payer);
        bytes32 orderId = orderBook.sell(address(bondToken), 5, ASK_PRICE, seller, payee);
        BondOrderBook.Order[] memory sells = orderBook.getSellOrders(seller);
        assertEq(sells.length, 1);
        assertEq(sells[0].id, orderId);
        assertEq(sells[0].amount, 5);
    }

    function test_partialFill_sellLeavesRemainder() public {
        // give seller enough supply
        bondToken.mintByIsin(ISIN, seller, 5);
        // two buys of 2 units each
        orderBook.buy(address(bondToken), 2, BID_PRICE, buyer, payer);
        orderBook.buy(address(bondToken), 2, BID_PRICE, otherBuyer, payer);
        // seller sells 5 units -> matches 4, leaves 1 sell in book
        orderBook.sell(address(bondToken), 5, ASK_PRICE, seller, payee);
        BondOrderBook.Order[] memory sells = orderBook.getSellOrders(seller);
        assertEq(sells.length, 1);
        assertEq(sells[0].amount, 1);
        // volume check
        assertEq(orderBook.getSellLevelVolume(ASK_PRICE), 1);
        assertEq(orderBook.getBuyOrders(buyer).length + orderBook.getBuyOrders(otherBuyer).length, 0);
    }

    function test_volumeDecrementsOnRevoke() public {
        bytes32 id1 = orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertEq(orderBook.getBuyLevelVolume(BID_PRICE), 2);
        orderBook.revokeBuyOrder(id1);
        assertEq(orderBook.getBuyLevelVolume(BID_PRICE), 1);
    }

    function test_cashAmountEqualsPriceTimesUnits() public {
        uint256 units = 3;
        orderBook.sell(address(bondToken), units, ASK_PRICE, seller, payee);
        uint256 payerBefore = tbd.balanceOf(payer);
        uint256 payeeBefore = tbd.balanceOf(payee);
        orderBook.buy(address(bondToken), units, BID_PRICE, buyer, payer);
        assertEq(tbd.balanceOf(payee) - payeeBefore, ASK_PRICE * units);
        assertEq(payerBefore - tbd.balanceOf(payer), ASK_PRICE * units);
    }

    function test_initializeSellOrders() public {
        uint256 numOrders = 5;
        orderBook.initializeSellOrders(numOrders, ASK_PRICE, address(bondToken), address(tbd), seller, payee);
        BondOrderBook.Order[] memory sells = orderBook.getAllSellOrders();
        assertEq(sells.length, numOrders);
    }

    function test_getAllBuyOrders_returnsAll() public {
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.buy(address(bondToken), 1, BID_PRICE, otherBuyer, payer);
        BondOrderBook.Order[] memory allBuys = orderBook.getAllBuyOrders();
        assertEq(allBuys.length, 2);
    }

    function test_getAllSellOrders_returnsAll() public {
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, otherBuyer, payee);
        BondOrderBook.Order[] memory allSells = orderBook.getAllSellOrders();
        assertEq(allSells.length, 2);
    }

    function test_sellVolumeDecrementsOnRevoke() public {
        bytes32 id1 = orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        assertEq(orderBook.getSellLevelVolume(ASK_PRICE), 2);
        orderBook.revokeSellOrder(id1);
        assertEq(orderBook.getSellLevelVolume(ASK_PRICE), 1);
    }

    function test_revertIf_SecurityMismatch() public {
        vm.expectRevert(Errors.SecurityMismatch.selector);
        orderBook.buy(address(0xdead), 1, BID_PRICE, buyer, payer);
        vm.expectRevert(Errors.SecurityMismatch.selector);
        orderBook.sell(address(0xdead), 1, ASK_PRICE, seller, payee);
    }

    function test_revertIf_InvalidAmountOrPrice() public {
        vm.expectRevert(Errors.InvalidAmount.selector);
        orderBook.buy(address(bondToken), 0, BID_PRICE, buyer, payer);
        vm.expectRevert(Errors.InvalidPrice.selector);
        orderBook.buy(address(bondToken), 1, 0, buyer, payer);
        vm.expectRevert(Errors.InvalidAmount.selector);
        orderBook.sell(address(bondToken), 0, ASK_PRICE, seller, payee);
        vm.expectRevert(Errors.InvalidPrice.selector);
        orderBook.sell(address(bondToken), 1, 0, seller, payee);
    }

    function test_revertIf_ZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidRecipient.selector));
        orderBook.buy(address(bondToken), 1, BID_PRICE, address(0), payer);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidHolder.selector, address(0)));
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, address(0));
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidHolder.selector, address(0)));
        orderBook.sell(address(bondToken), 1, ASK_PRICE, address(0), payee);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidRecipient.selector));
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, address(0));
    }

    function test_cashOnly_zeroUnits_noBondMovement() public {
        vm.expectRevert(Errors.InvalidAmount.selector);
        orderBook.sell(address(bondToken), 0, ASK_PRICE, seller, payee);
        vm.expectRevert(Errors.InvalidAmount.selector);
        orderBook.buy(address(bondToken), 0, BID_PRICE, buyer, payer);
    }

    function test_buy_failureBuyerDropsAndStops() public {
        // seller lists
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // break buyer cash path
        tbd.remove(payer);
        // call should store failed buy and leave sell
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertEq(orderBook.getBuyOrders(buyer).length, 1); // stored due to failure
        assertEq(orderBook.getSellOrders(seller).length, 1); // sell remains
    }

    function test_sell_failureSellerStopsKeepsSell() public {
        // revoke operator to make security leg fail
        vm.prank(seller);
        bondToken.revokeOperator(address(orderBook));
        // create buy to match
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // sell should remain since seller failure stops
        assertEq(orderBook.getSellOrders(seller).length, 1);
    }

    function test_buy_failureSellerDropsMaker() public {
        // two sells at same price
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // break seller by zero bonds
        vm.prank(seller);
        bondToken.revokeOperator(address(orderBook));
        // buyer attempt should drop seller maker on failure
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        assertEq(orderBook.getSellOrders(seller).length, 0);
    }

    function test_sell_failureBuyerDropsMaker() public {
        // two buys
        orderBook.buy(address(bondToken), 1, BID_PRICE, buyer, payer);
        orderBook.buy(address(bondToken), 1, BID_PRICE, otherBuyer, payer);
        // break payer allowlist (affects both)
        tbd.remove(payer);
        orderBook.sell(address(bondToken), 1, ASK_PRICE, seller, payee);
        // both buys dropped
        assertEq(orderBook.getBuyOrders(buyer).length + orderBook.getBuyOrders(otherBuyer).length, 0);
    }
}
