// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {BondOrderBook} from "@norges-bank/BondOrderBook.sol";

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondOrderBookFactory
 * @notice Deploys one BondOrderBook per (bondToken, partition) pair using CREATE2 for determinism.
 */
contract BondOrderBookFactory is AccessControl {
    /**
     * @notice Address of the Tbd contract (cash leg)
     */
    address public immutable TBD;
    /**
     * @notice Admin for deployed order books
     */
    address public immutable ADMIN;

    /**
     * @dev key = keccak256(abi.encode(bondToken, partition))
     */
    mapping(bytes32 => address) public getOrderBook;
    address[] public allOrderBooks;

    event BondOrderBookCreated(address indexed bondToken, bytes32 indexed partition, address indexed orderBook);

    constructor(address _admin, address _tbd) {
        if (_admin == address(0)) revert Errors.AdminAddressZero();
        if (_tbd == address(0)) revert Errors.TbdAddressZero();
        ADMIN = _admin;
        TBD = _tbd;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(Roles.ORDER_ADMIN_ROLE, _admin);
    }

    function allOrderBooksLength() external view returns (uint256) {
        return allOrderBooks.length;
    }

    /**
     * @notice Deploy a bond order book for a specific bond partition.
     * @param bondToken Address of the BondToken (ERC1410) contract.
     * @param partition Partition (ISIN) identifier.
     * @return orderBook deployed address.
     */
    function createBondOrderBook(address bondToken, bytes32 partition)
        external
        onlyRole(Roles.ORDER_ADMIN_ROLE)
        returns (address orderBook)
    {
        if (bondToken == address(0)) revert Errors.BondTokenAddressZero();
        if (partition == bytes32(0)) revert Errors.PartitionZero();

        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 salt = keccak256(abi.encode(bondToken, partition));
        orderBook = getOrderBook[salt];
        if (orderBook != address(0)) revert Errors.DuplicateOrderBook(bondToken);

        bytes memory bytecode =
            abi.encodePacked(type(BondOrderBook).creationCode, abi.encode(ADMIN, TBD, bondToken, partition));

        assembly {
            orderBook := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        if (orderBook == address(0)) revert Errors.OrderBookAddressZero();

        getOrderBook[salt] = orderBook;
        allOrderBooks.push(orderBook);

        emit BondOrderBookCreated(bondToken, partition, orderBook);
    }

    /**
     * @notice Precompute the order book address for (bondToken, partition).
     */
    function computeBondOrderBookAddress(address bondToken, bytes32 partition) external view returns (address) {
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 key = keccak256(abi.encode(bondToken, partition));
        bytes memory bytecode =
            abi.encodePacked(type(BondOrderBook).creationCode, abi.encode(ADMIN, TBD, bondToken, partition));
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), key, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }
}
