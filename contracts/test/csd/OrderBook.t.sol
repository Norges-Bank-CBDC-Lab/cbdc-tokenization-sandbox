// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {StockToken} from "@csd/StockToken.sol";
import {DvP} from "@csd/DvP.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";
import {SettlementInfo} from "@common/SettlementInfo.sol";
import {IOrderBook} from "@interfaces/IOrderBook.sol";

contract OrderBookHarness is OrderBook {
    constructor(address admin, address wnok, address dvp, address sec) OrderBook(admin, wnok, dvp, sec) {}

    function getBuyLevelVolume(uint256 price) external view returns (uint256) {
        return buyLevels[price].volume;
    }

    function getSellLevelVolume(uint256 price) external view returns (uint256) {
        return sellLevels[price].volume;
    }
}

contract OrderBookTest is Test {
    OrderBookHarness orderBook;
    Wnok wnok;
    Tbd buyerBankTbdContract;
    Tbd sellerBankTbdContract;
    StockToken secContract;
    DvP dvpContract;

    address admin = address(this);
    address secContrAddr = address(0x1);
    address sellerSecAddr = address(0x2);
    address buyerSecAddr = address(0x3);
    address sellerTbdAddr = address(0x4);
    address buyerTbdAddr = address(0x5);
    address sellerBankAddr = address(0x6);
    address buyerBankAddr = address(0x7);
    address wnokContrAddr = address(0x8);
    address sellerBankTbdContrAddr = address(0x9);
    address buyerBankTbdContrAddr = address(0xa);
    address dvpContrAddr = address(0xb);
    address otherBroker = address(0xc);
    address otherSecAddr = address(0xd);

    string wnokName = "Wholesale NOK";
    string sellerBankTbdName = "OSLOTBD";
    string buyerBankTbdName = "STAVANGERTBD";
    string secName = "EquiNor";

    uint256 secAmount = 1;
    uint256 askPrice = 10;
    uint256 bidPrice = 20;

    /**
     * Create an Order Book contract with this test as the owner.
     */
    function setUp() public {
        wnok = Wnok(wnokContrAddr);

        orderBook = new OrderBookHarness(admin, wnokContrAddr, dvpContrAddr, secContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, admin);

        buyerBankTbdContract = Tbd(buyerBankTbdContrAddr);
        sellerBankTbdContract = Tbd(sellerBankTbdContrAddr);

        secContract = StockToken(secContrAddr);

        dvpContract = DvP(dvpContrAddr);

        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.hasRole.selector), abi.encode(true));
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.allowlistQuery.selector), abi.encode(true));
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.name.selector), abi.encode(wnokName));
        vm.mockCall(secContrAddr, abi.encodeWithSelector(secContract.allowlistQuery.selector), abi.encode(true));
        vm.mockCall(secContrAddr, abi.encodeWithSelector(secContract.name.selector), abi.encode(secName));
        vm.mockCall(secContrAddr, abi.encodeWithSelector(secContract.allowance.selector), abi.encode(secAmount));
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        vm.mockCall(
            buyerBankTbdContrAddr, abi.encodeWithSelector(buyerBankTbdContract.allowance.selector), abi.encode(bidPrice)
        );

        vm.mockCall(
            buyerBankTbdContrAddr,
            abi.encodeWithSelector(buyerBankTbdContract.allowlistQuery.selector),
            abi.encode(true)
        );
        vm.mockCall(
            buyerBankTbdContrAddr,
            abi.encodeWithSelector(buyerBankTbdContract.name.selector),
            abi.encode(buyerBankTbdName)
        );
        vm.mockCall(
            buyerBankTbdContrAddr,
            abi.encodeWithSelector(buyerBankTbdContract.getBankAddress.selector),
            abi.encode(buyerBankAddr)
        );

        vm.mockCall(
            sellerBankTbdContrAddr,
            abi.encodeWithSelector(sellerBankTbdContract.allowlistQuery.selector),
            abi.encode(true)
        );
        vm.mockCall(
            sellerBankTbdContrAddr,
            abi.encodeWithSelector(sellerBankTbdContract.name.selector),
            abi.encode(sellerBankTbdName)
        );
        vm.mockCall(
            sellerBankTbdContrAddr,
            abi.encodeWithSelector(sellerBankTbdContract.getBankAddress.selector),
            abi.encode(sellerBankAddr)
        );
    }

    /**
     * Common buy() call executed by other tests.
     */
    function _buy() public returns (SettlementInfo memory) {
        return orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
    }

    /**
     * Common sell() call executed by other tests.
     */
    function _sell() public returns (SettlementInfo memory) {
        return orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
    }

    /**
     * The admin has DEFAULT_ADMIN_ROLE
     */
    function test_constructor_adminHas_DEFAULT_ADMIN_ROLE() public view {
        vm.assertTrue(orderBook.hasRole(Roles.DEFAULT_ADMIN_ROLE, admin));
    }

    /**
     * The buyer bank's TBD contract must have TRANSFER_FROM_ROLE on Wnok.
     */
    function test_buy_revertIf_buyerBankTbdContractDoesNotHaveWnokTransferFromRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(Errors.MissingRole.selector, Roles.TRANSFER_FROM_ROLE, buyerBankTbdContrAddr)
        );
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.hasRole.selector), abi.encode(false));
        _buy();
    }

    /**
     * The seller bank's TBD contract must have TRANSFER_FROM_ROLE on Wnok.
     */
    function test_sell_revertIf_sellerBankTbdContractDoesNotHaveWnokTransferFromRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(Errors.MissingRole.selector, Roles.TRANSFER_FROM_ROLE, sellerBankTbdContrAddr)
        );
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.hasRole.selector), abi.encode(false));
        _sell();
    }

    /**
     * The buyer must be in its bank TBD contract's allowlist.
     */
    function test_buy_revertIf_buyerIsNotInTbdContractAllowlist() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInAllowlist.selector, "BuyerBankTbdAllowlist", buyerTbdAddr));
        vm.mockCall(
            buyerBankTbdContrAddr,
            abi.encodeWithSelector(buyerBankTbdContract.allowlistQuery.selector),
            abi.encode(false)
        );
        _buy();
    }

    /**
     * The seller must be in its bank TBD contract's allowlist.
     */
    function test_sell_revertIf_sellerIsNotInTbdContractAllowlist() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInAllowlist.selector, "SellerBankTbdAllowlist", sellerTbdAddr));
        vm.mockCall(
            sellerBankTbdContrAddr,
            abi.encodeWithSelector(sellerBankTbdContract.allowlistQuery.selector),
            abi.encode(false)
        );
        _sell();
    }

    /**
     * The buyer's bank must be in the wnok contract's allowlist.
     */
    function test_buy_revertIf_buyerBankIsNotInWnokContractAllowlist() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInAllowlist.selector, "BuyerWnokAllowlist", buyerBankAddr));
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.allowlistQuery.selector), abi.encode(false));
        _buy();
    }

    /**
     * The seller's bank must be in the wnok contract's allowlist.
     */
    function test_sell_revertIf_sellerBankIsNotInWnokContractAllowlist() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInAllowlist.selector, "SellerWnokAllowlist", sellerBankAddr));
        vm.mockCall(wnokContrAddr, abi.encodeWithSelector(wnok.allowlistQuery.selector), abi.encode(false));
        _sell();
    }

    /**
     * The buyer must be in the security contract's allowlist.
     */
    function test_buy_revertIf_buyerIsNotInSecurityContractAllowlist() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotInAllowlist.selector, "BuyerSecurityAllowlist", buyerSecAddr));
        vm.mockCall(secContrAddr, abi.encodeWithSelector(secContract.allowlistQuery.selector), abi.encode(false));
        orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
    }

    /**
     * The seller must be in the security contract's allowlist.
     */
    function test_sell_revertIf_sellerIsNotInSecurityContractAllowlist() public {
        vm.expectRevert(
            abi.encodeWithSelector(Errors.NotInAllowlist.selector, "SellerSecurityAllowlist", sellerSecAddr)
        );
        vm.mockCall(secContrAddr, abi.encodeWithSelector(secContract.allowlistQuery.selector), abi.encode(false));
        orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
    }

    /**
     * A successful buy order emits OrderSubmittedEvent.
     */
    function test_buy_newOrder_emitsAndReturns() public {
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);
        SettlementInfo memory settlementInfo = _buy();
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A successful sell order emits OrderSubmittedEvent.
     */
    function test_sell_newOrder_emitsAndReturns() public {
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);
        SettlementInfo memory settlementInfo = _sell();
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A successful unmatched buy order is added to the order book.
     */
    function test_buy_unmatchedOrder_added() public {
        SettlementInfo memory settlementInfo = _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
        assertEq(buyOrders[0].id, settlementInfo.orderId);
        assertEq(buyOrders[0].investorSecAddr, buyerSecAddr);
        assertEq(buyOrders[0].amount, secAmount);
        assertEq(buyOrders[0].price, bidPrice);
    }

    /**
     * A successful unmatched sell order is added to the order book.
     */
    function test_sell_unmatchedOrder_added() public {
        SettlementInfo memory settlementInfo = _sell();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
        assertEq(sellOrders[0].id, settlementInfo.orderId);
        assertEq(sellOrders[0].investorSecAddr, sellerSecAddr);
        assertEq(sellOrders[0].amount, secAmount);
        assertEq(sellOrders[0].price, askPrice);

        // Verify volume is correctly initialized: order amount matches volume
        // (since it's the only order at this price level)
        uint256 totalVolume = 0;
        for (uint256 i = 0; i < sellOrders.length; i++) {
            if (sellOrders[i].price == askPrice) {
                totalVolume += sellOrders[i].amount;
            }
        }
        assertEq(totalVolume, secAmount); // Volume should equal the order amount
    }

    /**
     * A dropped buy Order emits OrderSubmittedEvent and returns the expected
     * SettlementInfo.
     */
    function test_buy_matchedOrder_newFails() public {
        _sell();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Buyer, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(sellOrders[0].id);
        SettlementInfo memory settlementInfo = _buy();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 1);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 0);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, false);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A dropped sell Order emits OrderSubmittedEvent and returns the expected
     * SettlementInfo.
     */
    function test_sell_matchedOrder_newFails() public {
        _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Seller, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(buyOrders[0].id);
        SettlementInfo memory settlementInfo = _sell();
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 1);
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 0);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, false);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A buy Order which is matched but fails settlement due to the seller
     * emits OrderSubmittedEvent, returns the expected SettlementInfo, and is
     * added to the order book while the existing order is removed.
     */
    function test_buy_matchedOrder_existingFails() public {
        _sell();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Seller, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(sellOrders[0].id);
        vm.expectEmit();
        emit IOrderBook.OrderRevokedEvent(sellOrders[0].id);
        SettlementInfo memory settlementInfo = _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 0);
        assertEq(buyOrders.length, 1);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
        assertEq(buyOrders[0].id, settlementInfo.orderId);
        assertEq(buyOrders[0].investorSecAddr, buyerSecAddr);
        assertEq(buyOrders[0].amount, secAmount);
        assertEq(buyOrders[0].price, bidPrice);
    }

    /**
     * A sell Order which is matched but fails settlement due to the buyer
     * emits OrderSubmittedEvent, returns the expected SettlementInfo, and is
     * added to the order book while the existing order is removed.
     */
    function test_sell_matchedOrder_existingFails() public {
        _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Buyer, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(buyOrders[0].id);
        vm.expectEmit();
        emit IOrderBook.OrderRevokedEvent(buyOrders[0].id);
        SettlementInfo memory settlementInfo = _sell();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 0);
        assertEq(sellOrders.length, 1);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
        assertEq(sellOrders[0].id, settlementInfo.orderId);
        assertEq(sellOrders[0].investorSecAddr, sellerSecAddr);
        assertEq(sellOrders[0].amount, secAmount);
        assertEq(sellOrders[0].price, askPrice);
    }

    /**
     * A buy Order which is matched but fails settlement for unknown reasons
     * emits OrderSubmittedEvent, returns the expected SettlementInfo, and is
     * added to the order book.
     */
    function test_buy_matchedOrder_unknownFail() public {
        _sell();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);
        SettlementInfo memory settlementInfo = _buy();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 1);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 1);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A sell Order which is matched but fails settlement for unknown reasons
     * emits OrderSubmittedEvent, returns the expected SettlementInfo, and is
     * added to the order book.
     */
    function test_sell_matchedOrder_unknownFail() public {
        _buy();
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 1);
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(dvpContract.settle.selector),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "")
        );
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);
        SettlementInfo memory settlementInfo = _sell();
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 1);
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 1);
        assertEq(settlementInfo.settled, false);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, 0);
    }

    /**
     * A buy order which is matched and successfully settles
     * emits and returns the expected SettlementInfo.
     */
    function test_buy_matchedOrder_settleSuccess() public {
        _sell();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(sellOrders[0].id);
        SettlementInfo memory settlementInfo = _buy();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 0);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 0);
        assertEq(settlementInfo.settled, true);
        assertEq(settlementInfo.validOrder, true);
        assertEq(settlementInfo.settlementAmount, secAmount);
    }

    /**
     * A sell order which is matched and successfully settles
     * emits and returns the expected SettlementInfo.
     */
    function test_sell_matchedOrder_settleSuccess() public {
        _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));
        vm.expectEmit();
        emit IOrderBook.OrderSubmittedEvent(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);
        vm.expectEmit();
        emit IOrderBook.OrderMatchedEvent(buyOrders[0].id);
        SettlementInfo memory settlementInfo = _sell();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 0);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 0);
        assertEq(settlementInfo.settled, true);
        assertEq(settlementInfo.validOrder, true);
    }

    /**
     * Buy orders are added sequentially to the CLOB. When settlement fails,
     * orders are handled based on failure reason (buyer/seller/unknown).
     */
    function test_buy_multiOrder() public {
        SettlementInfo memory order0 =
            orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        SettlementInfo memory order1 =
            orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        SettlementInfo memory order2 =
            orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        // The orders are added in sequential order
        IOrderBook.Order[] memory buyOrders = orderBook.getAllBuyOrders();
        assertEq(buyOrders.length, 3);
        assertEq(buyOrders[0].id, order0.orderId);
        assertEq(buyOrders[1].id, order1.orderId);
        assertEq(buyOrders[2].id, order2.orderId);
        // Make order0 (buyerSecAddr) fail due to buyer
        // When sell order matches buy orders, maker is buy order, so settlement price is bidPrice
        uint256 expectedPaymentBuyer = bidPrice * secAmount; // bidPrice * 1 = bidPrice
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContract,
                sellerSecAddr,
                buyerSecAddr,
                secAmount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPaymentBuyer, // wholesaleValue = bidPrice * secAmount
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            ),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Buyer, "")
        );
        // Make other orders fail due to unknown reason
        uint256 expectedPaymentOther = bidPrice * secAmount; // bidPrice * 1 = bidPrice
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContract,
                sellerSecAddr,
                otherSecAddr,
                secAmount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPaymentOther, // wholesaleValue = bidPrice * secAmount
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            ),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "")
        );
        // After a matching attempt, the first order is removed (buyer failure)
        _sell();
        buyOrders = orderBook.getAllBuyOrders();
        assertEq(buyOrders.length, 2);
        assertEq(buyOrders[0].id, order1.orderId);
        assertEq(buyOrders[1].id, order2.orderId);
    }

    /**
     * Sell orders are added sequentially to the CLOB. When settlement fails,
     * orders are handled based on failure reason (buyer/seller/unknown).
     */
    function test_sell_multiOrder() public {
        SettlementInfo memory order0 =
            orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        SettlementInfo memory order1 =
            orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        SettlementInfo memory order2 =
            orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        // The orders are added in sequential order
        IOrderBook.Order[] memory orders = orderBook.getAllSellOrders();
        assertEq(orders.length, 3);
        assertEq(orders[0].id, order0.orderId);
        assertEq(orders[1].id, order1.orderId);
        assertEq(orders[2].id, order2.orderId);
        // Make order0 (sellerSecAddr) fail due to seller
        // When buy order matches sell orders, maker is sell order, so settlement price is askPrice
        uint256 expectedPaymentSeller = askPrice * secAmount; // askPrice * 1 = askPrice
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContract,
                sellerSecAddr,
                buyerSecAddr,
                secAmount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPaymentSeller, // wholesaleValue = askPrice * secAmount
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            ),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Seller, "")
        );
        // Make other orders fail due to unknown reason
        uint256 expectedPaymentOther = askPrice * secAmount; // askPrice * 1 = askPrice
        vm.mockCallRevert(
            dvpContrAddr,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContract,
                otherSecAddr,
                buyerSecAddr,
                secAmount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPaymentOther, // wholesaleValue = askPrice * secAmount
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            ),
            abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "")
        );
        // After a matching attempt, the first order is removed (seller failure)
        _buy();
        orders = orderBook.getAllSellOrders();
        assertEq(orders.length, 2);
        assertEq(orders[0].id, order1.orderId);
        assertEq(orders[1].id, order2.orderId);
    }

    /**
     * getBuyOrders() only returns orders where the broker is the caller
     */
    function test_getBuyOrders() public {
        orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        IOrderBook.Order[] memory otherBuyOrders = orderBook.getBuyOrders();
        assertEq(otherBuyOrders.length, 1);
        vm.stopPrank();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders();
        assertEq(buyOrders.length, 2);
    }

    /**
     * getSellOrders() only returns orders where the broker is the caller
     */
    function test_getSellOrders() public {
        orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        IOrderBook.Order[] memory otherSellOrders = orderBook.getSellOrders();
        assertEq(otherSellOrders.length, 1);
        vm.stopPrank();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders();
        assertEq(sellOrders.length, 2);
    }

    /**
     * getBuyOrders(address) only returns orders where the broker is the caller
     * and the address matches
     */
    function test_getBuyOrders_address() public {
        orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 0);
        assertEq(orderBook.getBuyOrders(otherSecAddr).length, 2);
        vm.stopPrank();
        assertEq(orderBook.getBuyOrders(buyerSecAddr).length, 1);
        assertEq(orderBook.getBuyOrders(otherSecAddr).length, 1);
    }

    /**
     * getSellOrders(address) only returns orders where the broker is the caller
     * and the address matches
     */
    function test_getSellOrders_address() public {
        orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 0);
        assertEq(orderBook.getSellOrders(otherSecAddr).length, 2);
        vm.stopPrank();
        assertEq(orderBook.getSellOrders(sellerSecAddr).length, 1);
        assertEq(orderBook.getSellOrders(otherSecAddr).length, 1);
    }

    /**
     * getAllBuyOrders() returns all orders
     */
    function test_getAllBuyOrders() public {
        orderBook.buy(secContrAddr, secAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, secAmount, bidPrice, otherSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        assertEq(orderBook.getAllBuyOrders().length, 4);
        vm.stopPrank();
        assertEq(orderBook.getAllBuyOrders().length, 4);
    }

    /**
     * getAllSellOrders() returns all orders
     */
    function test_getAllSellOrders() public {
        orderBook.sell(secContrAddr, secAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, otherBroker);
        vm.startPrank(otherBroker);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, secAmount, askPrice, otherSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        assertEq(orderBook.getAllSellOrders().length, 4);
        vm.stopPrank();
        assertEq(orderBook.getAllSellOrders().length, 4);
    }

    /**
     * A revoked buy order disappears from the order book.
     */
    function test_revokeBuyOrder() public {
        SettlementInfo memory order1 = _buy(); // amount 1
        _buy(); // amount 1

        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 2);

        // Confirm volume is 2
        assertEq(orderBook.getBuyLevelVolume(bidPrice), 2 * secAmount, "Volume mismatch before revoke");

        orderBook.revokeBuyOrder(order1.orderId);

        buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);

        // Confirm volume is decreased to 1
        // If bug exists (no decrement), it will remain 2
        assertEq(orderBook.getBuyLevelVolume(bidPrice), secAmount, "Volume mismatch after revoke");
    }

    /**
     * A revoked sell order disappears from the order book.
     */
    function test_revokeSellOrder() public {
        SettlementInfo memory order1 = _sell(); // amount 1
        _sell(); // amount 1

        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 2);

        // Confirm volume is 2
        assertEq(orderBook.getSellLevelVolume(askPrice), 2 * secAmount, "Volume mismatch before revoke");

        orderBook.revokeSellOrder(order1.orderId);

        sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);

        // Confirm volume is decreased to 1
        assertEq(orderBook.getSellLevelVolume(askPrice), secAmount, "Volume mismatch after revoke");
    }

    /**
     * A revoked buy order emits OrderRevokedEvent.
     */
    function test_revokeBuyOrder_emitsEvent() public {
        SettlementInfo memory settlementInfo = _buy();
        vm.expectEmit();
        emit IOrderBook.OrderRevokedEvent(settlementInfo.orderId);
        orderBook.revokeBuyOrder(settlementInfo.orderId);
    }

    /**
     * A revoked sell order emits OrderRevokedEvent.
     */
    function test_revokeSellOrder_emitsEvent() public {
        SettlementInfo memory settlementInfo = _sell();
        vm.expectEmit();
        emit IOrderBook.OrderRevokedEvent(settlementInfo.orderId);
        orderBook.revokeSellOrder(settlementInfo.orderId);
    }

    /**
     * Buy order revocation fails if revoked by another broker.
     */
    function test_revokeBuyOrder_revertIf_otherBroker() public {
        SettlementInfo memory settlementInfo = _buy();
        vm.startPrank(otherBroker);
        vm.expectRevert(Errors.UnauthorizedBroker.selector);
        orderBook.revokeBuyOrder(settlementInfo.orderId);
    }

    /**
     * Sell order revocation fails if revoked by another broker.
     */
    function test_revokeSellOrder_revertIf_otherBroker() public {
        SettlementInfo memory settlementInfo = _sell();
        vm.startPrank(otherBroker);
        vm.expectRevert(Errors.UnauthorizedBroker.selector);
        orderBook.revokeSellOrder(settlementInfo.orderId);
    }

    /**
     * Buy order revocation reverts if order id not found
     */
    function test_revokeBuyOrder_revertIf_idNotFound() public {
        bytes32 fakeBuyOrderId = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        _buy();
        vm.expectRevert(Errors.OrderNotFound.selector);
        orderBook.revokeBuyOrder(fakeBuyOrderId);
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
    }

    /**
     * Sell order revocation reverts if order id not found
     */
    function test_revokeSellOrder_revertIf_idNotFound() public {
        bytes32 fakeSellOrderId = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        _sell();
        vm.expectRevert(Errors.OrderNotFound.selector);
        orderBook.revokeSellOrder(fakeSellOrderId);
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
    }

    /**
     * A revoked buy order is removed from the CLOB, maintaining order priority.
     */
    function test_revokeBuyOrder_multiOrder() public {
        SettlementInfo memory order0 = _buy();
        SettlementInfo memory order1 = _buy();
        SettlementInfo memory order2 = _buy();
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 3);
        orderBook.revokeBuyOrder(order0.orderId);
        buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 2);
        assertEq(buyOrders[0].id, order1.orderId);
        assertEq(buyOrders[1].id, order2.orderId);
    }

    /**
     * A revoked sell order is removed from the CLOB, maintaining order priority.
     */
    function test_revokeSellOrder_multiOrder() public {
        SettlementInfo memory order0 = _sell();
        SettlementInfo memory order1 = _sell();
        SettlementInfo memory order2 = _sell();
        IOrderBook.Order[] memory orders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(orders.length, 3);
        orderBook.revokeSellOrder(order0.orderId);
        orders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(orders.length, 2);
        assertEq(orders[0].id, order1.orderId);
        assertEq(orders[1].id, order2.orderId);
    }

    /**
     * initializeSellOrders works
     */
    function test_initializeSellOrders() public {
        uint256 numOrders = 2000;
        orderBook.initializeSellOrders(
            numOrders, 1000, secContrAddr, sellerBankTbdContrAddr, sellerSecAddr, sellerTbdAddr
        );
        IOrderBook.Order[] memory orders = orderBook.getAllSellOrders();
        assertEq(orders.length, numOrders);
    }

    /**
     * initializeSellOrders fails if the initial supply is too high
     * The actual limit depends on the EVM runtime and may be higher in practice
     * - the value here is calibrated to fail in foundry/sputnik.
     */
    function test_initializeSellOrders_revertIf_tooManyOrders() public {
        uint256 numOrders = 7000;
        vm.expectRevert(bytes(""));
        orderBook.initializeSellOrders(
            numOrders, 1000, secContrAddr, sellerBankTbdContrAddr, sellerSecAddr, sellerTbdAddr
        );
    }

    /**
     * initializeSellOrders requires OrderBook admin
     */
    function test_initializeSellOrders_revertIf_nonAdmin() public {
        uint256 numOrders = 6000;
        vm.prank(otherBroker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, otherBroker, Roles.ORDER_ADMIN_ROLE
            )
        );
        orderBook.initializeSellOrders(
            numOrders, 1000, secContrAddr, sellerBankTbdContrAddr, sellerSecAddr, sellerTbdAddr
        );
    }

    /**
     * Supported interfaces are correct
     */
    function test_supportedInterfaces() public view {
        // ERC-165
        assertEq(orderBook.supportsInterface(0x01ffc9a7), true);
        // IOrderBook interface
        assertEq(orderBook.supportsInterface(type(IOrderBook).interfaceId), true);
        // Unsupported interface
        assertEq(orderBook.supportsInterface(0xffffffff), false);
    }

    /**
     * A large buy order partially fills multiple small sell orders
     */
    function test_buy_partialFill_multipleSmallSellOrders() public {
        // Create 3 sell orders of 2 units each at askPrice
        orderBook.sell(secContrAddr, 2, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, 2, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, 2, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Verify 3 sell orders exist
        IOrderBook.Order[] memory sellOrders = orderBook.getAllSellOrders();
        assertEq(sellOrders.length, 3);
        assertEq(sellOrders[0].amount, 2);
        assertEq(sellOrders[1].amount, 2);
        assertEq(sellOrders[2].amount, 2);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Submit a buy order for 5 units
        // Should match: 1st order (2 units), 2nd order (2 units), 3rd order (1 unit)
        // Leaving 3rd order with 1 unit remaining
        // Verify total payment amounts for each match:
        // - 1st match: 2 units at askPrice = askPrice * 2
        // - 2nd match: 2 units at askPrice = askPrice * 2
        // - 3rd match: 1 unit at askPrice = askPrice * 1
        uint256 match1Amount = 2;
        uint256 match2Amount = 2;
        uint256 match3Amount = 1;
        uint256 expectedPayment1 = askPrice * match1Amount; // 10 * 2 = 20
        uint256 expectedPayment2 = askPrice * match2Amount; // 10 * 2 = 20
        uint256 expectedPayment3 = askPrice * match3Amount; // 10 * 1 = 10

        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match1Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment1,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match2Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment2,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match3Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment3,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );

        SettlementInfo memory settlementInfo =
            orderBook.buy(secContrAddr, 5, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);

        // Verify settlement was successful (all 5 units matched)
        assertEq(settlementInfo.settled, true);
        assertEq(settlementInfo.validOrder, true);
        // settlementAmount is now the total quantity traded (2 + 2 + 1 = 5 units)
        assertEq(settlementInfo.settlementAmount, 5);

        // Verify: 1st and 2nd orders fully consumed, 3rd order has 1 unit left
        sellOrders = orderBook.getAllSellOrders();
        assertEq(sellOrders.length, 1);
        assertEq(sellOrders[0].amount, 1);

        // Verify volume is correctly maintained:
        // Initial: 3 orders of 2 units each = 6 total volume at askPrice
        // Traded: 2 + 2 + 1 = 5 units
        // Remaining: 1 unit (which matches the remaining order amount)
        // We verify this indirectly by checking the sum of remaining order amounts
        uint256 totalRemainingVolume = 0;
        for (uint256 i = 0; i < sellOrders.length; i++) {
            if (sellOrders[i].price == askPrice) {
                totalRemainingVolume += sellOrders[i].amount;
            }
        }
        assertEq(totalRemainingVolume, 1); // Only 1 unit remaining at askPrice
    }

    /**
     * A large sell order partially fills multiple small buy orders
     */
    function test_sell_partialFill_multipleSmallBuyOrders() public {
        // Create 3 buy orders of 2 units each at bidPrice
        orderBook.buy(secContrAddr, 2, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, 2, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
        orderBook.buy(secContrAddr, 2, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);

        // Verify 3 buy orders exist
        IOrderBook.Order[] memory buyOrders = orderBook.getAllBuyOrders();
        assertEq(buyOrders.length, 3);
        assertEq(buyOrders[0].amount, 2);
        assertEq(buyOrders[1].amount, 2);
        assertEq(buyOrders[2].amount, 2);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Submit a sell order for 5 units - should match all of first order (2) and part of second (3)
        // Verify total payment amounts for each match:
        // - 1st match: 2 units at bidPrice = bidPrice * 2
        // - 2nd match: 2 units at bidPrice = bidPrice * 2
        // - 3rd match: 1 unit at bidPrice = bidPrice * 1
        uint256 match1Amount = 2;
        uint256 match2Amount = 2;
        uint256 match3Amount = 1;
        uint256 expectedPayment1 = bidPrice * match1Amount; // 20 * 2 = 40
        uint256 expectedPayment2 = bidPrice * match2Amount; // 20 * 2 = 40
        uint256 expectedPayment3 = bidPrice * match3Amount; // 20 * 1 = 20

        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match1Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment1,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match2Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment2,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                match3Amount,
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment3,
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );

        SettlementInfo memory settlementInfo =
            orderBook.sell(secContrAddr, 5, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Verify settlement was successful
        assertEq(settlementInfo.settled, true);
        assertEq(settlementInfo.validOrder, true);
        // settlementAmount is now the total quantity traded (2 + 2 + 1 = 5 units)
        assertEq(settlementInfo.settlementAmount, 5);

        // Verify orders are consumed correctly
        // 5 units sell against 3 orders of 2 each
        // Match 1st: 2 units (fully consumed, removed)
        // Match 2nd: 2 units (fully consumed, removed)
        // Match 3rd: 1 unit (partially consumed, 1 remains)
        buyOrders = orderBook.getAllBuyOrders();
        assertEq(buyOrders.length, 1);
        assertEq(buyOrders[0].amount, 1);

        // Verify volume is correctly maintained:
        // Initial: 3 orders of 2 units each = 6 total volume at bidPrice
        // Traded: 2 + 2 + 1 = 5 units
        // Remaining: 1 unit (which matches the remaining order amount)
        // We verify this indirectly by checking the sum of remaining order amounts
        uint256 totalRemainingVolume = 0;
        for (uint256 i = 0; i < buyOrders.length; i++) {
            if (buyOrders[i].price == bidPrice) {
                totalRemainingVolume += buyOrders[i].amount;
            }
        }
        assertEq(totalRemainingVolume, 1); // Only 1 unit remaining at bidPrice
    }

    /**
     * A buy order is partially filled, leaving only the remainder in the order book
     */
    function test_buy_partialFill_remainderInBook() public {
        // Create 1 sell order of 3 units
        orderBook.sell(secContrAddr, 3, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Submit a buy order for 5 units - should match 3, leaving 2 unmatched
        SettlementInfo memory buyInfo =
            orderBook.buy(secContrAddr, 5, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);

        // Verify partial settlement (only 3 out of 5 units matched)
        assertEq(buyInfo.settled, false); // Not fully settled
        assertEq(buyInfo.validOrder, true);
        // settlementAmount is now the quantity traded (3 units matched)
        assertEq(buyInfo.settlementAmount, 3);

        // Verify sell order is fully consumed
        IOrderBook.Order[] memory sellOrders = orderBook.getAllSellOrders();
        assertEq(sellOrders.length, 0);

        // Verify buy order with only the REMAINING 2 units is in the book
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders(buyerSecAddr);
        assertEq(buyOrders.length, 1);
        assertEq(buyOrders[0].amount, 2); // Only the remaining 2 units
        assertEq(buyOrders[0].price, bidPrice);
        assertEq(buyOrders[0].investorSecAddr, buyerSecAddr);

        // Verify volume is correctly maintained: sell order was fully consumed (3 units)
        // Volume at askPrice should be 0 (order removed)
        // We verify this indirectly: no sell orders remain at askPrice
        assertEq(sellOrders.length, 0);
    }

    /**
     * A sell order is partially filled, leaving only the remainder in the order book
     */
    function test_sell_partialFill_remainderInBook() public {
        // Create 1 buy order of 3 units
        orderBook.buy(secContrAddr, 3, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Submit a sell order for 5 units - should match 3, leaving 2 unmatched
        SettlementInfo memory sellInfo =
            orderBook.sell(secContrAddr, 5, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Verify partial settlement (only 3 out of 5 units matched)
        assertEq(sellInfo.settled, false); // Not fully settled
        assertEq(sellInfo.validOrder, true);
        // settlementAmount is now the quantity traded (3 units matched)
        assertEq(sellInfo.settlementAmount, 3);

        // Verify buy order is fully consumed
        IOrderBook.Order[] memory buyOrders = orderBook.getAllBuyOrders();
        assertEq(buyOrders.length, 0);

        // Verify sell order with only the REMAINING 2 units is in the book
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders(sellerSecAddr);
        assertEq(sellOrders.length, 1);
        assertEq(sellOrders[0].amount, 2); // Only the remaining 2 units
        assertEq(sellOrders[0].price, askPrice);
        assertEq(sellOrders[0].investorSecAddr, sellerSecAddr);
    }

    /**
     * Verifies that the total payment amount (price * amount) is correctly calculated
     * and passed to DvP.settle() for multi-unit trades.
     */
    function test_buy_verifiesTotalPaymentAmount() public {
        // Create a sell order for 3 units at askPrice = 10
        uint256 sellAmount = 3;
        orderBook.sell(secContrAddr, sellAmount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Verify DvP.settle() is called with correct wholesaleValue = askPrice * sellAmount = 10 * 3 = 30
        uint256 expectedTotalPayment = askPrice * sellAmount; // 10 * 3 = 30
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                sellAmount, // secValue
                sellerTbdAddr,
                buyerTbdAddr,
                expectedTotalPayment, // wholesaleValue = price * amount
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );

        // Submit buy order that will match the sell order
        orderBook.buy(secContrAddr, sellAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
    }

    /**
     * Verifies that the total payment amount (price * amount) is correctly calculated
     * for partial fills with multiple matches.
     */
    function test_buy_partialFill_verifiesTotalPaymentAmount() public {
        // Create 2 sell orders: 2 units each at askPrice = 10
        uint256 order1Amount = 2;
        uint256 order2Amount = 2;
        orderBook.sell(secContrAddr, order1Amount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);
        orderBook.sell(secContrAddr, order2Amount, askPrice, sellerSecAddr, sellerTbdAddr, sellerBankTbdContrAddr);

        // Mock DvP to succeed
        vm.mockCall(dvpContrAddr, abi.encodeWithSelector(dvpContract.settle.selector), abi.encode(true));

        // Buy order for 3 units should match:
        // - First order: 2 units at 10 = 20 total payment
        // - Second order: 1 unit at 10 = 10 total payment
        uint256 buyAmount = 3;
        uint256 expectedPayment1 = askPrice * order1Amount; // 10 * 2 = 20
        uint256 expectedPayment2 = askPrice * 1; // 10 * 1 = 10

        // Verify first match: 2 units
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                order1Amount, // secValue = 2
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment1, // wholesaleValue = 10 * 2 = 20
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );

        // Verify second match: 1 unit
        vm.expectCall(
            dvpContrAddr,
            0,
            abi.encodeWithSelector(
                dvpContract.settle.selector,
                secContrAddr,
                sellerSecAddr,
                buyerSecAddr,
                1, // secValue = 1
                sellerTbdAddr,
                buyerTbdAddr,
                expectedPayment2, // wholesaleValue = 10 * 1 = 10
                sellerBankTbdContrAddr,
                buyerBankTbdContrAddr
            )
        );

        // Submit buy order for 3 units
        orderBook.buy(secContrAddr, buyAmount, bidPrice, buyerSecAddr, buyerTbdAddr, buyerBankTbdContrAddr);
    }
}
