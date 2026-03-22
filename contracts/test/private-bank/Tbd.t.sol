// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";

contract TbdTest is Test {
    Tbd public tbd;
    string contractName = "OSLOTBD";
    string contractSymbol = "OSLOTBD";

    address admin = address(this);
    address reader = address(0x1);
    address investor1 = address(0x2);
    address investor2 = address(0x3);
    address bank = address(0x4);
    // only to allow compilation, Central Bank related methods are tested separately
    address cbContract = address(0x5);
    address dvpContract = address(0x6);

    function setUp() public {
        tbd = new Tbd(admin, bank, cbContract, dvpContract, contractName, contractSymbol, address(0));
    }

    /**
     * DEFAULT_ADMIN_ROLE can mint to investor1, if investor1 is on allowlist
     */
    function test_mintAsOwner() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.mint(investor1, amount);

        assertEq(tbd.balanceOf(investor1), amount);
    }

    /**
     * DEFAULT_ADMIN_ROLE can burn from investor1, if investor1 is on allowlist
     */
    function test_burnAsOwner() public {
        uint256 mintAmount = 100 * 10;
        uint256 burnAmount = 50 * 10;

        tbd.add(investor1);
        tbd.mint(investor1, mintAmount);
        tbd.burn(investor1, burnAmount);

        assertEq(tbd.balanceOf(investor1), mintAmount - burnAmount);
    }

    /**
     * DEFAULT_ADMIN_ROLE can't mint to investor2, if investor2 is not on allowlist
     */
    function test_mintAsOwner_accountNotAllowed() public {
        uint256 amount = 100;

        _expectAllowlistViolation(investor2, "");
        tbd.mint(investor2, amount);
    }

    /**
     * DEFAULT_ADMIN_ROLE can't burn from investor1, if investor1 is not on allowlist
     */
    function test_burnAsOwner_accountNotAllowed() public {
        uint256 mintAmount = 100 * 10;
        uint256 burnAmount = 50 * 10;

        tbd.add(investor1);
        tbd.mint(investor1, mintAmount);
        tbd.remove(investor1);

        _expectAllowlistViolation(investor1, "");
        tbd.burn(investor1, burnAmount);
    }

    /**
     * investor2 without DEFAULT_ADMIN_ROLE can't mint
     */
    function test_revertIf_MintCallerIsNotOwner() public {
        uint256 amount = 100;

        vm.expectRevert();
        vm.prank(address(investor2));
        tbd.mint(investor2, amount);
    }

    /**
     * investor2 without DEFAULT_ADMIN_ROLE can't burn
     */
    function test_revertIf_BurnCallerIsNotOwner() public {
        uint256 amount = 100;

        vm.expectRevert();
        vm.prank(address(investor2));
        tbd.burn(investor2, amount);
    }

    /**
     * investor1 can transfer to investor2 if both are on the allowlist
     */
    function test_transfer() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.add(investor2);

        tbd.mint(investor1, amount);
        vm.prank(address(investor1));
        assertTrue(tbd.transfer(investor2, amount));

        uint256 investor2Balance = tbd.balanceOf(investor2);
        assertEq(investor2Balance, amount);
    }

    /**
     * investor2 can transfer from investor1 if both are on the allowlist
     * and an allowance was given by investor 1
     */
    function test_transferFrom() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.add(investor2);

        tbd.mint(investor1, amount);
        vm.prank(address(investor1));
        tbd.approve(address(investor2), amount);
        vm.prank(address(investor2));
        assertTrue(tbd.transferFrom(investor1, investor2, amount));

        uint256 investor2Balance = tbd.balanceOf(investor2);
        assertEq(investor2Balance, amount);
    }

    /**
     * investor1 can't transfer to investor2, if investor2 is not on the
     * allowlist
     */
    function test_transfer_notAllowedReceiver() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.mint(investor1, amount);
        vm.prank(address(investor1));

        _expectAllowlistViolation(investor2, "");
        // After expectRevert, don't assert on return values: the call must revert.
        tbd.transfer(investor2, amount);
    }

    /**
     * investor1 can't transfer to investor2, if investor1 is not on the
     * allowlist
     */
    function test_transfer_notAllowedSender() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.add(investor2);
        tbd.mint(investor1, amount);
        tbd.remove(investor1);
        vm.prank(address(investor1));

        _expectAllowlistViolation(investor1, "");
        // After expectRevert, don't assert on return values: the call must revert.
        tbd.transfer(investor2, amount);
    }

    /**
     * investor2 can't transfer from investor1, if investor2 is not on the
     * allowlist
     */
    function test_transferFrom_notAllowedReceiver() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.mint(investor1, amount);
        vm.prank(address(investor1));
        tbd.approve(address(investor2), amount);
        vm.prank(investor2);

        _expectAllowlistViolation(investor2, "");
        // After expectRevert, don't assert on return values: the call must revert.
        tbd.transferFrom(investor1, investor2, amount);
    }

    /**
     * investor2 can't transfer from investor1, if investor1 is not on the
     * allowlist
     */
    function test_transferFrom_notAllowedSender() public {
        uint256 amount = 100;

        tbd.add(investor1);
        tbd.add(investor2);
        tbd.mint(investor1, amount);
        vm.prank(address(investor1));
        tbd.approve(address(investor2), amount);
        tbd.remove(investor1);
        vm.prank(investor2);

        _expectAllowlistViolation(investor1, "");
        // After expectRevert, don't assert on return values: the call must revert.
        tbd.transferFrom(investor1, investor2, amount);
    }

    /**
     * The bank address can be read
     */
    function test_getBankAddress() public {
        vm.prank(reader);
        address result = tbd.getBankAddress();
        assertEq(bank, result);
    }

    /**
     * symbol and name are correctly set
     */
    function test_SymbolAndName() public view {
        assertEq(tbd.name(), contractName);
        assertEq(tbd.symbol(), contractSymbol);
    }

    /**
     * a cct can be done within investors of the same bank
     */
    function test_cctFrom_withSameBank() public {
        uint256 amount = 100;

        tbd.grantRole(Roles.CCT_FROM_CALLER_ROLE, investor1);

        tbd.add(investor1);
        tbd.add(investor2);
        tbd.mint(investor1, amount);

        vm.prank(investor1);
        tbd.cctFrom(investor1, investor2, address(tbd), amount);
    }

    /**
     * a cct can't be done within investors of the same bank, if
     * the receiving investor is not on the allowlist
     */
    function test_cctFrom_withSameBank_notAllowedReceiver() public {
        uint256 amount = 100;

        tbd.grantRole(Roles.CCT_FROM_CALLER_ROLE, investor1);

        tbd.add(investor1);
        tbd.mint(investor1, amount);

        vm.prank(investor1);
        _expectAllowlistViolation(investor2, "");
        tbd.cctFrom(investor1, investor2, address(tbd), amount);
    }

    /**
     * a cct can't be done within investors of the same bank, if
     * the sending investor is not on the allowlist
     */
    function test_cctFrom_withSameBank_notAllowedSender() public {
        uint256 amount = 100;

        tbd.grantRole(Roles.CCT_FROM_CALLER_ROLE, investor1);

        tbd.add(investor1);
        tbd.add(investor2);
        tbd.mint(investor1, amount);

        tbd.remove(investor1);
        vm.prank(investor1);
        _expectAllowlistViolation(investor1, "");
        tbd.cctFrom(investor1, investor2, address(tbd), amount);
    }

    /**
     * The admin address may not be the zero address
     */
    function test_revertIf_adminAddressZero() public {
        vm.expectRevert(Errors.AdminAddressZero.selector);
        new Tbd(address(0), bank, cbContract, dvpContract, contractName, contractSymbol, address(0));
    }

    /**
     * The bank address may not be the zero address
     */
    function test_revertIf_bankAddressZero() public {
        vm.expectRevert(Errors.BankAddressZero.selector);
        new Tbd(admin, address(0), cbContract, dvpContract, contractName, contractSymbol, address(0));
    }

    /**
     * The central bank contract address may not be the zero address
     */
    function test_revertIf_cbContractAddressZero() public {
        vm.expectRevert(Errors.WnokAddressZero.selector);
        new Tbd(admin, bank, address(0), dvpContract, contractName, contractSymbol, address(0));
    }

    /**
     * The DvP contract address may not be the zero address
     */
    function test_revertIf_dvpContractAddressZero() public {
        vm.expectRevert(Errors.DvpAddressZero.selector);
        new Tbd(admin, bank, cbContract, address(0), contractName, contractSymbol, address(0));
    }

    /**
     * Supported interfaces are correct
     */
    function test_supportedInterfaces() public view {
        // ITbd
        bool result = tbd.supportsInterface(0x2cc34a49);
        assertEq(result, true);

        // ERC-165
        result = tbd.supportsInterface(0x01ffc9a7);
        assertEq(result, true);

        // ERC-1363Receiver
        result = tbd.supportsInterface(0x88a7ca5c);
        assertEq(result, true);

        // Not-supported interface
        result = tbd.supportsInterface(0xffffffff);
        assertEq(result, false);
    }

    function _expectAllowlistViolation(address account, string memory message) private {
        vm.expectRevert(abi.encodeWithSelector(Errors.AllowlistViolation.selector, contractName, account, message));
    }
}
