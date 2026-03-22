// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {RegistryScript} from "../common/RegistryScript.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

/**
 * @title Wnok Deployment Script
 * @notice This script deploys the Wnok contract and registers it in the GlobalRegistry.
 */
contract WnokScript is RegistryScript {
    /// @dev Instance of the deployed Wnok contract
    Wnok public wnok;

    /**
     * @notice Main execution function to deploy the Wnok contract and register it
     * @dev Fetches deployment keys and registry addresses from environment variables, broadcast contract and add to registry.
     */
    function run() public {
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);
        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        string memory contractName = vm.envString("WNOK_CONTRACT_NAME");
        string memory contractSymbol = vm.envString("WNOK_CONTRACT_SYMBOL");

        _ensureRegistry(registryAddr, owner);

        vm.startBroadcast(deployerKey);
        wnok = new Wnok(owner, contractName, contractSymbol);
        vm.stopBroadcast();

        GlobalRegistry registry = GlobalRegistry(registryAddr);

        vm.startBroadcast(ownerKey);
        registry.setContract(wnok.name(), address(wnok));
        vm.stopBroadcast();
    }
}
