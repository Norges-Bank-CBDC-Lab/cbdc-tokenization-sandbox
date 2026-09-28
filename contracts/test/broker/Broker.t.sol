// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Broker} from "@broker/Broker.sol";
import {Errors} from "@common/Errors.sol";
import {SettlementInfo} from "@common/SettlementInfo.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {Test} from "forge-std/Test.sol";
import {IOrderBook} from "@interfaces/IOrderBook.sol";

/**
 *  @notice These unit tests do limit themselves to consider only a single broker.
 *      These tests focus on the client list and role functions of the broker contract and does not incorporate any scenarios relating to the called contracts.
 *      Interaction of clients via different brokers should be tested via integration tests.
 */
contract BrokerTest is Test {
    Broker broker;

    address admin = address(this);
    address brokerBank = address(0x1);
    address client = address(0x2);
    address secToken = address(0x3);
    address tbdWallet = address(0x4);
    address secWallet = address(0x5);
    address otherSecWallet = address(0x6);
    address unregistered = address(0x8);
    address orderBookAddr = address(0x9);

    SettlementInfo faultySettlementResponse =
        SettlementInfo({settled: false, validOrder: false, orderId: bytes32(uint256(0)), settlementAmount: 0});
    IOrderBook.Order[] faultyOrderResponse;
    IOrderBook.Order[] expectedOrderResponse;
    bytes32 orderId = keccak256("order_id");

    function setUp() public {
        broker = new Broker(admin, orderBookAddr);
        faultyOrderResponse.push(
            IOrderBook.Order(
                bytes32(uint256(0)),
                address(0x0),
                address(0x0),
                address(0x0),
                0,
                0,
                address(0x0),
                address(0x0),
                false,
                bytes32(0),
                bytes32(0)
            )
        );
        expectedOrderResponse.push(
            IOrderBook.Order(
                bytes32(uint256(1)),
                address(0x1),
                address(0x1),
                address(0x1),
                1,
                1,
                address(0x1),
                address(0x1),
                false,
                bytes32(0),
                bytes32(0)
            )
        );
        broker.addClient(client, tbdWallet, secWallet, brokerBank);
        // Default response for order book contract buy function if called with arbitrary input
        vm.mockCall(orderBookAddr, abi.encodeWithSelector(OrderBook.buy.selector), abi.encode(faultySettlementResponse));
        // Default response for order book contract sell function if called with arbitrary input
        vm.mockCall(
            orderBookAddr, abi.encodeWithSelector(OrderBook.sell.selector), abi.encode(faultySettlementResponse)
        );
        // Default response for order book contract getBuyOrders function if called with arbitrary input -- not using selector due to function overload
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(bytes4(keccak256("getBuyOrders(address)"))),
            abi.encode(faultySettlementResponse)
        );
        // Default response for order book contract getSellOrders function if called with arbitrary input -- not using selector due to function overload
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(bytes4(keccak256("getSellOrders(address)"))),
            abi.encode(faultySettlementResponse)
        );
    }

    /// @notice Returns correct name
    function test_name() public view {
        assertEq(broker.name(), "Broker");
    }

    /**
     * @notice Registered client can submit a buy order, forwarded to OrderBook.
     *      Call to order book function is corretly enriched with secruity wallet, TBD wallet, and TBD contract address information.
     */
    function test_buy_forwardedCorrectly() public {
        vm.prank(client);
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(OrderBook.buy.selector, secToken, 1, 5, secWallet, tbdWallet, brokerBank),
            abi.encode(
                SettlementInfo({settled: true, validOrder: true, orderId: bytes32(uint256(2)), settlementAmount: 2})
            )
        );
        SettlementInfo memory info = broker.buy(secToken, 1, 5);
        assertTrue(info.settled);
    }

    /**
     * @notice Registered client can submit a sell order, forwarded to OrderBook.
     *      Call to order book function is corretly enriched with secruity wallet, TBD wallet, and TBD contract address information.
     */
    function test_sell_forwardedCorrectly() public {
        vm.prank(client);
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(OrderBook.sell.selector, secToken, 1, 3, secWallet, tbdWallet, brokerBank),
            abi.encode(
                SettlementInfo({settled: true, validOrder: true, orderId: bytes32(uint256(2)), settlementAmount: 2})
            )
        );
        SettlementInfo memory info = broker.sell(secToken, 1, 3);
        assertTrue(info.settled);
    }

    /**
     * @notice Registered client can revoke its own buy order, forwarded to OrderBook.
     */
    function test_revokeBuyOrder_forwardedCorrectly() public {
        _mockOrderOwnedBy(secWallet, true);
        vm.prank(client);
        vm.mockCall(orderBookAddr, abi.encodeWithSelector(OrderBook.revokeBuyOrder.selector, orderId), abi.encode(true));
        bool success = broker.revokeBuyOrder(orderId);
        assertTrue(success);
    }

    /**
     * @notice Registered client can revoke its own sell order, forwarded to OrderBook.
     */
    function test_revokeSellOrder_forwardedCorrectly() public {
        _mockOrderOwnedBy(secWallet, false);
        vm.prank(client);
        vm.mockCall(
            orderBookAddr, abi.encodeWithSelector(OrderBook.revokeSellOrder.selector, orderId), abi.encode(true)
        );
        bool success = broker.revokeSellOrder(orderId);
        assertTrue(success);
    }

    /**
     * @notice A client cannot revoke a buy order placed for another client's securities wallet.
     */
    function test_RevokeBuyOrder_RevertIf_OrderBelongsToAnotherClient() public {
        _mockOrderOwnedBy(otherSecWallet, true);
        vm.expectRevert(abi.encodeWithSelector(Errors.OrderNotOwnedByClient.selector, orderId));
        vm.prank(client);
        broker.revokeBuyOrder(orderId);
    }

    /**
     * @notice A client cannot revoke a sell order placed for another client's securities wallet.
     */
    function test_RevokeSellOrder_RevertIf_OrderBelongsToAnotherClient() public {
        _mockOrderOwnedBy(otherSecWallet, false);
        vm.expectRevert(abi.encodeWithSelector(Errors.OrderNotOwnedByClient.selector, orderId));
        vm.prank(client);
        broker.revokeSellOrder(orderId);
    }

    function _mockOrderOwnedBy(address investorSecAddr, bool isBuySide) internal {
        IOrderBook.Order memory order = IOrderBook.Order({
            id: orderId,
            broker: address(broker),
            investorSecAddr: investorSecAddr,
            secContrAddr: secToken,
            amount: 1,
            price: 1,
            investorTbdAddr: tbdWallet,
            tbdContrAddr: brokerBank,
            isBuySide: isBuySide,
            next: bytes32(0),
            prev: bytes32(0)
        });
        vm.mockCall(orderBookAddr, abi.encodeWithSelector(OrderBook.getOrder.selector, orderId), abi.encode(order));
    }

    /// @notice Unregistered client calling buy should revert
    function test_revertIf_buy_unregisteredClient() public {
        vm.expectRevert();
        vm.prank(unregistered);
        broker.buy(secToken, 1, 1);
    }

    /// @notice Unregistered client calling sell should revert
    function test_revertIf_sell_unregisteredClient() public {
        vm.expectRevert();
        vm.prank(unregistered);
        broker.sell(secToken, 1, 1);
    }

    /**
     * @notice Registered client can get all their buy orders from the OrderBook.
     *      Call to order book function is correctly enriched with security wallet.
     */
    function test_getBuyOrders_forwardedCorrectly() public {
        vm.prank(client);
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(bytes4(keccak256("getSellOrders(address)")), secWallet),
            abi.encode(expectedOrderResponse)
        );
        IOrderBook.Order[] memory orders = broker.getSellOrders();
        IOrderBook.Order memory order = orders[0];
        assertTrue(order.price == 1);
    }

    /**
     * @notice Registered client can get all their sell orders from the OrderBook.
     *      Call to order book function is correctly enriched with security wallet.
     */
    function test_getSellOrders_forwardedCorrectly() public {
        vm.prank(client);
        vm.mockCall(
            orderBookAddr,
            abi.encodeWithSelector(bytes4(keccak256("getSellOrders(address)")), secWallet),
            abi.encode(expectedOrderResponse)
        );
        IOrderBook.Order[] memory orders = broker.getSellOrders();
        IOrderBook.Order memory order = orders[0];
        assertTrue(order.price == 1);
    }
}
