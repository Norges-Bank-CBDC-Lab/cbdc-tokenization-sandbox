// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondManager} from "@norges-bank/BondManager.sol";
import {Errors} from "@common/Errors.sol";

/**
 * Constructor address checks for BondManager, kept apart from BondManager.t.sol, which sits at
 * the via-IR size limit. Every check runs before the constructor calls into BondToken, so plain
 * placeholder addresses are enough.
 */
contract BondManagerConstructorTest is Test {
    struct Args {
        address wNok;
        address controller;
        address bondAuction;
        address bondToken;
        address bondDvp;
        address govReserve;
    }

    uint256 constant DURATION_SCALAR = 1;

    function _validArgs() internal pure returns (Args memory) {
        return Args({
            wNok: address(0x1),
            controller: address(0x2),
            bondAuction: address(0x3),
            bondToken: address(0x4),
            bondDvp: address(0x5),
            govReserve: address(0x6)
        });
    }

    function _deploy(Args memory a) internal returns (BondManager) {
        return new BondManager(
            "Bond Manager", a.wNok, a.controller, a.bondAuction, a.bondToken, a.bondDvp, a.govReserve, DURATION_SCALAR
        );
    }

    function test_Constructor_RevertIf_WnokAddressZero() public {
        Args memory a = _validArgs();
        a.wNok = address(0);
        vm.expectRevert(Errors.WnokAddressZero.selector);
        _deploy(a);
    }

    function test_Constructor_RevertIf_ControllerAddressZero() public {
        Args memory a = _validArgs();
        a.controller = address(0);
        vm.expectRevert(Errors.ControllerAddressZero.selector);
        _deploy(a);
    }

    function test_Constructor_RevertIf_BondAuctionAddressZero() public {
        Args memory a = _validArgs();
        a.bondAuction = address(0);
        vm.expectRevert(Errors.BondAuctionAddressZero.selector);
        _deploy(a);
    }

    function test_Constructor_RevertIf_BondTokenAddressZero() public {
        Args memory a = _validArgs();
        a.bondToken = address(0);
        vm.expectRevert(Errors.BondTokenAddressZero.selector);
        _deploy(a);
    }

    function test_Constructor_RevertIf_BondDvpAddressZero() public {
        Args memory a = _validArgs();
        a.bondDvp = address(0);
        vm.expectRevert(Errors.DvpAddressZero.selector);
        _deploy(a);
    }
}
