// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "@common/Errors.sol";

/**
 * @title GlobalRegistry
 * @notice A contract that holds addresses of important contracts on the network.
 * Allows the owner to register and update contract addresses
 * by name, and provides functions to retrieve these addresses.
 *
 * @dev !Intended for test environments and not for production use!
 * This contract should be published first on the newtwork and given a preknown address
 * When you deploy new versions of deployed contracts, remember to update the address here.
 * @custom:inheritance Ownable
 * @custom:events ContractAdded(string name, address newAddress), ContractUpdated(string name, address oldAddress, address newAddress)
 * @custom:custom-errors ContractNotFound(string contractAddress), InvalidContractAddress(address contractAddress)
 */
contract GlobalRegistry is Ownable {
    // Mapping of contract names to their addresses
    mapping(bytes32 => address) private registry;

    // Event for when a contract is registered or updated
    event ContractAdded(string name, address newAddress);
    event ContractUpdated(string name, address oldAddress, address newAddress);

    modifier validParams(address contractAddress) {
        _validParams(contractAddress);
        _;
    }

    function _validParams(address contractAddress) internal pure {
        if (contractAddress == address(0)) {
            revert Errors.InvalidContractAddress(contractAddress);
        }
    }

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Registers or updates a contract address in the registry, and emits events
     * @dev Only owner can call this function, and the address cann not be zero. The name set is hashed to create a unique key.
     * @param name The name of the contract to register or update.
     * @param contractAddress The address of the contract to register or update.
     * @custom:events ContractAdded(string name, address newAddress), ContractUpdated(string name, address oldAddress, address newAddress)
     * @custom:custom-errors InvalidContractAddress(address contractAddress)
     */
    function setContract(string calldata name, address contractAddress)
        external
        onlyOwner
        validParams(contractAddress)
    {
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 key = keccak256(abi.encodePacked(name));
        address current = registry[key];
        registry[key] = contractAddress;

        if (current == address(0)) {
            emit ContractAdded(name, contractAddress);
        } else {
            emit ContractUpdated(name, current, contractAddress);
        }
    }

    /**
     * @notice Retrieves the address of a contract by its name.
     * @dev This function will revert with a custom error if the contract is not found, so calling exists() is preferrable.
     * Use tryGetContract to avoid error handling.
     * The name provided is hashed to check in the registry.
     * @param name The name of the contract to retrieve.
     * @return contractAddress The address of the contract.
     * @custom:custom-errors ContractNotFound(string contractAddress)
     */
    function getContract(string calldata name) external view returns (address contractAddress) {
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 key = keccak256(abi.encodePacked(name));
        contractAddress = registry[key];
        if (contractAddress == address(0)) {
            revert Errors.ContractNotFound(name);
        }
    }

    /**
     * @notice Tries to retrieve the address of a contract by its name. Check returned boolean to see if the contract was found.
     * @dev This function will return a boolean indicating if the contract was found, and the address of the contract.
     * @param name The name of the contract to retrieve.
     * @return found A boolean indicating if the contract was found.
     * @return contractAddress The address of the contract, or address(0) if not found.
     */
    function tryGetContract(string calldata name) external view returns (bool found, address contractAddress) {
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 key = keccak256(abi.encodePacked(name));
        contractAddress = registry[key];
        found = contractAddress != address(0);
    }

    /**
     * @notice Checks if a contract exists in the registry by its name.
     * @dev This function will return a boolean indicating if the contract was found.
     * @param name The name of the contract to check.
     * @return exists A boolean indicating if the contract was found.
     */
    function exists(string calldata name) external view returns (bool) {
        // forge-lint: disable-next-line(asm-keccak256)
        bytes32 key = keccak256(abi.encodePacked(name));
        return registry[key] != address(0);
    }
}
