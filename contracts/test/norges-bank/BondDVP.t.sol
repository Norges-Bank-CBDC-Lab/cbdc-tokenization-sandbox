// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

import {BondDvP} from "@norges-bank/BondDvP.sol";
import {IBondDvP} from "@norges-bank/interfaces/IBondDvP.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

import {Roles} from "@common/Roles.sol";
import {Errors} from "@common/Errors.sol";

contract BondDvPTest is Test {
    BondDvP bondDvp;
    BondToken bondToken;
    Wnok wnok;

    address deployer = address(this);
    address seller = address(0x1);
    address buyer = address(0x2);
    address payer = address(0x3);
    address payee = address(0x4);
    address couponEoa = address(0x5);

    string constant ISIN = "NO0001234567";
    bytes32 constant PARTITION = keccak256(abi.encodePacked(ISIN));
    uint256 constant UNITS = 100;
    uint256 constant UNIT_NOMINAL = 1000;
    uint256 constant CASH_AMOUNT = UNITS * UNIT_NOMINAL;

    function setUp() public {
        wnok = new Wnok(deployer, "Wholesale NOK", "WNOK");
        bondToken = new BondToken("Bond Token", "BOND");
        bondDvp = new BondDvP("Bond DvP", deployer);

        // Allowlist actors
        wnok.add(seller);
        wnok.add(buyer);
        wnok.add(payer);
        wnok.add(payee);
        wnok.add(address(bondDvp));
        wnok.add(couponEoa);

        // Roles and operator auth
        wnok.grantRole(keccak256("TRANSFER_FROM_ROLE"), address(bondDvp));
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, deployer);
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondDvp));
        vm.prank(seller);
        bondToken.authorizeOperator(address(bondDvp));
        bondDvp.grantRole(Roles.SETTLE_ROLE, deployer);

        // Create partition and mint to seller
        bondToken.createPartition(ISIN, UNITS, 1 days);
        bondToken.mintByIsin(ISIN, seller, UNITS);

        // Fund and approve payer for cash leg
        wnok.mint(payer, CASH_AMOUNT);
        vm.prank(payer);
        wnok.approve(address(bondDvp), CASH_AMOUNT);

        // Fund and approve coupon payer
        wnok.mint(couponEoa, CASH_AMOUNT);
        vm.prank(couponEoa);
        wnok.approve(address(bondDvp), CASH_AMOUNT);
    }

    function _transferSettlement(
        address bondFrom,
        address bondTo,
        uint256 bondAmount,
        address cashFrom,
        address cashTo,
        uint256 cashAmount,
        IBondDvP.Operation op
    ) internal view returns (IBondDvP.Settlement memory) {
        return _settlement(bondFrom, bondTo, bondAmount, cashFrom, cashTo, cashAmount, op, address(0));
    }

    function _settlement(
        address bondFrom,
        address bondTo,
        uint256 bondAmount,
        address cashFrom,
        address cashTo,
        uint256 cashAmount,
        IBondDvP.Operation op,
        address operator
    ) internal view returns (IBondDvP.Settlement memory) {
        return IBondDvP.Settlement({
            bond: address(bondToken),
            partition: PARTITION,
            bondFrom: bondFrom,
            bondTo: bondTo,
            bondAmount: bondAmount,
            cashToken: address(wnok),
            cashFrom: cashFrom,
            cashTo: cashTo,
            cashAmount: cashAmount,
            operator: operator,
            op: op
        });
    }

    function test_settle_TransferPartition_Success() public {
        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);

        vm.prank(deployer);
        bondDvp.settle(p);

        assertEq(bondToken.balanceOfByPartition(PARTITION, seller), 0);
        assertEq(bondToken.balanceOfByPartition(PARTITION, buyer), UNITS);
        assertEq(wnok.balanceOf(payer), 0);
        assertEq(wnok.balanceOf(payee), CASH_AMOUNT);
    }

    function test_settle_TransferPartition_RevertIf_UnauthorizedOperator() public {
        vm.prank(seller);
        bondToken.revokeOperator(address(bondDvp));

        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);

        vm.expectRevert();
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_TransferPartition_RevertIf_CashLegFails() public {
        vm.prank(payer);
        wnok.approve(address(bondDvp), 0);

        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);

        vm.expectRevert();
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_TransferPartition_RevertIf_SecurityInsufficientBalance() public {
        IBondDvP.Settlement memory p = _transferSettlement(
            seller, buyer, UNITS + 1, payer, payee, CASH_AMOUNT + UNIT_NOMINAL, IBondDvP.Operation.TransferPartition
        );

        vm.expectRevert();
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_TransferPartition_RevertIf_CashInsufficientBalance() public {
        address poorPayer = address(0x9);
        wnok.add(poorPayer);
        vm.prank(poorPayer);
        wnok.approve(address(bondDvp), CASH_AMOUNT);

        IBondDvP.Settlement memory p = _transferSettlement(
            seller, buyer, UNITS, poorPayer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition
        );

        vm.expectRevert();
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_CashOnly_ZeroBondAmount() public {
        uint256 payerBefore = wnok.balanceOf(couponEoa);
        uint256 payeeBefore = wnok.balanceOf(payee);
        uint256 sellerBefore = bondToken.balanceOfByPartition(PARTITION, seller);
        uint256 buyerBefore = bondToken.balanceOfByPartition(PARTITION, buyer);

        uint256 couponAmount = 10 * UNIT_NOMINAL;

        IBondDvP.Settlement memory p =
            _transferSettlement(seller, seller, 0, couponEoa, payee, couponAmount, IBondDvP.Operation.None);

        vm.prank(deployer);
        bondDvp.settle(p);

        assertEq(bondToken.balanceOfByPartition(PARTITION, seller), sellerBefore);
        assertEq(bondToken.balanceOfByPartition(PARTITION, buyer), buyerBefore);
        assertEq(wnok.balanceOf(couponEoa), payerBefore - couponAmount);
        assertEq(wnok.balanceOf(payee), payeeBefore + couponAmount);
    }

    function test_settle_RevertIf_ZeroPayerOrPayee() public {
        IBondDvP.Settlement memory zeroPayer = _transferSettlement(
            seller, buyer, UNITS, address(0), payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition
        );
        vm.expectRevert(abi.encodeWithSelector(Errors.PayerOrPayeeZero.selector));
        vm.prank(deployer);
        bondDvp.settle(zeroPayer);

        IBondDvP.Settlement memory zeroPayee = _transferSettlement(
            seller, buyer, UNITS, payer, address(0), CASH_AMOUNT, IBondDvP.Operation.TransferPartition
        );
        vm.expectRevert(abi.encodeWithSelector(Errors.PayerOrPayeeZero.selector));
        vm.prank(deployer);
        bondDvp.settle(zeroPayee);
    }

    function test_settle_Redeem_Success() public {
        uint256 redeemUnits = 10;
        bondToken.setMatured(ISIN);
        IBondDvP.Settlement memory p = _settlement(
            seller,
            address(0),
            redeemUnits,
            payer,
            seller,
            redeemUnits * UNIT_NOMINAL,
            IBondDvP.Operation.Redeem,
            deployer
        );

        vm.prank(deployer);
        bondDvp.settle(p);

        assertEq(bondToken.balanceOfByPartition(PARTITION, seller), UNITS - redeemUnits);
        assertEq(wnok.balanceOf(payer), CASH_AMOUNT - (redeemUnits * UNIT_NOMINAL));
        assertEq(wnok.balanceOf(seller), redeemUnits * UNIT_NOMINAL);
    }

    function test_settle_Redeem_RevertIf_ZeroBondAmount() public {
        IBondDvP.Settlement memory p =
            _settlement(seller, address(0), 0, payer, seller, 1, IBondDvP.Operation.Redeem, deployer);

        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidAmount.selector));
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_Buyback_Success() public {
        uint256 buybackUnits = 20;
        IBondDvP.Settlement memory p = _settlement(
            seller,
            address(0),
            buybackUnits,
            payer,
            seller,
            buybackUnits * UNIT_NOMINAL,
            IBondDvP.Operation.Buyback,
            deployer
        );

        vm.prank(deployer);
        bondDvp.settle(p);

        assertEq(bondToken.balanceOfByPartition(PARTITION, seller), UNITS - buybackUnits);
        assertEq(wnok.balanceOf(payer), CASH_AMOUNT - (buybackUnits * UNIT_NOMINAL));
        assertEq(wnok.balanceOf(seller), buybackUnits * UNIT_NOMINAL);
    }

    function test_settle_Buyback_RevertIf_CashLegFails() public {
        vm.prank(payer);
        wnok.approve(address(bondDvp), 0);

        IBondDvP.Settlement memory p =
            _settlement(seller, address(0), 5, payer, seller, 5 * UNIT_NOMINAL, IBondDvP.Operation.Buyback, deployer);

        vm.expectRevert();
        vm.prank(deployer);
        bondDvp.settle(p);
    }

    function test_settle_InvalidOperation_Reverts() public {
        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);
        bytes memory callData = abi.encodeWithSelector(BondDvP.settle.selector, p);
        // overwrite the op word (last field) with an invalid enum value
        assembly {
            mstore(add(callData, 0x144), 5)
        }
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidOperation.selector));
        vm.prank(deployer);
        (bool ok,) = address(bondDvp).call(callData);
        ok;
    }

    function test_settle_RevertIf_NoSettleRole() public {
        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);

        vm.expectRevert();
        vm.prank(payer);
        bondDvp.settle(p);
    }

    function test_settle_EmitsEvent() public {
        IBondDvP.Settlement memory p =
            _transferSettlement(seller, buyer, UNITS, payer, payee, CASH_AMOUNT, IBondDvP.Operation.TransferPartition);

        vm.expectEmit(true, true, true, true);
        emit IBondDvP.DvPEvent(
            address(bondToken),
            PARTITION,
            IBondDvP.Operation.TransferPartition,
            seller,
            buyer,
            UNITS,
            address(wnok),
            payer,
            payee,
            CASH_AMOUNT,
            address(0)
        );

        vm.prank(deployer);
        bondDvp.settle(p);
    }
}
