// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IBondToken} from "@norges-bank/interfaces/IBondToken.sol";
import {IBondDvP} from "@norges-bank/interfaces/IBondDvP.sol";

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondDvP
 * @notice Delivery-versus-Payment for ERC1410 bond partitions against an ERC20 cash token (e.g., WNOK).
 */
contract BondDvP is AccessControl, IBondDvP {
    string public name;

    /**
     * @param _name Name of the BondDvP instance.
     * @param _admin Bond issuer address granted BOND_MANAGER_ROLE.
     * @dev Grants DEFAULT_ADMIN_ROLE to `_admin`.
     */
    constructor(string memory _name, address _admin) {
        if (_admin == address(0)) revert Errors.AdminAddressZero();
        _grantRole(Roles.DEFAULT_ADMIN_ROLE, _admin);
        name = _name;
    }

    /**
     * @notice Generalised settlement entrypoint covering transfer, redeem, buyback and cash-only paths.
     * @dev Caller must have SETTLE_ROLE.
     * @dev Contract must have operator rights on bond partitions being settled.
     * @param p Settlement parameters describing both bond and cash legs.
     * @return true if settlement succeeded.
     */
    function settle(Settlement calldata p) external override onlyRole(Roles.SETTLE_ROLE) returns (bool) {
        if (p.cashFrom == address(0) || p.cashTo == address(0)) {
            revert Errors.PayerOrPayeeZero();
        }

        emit DvPEvent(
            p.bond,
            p.partition,
            p.op,
            p.bondFrom,
            p.bondTo,
            p.bondAmount,
            p.cashToken,
            p.cashFrom,
            p.cashTo,
            p.cashAmount,
            p.operator
        );

        if (p.op != Operation.None) {
            _settleSecurityLeg(p);
        }
        _settleCashLeg(p);
        return true;
    }

    function _settleSecurityLeg(Settlement calldata p) internal {
        if (p.op == Operation.TransferPartition) {
            if (p.bondAmount == 0) return; // allow cash-only via TransferPartition
            try IBondToken(p.bond)
                .operatorTransferByPartition(p.partition, p.bondFrom, p.bondTo, p.bondAmount, "", "") returns (
                bytes32 partitionReturned
            ) {
                if (partitionReturned != p.partition) {
                    revert Errors.SettlementFailure(uint8(FailureReason.Security), "partition mismatch");
                }
            } catch (bytes memory lowLevelData) {
                _revertSecurity(lowLevelData);
            }
        } else if (p.op == Operation.Redeem) {
            if (p.bondAmount == 0) revert Errors.InvalidAmount();
            string memory isin = IBondToken(p.bond).partitionToIsin(p.partition);
            try IBondToken(p.bond).redeemFor(p.bondFrom, isin, p.bondAmount, p.operator) {}
            catch (bytes memory lowLevelData) {
                _revertSecurity(lowLevelData);
            }
        } else if (p.op == Operation.Buyback) {
            if (p.bondAmount == 0) revert Errors.InvalidAmount();
            string memory isin = IBondToken(p.bond).partitionToIsin(p.partition);
            try IBondToken(p.bond).buybackRedeemFor(p.bondFrom, isin, p.bondAmount, p.operator) {}
            catch (bytes memory lowLevelData) {
                _revertSecurity(lowLevelData);
            }
        } else {
            revert Errors.InvalidOperation();
        }
    }

    function _settleCashLeg(Settlement calldata p) internal {
        try IERC20(p.cashToken).transferFrom(p.cashFrom, p.cashTo, p.cashAmount) returns (bool ok) {
            if (!ok) {
                revert Errors.SettlementFailure(uint8(FailureReason.Cash), "transferFrom returned false");
            }
        } catch (bytes memory lowLevelData) {
            // forge-lint: disable-next-line(unsafe-typecast)
            bytes4 selector = lowLevelData.length >= 4 ? bytes4(lowLevelData) : bytes4(0);
            if (
                selector == IERC20Errors.ERC20InsufficientBalance.selector
                    || selector == IERC20Errors.ERC20InsufficientAllowance.selector
                    || selector == Errors.AllowlistViolation.selector
            ) {
                revert Errors.SettlementFailure(uint8(FailureReason.Cash), lowLevelData);
            }
            revert Errors.SettlementFailure(uint8(FailureReason.Unknown), lowLevelData);
        }
    }

    function _revertSecurity(bytes memory lowLevelData) private pure {
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes4 selector = lowLevelData.length >= 4 ? bytes4(lowLevelData) : bytes4(0);
        if (
            selector == Errors.InsufficientBalance.selector || selector == Errors.InsufficientPartitionBalance.selector
                || selector == Errors.NotMultipleOfGranularity.selector
                || selector == Errors.UnauthorizedOperator.selector || selector == Errors.InvalidRecipient.selector
                || selector == Errors.AllowlistViolation.selector
        ) {
            revert Errors.SettlementFailure(uint8(FailureReason.Security), lowLevelData);
        }
        revert Errors.SettlementFailure(uint8(FailureReason.Unknown), lowLevelData);
    }
}
