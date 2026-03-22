// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {Roles} from "@common/Roles.sol";
import {RegistryScript} from "../common/RegistryScript.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

/**
 * @title WnokSetupScript
 * @dev Automation script to set up the Wnok contract with accounts and permissions.
 */
contract WnokSetupScript is RegistryScript {
    function setUp() public {}

    /**
     * @dev Main function to execute the script logic.
     * Sets up contracts, adds allowed addresses to the Wnok allowlist, grants roles, and mints initial funds.
     * Uses environment variables for configuration.
     */
    function run() public {
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        uint256 nordeaKey = vm.envUint("PK_NORDEA");
        uint256 dnbKey = vm.envUint("PK_DNB");
        uint256 govReserveKey = vm.envUint("PK_GOV_RESERVE");
        address owner = vm.addr(ownerKey);
        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        address nordeaAddr = vm.addr(nordeaKey);
        address dnbAddr = vm.addr(dnbKey);
        address govReserveAddr = vm.addr(govReserveKey);

        _ensureRegistry(registryAddr, owner);

        GlobalRegistry registry = GlobalRegistry(registryAddr);

        address tbdNordeaAddr = registry.getContract(vm.envString("TBD_NORDEA_CONTRACT_NAME"));
        address tbdDnbAddr = registry.getContract(vm.envString("TBD_DNB_CONTRACT_NAME"));

        Wnok wnok = Wnok(registry.getContract(vm.envString("WNOK_CONTRACT_NAME")));

        /**
         * @dev Adds specified contracts and banks to the Wnok allowlist, grants transfer roles, and mints initial funds.
         */
        vm.startBroadcast(ownerKey);
        wnok.add(tbdNordeaAddr); //add Nordea TBD contract to Wnok Allowlist
        wnok.add(tbdDnbAddr); //add DNB TBD contract to Wnok Allowlist
        wnok.add(nordeaAddr); //add Nordea Bank to Wnok Allowlist
        wnok.add(dnbAddr); //add DNB Bank to Wnok Allowlist
        wnok.add(govReserveAddr); // add Gov Reserve to Wnok Allowlist
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, tbdNordeaAddr); // grant TRANSFER_FROM_ROLE to Nordea TBD contract
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, tbdDnbAddr); // grant TRANSFER_FROM_ROLE to DNB TBD contract
        wnok.mint(nordeaAddr, 100_000); // mint initial funds for Nordea Bank
        wnok.mint(dnbAddr, 200_000); // mint initial funds for DNB Bank
        wnok.mint(govReserveAddr, 10_000_000); // mint initial funds for gov. reserve

        vm.stopBroadcast();

        /**
         * @dev See {IERC20-approve}
         * NOTE: grant infinite approval to Nordea TBD contract
         */
        vm.startBroadcast(nordeaKey);
        wnok.approve(tbdNordeaAddr, type(uint256).max);
        vm.stopBroadcast();

        /**
         * @dev See {IERC20-approve}
         * NOTE: grant infinite approval to DNB TBD contract
         */
        vm.startBroadcast(dnbKey);
        wnok.approve(tbdDnbAddr, type(uint256).max);
        vm.stopBroadcast();

        /**
         * @dev See {IERC20-approve}
         * NOTE: grant nominated gov. bank infinite approval to reserve EOA
         */
        vm.startBroadcast(govReserveKey);
        wnok.approve(tbdNordeaAddr, type(uint256).max);
        vm.stopBroadcast();
    }
}
