// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {RegistryScript} from "../common/RegistryScript.sol";

import {GlobalRegistry} from "@common/GlobalRegistry.sol";

import {DvP} from "@csd/DvP.sol";

/**
 * @title DvP Deployment Script
 * @notice This script deploys the Delivery versus Payment (DvP) contract and registers it in the GlobalRegistry.
 */
contract DvPScript is RegistryScript {
    /// @notice Instance of the deployed DvP contract
    DvP public dvp;

    /**
     * @notice Main execution function to deploy the DvP contract and register it.
     */
    function run() public {
        // Load addresses and keys from environment variables
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        string memory dvpContractName = vm.envString("DVP_CONTRACT_NAME");

        _ensureRegistry(registryAddr, owner);

        /// @notice Deploy the DvP contract
        vm.startBroadcast(deployerKey);
        dvp = new DvP(address(owner));
        vm.stopBroadcast();

        /// @notice Register deployed contract addresses in GlobalRegistry
        GlobalRegistry registry = GlobalRegistry(registryAddr);
        vm.startBroadcast(ownerKey);
        registry.setContract(dvpContractName, address(dvp));
        vm.stopBroadcast();
    }
}
