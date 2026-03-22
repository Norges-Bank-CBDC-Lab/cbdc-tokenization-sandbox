// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IERC1410} from "./IERC1410.sol";
import {Errors} from "@common/Errors.sol";

/**
 * @title ERC1410Minimal
 * @notice Minimal, opinionated ERC1410 implementation for reference and testing.
 * @dev Uses the EIP-1410 partitioned balance model with owner-controlled minting/burning.
 */
contract ERC1410Minimal is IERC1410, ERC165 {
    string public name;
    string public symbol;
    uint8 public constant DECIMALS = 18;
    uint256 private immutable _GRANULARITY;

    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    mapping(bytes32 => uint256) private _totalSupplyByPartition;
    mapping(address => bytes32[]) private _partitionsOf;
    mapping(address => mapping(bytes32 => uint256)) private _partitionIndex; // 1-based index in _partitionsOf
    mapping(address => mapping(bytes32 => uint256)) private _balanceOfByPartition;
    bytes32[] private _totalPartitions;
    mapping(bytes32 => uint256) private _totalPartitionIndex; // 1-based index in _totalPartitions
    address[] internal _controllers;
    mapping(address => bool) internal _isController;

    mapping(address => mapping(address => bool)) private _authorizedOperators;
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _authorizedOperatorsByPartition;

    bytes32 public constant DEFAULT_PARTITION = bytes32(0);

    constructor(string memory tokenName, string memory tokenSymbol, uint256 tokenGranularity) {
        name = tokenName;
        symbol = tokenSymbol;

        if (tokenGranularity < 1) revert Errors.InvalidGranularity(); /* Constructor Blocked - Token granularity can not be lower than 1 */
        _GRANULARITY = tokenGranularity;
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Minimum transferable unit for the token.
     * @return granularityValue Granularity value (must be a divisor of all transfers).
     */
    function granularity() external view returns (uint256 granularityValue) {
        return _GRANULARITY;
    }

    /**
     * @notice Decimals used for display purposes.
     * @return decimalsValue Number of decimals.
     */
    function decimals() public pure returns (uint8 decimalsValue) {
        return DECIMALS;
    }

    /**
     * @inheritdoc IERC165
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC1410).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @notice Get total balance for a holder across all partitions.
     * @param tokenHolder Address being queried.
     * @return balance Combined balance across partitions.
     */
    function balanceOf(address tokenHolder) public view override returns (uint256 balance) {
        return _balances[tokenHolder];
    }

    /**
     * @notice Balance of a holder within a specific partition.
     * @param partition Target partition identifier.
     * @param tokenHolder Address being queried.
     * @return balance Partition-specific balance.
     */
    function balanceOfByPartition(bytes32 partition, address tokenHolder)
        public
        view
        override
        returns (uint256 balance)
    {
        return _balanceOfByPartition[tokenHolder][partition];
    }

    /**
     * @notice Enumerate partitions held by an address.
     * @param tokenHolder Address being queried.
     * @return partitions List of partition identifiers.
     */
    function partitionsOf(address tokenHolder) public view override returns (bytes32[] memory partitions) {
        return _partitionsOf[tokenHolder];
    }

    /**
     * @inheritdoc IERC1410
     */
    function totalSupply() public view override returns (uint256 supply) {
        return _totalSupply;
    }

    /**
     * @notice Total supply for a given partition.
     * @param partition Partition identifier.
     * @return supply Partition total supply.
     */
    function totalSupplyByPartition(bytes32 partition) external view returns (uint256 supply) {
        return _totalSupplyByPartition[partition];
    }

    function _totalSupplyOfPartition(bytes32 partition) internal view returns (uint256) {
        return _totalSupplyByPartition[partition];
    }

    /**
     * @notice All partitions that currently have non-zero supply.
     * @return partitions List of active partitions.
     */
    function totalPartitions() external view returns (bytes32[] memory partitions) {
        return _totalPartitions;
    }

    /**
     * @notice Current controller addresses.
     * @return controllerList Array of controllers.
     */
    function controllers() external view returns (address[] memory controllerList) {
        return _controllers;
    }

    /**
     * @notice Check if an address is a controller.
     * @param operator Address being checked.
     * @return isCtrl True if operator is a controller.
     */
    function isController(address operator) public view returns (bool isCtrl) {
        return _isController[operator];
    }

    /**
     * @inheritdoc IERC1410
     */
    function isOperator(address operator, address tokenHolder) public view override returns (bool) {
        return operator == tokenHolder || _authorizedOperators[tokenHolder][operator] || _isController[operator];
    }

    /**
     * @inheritdoc IERC1410
     */
    function isOperatorForPartition(bytes32 partition, address operator, address tokenHolder)
        public
        view
        override
        returns (bool)
    {
        return isOperator(operator, tokenHolder) || _authorizedOperatorsByPartition[tokenHolder][partition][operator];
    }

    /*//////////////////////////////////////////////////////////////
                          HOLDER / OPERATOR LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Transfer value from the caller out of a partition.
     * @dev If `data` is 32 bytes long, it is treated as the destination partition.
     */
    function transferByPartition(bytes32 partition, address to, uint256 value, bytes calldata data)
        external
        override
        returns (bytes32)
    {
        return _transferByPartition(partition, partition, msg.sender, msg.sender, to, value, data, "");
    }

    /**
     * @notice Operator transfer respecting global and partition-level approvals.
     */
    function operatorTransferByPartition(
        bytes32 partition,
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata operatorData
    ) external override returns (bytes32) {
        if (!isOperatorForPartition(partition, msg.sender, from)) revert Errors.UnauthorizedOperator();

        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 toPartition = data.length >= 32 ? bytes32(data) : partition;
        return _transferByPartition(partition, toPartition, msg.sender, from, to, value, data, operatorData);
    }

    /**
     * @notice Authorize an operator for all partitions of the caller.
     * @param operator Address to authorize.
     */
    function authorizeOperator(address operator) external override {
        _authorizedOperators[msg.sender][operator] = true;
        emit AuthorizedOperator(operator, msg.sender);
    }

    /**
     * @notice Revoke operator access for all partitions of the caller.
     * @param operator Address to revoke.
     */
    function revokeOperator(address operator) external override {
        _authorizedOperators[msg.sender][operator] = false;
        emit RevokedOperator(operator, msg.sender);
    }

    /**
     * @notice Authorize an operator for a specific partition.
     * @param partition Partition identifier.
     * @param operator Address to authorize.
     */
    function authorizeOperatorByPartition(bytes32 partition, address operator) external override {
        _authorizedOperatorsByPartition[msg.sender][partition][operator] = true;
        emit AuthorizedOperatorByPartition(partition, operator, msg.sender);
    }

    /**
     * @notice Revoke operator access for a specific partition.
     * @param partition Partition identifier.
     * @param operator Address to revoke.
     */
    function revokeOperatorByPartition(bytes32 partition, address operator) external override {
        _authorizedOperatorsByPartition[msg.sender][partition][operator] = false;
        emit RevokedOperatorByPartition(partition, operator, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    function _transferByPartition(
        bytes32 fromPartition,
        bytes32 toPartition,
        address operator,
        address from,
        address to,
        uint256 value,
        bytes memory data,
        bytes memory operatorData
    ) internal returns (bytes32) {
        if (to == address(0)) revert Errors.InvalidRecipient();

        _move(fromPartition, toPartition, from, to, value);

        emit TransferByPartition(fromPartition, operator, from, to, value, data, operatorData);
        if (fromPartition != toPartition) {
            emit ChangedPartition(fromPartition, toPartition, value);
        }

        return toPartition;
    }

    function _move(bytes32 fromPartition, bytes32 toPartition, address from, address to, uint256 value) internal {
        _enforceGranularity(value);
        if (_balances[from] < value) revert Errors.InsufficientBalance();
        if (_balanceOfByPartition[from][fromPartition] < value) revert Errors.InsufficientPartitionBalance();

        if (from != to) {
            _balances[from] -= value;
            _balances[to] += value;
        }

        if (fromPartition == toPartition && from == to) {
            return;
        }

        _balanceOfByPartition[from][fromPartition] -= value;
        _totalSupplyByPartition[fromPartition] -= value;
        if (_balanceOfByPartition[from][fromPartition] == 0) {
            _removePartition(from, fromPartition);
        }

        _balanceOfByPartition[to][toPartition] += value;
        _totalSupplyByPartition[toPartition] += value;
        _addPartition(to, toPartition);
        _trackPartition(toPartition);
        if (_totalSupplyByPartition[fromPartition] == 0 && fromPartition != toPartition) {
            _untrackPartition(fromPartition);
        }
    }

    function _mint(
        bytes32 partition,
        address to,
        uint256 value,
        address operator,
        bytes memory data,
        bytes memory operatorData
    ) internal {
        if (to == address(0)) revert Errors.InvalidRecipient();
        if (value == 0) revert Errors.InvalidAmount();
        _enforceGranularity(value);

        _totalSupply += value;
        _balances[to] += value;
        _balanceOfByPartition[to][partition] += value;
        _totalSupplyByPartition[partition] += value;
        _addPartition(to, partition);
        _trackPartition(partition);

        emit TransferByPartition(partition, operator, address(0), to, value, data, operatorData);
    }

    function _mint(bytes32 partition, address to, uint256 value) internal {
        _mint(partition, to, value, msg.sender, "", "");
    }

    function _burn(
        bytes32 partition,
        address from,
        uint256 value,
        address operator,
        bytes memory data,
        bytes memory operatorData
    ) internal {
        if (from == address(0)) revert Errors.InvalidHolder(from);
        if (value == 0) revert Errors.InvalidAmount();
        _enforceGranularity(value);
        if (_balanceOfByPartition[from][partition] < value) revert Errors.InsufficientPartitionBalance();

        _totalSupply -= value;
        _balances[from] -= value;
        _balanceOfByPartition[from][partition] -= value;
        _totalSupplyByPartition[partition] -= value;
        if (_balanceOfByPartition[from][partition] == 0) {
            _removePartition(from, partition);
        }
        if (_totalSupplyByPartition[partition] == 0) {
            _untrackPartition(partition);
        }

        emit TransferByPartition(partition, operator, from, address(0), value, data, operatorData);
    }

    function _burn(bytes32 partition, address from, uint256 value) internal {
        _burn(partition, from, value, msg.sender, "", "");
    }

    function _issueByPartition(bytes32 partition, address operator, address to, uint256 value, bytes memory data)
        internal
    {
        _issueByPartition(partition, operator, to, value, data, "");
    }

    function _issueByPartition(
        bytes32 partition,
        address operator,
        address to,
        uint256 value,
        bytes memory data,
        bytes memory operatorData
    ) internal {
        _mint(partition, to, value, operator, data, operatorData);
    }

    function _redeemByPartition(bytes32 partition, address operator, address from, uint256 value, bytes memory data)
        internal
    {
        _redeemByPartition(partition, operator, from, value, data, "");
    }

    function _redeemByPartition(
        bytes32 partition,
        address operator,
        address from,
        uint256 value,
        bytes memory data,
        bytes memory operatorData
    ) internal {
        _burn(partition, from, value, operator, data, operatorData);
    }

    function _addPartition(address holder, bytes32 partition) internal {
        if (_balanceOfByPartition[holder][partition] == 0) {
            return;
        }

        if (_partitionIndex[holder][partition] == 0) {
            _partitionsOf[holder].push(partition);
            _partitionIndex[holder][partition] = _partitionsOf[holder].length;
        }
    }

    function _removePartition(address holder, bytes32 partition) internal {
        uint256 index = _partitionIndex[holder][partition];
        if (index == 0) {
            return;
        }

        uint256 lastIndex = _partitionsOf[holder].length;
        if (index != lastIndex) {
            bytes32 lastPartition = _partitionsOf[holder][lastIndex - 1];
            _partitionsOf[holder][index - 1] = lastPartition;
            _partitionIndex[holder][lastPartition] = index;
        }

        _partitionsOf[holder].pop();
        _partitionIndex[holder][partition] = 0;
    }

    function _initializePartition(bytes32 partition) internal {
        _trackPartition(partition);
    }

    function _trackPartition(bytes32 partition) internal {
        if (_totalPartitionIndex[partition] == 0) {
            _totalPartitions.push(partition);
            _totalPartitionIndex[partition] = _totalPartitions.length;
        }
    }

    function _untrackPartition(bytes32 partition) internal {
        if (_totalSupplyByPartition[partition] != 0) {
            return;
        }

        uint256 index = _totalPartitionIndex[partition];
        if (index == 0) {
            return;
        }

        uint256 lastIndex = _totalPartitions.length;
        if (index != lastIndex) {
            bytes32 lastPartition = _totalPartitions[lastIndex - 1];
            _totalPartitions[index - 1] = lastPartition;
            _totalPartitionIndex[lastPartition] = index;
        }

        _totalPartitions.pop();
        _totalPartitionIndex[partition] = 0;
    }

    function _setControllers(address[] memory controllers_) internal {
        for (uint256 i = 0; i < _controllers.length; i++) {
            _isController[_controllers[i]] = false;
        }
        delete _controllers;

        for (uint256 j = 0; j < controllers_.length; j++) {
            address controller = controllers_[j];
            if (controller == address(0)) revert Errors.ControllerZeroAddress();
            if (_isController[controller]) {
                continue;
            }
            _controllers.push(controller);
            _isController[controller] = true;
        }
    }

    function _enforceGranularity(uint256 value) internal view {
        if (!_isMultiple(value)) {
            revert Errors.NotMultipleOfGranularity();
        }
    }

    /**
     * @dev Check if 'value' is multiple of the granularity.
     * @param value The quantity that want's to be checked.
     * @return 'true' if 'value' is a multiple of the granularity.
     */
    function _isMultiple(uint256 value) internal view returns (bool) {
        return value % _GRANULARITY == 0;
    }
}
