// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {DvP} from "@csd/DvP.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {Roles} from "@common/Roles.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";
import {RegistryScript} from "../common/RegistryScript.sol";

contract OrderBookScript is RegistryScript {
    function run() external {
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);

        address csdAddr = vm.addr(vm.envUint("PK_CSD"));

        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        address wnokAddr = registry.getContract(vm.envString("WNOK_CONTRACT_NAME"));
        DvP dvp = DvP(registry.getContract(vm.envString("DVP_CONTRACT_NAME")));
        StockTokenFactory stockTokenFactory =
            StockTokenFactory(registry.getContract(vm.envString("STOCKFACTORY_CONTRACT_NAME")));
        (bool found, address stockTokenAddr) = stockTokenFactory.getDeployedStockToken("NO0001234567");
        require(found, "Stock token NO0001234567 not found.");

        // SUBMIT_ORDER_ROLE goes only to the broker contracts (09_BrokersSetup), which submit
        // orders on behalf of their registered clients; broker EOAs get no direct order access.
        vm.startBroadcast(deployerKey);
        OrderBook orderBook = new OrderBook(csdAddr, wnokAddr, address(dvp), stockTokenAddr);
        vm.stopBroadcast();

        vm.startBroadcast(ownerKey);
        dvp.grantRole(Roles.SETTLE_ROLE, address(orderBook));
        registry.setContract(vm.envString("ORDERBOOK_CONTRACT_NAME"), address(orderBook));
    }
}
