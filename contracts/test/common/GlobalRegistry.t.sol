// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {Errors} from "@common/Errors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GlobalRegistryTest is Test {
    GlobalRegistry registry;

    address owner = address(this);
    address dummyContract = address(0xBEEF);

    function setUp() public {
        registry = new GlobalRegistry();
        registry.setContract("token", dummyContract);
    }

    // -------------------------
    // 🔍 Owner rights Tests
    // -------------------------
    function test_Owner_IsSet_Correctly() public view {
        assertEq(registry.owner(), owner);
    }

    function test_OnlyOwner_CanSet() public {
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        registry.setContract("Malicious", attacker);
    }

    function test_Failure_SetContract() public {
        address emptyAddress = address(0);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidContractAddress.selector, emptyAddress));
        registry.setContract("BadParam", emptyAddress);
    }

    // -------------------------
    // 🔍 GetContract() Tests
    // -------------------------
    function test_Get_ContractAddress() public view {
        address registryDummy = registry.getContract("token");
        assertEq(registryDummy, dummyContract);
    }

    function test_Get_ContractAddress_FiresEvent() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.ContractNotFound.selector, "Unknown"));
        registry.getContract("Unknown");
    }

    // -------------------------
    // 🔍 TryGetContract() Tests
    // -------------------------
    function test_TryGetContract() public view {
        (bool found, address result) = registry.tryGetContract("token");
        assertTrue(found);
        assertEq(result, dummyContract);

        (found, result) = registry.tryGetContract("Unknown");
        assertFalse(found);
        assertEq(result, address(0));
    }

    function test_Update_Fires_Correct_Event() public {
        vm.expectEmit(true, true, false, true);
        emit ContractAdded("Service", dummyContract);
        registry.setContract("Service", dummyContract);

        vm.expectEmit(true, true, false, true);
        emit ContractUpdated("Service", dummyContract, address(0xCAFE));
        registry.setContract("Service", address(0xCAFE));
    }

    // Declare emitted events for `expectEmit`
    event ContractAdded(string name, address newAddress);
    event ContractUpdated(string name, address oldAddress, address newAddress);
}
