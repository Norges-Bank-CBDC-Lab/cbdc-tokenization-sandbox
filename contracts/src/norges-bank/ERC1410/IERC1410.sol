// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @dev ERC1410 interface (Partially Fungible Token) as per EIP-1410.
 */
interface IERC1410 is IERC165 {
    event TransferByPartition(
        bytes32 indexed fromPartition,
        address operator,
        address from,
        address to,
        uint256 value,
        bytes data,
        bytes operatorData
    );
    event ChangedPartition(bytes32 indexed fromPartition, bytes32 indexed toPartition, uint256 value);
    event AuthorizedOperator(address indexed operator, address indexed tokenHolder);
    event RevokedOperator(address indexed operator, address indexed tokenHolder);
    event AuthorizedOperatorByPartition(
        bytes32 indexed partition, address indexed operator, address indexed tokenHolder
    );
    event RevokedOperatorByPartition(bytes32 indexed partition, address indexed operator, address indexed tokenHolder);

    function balanceOf(address tokenHolder) external view returns (uint256);

    function balanceOfByPartition(bytes32 partition, address tokenHolder) external view returns (uint256);

    function partitionsOf(address tokenHolder) external view returns (bytes32[] memory);

    function totalSupply() external view returns (uint256);

    function transferByPartition(bytes32 partition, address to, uint256 value, bytes calldata data)
        external
        returns (bytes32);

    function operatorTransferByPartition(
        bytes32 partition,
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata operatorData
    ) external returns (bytes32);

    function isOperator(address operator, address tokenHolder) external view returns (bool);

    function isOperatorForPartition(bytes32 partition, address operator, address tokenHolder)
        external
        view
        returns (bool);

    function authorizeOperator(address operator) external;

    function revokeOperator(address operator) external;

    function authorizeOperatorByPartition(bytes32 partition, address operator) external;

    function revokeOperatorByPartition(bytes32 partition, address operator) external;

    function totalSupplyByPartition(bytes32 partition) external view returns (uint256);
}
