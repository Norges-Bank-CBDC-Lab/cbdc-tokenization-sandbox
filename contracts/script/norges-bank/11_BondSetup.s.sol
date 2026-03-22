// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {RegistryScript} from "../common/RegistryScript.sol";

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {BondDvP} from "@norges-bank/BondDvP.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

import {Roles} from "@common/Roles.sol";

contract BondSetupScript is RegistryScript {
    function setUp() public {}

    function run() public {
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        uint256 govReserveKey = vm.envUint("PK_GOV_RESERVE");
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);

        // 2 verified bidders (PDs)
        uint256 dnbKey = vm.envUint("PK_DNB");
        uint256 nordeaKey = vm.envUint("PK_NORDEA");

        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        string memory govReserveName = vm.envString("TBD_NORDEA_CONTRACT_NAME");
        string memory bondAuctionName = vm.envString("BOND_AUCTION_CONTRACT_NAME");
        string memory bondManagerName = vm.envString("BOND_MANAGER_CONTRACT_NAME");
        string memory bondTokenName = vm.envString("BOND_TOKEN_CONTRACT_NAME");
        string memory wnokName = vm.envString("WNOK_CONTRACT_NAME");
        string memory bondDvpName = vm.envString("BOND_DVP_CONTRACT_NAME");

        address bondManagerAddr = registry.getContract(bondManagerName);

        BondAuction bondAuction = BondAuction(registry.getContract(bondAuctionName));
        BondToken bondToken = BondToken(registry.getContract(bondTokenName));
        BondDvP bondDvp = BondDvP(registry.getContract(bondDvpName));

        Wnok wnok = Wnok(registry.getContract(wnokName));
        Tbd govTbd = Tbd(registry.getContract(govReserveName));

        vm.startBroadcast(deployerKey);

        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, bondManagerAddr);
        bondToken.addController(bondManagerAddr);
        bondToken.addController(address(bondDvp));

        bondDvp.grantRole(Roles.SETTLE_ROLE, bondManagerAddr);

        vm.stopBroadcast();

        // Bidder addresses
        address dnbAddr = vm.addr(dnbKey);
        address nordeaAddr = vm.addr(nordeaKey);

        // Add WNOK balances to bidders
        vm.startBroadcast(ownerKey);
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(bondDvp));

        wnok.add(dnbAddr);
        wnok.mint(dnbAddr, 1_000_000);
        wnok.add(nordeaAddr);
        wnok.mint(nordeaAddr, 1_000_000);
        vm.stopBroadcast();

        // Add bidders to TBD allowlist
        vm.startBroadcast(nordeaKey);
        govTbd.add(dnbAddr);
        govTbd.add(nordeaAddr);
        vm.stopBroadcast();

        // TBD approval for BM
        vm.startBroadcast(govReserveKey);
        govTbd.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();

        // Wnok approvals for bidders
        vm.startBroadcast(nordeaKey); // Nordea
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(dnbKey); // DNB
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();
    }
}
