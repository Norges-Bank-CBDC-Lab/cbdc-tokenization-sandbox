// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";

abstract contract RegistryScript is Script {
    function _ensureRegistry(address registryAddr, address owner) internal {
        if (registryAddr.code.length == 0) {
            vm.etch(registryAddr, type(GlobalRegistry).runtimeCode);
            vm.store(registryAddr, bytes32(uint256(0)), bytes32(uint256(uint160(owner))));
        }
    }
}
