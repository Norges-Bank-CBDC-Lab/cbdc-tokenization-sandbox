// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {Errors} from "@common/Errors.sol";
import {SettlementInfo} from "@common/SettlementInfo.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {ClientList} from "@broker/ClientList.sol";
import {IOrderBook} from "@interfaces/IOrderBook.sol";

/**
 * @title The Broker
 * @notice broker contract that accepts buy and sell orders from registered retail clients
 *         and routes them to a central OrderBook contract for execution and settlement.
 * @dev This contract inherits from `ClientList` which maps each client wallet to a TBD money wallet address
 *      and a  securities wallet address as well as the broker bank TBD contract for that client.
 */
contract Broker is ClientList {
    /**
     *  @notice ERC165 supported interfaces.
     */
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /**
     *  @notice Reference to the shared OrderBook contract.
     */
    OrderBook private immutable _ORDER_BOOK;

    /**
     * @notice Initializes the Broker contract.
     * @dev Grants DEFAULT_ADMIN_ROLE to the provided `admin` address.
     *      Sets up support for ERC165 and Broker interface function selectors.
     * @param admin The administrator address for access control.
     * @param orderBookContrAddr The address of the OrderBook contract.
     */
    constructor(address admin, address orderBookContrAddr) ClientList(admin) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        if (orderBookContrAddr == address(0)) revert Errors.OrderBookAddressZero();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // ERC-165
        _supportedInterfaces[Broker(address(0)).supportsInterface.selector] = true;
        // Broker
        _supportedInterfaces[Broker(address(0)).sell.selector ^ Broker(address(0)).buy.selector] = true;

        _ORDER_BOOK = OrderBook(orderBookContrAddr);
    }

    /**
     * @notice Returns the name of the contract.
     * @return The string literal "Broker".
     */
    function name() public pure returns (string memory) {
        return "Broker";
    }

    /**
     * @notice Submits a buy order for the given security the orderbook contract.
     * @dev The caller must be a registered client. Wallet addresses are resolved from ClientList.
     * @param secContrAddr The address of the security (ERC20 or similar).
     * @param amount The amount of the security to buy.
     * @param bidPrice The price offered per unit.
     * @return A `SettlementInfo` struct representing the result of the order.
     */
    function buy(address secContrAddr, uint256 amount, uint256 bidPrice) public returns (SettlementInfo memory) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.buy(
            secContrAddr,
            amount,
            bidPrice,
            getSecuritiesWallet(msg.sender),
            getTbdWallet(msg.sender),
            getTbdContrAddr(msg.sender)
        );
    }

    /**
     * @notice Submits a sell order for the given security to the orderbook contract.
     * @dev The caller must be a registered client. Wallet addresses are resolved from ClientList.
     * @param secContrAddr The address of the security to sell.
     * @param amount The amount of the security to sell.
     * @param askPrice The asking price per unit.
     * @return A `SettlementInfo` struct representing the result of the order.
     */
    function sell(address secContrAddr, uint256 amount, uint256 askPrice) public returns (SettlementInfo memory) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.sell(
            secContrAddr,
            amount,
            askPrice,
            getSecuritiesWallet(msg.sender),
            getTbdWallet(msg.sender),
            getTbdContrAddr(msg.sender)
        );
    }

    /**
     * @notice Revokes a buy order.
     * @dev The caller must be a registered client. Wallet addresses are resolved from ClientList.
     * @param orderId The unique identifier of the Order.
     * @return true/false representing the success of the transaction.
     */
    function revokeBuyOrder(bytes32 orderId) public returns (bool) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.revokeBuyOrder(orderId);
    }

    /**
     * @notice Revokes a sell order.
     * @dev The caller must be a registered client. Wallet addresses are resolved from ClientList.
     * @param orderId The unique identifier of the Order.
     * @return true/false representing the success of the transaction.
     */
    function revokeSellOrder(bytes32 orderId) public returns (bool) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.revokeSellOrder(orderId);
    }

    /**
     * @notice Retrieves the current sell orders for the calling client.
     * @dev The caller must be a registered client. The sec. wallet addresses is resolved from ClientList.
     * @return Order[] -> An array of the caller's active sell orders from the order book.
     */
    function getSellOrders() public view returns (IOrderBook.Order[] memory) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.getSellOrders(getSecuritiesWallet(msg.sender));
    }

    /**
     * @notice Retrieves the current buy orders for the calling client.
     * @dev The caller must be a registered client. The sec. wallet addresses is resolved from ClientList.
     * @return Order[] -> An array of the caller's active buy orders from the order book.
     */
    function getBuyOrders() public view returns (IOrderBook.Order[] memory) {
        clientExistsGuard(msg.sender);
        return _ORDER_BOOK.getBuyOrders(getSecuritiesWallet(msg.sender));
    }
}
