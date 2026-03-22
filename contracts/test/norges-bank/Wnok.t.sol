// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {Errors} from "@common/Errors.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Roles} from "@common/Roles.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

/**
 * Test mint, burn, allowlistQuery, constructor and supportedInterfaces.
 */
contract WnokTest is Test {
    Wnok wnok;
    string contractName = "Wholesale NOK";
    string contractSymbol = "wNOK";

    address admin = address(this);
    address reader = address(0x1);
    address bank1 = address(0x2);
    address bank2 = address(0x3);

    /**
     * Create a wholesale contract with this test as the owner.
     */
    function setUp() public {
        wnok = new Wnok(admin, contractName, contractSymbol);
    }

    /**
     * Calling mint as admin works if the recipient is on the allowlist.
     */
    function test_mint_asAdmin_allowlisted() public {
        uint256 amount = 100;
        wnok.add(reader);
        wnok.mint(reader, amount);
        uint256 readerBalance = wnok.balanceOf(reader);
        assertEq(readerBalance, amount);
    }

    /**
     * Calling mint as admin fails if the recipient is not on the allowlist.
     */
    function test_revertIf_mint_asAdmin_notAllowlisted() public {
        uint256 amount = 100;
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", reader, "mint address not on allowlist"
            )
        );
        wnok.mint(reader, amount);
    }

    /**
     * Calling burn as admin works if the target account is on the allowlist.
     */
    function test_burn_asAdmin() public {
        uint256 mintAmount = 100 * 10;
        uint256 burnAmount = 50 * 10;
        wnok.add(bank1);
        wnok.mint(bank1, mintAmount);
        wnok.burn(bank1, burnAmount);
        uint256 bank1Balance = wnok.balanceOf(bank1);
        assertEq(bank1Balance, mintAmount - burnAmount);
    }

    /**
     * symbol and name are correctly set
     */
    function test_SymbolAndName() public view {
        assertEq(wnok.name(), contractName);
        assertEq(wnok.symbol(), contractSymbol);
    }

    /**
     * Calling burn as admin fails if the target account is not on the allowlist.
     */
    function test_revertIf_burn_asAdmin_notAllowlisted() public {
        uint256 mintAmount = 100 * 10;
        uint256 burnAmount = 50 * 10;
        wnok.add(bank1);
        wnok.mint(bank1, mintAmount);
        wnok.remove(bank1);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", bank1, "burn address not on allowlist"
            )
        );
        wnok.burn(bank1, burnAmount);
    }

    /**
     * Calling mint as non-admin reverts.
     */
    function test_revertIf_mint_asNonAdmin() public {
        uint256 amount = 100;
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bank1, Roles.MINTER_ROLE)
        );
        vm.prank(bank1);
        wnok.mint(bank1, amount);
    }

    /**
     * Calling burn as non-admin reverts.
     */
    function test_revertIf_burn_asNonAdmin() public {
        uint256 amount = 100;
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bank1, Roles.BURNER_ROLE)
        );
        vm.prank(bank1);
        wnok.burn(reader, amount);
    }

    /**
     * Reading the allowlist works.
     */
    function test_allowlistQuery() public {
        vm.prank(reader);
        bool result = wnok.allowlistQuery(bank1);
        assertFalse(result);
    }

    /**
     * The admin address may not be the zero address
     */
    function test_revertIf_adminAddressZero() public {
        vm.expectRevert(Errors.AdminAddressZero.selector);
        new Wnok(address(0), contractName, contractSymbol);
    }

    /**
     * Supported interfaces are correct
     */
    function test_supportedInterfaces() public view {
        // ERC-165
        bool result = wnok.supportsInterface(0x01ffc9a7);
        assertEq(result, true);

        // transferFromAndCall
        result = wnok.supportsInterface(0xd8fbe994);
        assertEq(result, true);

        // Not-supported interface
        result = wnok.supportsInterface(0xffffffff);
        assertEq(result, false);
    }
}

/**
 * Test transfer, transferFrom, transferFromAndCall.
 */
contract WnokTransferTest is Test {
    Wnok wnok;
    string contractName = "Wholesale NOK";
    string contractSymbol = "wNOK";

    address admin = address(this);
    address bank1 = address(0x2);
    address bank2 = address(0x3);
    address toTbdContr = address(0x4);

    uint256 value = 1_000;

    /**
     * Create a wholesale contract with this test as the owner.
     */
    function setUp() public {
        wnok = new Wnok(admin, contractName, contractSymbol);
        wnok.add(bank1);
        wnok.add(bank2);
        wnok.mint(bank1, value);
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, bank2);
        vm.prank(bank1);
        wnok.approve(bank2, value);
    }

    /**
     * Transfer works.
     */
    function test_transfer() public {
        vm.prank(bank1);
        assertTrue(wnok.transfer(bank2, value));
    }

    /**
     * Transfer requires owner to be allowlisted.
     */
    function test_revertIf_transfer_ownerNotListed() public {
        wnok.remove(bank1);
        vm.prank(bank1);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", bank1, "originator not on allowlist"
            )
        );
        // After expectRevert, don't assert on return values: the call must revert.
        wnok.transfer(bank2, value);
    }

    /**
     * Transfer requires recipient to be allowlisted.
     */
    function test_revertIf_transfer_recipientNotListed() public {
        wnok.remove(bank2);
        vm.prank(bank1);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", bank2, "recipient not on allowlist"
            )
        );
        // After expectRevert, don't assert on return values: the call must revert.
        wnok.transfer(bank2, value);
    }

    /**
     * transferFrom works.
     */
    function test_transferFrom() public {
        vm.prank(bank2);
        assertTrue(wnok.transferFrom(bank1, bank2, value));
    }

    /**
     * transferFrom requires msg.sender to have TRANSFER_FROM_ROLE.
     */
    function test_revertIf_transferFrom_withoutTransferFromRole() public {
        wnok.revokeRole(Roles.TRANSFER_FROM_ROLE, bank2);
        vm.prank(bank2);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, bank2, Roles.TRANSFER_FROM_ROLE
            )
        );
        // After expectRevert, don't assert on return values: the call must revert.
        wnok.transferFrom(bank1, bank2, value);
    }

    /**
     * transferFrom requires `from` address to be allowlisted
     */
    function test_revertIf_transferFrom_senderNotListed() public {
        wnok.remove(bank1);
        vm.prank(bank2);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", bank1, "originator not on allowlist"
            )
        );
        // After expectRevert, don't assert on return values: the call must revert.
        wnok.transferFrom(bank1, bank2, value);
    }

    /**
     * transferFrom requires `to` address to be allowlisted
     */
    function test_revertIf_transferFrom_recipientNotListed() public {
        wnok.remove(bank2);
        vm.prank(bank2);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "Wholesale NOK", bank2, "recipient not on allowlist"
            )
        );
        // After expectRevert, don't assert on return values: the call must revert.
        wnok.transferFrom(bank1, bank2, value);
    }

    /**
     * transferFromAndCall works and emits a Settlement event.
     */
    function test_transferFromAndCall() public {
        vm.mockCall(
            bank2,
            abi.encodeWithSelector(Tbd.onTransferReceived.selector),
            abi.encode(bytes4(keccak256("onTransferReceived(address,address,uint256,bytes)")))
        );
        vm.prank(bank2);
        // See <https://book.getfoundry.sh/cheatcodes/expect-emit>
        vm.expectEmit();
        emit Wnok.Settlement(bank1, bank2, value);
        vm.expectCall(address(bank2), abi.encodeWithSelector(Tbd.onTransferReceived.selector));
        wnok.transferFromAndCall(bank1, bank2, value);
    }

    /**
     * Fails if target contract responds with other than ERC1363Receiver sig.
     */
    function test_revertIf_transferFromAndCall_unexpectedReturn() public {
        bytes4 wrongRet = bytes4(keccak256("UNEXPECTED"));
        vm.mockCall(bank2, abi.encodeWithSelector(Tbd.onTransferReceived.selector), abi.encode(wrongRet));
        vm.prank(bank2);
        vm.expectRevert(abi.encodeWithSelector(Errors.CallbackFailed.selector, wrongRet));
        wnok.transferFromAndCall(bank1, bank2, value);
    }
}
