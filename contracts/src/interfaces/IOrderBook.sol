// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {SettlementInfo} from "@common/SettlementInfo.sol";

interface IOrderBook {
    /**
     * @notice Represents a limit order in the CLOB.
     * @param id Unique order identifier.
     * @param broker Address that submitted the order.
     * @param investorSecAddr Bond holder for the security leg.
     * @param secContrAddr Bond token address (ERC1410).
     * @param amount Units to trade.
     * @param price Quote price (per unit).
     * @param investorTbdAddr Cash address for the counter leg.
     * @param tbdContrAddr Cash token address (TBD/ERC20).
     * @param isBuySide True for buy orders, false for sell orders.
     * @param next Next order id in the price-level linked list.
     * @param prev Previous order id in the price-level linked list.
     */
    struct Order {
        bytes32 id;
        address broker;
        address investorSecAddr;
        address secContrAddr;
        uint256 amount;
        uint256 price;
        address investorTbdAddr;
        address tbdContrAddr;
        bool isBuySide;
        bytes32 next;
        bytes32 prev;
    }

    /**
     * @dev Represents a price level in the CLOB. A price level is a group of orders
     * that all have the same price. Price levels form a doubly-linked list, with each
     * level containing a linked list of orders at that price.
     * @param price The price level value (e.g., 100 NOK)
     * @param head First order ID at this price level (bytes32(0) if empty)
     * @param tail Last order ID at this price level (bytes32(0) if empty)
     * @param prev Previous price level (0 if best price)
     * @param next Next price level (0 if worst price)
     * @param volume Total amount of all orders at this price level
     * @param exists Whether this price level has been initialized
     */
    struct PriceLevel {
        uint256 price;
        bytes32 head;
        bytes32 tail;
        uint256 prev;
        uint256 next;
        uint256 volume;
        bool exists;
    }

    /**
     * An event emitted when an order is successfully submitted by a broker.
     */
    event OrderSubmittedEvent(
        address indexed secContrAddr,
        uint256 amount,
        uint256 price,
        address indexed investorSecAddr,
        address indexed investorBankTbdContrAddr
    );

    /**
     * An event emitted when an order from the order book is matched.
     */
    event OrderMatchedEvent(bytes32 orderId);

    /**
     * An event emitted when an order is revoked (and thus removed from the order book).
     */
    event OrderRevokedEvent(bytes32 orderId);

    /**
     * This error can be used to re-throw low level data from a caught revert.
     */
    error RethrowError(string message, bytes lowLevelData);

    function buy(
        address secContrAddr,
        uint256 amount,
        uint256 bidPrice,
        address buyerSecAddr,
        address buyerTbdAddr,
        address buyerBankTbdContrAddr
    ) external returns (SettlementInfo memory);

    function sell(
        address secContrAddr,
        uint256 amount,
        uint256 askPrice,
        address sellerSecAddr,
        address sellerTbdAddr,
        address sellerBankTbdContrAddr
    ) external returns (SettlementInfo memory);

    function getBuyOrders() external view returns (Order[] memory);
    function getSellOrders() external view returns (Order[] memory);
    function getBuyOrders(address investorSecAddr) external view returns (Order[] memory);
    function getSellOrders(address investorSecAddr) external view returns (Order[] memory);
    function getAllBuyOrders() external view returns (Order[] memory);
    function getAllSellOrders() external view returns (Order[] memory);

    function revokeBuyOrder(bytes32 orderId) external returns (bool);
    function revokeSellOrder(bytes32 orderId) external returns (bool);

    function initializeSellOrders(
        uint256 numIssuance,
        uint256 price,
        address secContrAddr,
        address tbdContrAddr,
        address investorSecAddr,
        address investorTbdAddr
    ) external returns (bool);
}
