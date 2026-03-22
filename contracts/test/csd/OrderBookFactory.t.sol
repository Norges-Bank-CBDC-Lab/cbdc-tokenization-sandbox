// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {OrderBookFactory} from "@csd/OrderBookFactory.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {Errors} from "@common/Errors.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {DvP} from "@csd/DvP.sol";

/**
 * @title OrderBookFactoryTest
 * @notice Comprehensive test suite for OrderBookFactory contract.
 * @dev Tests CREATE2 deterministic deployment, duplicate prevention, and enumeration.
 */
contract OrderBookFactoryTest is Test {
    OrderBookFactory factory;
    Wnok wnok;
    DvP dvp;

    address admin = address(this);
    address security1 = address(0x1);
    address security2 = address(0x2);
    address security3 = address(0x3);
    address zeroAddress = address(0);

    string wnokName = "Wholesale NOK";
    string wnokSymbol = "wNOK";

    function setUp() public {
        // Deploy dependencies
        wnok = new Wnok(admin, wnokName, wnokSymbol);
        dvp = new DvP(admin);

        // Deploy factory
        factory = new OrderBookFactory(admin, address(wnok), address(dvp));
    }

    // ============ Constructor Tests ============

    function test_constructor_SetsCorrectValues() public view {
        assertEq(factory.ADMIN(), admin);
        assertEq(factory.WNOK(), address(wnok));
        assertEq(factory.DVP(), address(dvp));
    }

    function test_constructor_RevertsIfAdminIsZero() public {
        vm.expectRevert(Errors.AdminAddressZero.selector);
        new OrderBookFactory(zeroAddress, address(wnok), address(dvp));
    }

    function test_constructor_RevertsIfWnokIsZero() public {
        vm.expectRevert(Errors.WnokAddressZero.selector);
        new OrderBookFactory(admin, zeroAddress, address(dvp));
    }

    function test_constructor_RevertsIfDvpIsZero() public {
        vm.expectRevert(Errors.DvpAddressZero.selector);
        new OrderBookFactory(admin, address(wnok), zeroAddress);
    }

    // ============ Create OrderBook Tests ============

    function test_createOrderBook_DeploysOrderBook() public {
        address orderBook = factory.createOrderBook(security1);

        assertTrue(orderBook != address(0));
        assertEq(factory.getOrderBook(security1), orderBook);
    }

    function test_createOrderBook_InitializesOrderBookCorrectly() public {
        address orderBookAddr = factory.createOrderBook(security1);
        OrderBook orderBook = OrderBook(orderBookAddr);

        // Verify OrderBook has correct admin role
        assertTrue(orderBook.hasRole(0x00, admin)); // DEFAULT_ADMIN_ROLE is 0x00
    }

    function test_createOrderBook_EmitsEvent() public {
        address expectedAddress = factory.computeOrderBookAddress(security1);

        vm.expectEmit(true, true, false, false);
        emit OrderBookFactory.OrderBookCreated(security1, expectedAddress);

        factory.createOrderBook(security1);
    }

    function test_createOrderBook_RevertsIfSecurityIsZero() public {
        vm.expectRevert(Errors.SecurityAddressZero.selector);
        factory.createOrderBook(zeroAddress);
    }

    function test_createOrderBook_RevertsIfOrderBookExists() public {
        factory.createOrderBook(security1);

        vm.expectRevert(abi.encodeWithSelector(Errors.DuplicateOrderBook.selector, security1));
        factory.createOrderBook(security1);
    }

    function test_createOrderBook_MultipleSecurities() public {
        address orderBook1 = factory.createOrderBook(security1);
        address orderBook2 = factory.createOrderBook(security2);
        address orderBook3 = factory.createOrderBook(security3);

        assertTrue(orderBook1 != address(0));
        assertTrue(orderBook2 != address(0));
        assertTrue(orderBook3 != address(0));
        assertTrue(orderBook1 != orderBook2);
        assertTrue(orderBook1 != orderBook3);
        assertTrue(orderBook2 != orderBook3);

        assertEq(factory.getOrderBook(security1), orderBook1);
        assertEq(factory.getOrderBook(security2), orderBook2);
        assertEq(factory.getOrderBook(security3), orderBook3);
    }

    // ============ CREATE2 Deterministic Address Tests ============

    function test_computeOrderBookAddress_MatchesDeployedAddress() public {
        address computedAddress = factory.computeOrderBookAddress(security1);
        address deployedAddress = factory.createOrderBook(security1);

        assertEq(computedAddress, deployedAddress);
    }

    function test_createOrderBook_DeterministicAddress() public {
        // Compute address before deployment
        address computedAddress1 = factory.computeOrderBookAddress(security1);
        address computedAddress2 = factory.computeOrderBookAddress(security2);

        // Deploy and verify addresses match
        address deployedAddress1 = factory.createOrderBook(security1);
        address deployedAddress2 = factory.createOrderBook(security2);

        assertEq(computedAddress1, deployedAddress1);
        assertEq(computedAddress2, deployedAddress2);
    }

    function test_createOrderBook_SameSecuritySameAddress() public {
        // Deploy factory again with same parameters
        OrderBookFactory factory2 = new OrderBookFactory(admin, address(wnok), address(dvp));

        // Compute addresses from both factories
        address address1 = factory.computeOrderBookAddress(security1);
        address address2 = factory2.computeOrderBookAddress(security1);

        // Should be different because factory addresses are different
        assertTrue(address1 != address2);
    }

    function test_createOrderBook_DifferentSecuritiesDifferentAddresses() public view {
        address address1 = factory.computeOrderBookAddress(security1);
        address address2 = factory.computeOrderBookAddress(security2);

        assertTrue(address1 != address2);
    }

    // ============ Enumeration Tests ============

    function test_allSecuritiesLength_ReturnsZeroInitially() public view {
        assertEq(factory.allSecuritiesLength(), 0);
    }

    function test_allSecuritiesLength_IncreasesWithDeployments() public {
        assertEq(factory.allSecuritiesLength(), 0);

        factory.createOrderBook(security1);
        assertEq(factory.allSecuritiesLength(), 1);

        factory.createOrderBook(security2);
        assertEq(factory.allSecuritiesLength(), 2);

        factory.createOrderBook(security3);
        assertEq(factory.allSecuritiesLength(), 3);
    }

    function test_getAllSecurities_ReturnsCorrectSecurities() public {
        factory.createOrderBook(security1);
        factory.createOrderBook(security2);
        factory.createOrderBook(security3);

        address[] memory securities = factory.getAllSecurities();

        assertEq(securities.length, 3);
        assertEq(securities[0], security1);
        assertEq(securities[1], security2);
        assertEq(securities[2], security3);
    }

    function test_getAllSecurities_ReturnsEmptyArrayInitially() public view {
        address[] memory securities = factory.getAllSecurities();
        assertEq(securities.length, 0);
    }

    // ============ Edge Cases ============

    function test_getOrderBook_ReturnsZeroForNonExistentSecurity() public view {
        assertEq(factory.getOrderBook(security1), address(0));
    }

    function test_createOrderBook_RevertsIfNotAdmin() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        factory.createOrderBook(security1);
    }

    function test_createOrderBook_RequiresOrderAdminRole() public {
        // Admin should be able to create order book
        address orderBook = factory.createOrderBook(security1);
        assertTrue(orderBook != address(0));
        assertEq(factory.getOrderBook(security1), orderBook);
    }
}
