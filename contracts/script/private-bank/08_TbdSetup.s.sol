// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {Roles} from "@common/Roles.sol";
import {RegistryScript} from "../common/RegistryScript.sol";
import {Tbd} from "@private-bank/Tbd.sol";

/**
 * @title TbdSetupScript
 * @dev Automation script to set up the Tbd contracts with accounts and permissions.
 */
contract TbdSetupScript is RegistryScript {
    /// @notice Structure to hold bank-specific data
    struct BankData {
        address addr;
        uint256 key;
        string contractName;
        string contractSymbol;
    }

    function setUp() public {}

    /**
     * @dev Main function to execute the script logic.
     * Sets up contracts, adds allowed addresses to the TBD allowlists, grants roles, and mints initial funds.
     * Uses environment variables for configuration.
     */
    function run() public {
        /// @dev Load Nordea bank data from environment variables
        BankData memory nordea = BankData({
            addr: vm.addr(vm.envUint("PK_NORDEA")),
            key: vm.envUint("PK_NORDEA"),
            contractName: vm.envString("TBD_NORDEA_CONTRACT_NAME"),
            contractSymbol: vm.envString("TBD_NORDEA_CONTRACT_SYMBOL")
        });

        /// @dev Load DNB bank data from environment variables
        BankData memory dnb = BankData({
            addr: vm.addr(vm.envUint("PK_DNB")),
            key: vm.envUint("PK_DNB"),
            contractName: vm.envString("TBD_DNB_CONTRACT_NAME"),
            contractSymbol: vm.envString("TBD_DNB_CONTRACT_SYMBOL")
        });

        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);
        address registryAddr = vm.envAddress("REGISTRY_ADDR");

        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        Tbd tbdNordea = Tbd(registry.getContract(nordea.contractName));
        Tbd tbdDnb = Tbd(registry.getContract(dnb.contractName));

        /// @notice Add Alice (Nordea investor) to allowlist and mint initial supply
        _retailInvestorSetup(tbdNordea, nordea.key, vm.addr(vm.envUint("PK_ALICE_TBD")));

        /// @notice Add Bob (DNB investor) to allowlist and mint initial supply
        _retailInvestorSetup(tbdDnb, dnb.key, vm.addr(vm.envUint("PK_BOB_TBD")));

        /// @notice Add CSD to DNB allowlist
        _csdSetup(tbdDnb, dnb.key, vm.addr(vm.envUint("PK_CSD")));
    }

    // internal function to set up investors
    function _retailInvestorSetup(Tbd tbd, uint256 bankKey, address investor) internal {
        vm.startBroadcast(bankKey);
        tbd.add(investor); // add to allowlist
        tbd.mint(investor, 10_000); // mint initial supply
        tbd.grantRole(Roles.CCT_FROM_CALLER_ROLE, investor); // grant the user the rights to do a cct transfer
        vm.stopBroadcast();
    }

    // internal function to set up a TBD account for CSD
    function _csdSetup(Tbd tbd, uint256 bankKey, address csd) internal {
        vm.startBroadcast(bankKey);
        tbd.add(csd);
        vm.stopBroadcast();
    }
}
