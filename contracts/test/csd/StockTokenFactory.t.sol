// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Errors} from "@common/Errors.sol";
import {StockToken} from "@csd/StockToken.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";
import {Test} from "forge-std/Test.sol";

/**
 * @title StockTokenFactoryTest
 * @notice A test contract for the StockTokenFactory, which creates new instances of the StockToken contract and verifies unique ISINs.
 *
 * @dev This contract tests the creation of stock tokens using the StockTokenFactory.
 * It checks for unique ISINs and ensures that duplicate tokens cannot be created.
 */
contract StockTokenFactoryTest is Test {
    // region Variables

    struct StockParams {
        string name;
        string symbol;
        string isin;
        string issuerName;
        string description;
        address issuerAddr;
        uint256 initialSupply;
    }

    struct Environment {
        address issuerOwner;
        address csd1;
        address csd2;
        address operator1;
        address alice;
        address bob;
    }

    StockTokenFactory factory;
    StockParams params;
    Environment env;

    //endregion

    /**
     * @notice Set up the test environment.
     * @dev This function initializes the environment, parameters and factory for the tests.
     */
    function setUp() public {
        env = Environment({
            issuerOwner: address(0x1),
            csd1: address(0x2),
            csd2: address(0x3),
            operator1: address(0x4),
            alice: address(0x4),
            bob: address(0x5)
        });
        params = StockParams({
            name: "EquiNor",
            symbol: "EqNr",
            isin: "NO00001234",
            issuerName: "EquiNor ASA",
            description: "EuroNext description",
            issuerAddr: env.issuerOwner,
            initialSupply: 100000000
        });

        // Deploy the StockTokenFactory
        address implementationToken = address(new StockToken());
        factory = new StockTokenFactory(implementationToken, params.issuerAddr);
    }

    /**
     * @notice Test the creation of a stock token from deafult parameters defined in the setup
     * @dev This function tests the creation of a stock token using the StockTokenFactory.
     */
    function test_CreateStockToken() public {
        // Create a new stock token
        vm.prank(params.issuerAddr);
        address tokenAddress = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );

        // Check that the token was created successfully
        StockToken token = StockToken(tokenAddress);
        assertEq(token.name(), params.name);
        assertEq(token.symbol(), params.symbol);
        assertEq(token.securityIsin(), params.isin);
        assertEq(token.securityIssuerName(), params.issuerName);
    }

    /**
     * @notice Test the creation of a stock token and verifying it was created by factory and retrieving it again from factory, and expect it to succeed.
     * @dev This function retest creation of a stock token using the StockTokenFactory,
     * then verifies that the token was created successfully through factory methods: isVerifiedStockToken and getDeployedStockToken.
     */
    function test_CreateStockAndVerifyDeployedStockToken() public {
        // Create a new stock token
        vm.prank(params.issuerAddr);
        address tokenAddress = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
        assertTrue(factory.isVerifiedStockToken(params.isin));
        (bool exists, address stock) = factory.getDeployedStockToken(params.isin);
        assertTrue(exists);
        assertEq(stock, tokenAddress);
    }

    /**
     * @notice Test the creation of a stock token with a different ISIN, and expect it to succeed.
     * @dev This function tests that the factory allows the creation of stock tokens with different ISINs, but other parameters are identical.
     */
    function test_CreateStockTokenWithDifferentIsin() public {
        // Create a new stock token with a different ISIN
        vm.prank(params.issuerAddr);
        address tokenAddress = factory.createStockToken(
            params.name,
            params.symbol,
            "NO00005678", // Different ISIN
            params.initialSupply,
            params.description,
            params.issuerName
        );

        // Check that the token was created successfully
        StockToken token = StockToken(tokenAddress);
        assertEq(token.name(), params.name);
        assertEq(token.symbol(), params.symbol);
        assertEq(token.securityIsin(), "NO00005678");
        assertEq(token.securityIssuerName(), params.issuerName);
    }

    /**
     * @notice Test creation of multiple similar contracts.
     * @dev Same params except ISIN are allowed.
     */
    function test_CreateStockTokenWithSameNameAndSymbol() public {
        vm.prank(params.issuerAddr);
        address tokenAddress1 = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
        vm.prank(params.issuerAddr);
        address tokenAddress2 = factory.createStockToken(
            params.name, params.symbol, "NO00005678", params.initialSupply, params.description, params.issuerName
        );
        StockToken token1 = StockToken(tokenAddress1);
        StockToken token2 = StockToken(tokenAddress2);
        assertEq(token1.name(), params.name);
        assertEq(token2.name(), params.name);
    }

    /**
     * @notice Test the retrieval of all deployed StockToken ISINs.
     * @dev This function tests the getAllDeployedStockTokenIsins using StockTokenFactory.
     */
    function test_GetAllDeployedStockTokenIsins() public {
        vm.prank(params.issuerAddr);
        factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
        vm.prank(params.issuerAddr);
        factory.createStockToken(
            params.name, params.symbol, "NO00005678", params.initialSupply, params.description, params.issuerName
        );
        string[] memory deployedIsins = factory.getAllDeployedStockTokenIsins();
        assertEq(deployedIsins.length, 2);
        assertEq(deployedIsins[0], params.isin);
        assertEq(deployedIsins[1], "NO00005678");
    }

    /**
     * @notice Test the creation of a stock token from deafult parameters defined in the setup
     * @dev This function tests the creation of a stock token using the StockTokenFactory.
     */
    function test_revertIf_NotDeployer() public {
        // Attempt to create a stock token with an unauthorized address
        vm.prank(env.operator1);
        vm.expectRevert(Errors.NotDeployer.selector);
        factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
    }

    /**
     * @notice Test the creation of a stock token with a duplicate ISIN, and expect it to revert.
     * @dev This function tests that the factory prevents the creation of duplicate stock tokens, with identical parameters.
     */
    function test_revertIf_CreateDuplicateStockToken() public {
        // Create a new stock token
        vm.startPrank(params.issuerAddr);
        address tokenAddress = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );

        // Attempt to create a duplicate stock token and expect it to revert
        vm.expectRevert(abi.encodeWithSelector(Errors.DuplicateStockToken.selector, params.isin, tokenAddress));
        // Create a new stock token, which should be a duplicate
        factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.description, params.issuerName
        );
        vm.stopPrank();
    }
}
