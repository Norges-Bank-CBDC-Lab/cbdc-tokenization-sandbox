// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {BaseSecurityToken} from "@csd/BaseSecurityToken.sol";
import {Errors} from "@common/Errors.sol";
import {DvP} from "@csd/DvP.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Roles} from "@common/Roles.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";

/**
 * Test mint, burn, allowlistQuery, constructor and supportedInterfaces.
 */
contract DvPTest is Test {
    DvP dvp;

    address admin = address(this);
    address secContr = address(0x1);
    address sellerSec = address(0x2);
    address buyerSec = address(0x3);
    address sellerTbd = address(0x4);
    address buyerTbd = address(0x5);
    address sellerTbdContr = address(0x6);
    address buyerTbdContr = address(0x7);

    uint256 secValue = 10;
    uint256 wholesaleValue = 1_000;

    /**
     * Create a DvP contract with this test as the owner.
     */
    function setUp() public {
        dvp = new DvP(admin);
        dvp.grantRole(Roles.SETTLE_ROLE, admin);
    }

    /**
     * Admin has DEFAULT_ADMIN_ROLE
     */
    function test_constructor_adminHas_DEFAULT_ADMIN_ROLE() public view {
        vm.assertTrue(dvp.hasRole(Roles.DEFAULT_ADMIN_ROLE, admin));
    }

    /**
     * Common settle() call executed by other tests.
     */
    function _settle() private returns (bool success) {
        return dvp.settle(
            secContr, sellerSec, buyerSec, secValue, sellerTbd, buyerTbd, wholesaleValue, sellerTbdContr, buyerTbdContr
        );
    }

    /**
     * Settle returns true and emits DvPEvent if both security and wholesale
     * transfers succeed.
     */
    function test_settle() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(true));
        vm.mockCall(buyerTbdContr, abi.encodeWithSelector(Tbd.cctFrom.selector), abi.encode(true));
        vm.expectEmit();
        emit DvP.DvPEvent(secContr, sellerSec, buyerSec, secValue, sellerTbdContr, buyerTbdContr, wholesaleValue);
        bool result = _settle();
        assertTrue(result);
    }

    /**
     * Settle requires SETTLE_ROLE.
     */
    function test_settle_revertIf_missing_SETTLE_ROLE() public {
        dvp.revokeRole(Roles.SETTLE_ROLE, admin);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, Roles.SETTLE_ROLE)
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Unknown if security transfer returns false.
     */
    function test_settle_revertIf_secTransfer_returnsFalse() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(false));
        vm.expectRevert(abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "unknown"));
        _settle();
    }

    /**
     * Reverts with FailureReason.Seller if security contract
     * throws ERC20InsufficientBalance.
     */
    function test_settle_revertIf_secTransfer_ERC20InsufficientBalance() public {
        vm.mockCallRevert(
            secContr,
            abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector),
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Seller,
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector)
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Seller if security contract
     * throws ERC20InvalidSender.
     */
    function test_settle_revertIf_secTransfer_ERC20InvalidSender() public {
        vm.mockCallRevert(
            secContr,
            abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector),
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidSender.selector)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Seller,
                abi.encodeWithSelector(IERC20Errors.ERC20InvalidSender.selector)
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Buyer if security contract
     * throws ERC20InvalidReceiver.
     */
    function test_settle_revertIf_secTransfer_ERC20InvalidReceiver() public {
        vm.mockCallRevert(
            secContr,
            abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector),
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Buyer,
                abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector)
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Buyer if security contract
     * throws AllowlistViolation referencing the buyer.
     */
    function test_settle_revertIf_secTransfer_AllowListViolationBuyer() public {
        vm.mockCall(secContr, abi.encodeWithSelector(ERC20.name.selector), abi.encode("SEC"));
        vm.mockCallRevert(
            secContr,
            abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector),
            abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SEC", buyerSec, "")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Buyer,
                abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SEC", buyerSec, "")
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Seller if security contract
     * throws AllowlistViolation referencing the seller.
     */
    function test_settle_revertIf_secTransfer_AllowListViolationSeller() public {
        vm.mockCall(secContr, abi.encodeWithSelector(ERC20.name.selector), abi.encode("SEC"));
        vm.mockCallRevert(
            secContr,
            abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector),
            abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SEC", sellerSec, "")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Seller,
                abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SEC", sellerSec, "")
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Unknown if security contract
     * throws an unrecognized error.
     */
    function test_settle_revertIf_secTransfer_unknownError() public {
        vm.mockCall(secContr, abi.encodeWithSelector(ERC20.name.selector), abi.encode("SEC"));
        vm.mockCallRevert(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), "arbitrary");
        vm.expectRevert(abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "arbitrary"));
        _settle();
    }

    /**
     * Reverts with FailureReason.Unknown if wholesale transfer returns false.
     */
    function test_settle_revertIf_wholesale_returnsFalse() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(true));
        vm.mockCall(buyerTbdContr, abi.encodeWithSelector(Tbd.cctFrom.selector), abi.encode(false));
        vm.expectRevert(abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "unknown"));
        _settle();
    }

    /**
     * Reverts with FailureReason.Buyer if wholesale contract
     * throws ERC20InsufficientBalance.
     */
    function test_settle_revertIf_wholesale_ERC20InsufficientBalance() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(true));
        vm.mockCallRevert(
            buyerTbdContr,
            abi.encodeWithSelector(Tbd.cctFrom.selector),
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Buyer,
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector)
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Seller if wholesale contract
     * throws AllowlistViolation referencing the seller.
     */
    function test_settle_revertIf_wholesale_AllowListViolationSeller() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(true));
        vm.mockCall(sellerTbdContr, abi.encodeWithSelector(ERC20.name.selector), abi.encode("SellerTbdName"));
        vm.mockCallRevert(
            buyerTbdContr,
            abi.encodeWithSelector(Tbd.cctFrom.selector),
            abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SellerTbdName", sellerTbd, "")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Seller,
                abi.encodeWithSelector(Errors.AllowlistViolation.selector, "SellerTbdName", sellerTbd, "")
            )
        );
        _settle();
    }

    /**
     * Reverts with FailureReason.Unknown if wholesale contract
     * throws unknown Error.
     */
    function test_settle_revertIf_wholesale_unknownError() public {
        vm.mockCall(secContr, abi.encodeWithSelector(BaseSecurityToken.custodialTransfer.selector), abi.encode(true));
        vm.mockCall(sellerTbdContr, abi.encodeWithSelector(ERC20.name.selector), abi.encode("SellerTbdName"));
        vm.mockCallRevert(buyerTbdContr, abi.encodeWithSelector(Tbd.cctFrom.selector), "arbitrary");
        vm.expectRevert(abi.encodeWithSelector(DvP.SettlementFailure.selector, DvP.FailureReason.Unknown, "arbitrary"));
        _settle();
    }

    /**
     * Supported interfaces are correct
     */
    function test_supportedInterfaces() public view {
        // ERC-165
        assertEq(dvp.supportsInterface(0x01ffc9a7), true);
        // DvP
        assertEq(dvp.supportsInterface(0xfbbf90ea), true);
        // Unsupported interface
        assertEq(dvp.supportsInterface(0xffffffff), false);
    }
}
