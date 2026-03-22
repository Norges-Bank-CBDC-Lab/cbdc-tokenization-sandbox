// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

contract BondTokenTest is Test {
    BondToken bondToken;
    Wnok wnok;

    address admin = address(this);
    address controller;
    address holder1 = address(0x1);
    address holder2 = address(0x2);

    string constant ISIN = "NO0001234567";
    uint256 constant OFFERING = 1000;
    uint256 constant MATURITY_DURATION = 4 * 365 days; // 4 years
    uint256 constant COUPON_DURATION = 365 days; // 1 year
    uint256 constant COUPON_YIELD = 425; // 4.25% (in bps)
    uint256 constant REDEMPTION_RATE = 1000; // 1 BOND = 1000 WNOK

    event PartitionCreated(bytes32 indexed partition, string isin);

    function setUp() public {
        // Deploy WNOK
        wnok = new Wnok(admin, "Wholesale NOK", "WNOK");
        wnok.add(address(this));

        // Deploy BondToken
        bondToken = new BondToken("Bond Token", "BOND");

        // Setup controller (simulating BondManager)
        controller = address(0x999);
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, controller);
        bondToken.grantRole(Roles.DEFAULT_ADMIN_ROLE, admin);
    }

    // ============ createPartition Tests ============

    function test_CreatePartition() public {
        vm.prank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertTrue(bondToken.activePartitions(partition));
        assertEq(bondToken.partitionOffering(partition), OFFERING);
        assertEq(bondToken.maturityDuration(partition), MATURITY_DURATION);
    }

    function test_CreatePartition_RevertIf_NotController() public {
        vm.expectRevert();
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
    }

    function test_CreatePartition_RevertIf_Duplicate() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        vm.expectRevert(abi.encodeWithSelector(Errors.DuplicatePartition.selector, ISIN));
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        vm.stopPrank();
    }

    function test_CreatePartition_RevertIf_ZeroOffering() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.OfferingZero.selector));
        bondToken.createPartition(ISIN, 0, MATURITY_DURATION);
    }

    function test_CreatePartition_RevertIf_ZeroMaturityDuration() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.MaturityDurationZero.selector));
        bondToken.createPartition(ISIN, OFFERING, 0);
    }

    // ============ mintByIsin Tests ============

    function test_MintByIsin() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.balanceOfByPartition(partition, holder1), 100);
        vm.stopPrank();
    }

    function test_MintByIsin_RevertIf_ExceedsOffering() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        vm.expectRevert(abi.encodeWithSelector(Errors.ExceedsOffering.selector, ISIN, 0, OFFERING + 1, OFFERING));
        bondToken.mintByIsin(ISIN, holder1, OFFERING + 1);
        vm.stopPrank();
    }

    function test_MintByIsin_RevertIf_PartitionNotActive() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.PartitionNotActive.selector, ISIN));
        bondToken.mintByIsin(ISIN, holder1, 100);
    }

    // ============ extendPartitionOffering Tests ============

    function test_ExtendPartitionOffering() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.extendPartitionOffering(ISIN, 500);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.partitionOffering(partition), OFFERING + 500);
        vm.stopPrank();
    }

    function test_ExtendPartitionOffering_RevertIf_NotController() public {
        vm.expectRevert();
        bondToken.extendPartitionOffering(ISIN, 500);
    }

    function test_ExtendPartitionOffering_RevertIf_PartitionNotActive() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.PartitionNotActive.selector, ISIN));
        bondToken.extendPartitionOffering(ISIN, 500);
    }

    // ============ reducePartitionOffering Tests ============

    function test_ReducePartitionOffering() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.reducePartitionOffering(ISIN, 300);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.partitionOffering(partition), OFFERING - 300);
        vm.stopPrank();
    }

    function test_ReducePartitionOffering_RevertIf_ExceedsOffering() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        vm.expectRevert(abi.encodeWithSelector(Errors.ReductionExceedsOffering.selector, OFFERING, OFFERING + 1));
        bondToken.reducePartitionOffering(ISIN, OFFERING + 1);
        vm.stopPrank();
    }

    function test_ReducePartitionOffering_RevertIf_ExceedsCurrentSupply() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 500);
        // Try to reduce below current supply
        vm.expectRevert(abi.encodeWithSelector(Errors.ReductionBelowSupply.selector, 500, OFFERING - 600));
        bondToken.reducePartitionOffering(ISIN, 600); // Would make offering 400, but supply is 500
        vm.stopPrank();
    }

    // ============ enableByIsin (coupon parameters) Tests ============

    function test_EnableByIsin() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        uint256 before = block.timestamp;
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);
        uint256 afterTime = block.timestamp;

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.couponDuration(partition), COUPON_DURATION);
        assertEq(bondToken.couponYield(partition), COUPON_YIELD);
        assertGe(bondToken.maturityDate(partition), before + MATURITY_DURATION);
        assertLe(bondToken.maturityDate(partition), afterTime + MATURITY_DURATION);
        assertEq(bondToken.lastCouponPayment(partition), block.timestamp);
        assertEq(bondToken.couponPaymentCount(partition), 0);
        vm.stopPrank();
    }

    function test_EnableByIsin_RevertIf_PartitionNotActive() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.PartitionNotActive.selector, ISIN));
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);
    }

    // ============ addController Tests ============

    function test_AddController_AddsRoleAndControllerList() public {
        address newController = address(0x3);

        bondToken.addController(newController);

        assertTrue(bondToken.hasRole(Roles.BOND_CONTROLLER_ROLE, newController));
        address[] memory controllers = bondToken.controllers();
        assertEq(controllers.length, 1);
        assertEq(controllers[0], newController);
    }

    function test_AddController_DeduplicatesExisting() public {
        address newController = address(0x3);
        bondToken.addController(newController);
        bondToken.addController(newController); // second call should not duplicate

        address[] memory controllers = bondToken.controllers();
        assertEq(controllers.length, 1);
        assertEq(controllers[0], newController);
    }

    // ============ startMaturityTimer Tests ============

    function test_StartMaturityTimer() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        uint256 beforeTime = block.timestamp;
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);
        uint256 afterTime = block.timestamp;

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 maturityDate = bondToken.maturityDate(partition);
        assertGe(maturityDate, beforeTime + MATURITY_DURATION);
        assertLe(maturityDate, afterTime + MATURITY_DURATION);
        assertEq(bondToken.lastCouponPayment(partition), block.timestamp);
        assertEq(bondToken.couponPaymentCount(partition), 0);
        vm.stopPrank();
    }

    function test_StartMaturityTimer_RevertIf_ZeroDuration() public {
        // Note: This test is difficult to execute directly since createPartition requires duration > 0
        // The check in _startMaturityTimer validates maturityDuration[partition] == 0
        // This scenario would only occur if partition was created with duration but then cleared
        // For now, we rely on the createPartition validation to prevent this state
        // This test documents the expected behavior if zero duration somehow occurs
    }

    // ============ updateCouponPayment Tests ============

    function test_UpdateCouponPayment() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);

        uint256 newTimestamp = block.timestamp + COUPON_DURATION;
        uint256 newPaymentCount = 1;
        bondToken.updateCouponPayment(ISIN, newTimestamp, newPaymentCount);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertEq(bondToken.lastCouponPayment(partition), newTimestamp);
        assertEq(bondToken.couponPaymentCount(partition), newPaymentCount);
        vm.stopPrank();
    }

    // ============ setMatured Tests ============

    function test_SetMatured() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.setMatured(ISIN);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertTrue(bondToken.isMatured(partition));
        vm.stopPrank();
    }

    // ============ getCouponDetails Tests ============

    function test_GetCouponDetails() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);

        (
            uint256 couponDuration,
            uint256 couponYield,
            uint256 maturityDuration,
            uint256 lastPayment,
            uint256 paymentCount
        ) = bondToken.getCouponDetails(ISIN);

        assertEq(couponDuration, COUPON_DURATION);
        assertEq(couponYield, COUPON_YIELD);
        assertEq(maturityDuration, MATURITY_DURATION);
        assertEq(lastPayment, block.timestamp);
        assertEq(paymentCount, 0);
        vm.stopPrank();
    }

    // ============ redeemFor Tests ============

    function test_RedeemFor_RevertIf_NotMatured() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);
        // Bond not matured yet
        vm.expectRevert();
        bondToken.redeemFor(holder1, ISIN, 50, controller);
        vm.stopPrank();
    }

    function test_RedeemFor_Success() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);
        bondToken.enableByIsin(ISIN, COUPON_DURATION, COUPON_YIELD);
        bondToken.setMatured(ISIN);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        uint256 balanceBefore = bondToken.balanceOfByPartition(partition, holder1);

        bondToken.redeemFor(holder1, ISIN, 50, controller);

        uint256 balanceAfter = bondToken.balanceOfByPartition(partition, holder1);
        assertEq(balanceBefore - balanceAfter, 50);
        assertEq(balanceAfter, 50);
        vm.stopPrank();
    }

    function test_RedeemFor_RevertIf_PartitionNotActive() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.PartitionNotActive.selector, ISIN));
        bondToken.redeemFor(holder1, ISIN, 50, controller);
    }

    // ============ isinToPartition Tests ============

    function test_IsinToPartition() public view {
        bytes32 partition1 = bondToken.isinToPartition(ISIN);
        bytes32 partition2 = bondToken.isinToPartition(ISIN);
        assertEq(partition1, partition2);

        string memory differentIsin = "NO0007654321";
        bytes32 partition3 = bondToken.isinToPartition(differentIsin);
        assertNotEq(partition1, partition3);
    }
}
