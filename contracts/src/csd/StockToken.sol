// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

// Import all contracts and inheritances from BaseSecurityToken
import {BaseSecurityToken} from "@csd/BaseSecurityToken.sol";

/**
 * @title StockToken
 * @notice A contract for stocks that can be traded on a CSD (Central Securities Depository).
 *
 * @dev A contract for a stock token that inherits from BaseSecurityToken.
 * This contract includes additional properties specific to stock tokens.
 * Deploy this contract with the StockFactory, and check BaseSecruityToken for events and custom errors.
 * @custom:inheritance BaseSecurityToken
 */
contract StockToken is BaseSecurityToken {
    string public securityIsin;
    string public securityIssuerName;

    event StockIssued(address indexed to, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Constructor for the StockToken contract, and will call on BaseSecurityToken constructor.
     * After initialization, the contract mints the initial supply of tokens to the initial owner.
     * @param tokenName The name of the stock token.
     * @param ticker The ticker symbol of the stock token.
     * @param isin The ISIN code of the stock token.
     * @param issuerName The name of the issuer of the stock token.
     * @param initialOwner The initial owner of the stock token.
     * @param initialSupply The initial supply of the stock token.
     * @param description A description of the stock token, keep this as simple as possible, and can reference a KIID.
     */
    function initialize(
        string memory tokenName,
        string memory ticker,
        string memory isin,
        string memory issuerName,
        address initialOwner,
        uint256 initialSupply,
        string memory description
    ) public initializer {
        baseSecurityInit(tokenName, ticker, description, initialOwner);

        securityIsin = isin;
        securityIssuerName = issuerName;

        _mint(initialOwner, initialSupply);
        emit StockIssued(initialOwner, initialSupply);
    }

    /**
     * @notice Will always return "Stock" as the security type.
     * @dev Function to get the security type of the token, which is "Stock" in this implementation
     * @return A string representing the security type.
     * @inheritdoc BaseSecurityToken
     */
    function securityType() external pure override returns (string memory) {
        return "Stock";
    }
}
