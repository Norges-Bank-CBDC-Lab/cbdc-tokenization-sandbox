// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {RegistryScript} from "../common/RegistryScript.sol";

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {BondManager} from "@norges-bank/BondManager.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {BondDvP} from "@norges-bank/BondDvP.sol";

contract BondScript is RegistryScript {
    BondAuction public bondAuction;
    BondManager public bondManager;
    BondToken public bondToken;
    BondDvP public bondDvp;

    function run() public {
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        uint256 bondAdminKey = vm.envUint("PK_BOND_ADMIN");

        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        address owner = vm.addr(ownerKey);

        string memory govReserveName = vm.envString("TBD_NORDEA_CONTRACT_NAME");
        string memory bondAuctionName = vm.envString("BOND_AUCTION_CONTRACT_NAME");
        string memory bondManagerName = vm.envString("BOND_MANAGER_CONTRACT_NAME");
        string memory bondTokenName = vm.envString("BOND_TOKEN_CONTRACT_NAME");
        string memory bondTokenSymbol = vm.envString("BOND_TOKEN_CONTRACT_SYMBOL");
        string memory bondDvpName = vm.envString("BOND_DVP_CONTRACT_NAME");

        uint256 durationScalar = vm.envUint("DURATION_SCALAR");

        _ensureRegistry(registryAddr, owner);

        GlobalRegistry registry = GlobalRegistry(registryAddr);
        address govTbd = registry.getContract(govReserveName);
        address wnok = registry.getContract(vm.envString("WNOK_CONTRACT_NAME"));

        address bondAdminAddr = vm.addr(bondAdminKey);
        address deployerAddr = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        bondAuction = new BondAuction(bondAuctionName);
        bondToken = new BondToken(bondTokenName, bondTokenSymbol);

        bondDvp = new BondDvP(bondDvpName, deployerAddr);

        bondManager = new BondManager(
            bondManagerName,
            wnok,
            bondAdminAddr,
            address(bondAuction),
            address(bondToken),
            address(bondDvp),
            govTbd,
            durationScalar
        );

        vm.stopBroadcast();

        vm.startBroadcast(ownerKey);
        registry.setContract(bondAuction.name(), address(bondAuction));
        registry.setContract(bondManager.name(), address(bondManager));
        registry.setContract(bondToken.name(), address(bondToken));
        registry.setContract(bondDvp.name(), address(bondDvp));
        vm.stopBroadcast();
    }
}
