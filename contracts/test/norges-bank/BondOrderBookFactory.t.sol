// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondOrderBookFactory} from "@norges-bank/BondOrderBookFactory.sol";
import {BondOrderBook} from "@norges-bank/BondOrderBook.sol";
import {Errors} from "@common/Errors.sol";

contract BondOrderBookFactoryTest is Test {
    BondOrderBookFactory factory;

    address admin = address(this);
    address tbd = address(0x10);
    address bondToken1 = address(0x20);
    address bondToken2 = address(0x21);
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 partition1 = bytes32("ISIN1");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 partition2 = bytes32("ISIN2");
    address zero = address(0);

    function setUp() public {
        factory = new BondOrderBookFactory(admin, tbd);
    }

    // --- constructor ---
    function test_constructor_SetsValues() public view {
        assertEq(factory.ADMIN(), admin);
        assertEq(factory.TBD(), tbd);
    }

    function test_constructor_RevertIf_AdminZero() public {
        vm.expectRevert(Errors.AdminAddressZero.selector);
        new BondOrderBookFactory(zero, tbd);
    }

    function test_constructor_RevertIf_TbdZero() public {
        vm.expectRevert(Errors.TbdAddressZero.selector);
        new BondOrderBookFactory(admin, zero);
    }

    // --- create ---
    function test_createBondOrderBook_Deploys() public {
        address ob = factory.createBondOrderBook(bondToken1, partition1);
        assertTrue(ob != address(0));
        assertEq(factory.getOrderBook(keccak256(abi.encode(bondToken1, partition1))), ob);
    }

    function test_createBondOrderBook_SetsAdminRole() public {
        address obAddr = factory.createBondOrderBook(bondToken1, partition1);
        BondOrderBook ob = BondOrderBook(obAddr);
        assertTrue(ob.hasRole(0x00, admin)); // DEFAULT_ADMIN_ROLE
    }

    function test_createBondOrderBook_EmitsEvent() public {
        address expected = factory.computeBondOrderBookAddress(bondToken1, partition1);
        vm.expectEmit(true, true, false, false);
        emit BondOrderBookFactory.BondOrderBookCreated(bondToken1, partition1, expected);
        factory.createBondOrderBook(bondToken1, partition1);
    }

    function test_createBondOrderBook_RevertIf_BondTokenZero() public {
        vm.expectRevert(Errors.BondTokenAddressZero.selector);
        factory.createBondOrderBook(zero, partition1);
    }

    function test_createBondOrderBook_RevertIf_PartitionZero() public {
        vm.expectRevert(Errors.PartitionZero.selector);
        factory.createBondOrderBook(bondToken1, bytes32(0));
    }

    function test_createBondOrderBook_RevertIf_Duplicate() public {
        factory.createBondOrderBook(bondToken1, partition1);
        vm.expectRevert(abi.encodeWithSelector(Errors.DuplicateOrderBook.selector, bondToken1));
        factory.createBondOrderBook(bondToken1, partition1);
    }

    function test_createBondOrderBook_MultiplePartitions() public {
        address ob1 = factory.createBondOrderBook(bondToken1, partition1);
        address ob2 = factory.createBondOrderBook(bondToken1, partition2);
        address ob3 = factory.createBondOrderBook(bondToken2, partition1);

        assertTrue(ob1 != address(0));
        assertTrue(ob2 != address(0));
        assertTrue(ob3 != address(0));
        assertTrue(ob1 != ob2);
        assertTrue(ob1 != ob3);
        assertTrue(ob2 != ob3);
    }

    // --- CREATE2 determinism ---
    function test_computeBondOrderBookAddress_MatchesDeployed() public {
        address computed = factory.computeBondOrderBookAddress(bondToken1, partition1);
        address deployed = factory.createBondOrderBook(bondToken1, partition1);
        assertEq(computed, deployed);
    }

    function test_computeBondOrderBookAddress_DifferentKeysDifferentAddresses() public view {
        address addr1 = factory.computeBondOrderBookAddress(bondToken1, partition1);
        address addr2 = factory.computeBondOrderBookAddress(bondToken1, partition2);
        address addr3 = factory.computeBondOrderBookAddress(bondToken2, partition1);
        assertTrue(addr1 != addr2);
        assertTrue(addr1 != addr3);
        assertTrue(addr2 != addr3);
    }

    function test_computeBondOrderBookAddress_DifferentFactoriesDiffer() public {
        BondOrderBookFactory f2 = new BondOrderBookFactory(admin, tbd);
        address addr1 = factory.computeBondOrderBookAddress(bondToken1, partition1);
        address addr2 = f2.computeBondOrderBookAddress(bondToken1, partition1);
        assertTrue(addr1 != addr2);
    }

    // --- enumeration ---
    function test_allOrderBooksLength_TracksDeployments() public {
        assertEq(factory.allOrderBooksLength(), 0);
        factory.createBondOrderBook(bondToken1, partition1);
        assertEq(factory.allOrderBooksLength(), 1);
        factory.createBondOrderBook(bondToken1, partition2);
        assertEq(factory.allOrderBooksLength(), 2);
    }

    function test_getOrderBook_ReturnsZeroIfMissing() public view {
        bytes32 key = keccak256(abi.encode(bondToken1, partition1));
        assertEq(factory.getOrderBook(key), address(0));
    }

    function test_createBondOrderBook_RevertIfNotAdmin() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        factory.createBondOrderBook(bondToken1, partition1);
    }
}
