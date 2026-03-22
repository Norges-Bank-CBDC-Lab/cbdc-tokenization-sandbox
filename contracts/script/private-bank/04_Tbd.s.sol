// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {RegistryScript} from "../common/RegistryScript.sol";
import {Tbd} from "@private-bank/Tbd.sol";

/**
 * @title TBD Deployment Script
 * @notice This contract deploys TBD contracts for Nordea and DNB and sets up retail investors.
 */
contract TbdScript is RegistryScript {
    /// @notice Deployed TBD instance for Nordea
    Tbd public tbdNordea;

    /// @notice Deployed TBD instance for DNB
    Tbd public tbdDnb;

    /// @notice Structure to hold bank-specific data
    struct BankInitData {
        address addr;
        uint256 key;
        string contractName;
        string contractSymbol;
        address govReserveAddr;
    }

    /**
     * @notice Main execution function to deploy contracts and setup investors
     */
    function run() public {
        /// @dev Load Nordea bank data from environment variables
        BankInitData memory nordea = BankInitData({
            addr: vm.addr(vm.envUint("PK_NORDEA")),
            key: vm.envUint("PK_NORDEA"),
            contractName: vm.envString("TBD_NORDEA_CONTRACT_NAME"),
            contractSymbol: vm.envString("TBD_NORDEA_CONTRACT_SYMBOL"),
            govReserveAddr: vm.addr(vm.envUint("PK_GOV_RESERVE"))
        });

        /// @dev Load DNB bank data from environment variables
        BankInitData memory dnb = BankInitData({
            addr: vm.addr(vm.envUint("PK_DNB")),
            key: vm.envUint("PK_DNB"),
            contractName: vm.envString("TBD_DNB_CONTRACT_NAME"),
            contractSymbol: vm.envString("TBD_DNB_CONTRACT_SYMBOL"),
            govReserveAddr: address(0)
        });

        /// @dev Retrieve registry address from environment variables
        address registryAddr = vm.envAddress("REGISTRY_ADDR");

        /// @dev Retrieve owner and deployer keys from environment variables
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        address owner = vm.addr(ownerKey);

        /// @notice Retrieve contract addresses from GlobalRegistry
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        string memory wnokContractName = vm.envString("WNOK_CONTRACT_NAME");
        string memory dvpContractName = vm.envString("DVP_CONTRACT_NAME");

        address wnok = registry.getContract(wnokContractName);
        address dvp = registry.getContract(dvpContractName);

        /// @notice Deploy TBD contracts for Nordea and DNB banks
        vm.startBroadcast(deployerKey);
        tbdNordea = new Tbd(
            nordea.addr, nordea.addr, wnok, dvp, nordea.contractName, nordea.contractSymbol, nordea.govReserveAddr
        );

        tbdDnb = new Tbd(dnb.addr, dnb.addr, wnok, dvp, dnb.contractName, dnb.contractSymbol, dnb.govReserveAddr);
        vm.stopBroadcast();

        /// @notice Register deployed contract addresses in GlobalRegistry
        vm.startBroadcast(ownerKey);
        registry.setContract(tbdNordea.name(), address(tbdNordea));
        registry.setContract(tbdDnb.name(), address(tbdDnb));
        vm.stopBroadcast();

        vm.startBroadcast(nordea.key);
        tbdNordea.add(nordea.govReserveAddr);
        vm.stopBroadcast();
    }
}
