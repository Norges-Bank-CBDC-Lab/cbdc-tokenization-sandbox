// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Errors} from "@common/Errors.sol";
import {BaseSecurityToken} from "@csd/BaseSecurityToken.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Roles} from "@common/Roles.sol";

contract DvP is AccessControl {
    /**
     * ERC165 supported interfaces.
     */
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /**
     * Enum used to track which side was responsible for settlement failure.
     */
    enum FailureReason {
        Buyer,
        Seller,
        Unknown
    }

    /**
     * An error thrown by DvP.settle on failure.
     */
    error SettlementFailure(FailureReason, bytes lowLevelData);

    /**
     * An event emitted when the contract is successfully invoked by a Order Book
     * contract for settlement.
     */
    event DvPEvent(
        address indexed secContrAddr,
        address indexed sellerSecAddr,
        address indexed buyerSecAddr,
        uint256 secValue,
        address sellerTbdContrAddr,
        address buyerTbdContrAddr,
        uint256 wholesaleValue
    );

    constructor(address admin) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // ERC-165
        _supportedInterfaces[DvP(address(0)).supportsInterface.selector] = true;
        // DvP
        _supportedInterfaces[DvP(address(0)).settle.selector] = true;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return _supportedInterfaces[interfaceId] || super.supportsInterface(interfaceId);
    }

    /**
     * Trigger a DvP settlement.
     *
     * "Seller" and "buyer" refer to the securities side, so for the
     * wholesale settlement the sides appear reversed.
     */
    function settle(
        address secContrAddr,
        address sellerSecAddr,
        address buyerSecAddr,
        uint256 secValue,
        address sellerTbdAddr,
        address buyerTbdAddr,
        uint256 wholesaleValue,
        address sellerTbdContrAddr,
        address buyerTbdContrAddr
    ) public onlyRole(Roles.SETTLE_ROLE) returns (bool success) {
        BaseSecurityToken secContract = BaseSecurityToken(secContrAddr);
        emit DvPEvent(
            secContrAddr, sellerSecAddr, buyerSecAddr, secValue, sellerTbdContrAddr, buyerTbdContrAddr, wholesaleValue
        );
        // Note: We assume the SecContract to have a specific implementation
        // with specific errors, not only ERC20-compliance.
        try secContract.custodialTransfer(sellerSecAddr, buyerSecAddr, secValue) returns (bool secResult) {
            if (!secResult) {
                revert SettlementFailure(FailureReason.Unknown, "unknown");
            }
        } catch (bytes memory lowLevelData) {
            // According to <https://docs.soliditylang.org/en/v0.8.29/control-structures.html#try-catch>
            // this clause catches all possible errors, revert()s and panics.
            // This is crucial. If it somehow missed an error and we continued
            // the settlement procedure, it would lead to a partial settlement.
            // forge-lint: disable-next-line(unsafe-typecast)
            if (lowLevelData.length >= 4 && bytes4(lowLevelData) == IERC20Errors.ERC20InsufficientBalance.selector) {
                // Security holder (seller) has insufficient balance
                revert SettlementFailure(FailureReason.Seller, lowLevelData);
            }
            // forge-lint: disable-next-line(unsafe-typecast)
            if (lowLevelData.length >= 4 && bytes4(lowLevelData) == IERC20Errors.ERC20InvalidSender.selector) {
                // Security holder (seller) has the null address reserved for
                // minting/burning
                revert SettlementFailure(FailureReason.Seller, lowLevelData);
            }
            // forge-lint: disable-next-line(unsafe-typecast)
            if (lowLevelData.length >= 4 && bytes4(lowLevelData) == IERC20Errors.ERC20InvalidReceiver.selector) {
                // Security buyer has the null address reserved for
                // minting/burning
                revert SettlementFailure(FailureReason.Buyer, lowLevelData);
            }
            if (_compareBytes(
                    lowLevelData,
                    abi.encodeWithSelector(Errors.AllowlistViolation.selector, secContract.name(), buyerSecAddr, "")
                )) {
                // Security buyer is not on the allowlist of the security
                revert SettlementFailure(FailureReason.Buyer, lowLevelData);
            }
            if (_compareBytes(
                    lowLevelData,
                    abi.encodeWithSelector(Errors.AllowlistViolation.selector, secContract.name(), sellerSecAddr, "")
                )) {
                // Security seller is not on the allowlist of the security
                revert SettlementFailure(FailureReason.Seller, lowLevelData);
            }
            // Other (unknown) cause
            revert SettlementFailure(FailureReason.Unknown, lowLevelData);
        }
        Tbd buyerTbdContract = Tbd(buyerTbdContrAddr);
        Tbd sellerTbdContract = Tbd(sellerTbdContrAddr);
        try buyerTbdContract.cctFrom(buyerTbdAddr, sellerTbdAddr, sellerTbdContrAddr, wholesaleValue) returns (
            bool cctResult
        ) {
            if (!cctResult) {
                revert SettlementFailure(FailureReason.Unknown, "unknown");
            }
        } catch (bytes memory lowLevelData) {
            // forge-lint: disable-next-line(unsafe-typecast)
            if (lowLevelData.length >= 4 && bytes4(lowLevelData) == IERC20Errors.ERC20InsufficientBalance.selector) {
                // TBD holder (buyer) or wNOK holder (buyer's bank) has insufficient balance
                revert SettlementFailure(FailureReason.Buyer, lowLevelData);
            }
            if (_compareBytes(
                    lowLevelData,
                    abi.encodeWithSelector(
                        Errors.AllowlistViolation.selector, sellerTbdContract.name(), sellerTbdAddr, ""
                    )
                )) {
                // Security holder (seller) is not on the allowlist of the seller's bank
                revert SettlementFailure(FailureReason.Seller, lowLevelData);
            }
            // Other (unknown) cause
            revert SettlementFailure(FailureReason.Unknown, lowLevelData);
        }
        return (true);
    }

    function _compareBytes(bytes memory b1, bytes memory b2) private pure returns (bool) {
        return keccak256(b1) == keccak256(b2);
    }
}
