// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

import {BondToken} from "@norges-bank/BondToken.sol";
import {Roles} from "@common/Roles.sol";

contract BondTokenHandler is Test {
    BondToken internal immutable bondToken;
    address internal immutable controller;

    string internal constant ISIN = "NO0001234567";
    bytes32 internal constant PARTITION = keccak256(abi.encodePacked(ISIN));
    string internal constant ISIN_B = "NO0007654321";
    bytes32 internal constant PARTITION_B = keccak256(abi.encodePacked(ISIN_B));

    address[4] internal holders = [address(0x101), address(0x102), address(0x103), address(0x104)];

    constructor(BondToken _bondToken, address _controller) {
        bondToken = _bondToken;
        controller = _controller;
    }

    function createPartition(uint96 offeringSeed, uint32 maturitySeed, uint8 isinSeed) external {
        (string memory isin, bytes32 partition) = _isin(isinSeed);
        if (bondToken.activePartitions(partition)) return;

        uint256 offering = _boundNonZero(uint256(offeringSeed), 1, 1_000_000);
        uint256 maturityDuration = _boundNonZero(uint256(maturitySeed), 1 days, 10 * 365 days);

        vm.prank(controller);
        bondToken.createPartition(isin, offering, maturityDuration);
    }

    function mintToHolder(uint96 amountSeed, uint8 holderSeed, uint8 isinSeed) external {
        (string memory isin, bytes32 partition) = _isin(isinSeed);
        if (!bondToken.activePartitions(partition)) return;

        uint256 currentSupply = bondToken.totalSupplyByPartition(partition);
        uint256 offering = bondToken.partitionOffering(partition);
        if (currentSupply >= offering) return;

        uint256 amount = _boundNonZero(uint256(amountSeed), 1, offering - currentSupply);

        vm.prank(controller);
        bondToken.mintByIsin(isin, _holder(holderSeed), amount);
    }

    /// @dev A holder moves its own units; `data` names either partition.
    function holderTransfer(uint96 amountSeed, uint8 fromSeed, uint8 toSeed, uint8 dataSeed) external {
        address from = _holder(fromSeed);
        bytes32[] memory held = bondToken.partitionsOf(from);
        if (held.length == 0) return;

        bytes32 partition = held[uint256(amountSeed) % held.length];
        uint256 balance = bondToken.balanceOfByPartition(partition, from);
        uint256 amount = _boundNonZero(uint256(amountSeed), 1, balance);
        (, bytes32 dataPartition) = _isin(dataSeed);

        vm.prank(from);
        bondToken.operatorTransferByPartition(partition, from, _holder(toSeed), amount, abi.encode(dataPartition), "");
    }

    function extendOffering(uint96 deltaSeed) external {
        if (!bondToken.activePartitions(PARTITION)) return;

        uint256 delta = _boundNonZero(uint256(deltaSeed), 1, 1_000_000);

        vm.prank(controller);
        bondToken.extendPartitionOffering(ISIN, delta);
    }

    function reduceOffering(uint96 deltaSeed) external {
        if (!bondToken.activePartitions(PARTITION)) return;

        uint256 currentOffering = bondToken.partitionOffering(PARTITION);
        uint256 currentSupply = bondToken.totalSupplyByPartition(PARTITION);
        if (currentOffering <= currentSupply) return;

        uint256 maxReduction = currentOffering - currentSupply;
        uint256 delta = _boundNonZero(uint256(deltaSeed), 1, maxReduction);

        vm.prank(controller);
        bondToken.reducePartitionOffering(ISIN, delta);
    }

    function enableCoupon(uint32 durationSeed, uint32 yieldSeed) external {
        if (!bondToken.activePartitions(PARTITION)) return;

        uint256 maturityDuration = bondToken.maturityDuration(PARTITION);
        if (maturityDuration == 0) return;

        uint256 couponDuration = _boundNonZero(uint256(durationSeed), 1, maturityDuration);
        uint256 couponYield = _boundNonZero(uint256(yieldSeed), 1, 20_000);

        vm.prank(controller);
        bondToken.enableByIsin(ISIN, couponDuration, couponYield);
    }

    function buybackRedeem(uint96 amountSeed, uint8 holderSeed) external {
        if (!bondToken.activePartitions(PARTITION)) return;

        address holder = _holder(holderSeed);
        uint256 balance = bondToken.balanceOfByPartition(PARTITION, holder);
        if (balance == 0) return;

        uint256 amount = _boundNonZero(uint256(amountSeed), 1, balance);

        vm.prank(controller);
        bondToken.buybackRedeemFor(holder, ISIN, amount, controller);
    }

    function markMatured() external {
        if (!bondToken.activePartitions(PARTITION)) return;

        vm.prank(controller);
        bondToken.setMatured(ISIN);
    }

    function redeemHolder(uint96 amountSeed, uint8 holderSeed) external {
        if (!bondToken.activePartitions(PARTITION) || !bondToken.isMatured(PARTITION)) return;

        address holder = _holder(holderSeed);
        uint256 balance = bondToken.balanceOfByPartition(PARTITION, holder);
        if (balance == 0) return;

        uint256 amount = _boundNonZero(uint256(amountSeed), 1, balance);

        vm.prank(controller);
        bondToken.redeemFor(holder, ISIN, amount, controller);
    }

    function _isin(uint8 isinSeed) internal pure returns (string memory isin, bytes32 partition) {
        return isinSeed % 2 == 0 ? (ISIN, PARTITION) : (ISIN_B, PARTITION_B);
    }

    function _holder(uint8 holderSeed) internal view returns (address) {
        return holders[uint256(holderSeed) % holders.length];
    }

    function _boundNonZero(uint256 value, uint256 minValue, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue <= minValue) return minValue;
        return minValue + (value % (maxValue - minValue + 1));
    }
}

contract BondTokenInvariantTest is Test {
    BondToken internal bondToken;
    BondTokenHandler internal handler;

    address internal constant CONTROLLER = address(0x999);
    string internal constant ISIN = "NO0001234567";
    bytes32 internal constant PARTITION = keccak256(abi.encodePacked(ISIN));
    string internal constant ISIN_B = "NO0007654321";
    bytes32 internal constant PARTITION_B = keccak256(abi.encodePacked(ISIN_B));
    address[4] internal HOLDERS = [address(0x101), address(0x102), address(0x103), address(0x104)];

    function setUp() public {
        bondToken = new BondToken("Bond Token", "BOND");
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, CONTROLLER);

        handler = new BondTokenHandler(bondToken, CONTROLLER);

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.createPartition.selector;
        selectors[1] = handler.mintToHolder.selector;
        selectors[2] = handler.extendOffering.selector;
        selectors[3] = handler.reduceOffering.selector;
        selectors[4] = handler.enableCoupon.selector;
        selectors[5] = handler.buybackRedeem.selector;
        selectors[6] = handler.markMatured.selector;
        selectors[7] = handler.redeemHolder.selector;
        selectors[8] = handler.holderTransfer.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_TotalSupplyNeverExceedsOffering() public view {
        _assertSupplyWithinOffering(PARTITION);
        _assertSupplyWithinOffering(PARTITION_B);
    }

    function invariant_SupplyMatchesTrackedHolderBalances() public view {
        _assertSupplyMatchesHolders(PARTITION);
        _assertSupplyMatchesHolders(PARTITION_B);
    }

    function invariant_CouponConfigRemainsSelfConsistent() public view {
        uint256 couponDuration = bondToken.couponDuration(PARTITION);
        uint256 couponYield = bondToken.couponYield(PARTITION);

        if (couponYield > 0) {
            assertGt(couponDuration, 0);
        }

        if (couponDuration > 0) {
            assertGt(bondToken.maturityDuration(PARTITION), 0);
            assertGt(bondToken.lastCouponPayment(PARTITION), 0);
        }
    }

    function invariant_MaturedPartitionMustBeActive() public view {
        if (bondToken.isMatured(PARTITION)) {
            assertTrue(bondToken.activePartitions(PARTITION));
        }
    }

    function _assertSupplyWithinOffering(bytes32 partition) internal view {
        if (!bondToken.activePartitions(partition)) {
            assertEq(bondToken.totalSupplyByPartition(partition), 0);
            return;
        }

        assertLe(bondToken.totalSupplyByPartition(partition), bondToken.partitionOffering(partition));
    }

    function _assertSupplyMatchesHolders(bytes32 partition) internal view {
        uint256 trackedBalance;
        for (uint256 i = 0; i < HOLDERS.length; i++) {
            trackedBalance += bondToken.balanceOfByPartition(partition, HOLDERS[i]);
        }

        assertEq(bondToken.totalSupplyByPartition(partition), trackedBalance);
    }
}
