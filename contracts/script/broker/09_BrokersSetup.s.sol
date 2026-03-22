// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Vm.sol";

import {Broker} from "@broker/Broker.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {Roles} from "@common/Roles.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {RegistryScript} from "../common/RegistryScript.sol";

contract HelperContractPkAndAddresses {
    /// Deployer
    uint256 public deployerKey;

    /// Registry owner
    uint256 public ownerKey;

    /// CSD key
    uint256 public csdKey;

    /// Id Wallets
    address public idWalletAlice;
    address public idWalletBob;

    /// TBD Wallets (custodial)
    address public tbdWalletAlice;
    address public tbdWalletBob;

    /// Securities Wallets (custodial)
    address public secWalletAlice;
    address public secWalletBob;

    /// Broker PKs and adresses
    uint256 public brokerPkAlice;
    uint256 public brokerPkBob;
    address public brokerAddressAlice;
    address public brokerAddressBob;

    constructor(Vm vm) {
        deployerKey = vm.envUint("PK_DEPLOYER");
        ownerKey = vm.envUint("PK_NORGES_BANK");
        csdKey = vm.envUint("PK_CSD");

        /// Id Wallets
        idWalletAlice = vm.addr(vm.envUint("PK_ID_WALLET_ALICE"));
        idWalletBob = vm.addr(vm.envUint("PK_ID_WALLET_BOB"));

        /// TBD Wallets (custodial)
        tbdWalletAlice = vm.addr(vm.envUint("PK_ALICE_TBD"));
        tbdWalletBob = vm.addr(vm.envUint("PK_BOB_TBD"));

        /// Securities Wallets (custodial)
        secWalletAlice = vm.addr(vm.envUint("PK_ALICE_SEC"));
        secWalletBob = vm.addr(vm.envUint("PK_BOB_SEC"));

        /// Broker PKs and addresses
        brokerPkAlice = vm.envUint("PK_BROKER1");
        brokerPkBob = vm.envUint("PK_BROKER2");
        brokerAddressAlice = vm.addr(brokerPkAlice);
        brokerAddressBob = vm.addr(brokerPkBob);
    }
}

contract BrokersSetupScript is RegistryScript {
    function run() external {
        HelperContractPkAndAddresses variables = new HelperContractPkAndAddresses(vm);

        /// ContractAddresses
        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        address owner = vm.addr(variables.ownerKey());
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);
        address tbdContractAddressAlice = registry.getContract(vm.envString("TBD_NORDEA_CONTRACT_NAME"));
        address tbdContractAddressBob = registry.getContract(vm.envString("TBD_DNB_CONTRACT_NAME"));
        address orderBookContractAddress = registry.getContract(vm.envString("ORDERBOOK_CONTRACT_NAME"));
        address brokerAddressAlice = variables.brokerAddressAlice();
        address brokerAddressBob = variables.brokerAddressBob();
        OrderBook orderBook = OrderBook(orderBookContractAddress);

        //Deploy the 2 broker contracts
        vm.startBroadcast(variables.deployerKey());
        Broker brokerContractAlice = new Broker(brokerAddressAlice, orderBookContractAddress);
        Broker brokerContractBob = new Broker(brokerAddressBob, orderBookContractAddress);
        vm.stopBroadcast();

        vm.startBroadcast(variables.ownerKey());
        registry.setContract(vm.envString("BROKER1_CONTRACT_NAME"), address(brokerContractAlice));
        registry.setContract(vm.envString("BROKER2_CONTRACT_NAME"), address(brokerContractBob));
        vm.stopBroadcast();

        //Grant roles
        vm.startBroadcast(variables.csdKey());
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, address(brokerContractAlice));
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, address(brokerContractBob));
        vm.stopBroadcast();

        //Initialize Alice's Broker (Pareto/Broker1)
        vm.startBroadcast(variables.brokerPkAlice());
        brokerContractAlice.addClient(
            variables.idWalletAlice(), variables.tbdWalletAlice(), variables.secWalletAlice(), tbdContractAddressAlice
        );
        vm.stopBroadcast();

        //Initialize Bob's Broker (DNB Markets/Broker2)
        vm.startBroadcast(variables.brokerPkBob());
        brokerContractBob.addClient(
            variables.idWalletBob(), variables.tbdWalletBob(), variables.secWalletBob(), tbdContractAddressBob
        );
        vm.stopBroadcast();
    }
}
