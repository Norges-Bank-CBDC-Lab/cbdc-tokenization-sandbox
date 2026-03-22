// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IBondToken} from "@norges-bank/interfaces/IBondToken.sol";
import {Tbd} from "@private-bank/Tbd.sol";

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondOrderBook
 * @notice Limit order book for ERC1410 bond partitions vs ERC20 cash (wNOK).
 * @dev Simplified matching: maker price, immediate matching with linked price levels.
 */
contract BondOrderBook is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /**
     * @dev Kept structurally consistent with IOrderBook.Order for ease of tooling.
     * - investorSecAddr: bond holder (receives on buy, sends on sell)
     * - secContrAddr: bond token address (immutable BOND_TOKEN)
     * - investorTbdAddr: cash address (pays on buy, receives on sell)
     * - tbdContrAddr: cash token address (immutable _cash)
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
     * @dev Aligned with IOrderBook.PriceLevel field ordering for consistency.
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

    enum FailureReason {
        Buyer,
        Seller,
        Unknown
    }

    mapping(bytes4 => bool) internal _supportedInterfaces;

    uint256 public bestBidPrice;
    uint256 public bestAskPrice;
    mapping(bytes32 => Order) public orders;
    mapping(uint256 => PriceLevel) internal buyLevels;
    mapping(uint256 => PriceLevel) internal sellLevels;
    uint256 private _orderIdNonce;

    Tbd private immutable _TBD;
    IBondToken private immutable _BOND;
    bytes32 public immutable PARTITION;
    address public immutable BOND_TOKEN;

    event OrderSubmitted(
        bytes32 indexed orderId, bool indexed isBuy, uint256 amount, uint256 price, address bondHolder, address cashAddr
    );
    event OrderMatched(bytes32 indexed orderId);
    event OrderRevoked(bytes32 indexed orderId);
    event DVPSuccess(bytes32 indexed orderId);
    event DVPFailed(bytes32 indexed orderId, FailureReason reason);

    constructor(address admin, address tbdToken, address bondToken, bytes32 partition) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        if (tbdToken == address(0)) revert Errors.TbdAddressZero();
        if (bondToken == address(0)) revert Errors.SecurityAddressZero();
        if (partition == bytes32(0)) revert Errors.PartitionZero();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(Roles.ORDER_ADMIN_ROLE, admin);
        _grantRole(Roles.SUBMIT_ORDER_ROLE, admin);

        _TBD = Tbd(tbdToken);
        _BOND = IBondToken(bondToken);
        PARTITION = partition;
        BOND_TOKEN = bondToken;
    }

    /**
     * @dev submit buy: caller must have SUBMIT_ORDER_ROLE
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function buy(address secContrAddr, uint256 amount, uint256 price, address bondReceiver, address cashPayer)
        external
        nonReentrant
        onlyRole(Roles.SUBMIT_ORDER_ROLE)
        returns (bytes32)
    {
        if (secContrAddr != BOND_TOKEN) revert Errors.SecurityMismatch();
        if (amount == 0) revert Errors.InvalidAmount();
        if (price == 0) revert Errors.InvalidPrice();
        if (bondReceiver == address(0)) revert Errors.InvalidRecipient();
        if (cashPayer == address(0)) revert Errors.InvalidHolder(cashPayer);

        bytes32 orderId = _generateOrderId();
        Order memory buyOrder = Order({
            id: orderId,
            broker: msg.sender,
            investorSecAddr: bondReceiver,
            secContrAddr: BOND_TOKEN,
            amount: amount,
            price: price,
            investorTbdAddr: cashPayer,
            tbdContrAddr: address(_TBD),
            isBuySide: true,
            next: bytes32(0),
            prev: bytes32(0)
        });

        emit OrderSubmitted(orderId, true, amount, price, bondReceiver, cashPayer);

        (bool settled, uint256 remaining) = _settleBuy(buyOrder);

        if (!settled) {
            buyOrder.amount = remaining;
            orders[orderId] = buyOrder;
            _appendToBuyLevel(orderId, price);
        }

        return orderId;
    }

    /**
     * @notice Revoke a buy order
     */
    function revokeBuyOrder(bytes32 orderId) external nonReentrant returns (bool) {
        Order storage order = orders[orderId];
        if (order.id == bytes32(0) || !order.isBuySide) revert Errors.OrderNotFound();
        if (order.broker != msg.sender) revert Errors.UnauthorizedBroker();
        _removeOrderFromLevel(orderId);
        delete orders[orderId];
        emit OrderRevoked(orderId);
        return true;
    }

    /**
     * @notice Revoke a sell order
     */
    function revokeSellOrder(bytes32 orderId) external nonReentrant returns (bool) {
        Order storage order = orders[orderId];
        if (order.id == bytes32(0) || order.isBuySide) revert Errors.OrderNotFound();
        if (order.broker != msg.sender) revert Errors.UnauthorizedBroker();
        _removeOrderFromLevel(orderId);
        delete orders[orderId];
        emit OrderRevoked(orderId);
        return true;
    }

    /**
     * @notice Initialize sell orders (1-unit each) for issuance bootstrap
     */
    function initializeSellOrders(
        uint256 numIssuance,
        uint256 price,
        address secContrAddr,
        address tbdContrAddr,
        address investorSecAddr,
        address investorTbdAddr
    ) external nonReentrant onlyRole(Roles.ORDER_ADMIN_ROLE) returns (bool) {
        if (price == 0) revert Errors.InvalidPrice();
        if (secContrAddr != BOND_TOKEN) revert Errors.SecurityMismatch();
        if (tbdContrAddr != address(_TBD)) revert Errors.SecurityMismatch();
        for (uint256 i = 0; i < numIssuance; i++) {
            bytes32 orderId = _generateOrderId();
            Order memory sellOrder = Order({
                id: orderId,
                broker: address(0x0),
                investorSecAddr: investorSecAddr,
                secContrAddr: BOND_TOKEN,
                amount: 1,
                price: price,
                investorTbdAddr: investorTbdAddr,
                tbdContrAddr: address(_TBD),
                isBuySide: false,
                next: bytes32(0),
                prev: bytes32(0)
            });
            orders[orderId] = sellOrder;
            _appendToSellLevel(orderId, price);
        }
        return true;
    }

    /**
     * @notice Get buy orders for caller broker
     */
    function getBuyOrders() external view returns (Order[] memory) {
        return _fetchOrders(true, msg.sender, address(0));
    }

    /**
     * @notice Get sell orders for caller broker
     */
    function getSellOrders() external view returns (Order[] memory) {
        return _fetchOrders(false, msg.sender, address(0));
    }

    /**
     * @notice Get buy orders filtered by investor
     */
    function getBuyOrders(address investorSecAddr) external view returns (Order[] memory) {
        return _fetchOrders(true, msg.sender, investorSecAddr);
    }

    /**
     * @notice Get sell orders filtered by investor
     */
    function getSellOrders(address investorSecAddr) external view returns (Order[] memory) {
        return _fetchOrders(false, msg.sender, investorSecAddr);
    }

    /**
     * @notice Get all buy orders (no broker/investor filter)
     */
    function getAllBuyOrders() external view returns (Order[] memory) {
        return _fetchOrders(true, address(0), address(0));
    }

    /**
     * @notice Get all sell orders (no broker/investor filter)
     */
    function getAllSellOrders() external view returns (Order[] memory) {
        return _fetchOrders(false, address(0), address(0));
    }

    /**
     * @dev submit sell: caller must have SUBMIT_ORDER_ROLE
     */
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function sell(address secContrAddr, uint256 amount, uint256 price, address bondSeller, address cashReceiver)
        external
        nonReentrant
        onlyRole(Roles.SUBMIT_ORDER_ROLE)
        returns (bytes32)
    {
        if (secContrAddr != BOND_TOKEN) revert Errors.SecurityMismatch();
        if (amount == 0) revert Errors.InvalidAmount();
        if (price == 0) revert Errors.InvalidPrice();
        if (bondSeller == address(0)) revert Errors.InvalidHolder(bondSeller);
        if (cashReceiver == address(0)) revert Errors.InvalidRecipient();

        bytes32 orderId = _generateOrderId();
        Order memory sellOrder = Order({
            id: orderId,
            broker: msg.sender,
            investorSecAddr: bondSeller,
            secContrAddr: BOND_TOKEN,
            amount: amount,
            price: price,
            investorTbdAddr: cashReceiver,
            tbdContrAddr: address(_TBD),
            isBuySide: false,
            next: bytes32(0),
            prev: bytes32(0)
        });

        emit OrderSubmitted(orderId, false, amount, price, bondSeller, cashReceiver);

        (bool settled, uint256 remaining) = _settleSell(sellOrder);

        if (!settled) {
            sellOrder.amount = remaining;
            orders[orderId] = sellOrder;
            _appendToSellLevel(orderId, price);
        }

        return orderId;
    }

    function revoke(bytes32 orderId) external nonReentrant returns (bool) {
        Order storage order = orders[orderId];
        if (order.id == bytes32(0)) revert Errors.OrderNotFound();
        if (order.broker != msg.sender) revert Errors.UnauthorizedBroker();
        _removeOrderFromLevel(orderId);
        delete orders[orderId];
        emit OrderRevoked(orderId);
        return true;
    }

    // -------- Matching ----------
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function _settleBuy(Order memory buyOrder) internal returns (bool settled, uint256 remaining) {
        remaining = buyOrder.amount;
        bytes32 matchedOrderId = bytes32(0);

        while (remaining > 0) {
            uint256 currentPrice = bestAskPrice;
            if (currentPrice == 0 || currentPrice > buyOrder.price) break;

            bytes32 orderId = sellLevels[currentPrice].head;
            while (orderId != bytes32(0) && remaining > 0) {
                Order storage sellOrder = orders[orderId];
                bytes32 nextOrder = sellOrder.next;

                uint256 tradeAmount = remaining < sellOrder.amount ? remaining : sellOrder.amount;
                uint256 settlementValue = tradeAmount * sellOrder.price; // maker price

                emit OrderMatched(orderId);

                (bool success, FailureReason reason) = _dvpsettle(
                    sellOrder.investorSecAddr,
                    buyOrder.investorSecAddr,
                    tradeAmount,
                    buyOrder.investorTbdAddr,
                    sellOrder.investorTbdAddr,
                    settlementValue
                );

                if (success) {
                    remaining -= tradeAmount;
                    buyOrder.amount = remaining;
                    sellOrder.amount -= tradeAmount;
                    sellLevels[sellOrder.price].volume -= tradeAmount;
                    matchedOrderId = orderId;
                    if (sellOrder.amount == 0) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                } else {
                    emit DVPFailed(orderId, reason);
                    if (reason == FailureReason.Buyer) {
                        return (false, remaining);
                    }
                    if (reason == FailureReason.Seller) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                }
                orderId = nextOrder;
            }
        }
        settled = remaining == 0;
        if (settled) emit DVPSuccess(matchedOrderId);
    }

    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function _settleSell(Order memory sellOrder) internal returns (bool settled, uint256 remaining) {
        remaining = sellOrder.amount;
        bytes32 matchedOrderId = bytes32(0);

        while (remaining > 0) {
            uint256 currentPrice = bestBidPrice;
            if (currentPrice == 0 || currentPrice < sellOrder.price) break;

            bytes32 orderId = buyLevels[currentPrice].head;
            while (orderId != bytes32(0) && remaining > 0) {
                Order storage buyOrder = orders[orderId];
                bytes32 nextOrder = buyOrder.next;

                uint256 tradeAmount = remaining < buyOrder.amount ? remaining : buyOrder.amount;
                uint256 settlementValue = tradeAmount * buyOrder.price; // maker price

                emit OrderMatched(orderId);

                // slither-disable-next-line reentrancy-vulnerabilities
                (bool success, FailureReason reason) = _dvpsettle(
                    sellOrder.investorSecAddr,
                    buyOrder.investorSecAddr,
                    tradeAmount,
                    buyOrder.investorTbdAddr,
                    sellOrder.investorTbdAddr,
                    settlementValue
                );

                if (success) {
                    remaining -= tradeAmount;
                    sellOrder.amount = remaining;
                    buyOrder.amount -= tradeAmount;
                    buyLevels[buyOrder.price].volume -= tradeAmount;
                    matchedOrderId = orderId;
                    if (buyOrder.amount == 0) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                } else {
                    emit DVPFailed(orderId, reason);
                    if (reason == FailureReason.Seller) {
                        return (false, remaining);
                    }
                    if (reason == FailureReason.Buyer) {
                        _removeOrderFromLevel(orderId);
                        delete orders[orderId];
                    }
                }
                orderId = nextOrder;
            }
        }
        settled = remaining == 0;
        if (settled) emit DVPSuccess(matchedOrderId);
    }

    /**
     * @dev Executes both legs atomically; reverts on unexpected errors.
     */
    function _dvpsettle(
        address sellerBondHolder,
        address buyerBondHolder,
        uint256 units,
        address cashPayer,
        address cashPayee,
        uint256 cashAmount
    ) internal returns (bool, FailureReason) {
        // Security leg
        // slither-disable-next-line reentrancy-vulnerabilities
        try _BOND.operatorTransferByPartition(PARTITION, sellerBondHolder, buyerBondHolder, units, "", "") returns (
            bytes32 partitionReturned
        ) {
            if (partitionReturned != PARTITION) {
                return (false, FailureReason.Seller);
            }
        } catch {
            return (false, FailureReason.Seller);
        }

        // Cash leg
        // slither-disable-next-line reentrancy-vulnerabilities
        try this._safeTransferFrom(cashPayer, cashPayee, cashAmount) {
            return (true, FailureReason.Unknown);
        } catch {
            return (false, FailureReason.Buyer);
        }
    }

    /**
     * @dev helper to use try/catch with SafeERC20
     */
    function _safeTransferFrom(address from, address to, uint256 amount) external {
        IERC20(address(_TBD)).safeTransferFrom(from, to, amount);
    }

    // -------- Order book list management (mirrors csd OrderBook logic) ----------

    function _generateOrderId() internal returns (bytes32) {
        _orderIdNonce++;
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encodePacked(block.number, _orderIdNonce, address(this)));
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
        PriceLevel storage level = order.isBuySide ? buyLevels[order.price] : sellLevels[order.price];

        if (order.amount > 0 && level.volume >= order.amount) {
            level.volume -= order.amount;
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

    function _fetchOrders(bool isBuySide, address broker, address investor) internal view returns (Order[] memory) {
        uint256 count = 0;
        uint256 currentPrice = isBuySide ? bestBidPrice : bestAskPrice;
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
}
