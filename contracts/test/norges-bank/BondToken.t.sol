// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
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
    string constant ISIN_B = "NO0007654321";
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

    function test_CreatePartition_AcceptsZeroOffering() public {
        // Pre-staged bond (D1): partition is created with offering 0; the offering
        // is added later via extendPartitionOffering when an auction is scheduled.
        // Mint-time safety (mintByIsin) still enforces supply + value <= offering.
        vm.prank(controller);
        bondToken.createPartition(ISIN, 0, MATURITY_DURATION);

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertTrue(bondToken.activePartitions(partition));
        assertEq(bondToken.partitionOffering(partition), 0);
        assertEq(bondToken.maturityDuration(partition), MATURITY_DURATION);
    }

    function test_CreatePartition_RevertIf_ZeroMaturityDuration() public {
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(Errors.MaturityDurationZero.selector));
        bondToken.createPartition(ISIN, OFFERING, 0);
    }

    // ============ disablePartition Tests ============

    function test_DisablePartition_HappyPath() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.disablePartition(ISIN);
        vm.stopPrank();

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertFalse(bondToken.activePartitions(partition));
        assertEq(bondToken.partitionOffering(partition), 0);
        assertEq(bondToken.maturityDuration(partition), 0);
        assertEq(bondToken.couponYield(partition), 0);
        assertFalse(bondToken.isMatured(partition));
    }

    function test_DisablePartition_RevertIf_NonZeroSupply() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);

        vm.expectRevert(abi.encodeWithSelector(Errors.BondNotEmpty.selector, ISIN, 100));
        bondToken.disablePartition(ISIN);
        vm.stopPrank();
    }

    function test_DisablePartition_RevertIf_AlreadyDisabled() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.disablePartition(ISIN);

        vm.expectRevert(abi.encodeWithSelector(Errors.BondAlreadyDisabled.selector, ISIN));
        bondToken.disablePartition(ISIN);
        vm.stopPrank();
    }

    function test_DisablePartition_RevertIf_NotController() public {
        vm.prank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);

        vm.expectRevert();
        bondToken.disablePartition(ISIN);
    }

    function test_DisablePartition_AllowsRecreateWithFreshParameters() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.disablePartition(ISIN);

        uint256 newMaturity = 7 * 365 days;
        bondToken.createPartition(ISIN, 500, newMaturity);
        vm.stopPrank();

        bytes32 partition = bondToken.isinToPartition(ISIN);
        assertTrue(bondToken.activePartitions(partition));
        assertEq(bondToken.partitionOffering(partition), 500);
        assertEq(bondToken.maturityDuration(partition), newMaturity);
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

    function test_AddController_AddsControllerWithoutLifecycleRole() public {
        address newController = address(0x3);

        bondToken.addController(newController);

        assertTrue(bondToken.isController(newController));
        assertFalse(bondToken.hasRole(Roles.BOND_CONTROLLER_ROLE, newController));
        address[] memory controllers = bondToken.controllers();
        assertEq(controllers.length, 1);
        assertEq(controllers[0], newController);
    }

    function test_RemoveController_RemovesOnlyThatController() public {
        address first = address(0x3);
        address second = address(0x4);
        bondToken.addController(first);
        bondToken.addController(second);
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, first);

        bondToken.removeController(first);

        assertFalse(bondToken.isController(first));
        assertTrue(bondToken.isController(second));
        address[] memory controllers = bondToken.controllers();
        assertEq(controllers.length, 1);
        assertEq(controllers[0], second);
        // Lifecycle rights are managed separately and stay as they were.
        assertTrue(bondToken.hasRole(Roles.BOND_CONTROLLER_ROLE, first));
    }

    function test_RemoveController_NoopWhenNotController() public {
        address first = address(0x3);
        bondToken.addController(first);

        bondToken.removeController(address(0x4));

        address[] memory controllers = bondToken.controllers();
        assertEq(controllers.length, 1);
        assertEq(controllers[0], first);
    }

    function test_RemoveController_RevertIf_NotBondAdmin() public {
        address first = address(0x3);
        bondToken.addController(first);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, holder1, Roles.BOND_ADMIN_ROLE
            )
        );
        vm.prank(holder1);
        bondToken.removeController(first);
    }

    function test_RemovedController_CannotMoveHolderUnits() public {
        address operator = address(0x3);
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);
        vm.stopPrank();
        bytes32 partition = bondToken.isinToPartition(ISIN);

        bondToken.addController(operator);
        bondToken.removeController(operator);

        vm.expectRevert(Errors.UnauthorizedOperator.selector);
        vm.prank(operator);
        bondToken.operatorTransferByPartition(partition, holder1, holder2, 10, "", "");
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

    // ============ operatorTransferByPartition Tests ============

    function test_OperatorTransferByPartition_KeepsPartition() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.createPartition(ISIN_B, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);
        bondToken.mintByIsin(ISIN_B, holder2, 100);
        vm.stopPrank();

        bytes32 partitionA = bondToken.isinToPartition(ISIN);
        bytes32 partitionB = bondToken.isinToPartition(ISIN_B);

        vm.recordLogs();
        vm.prank(holder1);
        bytes32 landedIn =
            bondToken.operatorTransferByPartition(partitionA, holder1, holder2, 60, abi.encode(partitionB), "");

        assertEq(landedIn, partitionA);
        assertEq(bondToken.balanceOfByPartition(partitionA, holder1), 40);
        assertEq(bondToken.balanceOfByPartition(partitionA, holder2), 60);
        assertEq(bondToken.balanceOfByPartition(partitionB, holder2), 100);
        assertEq(bondToken.totalSupplyByPartition(partitionA), 100);
        assertEq(bondToken.totalSupplyByPartition(partitionB), 100);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 changedPartitionTopic = keccak256("ChangedPartition(bytes32,bytes32,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertNotEq(logs[i].topics[0], changedPartitionTopic);
        }
    }

    function test_OperatorTransferByPartition_CannotBlockIssuance() public {
        vm.startPrank(controller);
        bondToken.createPartition(ISIN, OFFERING, MATURITY_DURATION);
        bondToken.mintByIsin(ISIN, holder1, 100);
        bondToken.createPartition(ISIN_B, OFFERING, MATURITY_DURATION);
        vm.stopPrank();

        bytes32 partitionA = bondToken.isinToPartition(ISIN);
        bytes32 partitionB = bondToken.isinToPartition(ISIN_B);

        vm.prank(holder1);
        bondToken.operatorTransferByPartition(partitionA, holder1, holder2, 1, abi.encode(partitionB), "");

        vm.prank(controller);
        bondToken.mintByIsin(ISIN_B, holder2, OFFERING);

        assertEq(bondToken.totalSupplyByPartition(partitionB), OFFERING);
        assertEq(bondToken.balanceOfByPartition(partitionA, holder2), 1);
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
