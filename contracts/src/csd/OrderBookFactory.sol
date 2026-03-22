// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {OrderBook} from "@csd/OrderBook.sol";
import {Errors} from "@common/Errors.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title OrderBookFactory
 * @notice Factory contract for creating OrderBook instances for different securities.
 * @dev Uses CREATE2 for deterministic deployment addresses. Similar to UniswapV2Factory.
 *
 * One OrderBook per security: Since wNOK is the fixed quote currency, each security
 * (ISIN) gets exactly one OrderBook for trading that security against wNOK.
 * For example: wNOK:ISIN1 has one OrderBook, wNOK:ISIN2 has another OrderBook.
 *
 * The salt used for CREATE2 is the security contract address directly, ensuring
 * deterministic addresses and preventing duplicate order books for the same security.
 */
contract OrderBookFactory is AccessControl {
    /// @notice Address of the wNOK contract (fixed quote currency)
    address public immutable WNOK;
    /// @notice Address of the DvP contract
    address public immutable DVP;
    /// @notice Address of the admin who will manage deployed order books
    address public immutable ADMIN;

    /// @notice Mapping from security contract address to deployed OrderBook address
    mapping(address => address) public getOrderBook;
    /// @notice Array of all deployed security addresses (for enumeration)
    address[] public allSecurities;

    /**
     * @notice Emitted when a new OrderBook is created.
     * @param security The security contract address (indexed)
     * @param orderBook The deployed OrderBook address (indexed)
     */
    event OrderBookCreated(address indexed security, address indexed orderBook);

    /**
     * @notice Creates a new OrderBookFactory.
     * @param _admin The admin address for deployed OrderBooks.
     * @param _wnok The wNOK contract address (quote currency).
     * @param _dvp The DvP contract address.
     */
    constructor(address _admin, address _wnok, address _dvp) {
        if (_admin == address(0)) revert Errors.AdminAddressZero();
        if (_wnok == address(0)) revert Errors.WnokAddressZero();
        if (_dvp == address(0)) revert Errors.DvpAddressZero();

        ADMIN = _admin;
        WNOK = _wnok;
        DVP = _dvp;

        // Grant DEFAULT_ADMIN_ROLE and ORDER_ADMIN_ROLE to the admin
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(Roles.ORDER_ADMIN_ROLE, _admin);
    }

    /**
     * @notice Returns the total number of securities with deployed order books.
     * @return The number of deployed order books.
     */
    function allSecuritiesLength() external view returns (uint256) {
        return allSecurities.length;
    }

    /**
     * @notice Creates a new OrderBook for a security if it doesn't already exist.
     * @dev Uses CREATE2 for deterministic address calculation.
     * @dev Only callable by accounts with ORDER_ADMIN_ROLE.
     * @param security The security contract address.
     * @return orderBook The address of the deployed (or existing) OrderBook.
     */
    function createOrderBook(address security) external onlyRole(Roles.ORDER_ADMIN_ROLE) returns (address orderBook) {
        if (security == address(0)) revert Errors.SecurityAddressZero();

        // Check if order book already exists
        orderBook = getOrderBook[security];
        if (orderBook != address(0)) {
            revert Errors.DuplicateOrderBook(security);
        }

        // Get the bytecode for OrderBook with constructor arguments
        // The salt is just the security address to ensure one OrderBook per security (wNOK is fixed quote)
        bytes32 salt = bytes32(uint256(uint160(security)));

        bytes memory bytecode = abi.encodePacked(type(OrderBook).creationCode, abi.encode(ADMIN, WNOK, DVP, security));

        // Deploy using CREATE2
        assembly {
            orderBook := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }

        if (orderBook == address(0)) revert Errors.OrderBookAddressZero();

        // Store the deployment
        getOrderBook[security] = orderBook;
        allSecurities.push(security);

        emit OrderBookCreated(security, orderBook);
    }

    /**
     * @notice Computes the address where an OrderBook would be deployed for a given security.
     * @dev Uses CREATE2 address computation: keccak256(0xff ++ factoryAddress ++ salt ++ keccak256(bytecode))[12:]
     * @param security The security contract address.
     * @return The deterministic address where the OrderBook would be deployed.
     */
    function computeOrderBookAddress(address security) external view returns (address) {
        // Use security address directly as salt (padded to bytes32) to ensure deterministic address
        bytes32 salt = bytes32(uint256(uint160(security)));

        bytes memory bytecode = abi.encodePacked(type(OrderBook).creationCode, abi.encode(ADMIN, WNOK, DVP, security));
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Returns all security addresses that have deployed order books.
     * @return An array of security contract addresses.
     */
    function getAllSecurities() external view returns (address[] memory) {
        return allSecurities;
    }
}
