// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";

contract GlobalRegistryScript is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");

        vm.startBroadcast(ownerKey);
        new GlobalRegistry();
        vm.stopBroadcast();
    }
}
