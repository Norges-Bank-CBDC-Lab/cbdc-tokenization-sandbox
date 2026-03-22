// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {console} from "forge-std/Script.sol";
import {StockToken} from "@csd/StockToken.sol";
import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";
import {Roles} from "@common/Roles.sol";
import {RegistryScript} from "../common/RegistryScript.sol";

contract StockTokenScript is RegistryScript {
    struct Environment {
        uint256 issuerOwnerKey;
        uint256 deployerKey;
        address operator1;
        address deployer;
        bytes32 custodialTransferRole;
        bytes32 securityOperatorRole;
        address alice;
        address bob;
        address registry;
        string dvpContractName;
        uint256 norgesBankPrivateKey;
        string stockFactoryContractName;
    }

    struct StockParams {
        string name;
        string symbol;
        string isin;
        string issuerName;
        string description;
        address issuerAddr;
        uint256 initialSupply;
    }

    StockParams params;
    Environment env;
    GlobalRegistry registry;
    StockToken tokenImplementationLogic;
    StockToken token;
    StockTokenFactory factory;

    function run() external {
        setupDeploymentParams();
        console.log("---------------------Starting the deployment script---------------------");
        console.log("---------------------parameters---------------------");
        logEnvironment();
        logStockParams();

        broadCastAs(env.deployerKey, deployStockToken);
        broadCastAs(env.deployerKey, deployFactory);
        broadCastAs(env.norgesBankPrivateKey, registerStockTokenFactory);
        broadCastAs(env.issuerOwnerKey, createNewStockToken);
        broadCastAs(env.issuerOwnerKey, grantRolesToStock);
        broadCastAs(env.issuerOwnerKey, addInvestorsToAllowlist);
        broadCastAs(env.issuerOwnerKey, helicopterStocks);

        console.log("---------------------Finished the deployment script---------------------");
    }

    // region Setup Parameters and environments

    /**
     * @notice Setup the deployment parameters and stock parameters
     * @dev This function initializes the environment and stock parameters for the deployment script.
     */
    function setupDeploymentParams() internal {
        env = Environment({
            issuerOwnerKey: vm.envUint("PK_CSD"),
            deployerKey: vm.envUint("PK_DEPLOYER"),
            operator1: vm.addr(vm.envUint("PK_OPERATOR1")),
            deployer: vm.addr(vm.envUint("PK_DEPLOYER")),
            custodialTransferRole: Roles.CUSTODIAL_TRANSFER_ROLE,
            securityOperatorRole: Roles.SECURITY_OPERATOR_ROLE,
            alice: vm.addr(vm.envUint("PK_ALICE_SEC")),
            bob: vm.addr(vm.envUint("PK_BOB_SEC")),
            registry: vm.envAddress("REGISTRY_ADDR"),
            dvpContractName: vm.envString("DVP_CONTRACT_NAME"),
            norgesBankPrivateKey: vm.envUint("PK_NORGES_BANK"),
            stockFactoryContractName: vm.envString("STOCKFACTORY_CONTRACT_NAME")
        });
        address owner = vm.addr(env.norgesBankPrivateKey);
        params = StockParams({
            name: "EquiNor",
            symbol: "EQNR",
            isin: "NO0001234567",
            issuerName: "EquiNor ASA",
            description: "Publicly traded stocks from EquiNor",
            issuerAddr: vm.addr(env.issuerOwnerKey),
            initialSupply: 1_000_000
        });
        _ensureRegistry(env.registry, owner);
        registry = GlobalRegistry(env.registry);
    }

    // endregion

    // region Deployment functions

    /**
     * @notice Broadcasts a transaction as a specific address, with the given function.
     * @dev This function requires referenced functions fn to be internal.
     * @param signerKey the key you want to sign the transaction with
     * @param fn The function that will be called, must be internal
     */
    function broadCastAs(uint256 signerKey, function() internal fn) internal {
        vm.startBroadcast(signerKey);
        fn();
        vm.stopBroadcast();
    }

    /**
     * @notice Register the StockTokenFactory contract in the GlobalRegistry
     */
    function registerStockTokenFactory() internal {
        registry.setContract(env.stockFactoryContractName, address(factory));
        console.log("Registered StockTokenFactory contract in the GlobalRegistry at: %s", address(factory));
        logSeparator();
    }

    /**
     * @notice Deploy the StockToken implementation logic contract
     * @dev StockToken implementation logic contract is needed by the factory, so this has to be deployed first
     */
    function deployStockToken() internal {
        tokenImplementationLogic = new StockToken();
        console.log("Deployed StockToken implementation logic at: %s", address(tokenImplementationLogic));
        logSeparator();
    }

    /**
     * @notice Grant roles to the StockToken contract
     * @dev This function grants the CUSTODIAL_TRANSFER_ROLE to dvp contract,
     * SECURITY_OPERATOR_ROLE to operator1 address on the StockToken contract
     */
    function grantRolesToStock() internal {
        address dvp = registry.getContract(env.dvpContractName);
        // Grant roles
        token.grantRoleTo(Roles.CUSTODIAL_TRANSFER_ROLE, dvp);
        token.grantRoleTo(Roles.SECURITY_OPERATOR_ROLE, env.operator1);
        console.log("Granted rights CUSTODIAL_TRANSFER_ROLE to: %s", dvp);
        console.log("Granted rights SECURITY_OPERATOR_ROLE to: %s", env.operator1);
        logSeparator();
    }

    /**
     * @notice Add investors to allowlist
     */
    function addInvestorsToAllowlist() internal {
        token.add(env.alice);
        token.add(env.bob);
        console.log("Added Alice and Bob to allowlist.");
        logSeparator();
    }

    /**
     * @notice Create a new StockToken using the factory
     * @dev This function creates a new StockToken using the factory and sets the token variable
     */
    function createNewStockToken() internal {
        address tokenAddress = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
        token = StockToken(tokenAddress);
        console.log("Deployer/Issuer address:", vm.addr(env.issuerOwnerKey));
        console.log("Deployed StockToken at:", tokenAddress);
        logSeparator();
    }

    /**
     * @notice Distributes free stock tokens to the investors
     * @dev 10 000 stocks to each investor: Alice and Bob
     */
    function helicopterStocks() internal {
        /// Setup investors with init funds
        require(token.transfer(env.alice, 10_000), "transfer to alice failed"); // mint initial supply
        require(token.transfer(env.bob, 10_000), "transfer to bob failed"); // mint initial supply
        console.log("Alice balance: %s", token.balanceOf(env.alice));
        console.log("Bob balance: %s", token.balanceOf(env.bob));
        logSeparator();
    }

    /**
     * @notice Deploy the StockTokenFactory contract
     * @dev This function deploys the StockTokenFactory contract and sets the factory variable, make sure to dpeloy stocktoken first
     */
    function deployFactory() internal {
        factory = new StockTokenFactory(address(tokenImplementationLogic), params.issuerAddr);
        console.log("Deployed StockTokenFactory at: %s", address(factory));
        logSeparator();
    }

    // endregion

    // region Helper functions
    function logEnvironment() internal view {
        console.log("Environment:");
        console.log("  issuerOwnerKey: %s", env.issuerOwnerKey);
        console.log("  deployerKey: %s", env.deployerKey);
        console.log("  operator1: %s", env.operator1);
        console.log("  deployer: %s", env.deployer);
        console.log("  custodialTransferRole:");
        console.logBytes32(env.custodialTransferRole);
        console.log("  securityOperatorRole:");
        console.logBytes32(env.securityOperatorRole);
        console.log("  alice: %s", env.alice);
        console.log("  bob: %s", env.bob);
        console.log("  registry: %s", env.registry);
        console.log("  dvpContractName: %s", env.dvpContractName);
        console.log("  norgesBankPrivateKey: %s", env.norgesBankPrivateKey);
        logSeparator();
    }

    // Helper function to log the stock parameters
    function logStockParams() internal view {
        console.log("Stock Parameters:");
        console.log("  name: %s", params.name);
        console.log("  symbol: %s", params.symbol);
        console.log("  isin: %s", params.isin);
        console.log("  issuerName: %s", params.issuerName);
        console.log("  description: %s", params.description);
        console.log("  issuerAddr: %s", params.issuerAddr);
        console.log("  initialSupply: %d", params.initialSupply);
        logSeparator();
    }

    function logSeparator() internal pure {
        console.log("-------------------------------------------------------------");
    }
    // endregion
}
