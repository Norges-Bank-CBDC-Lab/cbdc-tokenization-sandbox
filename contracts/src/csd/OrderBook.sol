// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Errors} from "@common/Errors.sol";
import {BaseSecurityToken} from "@csd/BaseSecurityToken.sol";
import {DvP} from "@csd/DvP.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Roles} from "@common/Roles.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {SettlementInfo} from "@common/SettlementInfo.sol";
import {IOrderBook} from "@interfaces/IOrderBook.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * To prevent re-entrant manipulation of order book states by other contract in
 * the settlement stack, all external/public functions of this contract which
 * access the order book arrays should have the nonReentrant modifier.
 */
contract OrderBook is IOrderBook, AccessControl, ReentrancyGuard {
    /**
     * ERC165 supported interfaces.
     */
    mapping(bytes4 => bool) internal _supportedInterfaces;

    uint256 public bestBidPrice;
    uint256 public bestAskPrice;

    mapping(bytes32 => Order) public orders; // Access order by ID
    mapping(uint256 => PriceLevel) internal buyLevels;
    mapping(uint256 => PriceLevel) internal sellLevels;

    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    Wnok private immutable _wnok;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    DvP private immutable _dvp;
    address public immutable SECURITY;

    uint256 private _orderIdNonce;

    /**
     * @dev Constructor for the OrderBook contract.
     * @param admin The address of the admin.
     * @param wnokContrAddr The address of the Wnok contract.
     * @param dvpContrAddr The address of the DvP contract.
     * @param securityAddr The address of the security contract this OrderBook handles.
     */
    constructor(address admin, address wnokContrAddr, address dvpContrAddr, address securityAddr) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        if (wnokContrAddr == address(0)) revert Errors.WnokAddressZero();
        if (dvpContrAddr == address(0)) revert Errors.DvpAddressZero();
        if (securityAddr == address(0)) revert Errors.SecurityAddressZero();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(Roles.ORDER_ADMIN_ROLE, admin);

        // ERC-165
        _supportedInterfaces[type(IOrderBook).interfaceId] = true;

        _wnok = Wnok(wnokContrAddr);
        _dvp = DvP(dvpContrAddr);
        SECURITY = securityAddr;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return _supportedInterfaces[interfaceId] || super.supportsInterface(interfaceId);
    }

    /**
     * Tries to settle a buy order by looking for a matching sell order in the order book.
     * @param buyOrder The buy order to settle.
     * @return settlementInfo containing settlement details.
     * @return remainingAmount the amount that was not settled.
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function _settleBuyOrder(Order memory buyOrder) internal returns (SettlementInfo memory, uint256) {
        uint256 remaining = buyOrder.amount;
        uint256 totalTradeAmount = 0;
        bytes32 matchedOrderId = bytes32(0);

        while (remaining > 0) {
            uint256 currentPrice = bestAskPrice;
            if (currentPrice == 0 || currentPrice > buyOrder.price) break;

            bytes32 orderId = sellLevels[currentPrice].head;
            while (orderId != bytes32(0) && remaining > 0) {
                Order storage sellOrder = orders[orderId];
                bytes32 nextOrder = sellOrder.next;

                uint256 tradeAmount = Math.min(remaining, sellOrder.amount);
                // sellOrder is the maker (already in the book), so use its price
                uint256 makerPricePerUnit = sellOrder.price;
                uint256 totalSettlementValue = _getSettlementPrice(makerPricePerUnit, tradeAmount);

                emit OrderMatchedEvent(orderId);

                (bool success, DvP.FailureReason reason) =
                    _settle(buyOrder, sellOrder, tradeAmount, totalSettlementValue);

                if (success) {
                    remaining -= tradeAmount;
                    buyOrder.amount = remaining;
                    sellOrder.amount -= tradeAmount;
                    totalTradeAmount += tradeAmount;
                    matchedOrderId = orderId;

                    // Always decrement volume by tradeAmount (for both partial and full fills)
                    // Note: order.amount is already decremented, so _removeOrderFromLevel
                    // cannot use it to decrement volume
                    sellLevels[sellOrder.price].volume -= tradeAmount;

                    if (sellOrder.amount == 0) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                } else {
                    if (reason == DvP.FailureReason.Buyer) {
                        return (_createSettlementInfo(false, false, buyOrder.id, totalTradeAmount), remaining);
                    }
                    if (reason == DvP.FailureReason.Seller) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                        emit OrderRevokedEvent(orderId);
                    }
                    if (reason == DvP.FailureReason.Unknown) {
                        // If we haven't settled anything yet, stop and preserve the buy order
                        if (totalTradeAmount == 0) {
                            return (_createSettlementInfo(false, true, buyOrder.id, 0), remaining);
                        }
                        // Otherwise, continue trying to match with other orders
                    }
                }
                orderId = nextOrder;
            }
        }

        bool settled = remaining == 0;
        bytes32 resultOrderId = settled ? matchedOrderId : buyOrder.id;
        return (_createSettlementInfo(settled, true, resultOrderId, totalTradeAmount), remaining);
    }

    /**
     * Tries to settle a sell order by looking for a matching buy order in the order book.
     * @param sellOrder The sell order to settle.
     * @return settlementInfo containing settlement details.
     * @return remainingAmount the amount that was not settled.
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function _settleSellOrder(Order memory sellOrder) internal returns (SettlementInfo memory, uint256) {
        uint256 remaining = sellOrder.amount;
        uint256 totalTradeAmount = 0;
        bytes32 matchedOrderId = bytes32(0);

        while (remaining > 0) {
            uint256 currentPrice = bestBidPrice;
            if (currentPrice == 0 || currentPrice < sellOrder.price) break;

            bytes32 orderId = buyLevels[currentPrice].head;
            while (orderId != bytes32(0) && remaining > 0) {
                Order storage buyOrder = orders[orderId];
                bytes32 nextOrder = buyOrder.next;

                uint256 tradeAmount = Math.min(remaining, buyOrder.amount);
                // buyOrder is the maker (already in the book), so use its price
                uint256 makerPricePerUnit = buyOrder.price;
                uint256 totalSettlementValue = _getSettlementPrice(makerPricePerUnit, tradeAmount);

                emit OrderMatchedEvent(buyOrder.id);

                (bool success, DvP.FailureReason reason) =
                    _settle(buyOrder, sellOrder, tradeAmount, totalSettlementValue);

                if (success) {
                    remaining -= tradeAmount;
                    sellOrder.amount = remaining;
                    buyOrder.amount -= tradeAmount;
                    totalTradeAmount += tradeAmount;
                    matchedOrderId = buyOrder.id;

                    // Always decrement volume by tradeAmount (for both partial and full fills)
                    // Note: order.amount is already decremented, so _removeOrderFromLevel
                    // cannot use it to decrement volume
                    buyLevels[buyOrder.price].volume -= tradeAmount;

                    if (buyOrder.amount == 0) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                } else {
                    if (reason == DvP.FailureReason.Seller) {
                        return (_createSettlementInfo(false, false, sellOrder.id, totalTradeAmount), remaining);
                    }
                    if (reason == DvP.FailureReason.Buyer) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                        emit OrderRevokedEvent(orderId);
                    }
                    if (reason == DvP.FailureReason.Unknown) {
                        // If we haven't settled anything yet, stop and preserve the sell order
                        if (totalTradeAmount == 0) {
                            return (_createSettlementInfo(false, true, sellOrder.id, 0), remaining);
                        }
                        // Otherwise, continue trying to match with other orders
                    }
                }
                orderId = nextOrder;
            }
        }

        bool settled = remaining == 0;
        bytes32 resultOrderId = settled ? matchedOrderId : sellOrder.id;
        return (_createSettlementInfo(settled, true, resultOrderId, totalTradeAmount), remaining);
    }

    function _ordersMatch(Order memory buyOrder, Order memory sellOrder) internal pure returns (bool) {
        return buyOrder.secContrAddr == sellOrder.secContrAddr && buyOrder.price >= sellOrder.price;
    }

    /**
     * @dev Helper function to create a SettlementInfo struct.
     * @param settlementAmount The total quantity/amount of securities traded (0 if unmatched or dropped).
     */
    function _createSettlementInfo(bool settled, bool validOrder, bytes32 orderId, uint256 settlementAmount)
        internal
        pure
        returns (SettlementInfo memory)
    {
        return SettlementInfo({
            settled: settled, validOrder: validOrder, orderId: orderId, settlementAmount: settlementAmount
        });
    }

    /**
     * @dev Helper function to create an Order struct.
     */
    function _createOrder(
        bytes32 orderId,
        address broker,
        address investorSecAddr,
        address secContrAddr,
        uint256 amount,
        uint256 price,
        address investorTbdAddr,
        address tbdContrAddr,
        bool isBuySide
    ) internal pure returns (Order memory) {
        return Order({
            id: orderId,
            broker: broker,
            investorSecAddr: investorSecAddr,
            secContrAddr: secContrAddr,
            amount: amount,
            price: price,
            investorTbdAddr: investorTbdAddr,
            tbdContrAddr: tbdContrAddr,
            isBuySide: isBuySide,
            next: bytes32(0),
            prev: bytes32(0)
        });
    }

    /**
     * Settles a matched pair of buy and sell orders via the DvP contract.
     * @param buyOrder The buy order.
     * @param sellOrder The sell order.
     * @param amount The amount to trade.
     * @param settlementPrice The price at which to settle.
     * @return success Whether the settlement succeeded.
     * @return reason The failure reason if settlement failed.
     */
    function _settle(Order memory buyOrder, Order memory sellOrder, uint256 amount, uint256 settlementPrice)
        internal
        returns (bool, DvP.FailureReason)
    {
        if (buyOrder.secContrAddr != sellOrder.secContrAddr) revert Errors.SecurityMismatch();

        try _dvp.settle(
            buyOrder.secContrAddr,
            sellOrder.investorSecAddr,
            buyOrder.investorSecAddr,
            amount,
            sellOrder.investorTbdAddr,
            buyOrder.investorTbdAddr,
            settlementPrice,
            sellOrder.tbdContrAddr,
            buyOrder.tbdContrAddr
        ) returns (
            bool result
        ) {
            return (result, DvP.FailureReason.Unknown);
        } catch (bytes memory lowLevelData) {
            // forge-lint: disable-next-line(unsafe-typecast)
            if (lowLevelData.length >= 4 && bytes4(lowLevelData) == DvP.SettlementFailure.selector) {
                bytes memory data = this.trimBytes(lowLevelData, 4);
                (DvP.FailureReason reason) = abi.decode(data, (DvP.FailureReason));
                return (false, reason);
            }
            revert RethrowError("An unknown error occurred during settlement", lowLevelData);
        }
    }

    /**
     * Due to restrictions in Solidity, we cannot slice a `bytes memory`, only `bytes calldata`.
     * Wrapping this operation in an external function with calldata argument is a
     * possible workaround without resorting to assembly.
     * This function must be external/public and must be called as `this.trimBytes`.
     * @param data The bytes data to trim.
     * @param ix The index from which to start the slice.
     * @return The trimmed bytes data.
     */
    function trimBytes(bytes calldata data, uint256 ix) external pure returns (bytes calldata) {
        return data[ix:];
    }

    /**
     * Submit a buy order to the order book.
     *
     * Orders are always limit orders.
     *
     * @dev A function for brokers to submit a limit order to the order book, to buy a security.
     * @param secContrAddr The address of the contract of the security that the broker wants to buy.
     * @param amount The amount of securities to be bought.
     * @param bidPrice The maximum price at which to trade the security.
     * @param buyerSecAddr The address that will own the bought security.
     * @param buyerTbdAddr The address that owns the TBD funds to buy the security.
     * @param buyerBankTbdContrAddr The address of the TBD contract with which to buy the security.
     * @return SettlementInfo containing settlement details.
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function buy(
        address secContrAddr,
        uint256 amount,
        uint256 bidPrice,
        address buyerSecAddr,
        address buyerTbdAddr,
        address buyerBankTbdContrAddr
    ) public override nonReentrant onlyRole(Roles.SUBMIT_ORDER_ROLE) returns (SettlementInfo memory) {
        if (amount == 0) revert Errors.InvalidAmount();
        if (bidPrice == 0) revert Errors.InvalidPrice();
        if (secContrAddr != SECURITY) revert Errors.SecurityMismatch();

        BaseSecurityToken secContract = BaseSecurityToken(secContrAddr);
        Tbd buyerBankTbdContract = Tbd(buyerBankTbdContrAddr);

        emit OrderSubmittedEvent(secContrAddr, amount, bidPrice, buyerSecAddr, buyerBankTbdContrAddr);

        bytes32 orderId = _generateOrderId();
        Order memory buyOrder = _createOrder(
            orderId, msg.sender, buyerSecAddr, secContrAddr, amount, bidPrice, buyerTbdAddr, buyerBankTbdContrAddr, true
        );

        if (!_wnok.hasRole(Roles.TRANSFER_FROM_ROLE, buyerBankTbdContrAddr)) {
            revert Errors.MissingRole(Roles.TRANSFER_FROM_ROLE, buyerBankTbdContrAddr);
        }

        if (!buyerBankTbdContract.allowlistQuery(buyerTbdAddr)) {
            revert Errors.NotInAllowlist("BuyerBankTbdAllowlist", buyerTbdAddr);
        }

        address buyerBankAddr = buyerBankTbdContract.getBankAddress();

        if (!_wnok.allowlistQuery(buyerBankAddr)) {
            revert Errors.NotInAllowlist("BuyerWnokAllowlist", buyerBankAddr);
        }

        if (!secContract.allowlistQuery(buyerSecAddr)) {
            revert Errors.NotInAllowlist("BuyerSecurityAllowlist", buyerSecAddr);
        }
        // slither-disable-next-line reentrancy-vulnerabilities
        (SettlementInfo memory settlementInfo, uint256 remainingAmount) = _settleBuyOrder(buyOrder);

        if (!settlementInfo.settled && settlementInfo.validOrder) {
            // Update the order amount to only the remaining (unsettled) amount
            buyOrder.amount = remainingAmount;
            orders[orderId] = buyOrder;
            _appendToBuyLevel(orderId, bidPrice);
        }

        return settlementInfo;
    }

    /**
     * Submit a sell order to the order book.
     *
     * Orders are always limit orders.
     *
     * @dev A function for brokers to submit a limit order to the order book, to sell a security.
     * @param secContrAddr The address of the contract of the security that the broker wants to sell.
     * @param amount The amount of securities to be sold.
     * @param askPrice The minimum price for which to trade the security.
     * @param sellerSecAddr The address that owns the security to be sold.
     * @param sellerTbdAddr The address that will receive the TBD funds in exchange for the security.
     * @param sellerBankTbdContrAddr The address of the TBD contract with which to receive the funds for the security.
     * @return SettlementInfo containing settlement details.
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function sell(
        address secContrAddr,
        uint256 amount,
        uint256 askPrice,
        address sellerSecAddr,
        address sellerTbdAddr,
        address sellerBankTbdContrAddr
    ) public override nonReentrant onlyRole(Roles.SUBMIT_ORDER_ROLE) returns (SettlementInfo memory) {
        if (amount == 0) revert Errors.InvalidAmount();
        if (askPrice == 0) revert Errors.InvalidPrice();
        if (secContrAddr != SECURITY) revert Errors.SecurityMismatch();

        BaseSecurityToken secContract = BaseSecurityToken(secContrAddr);
        Tbd sellerBankTbdContract = Tbd(sellerBankTbdContrAddr);

        emit OrderSubmittedEvent(secContrAddr, amount, askPrice, sellerSecAddr, sellerBankTbdContrAddr);

        bytes32 orderId = _generateOrderId();
        Order memory sellOrder = _createOrder(
            orderId,
            msg.sender,
            sellerSecAddr,
            secContrAddr,
            amount,
            askPrice,
            sellerTbdAddr,
            sellerBankTbdContrAddr,
            false
        );

        if (!_wnok.hasRole(Roles.TRANSFER_FROM_ROLE, sellerBankTbdContrAddr)) {
            revert Errors.MissingRole(Roles.TRANSFER_FROM_ROLE, sellerBankTbdContrAddr);
        }

        if (!sellerBankTbdContract.allowlistQuery(sellerTbdAddr)) {
            revert Errors.NotInAllowlist("SellerBankTbdAllowlist", sellerTbdAddr);
        }

        address sellerBankAddr = sellerBankTbdContract.getBankAddress();

        if (!_wnok.allowlistQuery(sellerBankAddr)) {
            revert Errors.NotInAllowlist("SellerWnokAllowlist", sellerBankAddr);
        }

        if (!secContract.allowlistQuery(sellerSecAddr)) {
            revert Errors.NotInAllowlist("SellerSecurityAllowlist", sellerSecAddr);
        }

        // slither-disable-next-line reentrancy-vulnerabilities
        (SettlementInfo memory settlementInfo, uint256 remainingAmount) = _settleSellOrder(sellOrder);

        if (!settlementInfo.settled && settlementInfo.validOrder) {
            // Update the order amount to only the remaining (unsettled) amount
            sellOrder.amount = remainingAmount;
            orders[orderId] = sellOrder;
            _appendToSellLevel(orderId, askPrice);
        }

        return settlementInfo;
    }

    /**
     * @dev The following getter functions are provided for backwards compatibility.
     * For production use, these should be indexed off-chain from events to scale efficiently.
     */
    function getBuyOrders() external view override returns (Order[] memory) {
        return _fetchOrders(true, msg.sender, address(0));
    }

    function getSellOrders() external view override returns (Order[] memory) {
        return _fetchOrders(false, msg.sender, address(0));
    }

    function getBuyOrders(address investorSecAddr) external view override returns (Order[] memory) {
        return _fetchOrders(true, msg.sender, investorSecAddr);
    }

    function getSellOrders(address investorSecAddr) external view override returns (Order[] memory) {
        return _fetchOrders(false, msg.sender, investorSecAddr);
    }

    function getAllBuyOrders() external view override returns (Order[] memory) {
        return _fetchOrders(true, address(0), address(0));
    }

    function getAllSellOrders() external view override returns (Order[] memory) {
        return _fetchOrders(false, address(0), address(0));
    }

    function _fetchOrders(bool isBuySide, address broker, address investor) internal view returns (Order[] memory) {
        uint256 count = 0;
        uint256 currentPrice = isBuySide ? bestBidPrice : bestAskPrice;

        // Pass 1: Count
        uint256 priceCursor = currentPrice;
        while (priceCursor != 0) {
            PriceLevel storage level = isBuySide ? buyLevels[priceCursor] : sellLevels[priceCursor];

            bytes32 orderId = level.head;
            while (orderId != bytes32(0)) {
                Order storage order = orders[orderId];
                if (
                    (broker == address(0) || order.broker == broker)
                        && (investor == address(0) || order.investorSecAddr == investor)
                ) {
                    count++;
                }
                orderId = order.next;
            }
            priceCursor = level.next;
        }

        Order[] memory result = new Order[](count);
        if (count == 0) return result;

        // Pass 2: Collect
        uint256 i = 0;
        priceCursor = currentPrice;
        while (priceCursor != 0) {
            PriceLevel storage level = isBuySide ? buyLevels[priceCursor] : sellLevels[priceCursor];

            bytes32 orderId = level.head;
            while (orderId != bytes32(0)) {
                Order storage order = orders[orderId];
                if (
                    (broker == address(0) || order.broker == broker)
                        && (investor == address(0) || order.investorSecAddr == investor)
                ) {
                    result[i] = order;
                    i++;
                }
                orderId = order.next;
            }
            priceCursor = level.next;
        }
        return result;
    }

    function revokeBuyOrder(bytes32 orderId) external override nonReentrant returns (bool) {
        Order storage order = orders[orderId];
        if (order.id == bytes32(0) || !order.isBuySide) revert Errors.OrderNotFound();
        if (order.broker != msg.sender) revert Errors.UnauthorizedBroker();

        _removeOrderFromLevel(orderId);
        delete orders[orderId];

        emit OrderRevokedEvent(orderId);
        return true;
    }

    function revokeSellOrder(bytes32 orderId) external override nonReentrant returns (bool) {
        Order storage order = orders[orderId];
        if (order.id == bytes32(0) || order.isBuySide) revert Errors.OrderNotFound();
        if (order.broker != msg.sender) revert Errors.UnauthorizedBroker();

        _removeOrderFromLevel(orderId);
        delete orders[orderId];

        emit OrderRevokedEvent(orderId);
        return true;
    }

    /**
     * @dev Initializes sell orders for a security issuance. Creates individual orders for each unit.
     * @param numIssuance The number of individual sell orders to create.
     * @param price The price for each sell order.
     * @param secContrAddr The address of the security contract.
     * @param tbdContrAddr The address of the TBD contract.
     * @param investorSecAddr The address that owns the securities.
     * @param investorTbdAddr The address that will receive the TBD funds.
     * @return true if successful.
     */
    function initializeSellOrders(
        uint256 numIssuance,
        uint256 price,
        address secContrAddr,
        address tbdContrAddr,
        address investorSecAddr,
        address investorTbdAddr
    ) external override nonReentrant onlyRole(Roles.ORDER_ADMIN_ROLE) returns (bool) {
        if (price == 0) revert Errors.InvalidPrice();
        if (secContrAddr != SECURITY) revert Errors.SecurityMismatch();

        for (uint256 i = 0; i < numIssuance; i++) {
            bytes32 orderId = _generateOrderId();
            Order memory sellOrder = _createOrder(
                orderId, address(0x0), investorSecAddr, secContrAddr, 1, price, investorTbdAddr, tbdContrAddr, false
            );

            orders[orderId] = sellOrder;
            _appendToSellLevel(orderId, price);
        }
        return true;
    }

    /**
     * @dev Returns a unique order id.
     * @return A unique bytes32 order identifier.
     */
    function _generateOrderId() internal returns (bytes32) {
        _orderIdNonce++;
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encodePacked(block.number, _orderIdNonce));
    }

    /**
     * @dev Calculates the total settlement value using the maker's price.
     * The maker is the order already in the book (resting order), and the taker is the incoming order.
     * The settlement price is always the maker's price per unit, multiplied by the trade amount.
     * @param makerPrice The price per unit from the maker (order already in the book).
     * @param tradeAmount The amount of securities being traded.
     * @return The total settlement value (makerPrice * tradeAmount).
     */
    function _getSettlementPrice(uint256 makerPrice, uint256 tradeAmount) internal pure returns (uint256) {
        return makerPrice * tradeAmount;
    }

    function _appendToBuyLevel(bytes32 _orderId, uint256 _price) internal {
        PriceLevel storage level = _ensureBuyLevel(_price);

        if (level.head == bytes32(0)) {
            level.head = _orderId;
            level.tail = _orderId;
        } else {
            bytes32 tailId = level.tail;
            orders[tailId].next = _orderId;
            orders[_orderId].prev = tailId;
            level.tail = _orderId;
        }

        level.volume += orders[_orderId].amount;
    }

    function _appendToSellLevel(bytes32 _orderId, uint256 _price) internal {
        PriceLevel storage level = _ensureSellLevel(_price);

        if (level.head == bytes32(0)) {
            level.head = _orderId;
            level.tail = _orderId;
        } else {
            bytes32 tailId = level.tail;
            orders[tailId].next = _orderId;
            orders[_orderId].prev = tailId;
            level.tail = _orderId;
        }

        level.volume += orders[_orderId].amount;
    }

    /**
     * @dev The following internal price level management functions (_ensureBuyLevel, _ensureSellLevel) are provided for on-chain
     * operations. For production use, price level management should be handled off-chain with on-chain
     * validation. Off-chain systems can track price level structure and validate against
     * on-chain state to reduce gas costs.
     */
    function _ensureBuyLevel(uint256 _price) internal returns (PriceLevel storage) {
        PriceLevel storage level = buyLevels[_price];
        if (!level.exists) {
            level.exists = true;
            level.price = _price;
            _insertBuyLevel(_price);
        }
        return level;
    }

    function _ensureSellLevel(uint256 _price) internal returns (PriceLevel storage) {
        PriceLevel storage level = sellLevels[_price];
        if (!level.exists) {
            level.exists = true;
            level.price = _price;
            _insertSellLevel(_price);
        }
        return level;
    }

    function _insertBuyLevel(uint256 _price) internal {
        if (bestBidPrice == 0) {
            bestBidPrice = _price;
            return;
        }

        if (_price > bestBidPrice) {
            PriceLevel storage currentBest = buyLevels[bestBidPrice];
            currentBest.prev = _price;
            PriceLevel storage newBest = buyLevels[_price];
            newBest.next = bestBidPrice;
            bestBidPrice = _price;
            return;
        }

        uint256 cursor = bestBidPrice;
        while (true) {
            PriceLevel storage cursorLevel = buyLevels[cursor];
            uint256 nextPrice = cursorLevel.next;

            if (nextPrice == 0 || nextPrice < _price) {
                cursorLevel.next = _price;
                PriceLevel storage newLevel = buyLevels[_price];
                newLevel.prev = cursor;
                newLevel.next = nextPrice;
                if (nextPrice != 0) {
                    buyLevels[nextPrice].prev = _price;
                }
                break;
            }

            cursor = nextPrice;
        }
    }

    function _insertSellLevel(uint256 _price) internal {
        if (bestAskPrice == 0) {
            bestAskPrice = _price;
            return;
        }

        if (_price < bestAskPrice) {
            PriceLevel storage currentBest = sellLevels[bestAskPrice];
            currentBest.prev = _price;
            PriceLevel storage newBest = sellLevels[_price];
            newBest.next = bestAskPrice;
            bestAskPrice = _price;
            return;
        }

        uint256 cursor = bestAskPrice;
        while (true) {
            PriceLevel storage cursorLevel = sellLevels[cursor];
            uint256 nextPrice = cursorLevel.next;

            if (nextPrice == 0 || nextPrice > _price) {
                cursorLevel.next = _price;
                PriceLevel storage newLevel = sellLevels[_price];
                newLevel.prev = cursor;
                newLevel.next = nextPrice;
                if (nextPrice != 0) {
                    sellLevels[nextPrice].prev = _price;
                }
                break;
            }

            cursor = nextPrice;
        }
    }

    function _removeOrderFromLevel(bytes32 _orderId) internal {
        Order storage order = orders[_orderId];
        PriceLevel storage level;
        if (order.isBuySide) {
            level = buyLevels[order.price];
        } else {
            level = sellLevels[order.price];
        }

        // Decrement volume only if order has remaining amount (not fully settled)
        // When an order is fully settled, volume is already decremented during settlement
        // and order.amount is 0, so this is a no-op in that case.
        // When an order is revoked (not settled), order.amount still has its value.
        if (order.amount > 0) {
            if (level.volume >= order.amount) {
                level.volume -= order.amount;
            } else {
                level.volume = 0;
            }
        }

        bytes32 prevId = order.prev;
        bytes32 nextId = order.next;

        if (prevId == bytes32(0)) {
            level.head = nextId;
        } else {
            orders[prevId].next = nextId;
        }

        if (nextId == bytes32(0)) {
            level.tail = prevId;
        } else {
            orders[nextId].prev = prevId;
        }

        order.next = bytes32(0);
        order.prev = bytes32(0);

        if (level.head == bytes32(0)) {
            if (order.isBuySide) {
                _removeBuyLevel(order.price);
            } else {
                _removeSellLevel(order.price);
            }
        }
    }

    function _removeBuyLevel(uint256 _price) internal {
        PriceLevel storage level = buyLevels[_price];
        uint256 prevPrice = level.prev;
        uint256 nextPrice = level.next;

        if (prevPrice == 0) {
            bestBidPrice = nextPrice;
        } else {
            buyLevels[prevPrice].next = nextPrice;
        }

        if (nextPrice != 0) {
            buyLevels[nextPrice].prev = prevPrice;
        }

        delete buyLevels[_price];
    }

    function _removeSellLevel(uint256 _price) internal {
        PriceLevel storage level = sellLevels[_price];
        uint256 prevPrice = level.prev;
        uint256 nextPrice = level.next;

        if (prevPrice == 0) {
            bestAskPrice = nextPrice;
        } else {
            sellLevels[prevPrice].next = nextPrice;
        }

        if (nextPrice != 0) {
            sellLevels[nextPrice].prev = prevPrice;
        }

        delete sellLevels[_price];
    }
}
