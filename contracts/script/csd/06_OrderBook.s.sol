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
        uint256 csdKey = vm.envUint("PK_CSD");
        address owner = vm.addr(ownerKey);

        address csdAddr = vm.addr(vm.envUint("PK_CSD"));
        address broker1Addr = vm.addr(vm.envUint("PK_BROKER1"));
        address broker2Addr = vm.addr(vm.envUint("PK_BROKER2"));

        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        address wnokAddr = registry.getContract(vm.envString("WNOK_CONTRACT_NAME"));
        DvP dvp = DvP(registry.getContract(vm.envString("DVP_CONTRACT_NAME")));
        StockTokenFactory stockTokenFactory =
            StockTokenFactory(registry.getContract(vm.envString("STOCKFACTORY_CONTRACT_NAME")));
        (bool found, address stockTokenAddr) = stockTokenFactory.getDeployedStockToken("NO0001234567");
        require(found, "Stock token NO0001234567 not found.");

        vm.startBroadcast(deployerKey);
        OrderBook orderBook = new OrderBook(csdAddr, wnokAddr, address(dvp), stockTokenAddr);
        vm.stopBroadcast();

        vm.startBroadcast(csdKey);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, broker1Addr);
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, broker2Addr);
        vm.stopBroadcast();

        vm.startBroadcast(ownerKey);
        dvp.grantRole(Roles.SETTLE_ROLE, address(orderBook));
        registry.setContract(vm.envString("ORDERBOOK_CONTRACT_NAME"), address(orderBook));
    }
}
