// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AllowlistUpgradeable} from "@common/AllowlistUpgradeable.sol";
import {Test} from "forge-std/Test.sol";

/**
 * Since AllowlistUpgradeable is abstract, we create a simple inheritor to perform tests.
 */
contract BasicAllowlistUpgradeable is AllowlistUpgradeable {
    function initialize(address owner) public initializer {
        __Allowlist_init(owner);
    }
}

contract AllowlistUpgradeableTest is Test {
    BasicAllowlistUpgradeable allowlist;

    address admin = address(this);
    address reader = address(0x1);
    address addr2 = address(0x2);
    address addr3 = address(0x3);

    /**
     * Before each test, set up a new list containing reader and addr2.
     */
    function setUp() public {
        allowlist = new BasicAllowlistUpgradeable();
        allowlist.initialize(admin);
        allowlist.add(reader);
        allowlist.add(addr2);
    }

    /**
     * The list is initialized as expected and can be queried by anyone.
     */
    function test_query() public {
        vm.prank(reader);
        bool status1 = allowlist.allowlistQuery(reader);
        vm.prank(addr3);
        bool status2 = allowlist.allowlistQuery(addr2);
        vm.prank(addr2);
        bool status3 = allowlist.allowlistQuery(addr3);
        assertTrue(status1);
        assertTrue(status2);
        assertFalse(status3);
    }

    /**
     * The allowlist is initialized as expected and addresses can be queried.
     */
    function test_queryAll() public {
        vm.prank(reader);
        address[] memory allowlist1 = allowlist.allowlistQueryAll();
        address[] memory expectedAllowlist = new address[](2);
        expectedAllowlist[0] = reader;
        expectedAllowlist[1] = addr2;
        assertEq(allowlist1, expectedAllowlist);
    }

    /**
     * Adding a new entry works.
     */
    function test_add_asAdmin() public {
        vm.prank(reader);
        bool initialStatus = allowlist.allowlistQuery(addr3);
        vm.prank(admin);
        allowlist.add(addr3);
        vm.prank(reader);
        bool finalStatus = allowlist.allowlistQuery(addr3);
        assertFalse(initialStatus);
        assertTrue(finalStatus);
    }

    /**
     * Adding an entry which already existed works.
     */
    function test_add_existing_asAdmin() public {
        vm.prank(reader);
        bool initialStatus = allowlist.allowlistQuery(reader);
        vm.prank(admin);
        allowlist.add(reader);
        vm.prank(reader);
        bool finalStatus = allowlist.allowlistQuery(reader);
        assertTrue(initialStatus);
        assertTrue(finalStatus);
    }

    /**
     * Removing an entry works.
     */
    function test_remove_asAdmin() public {
        vm.prank(reader);
        bool initialStatus = allowlist.allowlistQuery(addr2);
        vm.prank(admin);
        allowlist.remove(addr2);
        vm.prank(reader);
        bool finalStatus = allowlist.allowlistQuery(addr2);
        assertTrue(initialStatus);
        assertFalse(finalStatus);
    }

    /**
     * Removing an entry which did not exist works.
     */
    function test_remove_nonexisting_asAdmin() public {
        vm.prank(reader);
        bool initialStatus = allowlist.allowlistQuery(addr3);
        vm.prank(admin);
        allowlist.remove(addr3);
        vm.prank(reader);
        bool finalStatus = allowlist.allowlistQuery(addr3);
        assertFalse(initialStatus);
        assertFalse(finalStatus);
    }

    /**
     * Non-admin cannot add.
     */
    function test_revertIf_add_asNonAdmin() public {
        vm.expectRevert();
        vm.prank(reader);
        allowlist.add(addr3);
    }

    /**
     * Non-admin cannot remove.
     */
    function test_revertIf_remove_asNonAdmin() public {
        vm.expectRevert();
        vm.prank(reader);
        allowlist.remove(addr2);
    }
}
