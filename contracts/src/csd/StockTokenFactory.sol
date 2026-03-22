// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {StockToken} from "@csd/StockToken.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title StockTokenFactory
 * @notice A factory contract for creating new instances of the StockToken contract, which also checks for unique ISINs.
 *
 * @dev This contract is used to create new instances of the StockToken contract.
 * It uses the OpenZeppelin Clones library to create minimal proxy contracts.
 * The factory ensures that each ISIN is unique and prevents the creation of duplicate tokens.
 * @custom:inheritance StockToken, OpenZeppelin Clones
 * @custom:events event StockTokenCreated(bytes32 indexed stockId, address token, string name, string symbol)
 * @custom:custom-errors StockTokenCloneFailed(string name, string symbol, address implementation), DuplicateStockToken(bytes32 stockId, string isin, address token)
 */
contract StockTokenFactory {
    // Custom errors (inline to avoid Slither IR parsing issues with library imports)
    error NotDeployer();
    error DeployerAddressZero();
    error ImplementationAddressZero();
    error StockTokenCloneFailed(string name, string symbol, address implementation);
    error DuplicateStockToken(string isin, address token);

    // slither-disable-next-line uninitialized-state
    address public immutable IMPLEMENTATION;
    // slither-disable-next-line uninitialized-state
    address public immutable DEPLOYER;
    //string public constant issuerName = "EuroNext";
    // slither-disable-next-line uninitialized-state
    mapping(bytes32 => address) private _deployedStockTokens;
    // slither-disable-next-line uninitialized-state
    string[] private _deployedStockTokenIsins; // Array to store ISIN keys

    /**
     * @notice Emitted when a new StockToken is successfully created/cloned.
     * @param stockId The unique identifier, indexed, for the stock, derived from the ISIN.
     * @param token The address, indexed, of the newly created StockToken contract.
     * @param name The name of the stock token.
     * @param symbol The symbol of the stock token.
     */
    event StockTokenCreated(bytes32 indexed stockId, address indexed token, string name, string symbol);

    modifier onlyDeployer() {
        _onlyDeployer();
        _;
    }

    /**
     * @dev Checks if the ISIN is unique (not already deployed).
     * @param isin The ISIN of the stock.
     * @custom:custom-errors DuplicateStockToken(string isin, address token)
     */
    modifier uniqueIsin(string memory isin) {
        _uniqueIsin(isin);
        _;
    }

    constructor(address _implementation, address _deployer) {
        if (_implementation == address(0)) revert ImplementationAddressZero();
        if (_deployer == address(0)) revert DeployerAddressZero();

        IMPLEMENTATION = _implementation;
        DEPLOYER = _deployer;
    }

    /**
     * @notice Creates a new instance of the StockToken contract with the specified parameters.
     * @dev This function uses the OpenZeppelin Clones library to create a minimal proxy contract, and checks for unique ISINs.
     * @param name The name of the stock token.
     * @param symbol The symbol of the stock token.
     * @param isin The ISIN code of the stock token.
     * @param initialSupply The initial supply of the stock token.
     * @param description A description of the stock token, keep this as simple as possible, and can reference a KIID.
     * @param issuerName The name of the issuer of the stock token.
     * @return token The address of the newly created StockToken contract.
     * @custom:events StockTokenCreated(bytes32 indexed stockId, address token, string name, string symbol)
     */
    function createStockToken(
        string memory name,
        string memory symbol,
        string memory isin,
        uint256 initialSupply,
        string memory description,
        string memory issuerName
    ) external onlyDeployer uniqueIsin(isin) returns (address token) {
        token = Clones.clone(IMPLEMENTATION);
        if (token == address(0)) {
            revert StockTokenCloneFailed(name, symbol, IMPLEMENTATION);
        }

        // Store the deployed token address in the mapping
        bytes32 stockId = getStockId(isin);
        _deployedStockTokens[stockId] = token;
        _deployedStockTokenIsins.push(isin); // Add ISIN key to the array

        emit StockTokenCreated(stockId, token, name, symbol);

        StockToken(token).initialize(name, symbol, isin, issuerName, DEPLOYER, initialSupply, description);
    }

    /**
     * @notice Returns the address of the deployed StockToken contract for a given ISIN, check boolean to see if it exists.
     * @dev If boolean is false, the token was not created by this factory or does not exist.
     * @param isin The ISIN of the stock.
     * @return token The address of the deployed StockToken contract.
     */
    function getDeployedStockToken(string memory isin) external view returns (bool, address) {
        address deployedContract = _deployedStockTokens[getStockId(isin)];
        return (deployedContract != address(0), deployedContract);
    }

    /**
     * @notice Returns all deployed StockToken ISINs.
     * @return deployedTokens The array with ISINs of all deployed StockToken contracts.
     */
    function getAllDeployedStockTokenIsins() external view returns (string[] memory) {
        return _deployedStockTokenIsins;
    }

    /**
     * @notice Use this to check if a stock token has been created for a given ISIN and by this factory contract.
     * @dev Only the factory contract can create stock tokens, which means that only stocks from this factory should be traded.
     * IMPORTANT: report to the CSD if a stock token is created by another factory.
     * @param isin The ISIN of the stock.
     * @return bool True if the stock token exists and created by this factory.
     */
    function isVerifiedStockToken(string memory isin) external view returns (bool) {
        bytes32 stockId = getStockId(isin);
        return _deployedStockTokens[stockId] != address(0);
    }

    /**
     * @dev Checks if the stockId already exists (have been previously created).
     * @param isin The ISIN of the stock.
     * @return stockId The hashed unique identifier for the stock.
     * @custom:custom-errors DuplicateStockToken(bytes32 stockID, string isin, address token)
     */
    function getStockId(string memory isin) private pure returns (bytes32 stockId) {
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encodePacked(isin));
    }

    function _onlyDeployer() internal view {
        if (msg.sender != DEPLOYER) revert NotDeployer();
    }

    function _uniqueIsin(string memory isin) internal view {
        bytes32 stockId = getStockId(isin);
        if (_deployedStockTokens[stockId] != address(0)) {
            revert DuplicateStockToken(isin, _deployedStockTokens[stockId]);
        }
    }
}
