// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {AllowlistUpgradeable} from "@common/AllowlistUpgradeable.sol";
import {Errors} from "@common/Errors.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BaseSecurityToken
 * @notice All security tokens must inherit from this contract in order to be compliant in CSD setup.
 * This contract provides basic functionality for custodial transfers and role management.
 * CSD_ROLE, SECURITY_OPERATOR_ROLE, and DEFAULT_ADMIN_ROLE are the three roles implemented.
 * This is initializable and intended to be used with OpenZeppelin's upgradeable contracts.
 *
 * @custom:custom-errors NotApprovedOperator(address caller),InvalidRole(bytes32 role)
 * @custom:events event CustodialTransferred(address indexed from,address indexed to,uint256 amount)
 * @custom:inheritance ERC20Upgradeable, AccessControlUpgradeable
 * @dev !Intended for test environments and not for production use!
 * Each category of securities (stocks, bonds, etc.) should inherit from this contract.
 */
abstract contract BaseSecurityToken is Initializable, ERC20Upgradeable, AccessControlUpgradeable, AllowlistUpgradeable {
    // #region variables
    string public securityDescription;
    // #endregion

    // #region events
    /**
     * @notice Emitted when a custodial transfer is made.
     * @param from The address, indexed, from which the tokens are transferred.
     * @param to The address, indexed, to which the tokens are transferred.
     * @param amount The amount of tokens transferred.
     */
    event CustodialTransferred(address indexed from, address indexed to, uint256 amount);
    // #endregion

    // #region errors

    /**
     * @notice Error to indicate that an invalid role was provided.
     * @dev This error is used in the onlyKnownRoles modifier to ensure only valid roles are processed.
     * @param role hashed role name
     */
    error InvalidRole(bytes32 role);

    /**
     * @notice Error to indicate that the caller is not an approved operator.
     * @dev This error is used in the onlyOperator modifier to ensure that only approved operators can call certain functions.
     * @param caller The address of the caller who triggered the error.
     */
    error NotApprovedOperator(address caller);

    // #endregion

    // #region Modifiers

    /**
     * @notice Modifier to check if the caller has the SECURITY_OPERATOR_ROLE.
     * @dev This modifier is used to restrict access to certain functions to only those with the SECURITY_OPERATOR_ROLE.
     * @custom:error NotApprovedOperator if the caller does not have the SECURITY_OPERATOR_ROLE
     */
    modifier onlyOperator() {
        _onlyOperator();
        _;
    }

    /**
     * @notice Modifier to check if the role is one of the known roles (CSD_ROLE or SECURITY_OPERATOR_ROLE).
     * @dev This modifier is used to restrict access to certain functions to only those with the known roles.
     * @param role The role to check.
     * @custom:error InvalidRole if the role is not one of the known roles
     */
    modifier onlyKnownRoles(bytes32 role) {
        _onlyKnownRoles(role);
        _;
    }

    /**
     * @notice Modifier to check if the caller has the DEFAULT_ADMIN_ROLE.
     * @dev This modifier is used to restrict access to certain functions to only those with the DEFAULT_ADMIN_ROLE.
     * @custom:error NotAdmin if the caller does not have the DEFAULT_ADMIN_ROLE
     */
    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    function _onlyOperator() internal view {
        if (!hasRole(Roles.SECURITY_OPERATOR_ROLE, msg.sender)) {
            revert NotApprovedOperator(msg.sender);
        }
    }

    function _onlyKnownRoles(bytes32 role) internal pure {
        if (!(role == Roles.CUSTODIAL_TRANSFER_ROLE || role == Roles.SECURITY_OPERATOR_ROLE)) {
            revert InvalidRole(role);
        }
    }

    function _onlyAdmin() internal view {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Errors.NotAdmin();
        }
    }

    // #endregion

    // region constructor
    /**
     * @notice Constructor for the BaseSecurityToken contract.
     * @dev This constructor is used to disable the initializers and prevent the contract from being initialized multiple times.
     * It is called only once when the contract is deployed.
     */
    constructor() {
        _disableInitializers();
    }

    // endregion

    // region initializer
    /**
     * @notice Initialize the contract with the name, symbol, and initial owner.
     * @dev This function is called only once when the contract is deployed.
     * This will call the ERC20 and Ownable initializers and grant the roles to the initial owner.
     * @param tokenName The name of the token.
     * @param tokenSymbol The symbol of the token.
     * @param initialOwner The address of the initial owner of the token.
     * @param description A description of the security token, keep this as simple as possible, and can reference a KIID.
     */
    function baseSecurityInit(
        string memory tokenName,
        string memory tokenSymbol,
        string memory description,
        address initialOwner
    ) internal onlyInitializing {
        __ERC20_init(tokenName, tokenSymbol);
        __AccessControl_init();
        __Allowlist_initAndAddOwnerToAllowlist(initialOwner);
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(Roles.SECURITY_OPERATOR_ROLE, initialOwner);
        securityDescription = description;
    }

    // endregion

    // region functions

    /**
     * @notice Transfer security tokens from any account without permission from users.
     * Only preapproved CSDs can perform this action
     * @dev Uses ERC20._transfer function to transfer tokens after validating role permissions from caller.
     * @param from The address to transfer tokens from.
     * @param to The address to transfer tokens to.
     * @param amount The amount of tokens to transfer.
     * @custom:event CustodialTransferred(from, to, amount)
     */
    function custodialTransfer(address from, address to, uint256 amount)
        external
        onlyRole(Roles.CUSTODIAL_TRANSFER_ROLE)
        returns (bool)
    {
        ERC20Upgradeable._transfer(from, to, amount);
        emit CustodialTransferred(from, to, amount);
        return true;
    }

    // Simple function which the SECURITY_OPERATOR can only perform to set role to anyone
    /**
     * @notice Grant a role to an account, and only the SECURITY_OPERATOR can perform this action.
     * @dev Function to grant a role to an account and uses AccessControl's _grantRole function after verifying the caller role.
     * @param role The role to grant. Valid roles are CSD_ROLE and SECURITY_OPERATOR_ROLE.
     * @custom:error InvalidRole if you try to grant a role that is not listed in the role parameter
     * @param account The address of the account to grant the role to.
     */
    function grantRoleTo(bytes32 role, address account) external onlyOperator onlyKnownRoles(role) {
        _grantRole(role, account);
    }

    /**
     * @notice Revoke a role from an account, and only the SECURITY_OPERATOR can perform this action.
     * @dev Function to revoke a role from an account and uses AccessControl's _revokeRole function after verifying the caller role.
     * @param role The role to revoke. Valid roles are CSD_ROLE and SECURITY_OPERATOR_ROLE.
     * @custom:error InvalidRole if you try to revoke a role that is not listed in the role parameter
     * @param account The address of the account to revoke the role from.
     */
    function revokeRoleFrom(bytes32 role, address account) external onlyOperator onlyKnownRoles(role) {
        _revokeRole(role, account);
    }

    /**
     * @notice Function to get the security type of the token
     * @dev Function to get the security type of the token, implement this in the derived contract.
     * @return A string representing the security type.
     */
    function securityType() external view virtual returns (string memory);

    /**
     * @notice Function to check if an address is a CSD approved operator.
     * @dev You can use this function to check if an address is a CSD approved operator before calling custodialTransfer.
     * Reverting is very costly, so please verify before calling custodialTransfer.
     * @param csd The address to check.
     * @return A boolean indicating whether the address is a CSD approved operator.
     */
    // forge-lint: disable-next-line(mixed-case-function)
    function isCSDApproved(address csd) public view virtual returns (bool) {
        return hasRole(Roles.CUSTODIAL_TRANSFER_ROLE, csd);
    }

    /**
     * @dev Overwritten default transfer function to include also an allowlist check.
     *      Alternatively mints (or burns) if from (or to) is the zero address
     * @param from Account from which to transfer the tokens
     * @param to Account to which to transfer the tokens
     * @param amount Amount to transfer in token units
     */
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && !allowlistQueryInternal(from)) {
            revert Errors.AllowlistViolation(ERC20Upgradeable.name(), from, "");
        }
        if (to != address(0) && !allowlistQueryInternal(to)) {
            revert Errors.AllowlistViolation(ERC20Upgradeable.name(), to, "");
        }
        return super._update(from, to, amount);
    }

    /**
     * @notice Function to check how many decimals are supported, which is 0
     * @dev BaseSecurityToken do not support fractional shares, so this function returns 0.
     * @return The number of decimals.
     */
    function decimals() public pure override returns (uint8) {
        return 0; // whole shares only
    }
    // endregion
}
