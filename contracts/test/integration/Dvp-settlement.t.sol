// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Errors} from "@common/Errors.sol";
import {DvP} from "@csd/DvP.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Roles} from "@common/Roles.sol";
import {StockToken} from "@csd/StockToken.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";

/**
 * Tests DvP settlement with 5 contracts:
 *   - Wnok (Norges Bank),
 *   - Tbd (OSLOTBD),
 *   - Tbd (STAVANGERTBD)
 *   - DvP (CSD)
 *   - StockToken (CSD)
 * and 2 investors:
 *   - investor1 (customer of OSLO)
 *   - investor2 (customer of STAVANGER)
 * Note: Cct within the same bank are covered within the Tbd unit tests
 */
contract DvPSettlement is Test {
    struct StockParams {
        string name;
        string symbol;
        string isin;
        string issuerName;
        string description;
        address issuerAddr;
        uint256 initialSupply;
    }

    Tbd public tbd1;
    Tbd public tbd2;
    Wnok public wnok;
    DvP public dvp;
    StockToken public sec;

    string tbd1Name = "OSLOTBD";
    string tbd1Symbol = "OSLOTBD";
    string tbd2Name = "STAVANGERTBD";
    string tbd2Symbol = "STAVANGERTBD";
    string wnokName = "Wholesale NOK";
    string wnokSymbol = "wNOK";

    address testadmin = address(this);
    address tbd1admin = address(0x1);
    address tbd2admin = address(0x2);
    address wnokadmin = address(0x3);
    address dvpadmin = address(0x4);
    address bank1 = address(0x5);
    address bank2 = address(0x6);
    address investor1tbd = address(0x7);
    address investor2tbd = address(0x8);
    address investor1sec = address(0x9);
    address investor2sec = address(0xa);
    address issuerOwner = address(0xb);

    uint256 initAmountBank1Wnok = 1_000;
    uint256 initAmountBank2Wnok = 5_000;
    uint256 initBalanceInvestor1 = 200;
    uint256 initBalanceInvestor2 = 0;
    uint256 initBalanceInvestor1Sec = 0;
    uint256 initBalanceInvestor2Sec = 10; // at least secValue
    uint256 cctAmount = 100;

    uint256 wholesaleValue = 100;
    uint256 secValue = 10;
    StockParams params;
    address implementationToken;

    function setUp() public {
        // Create wNOK, DvP, TBDs
        wnok = new Wnok(wnokadmin, wnokName, wnokSymbol);
        dvp = new DvP(dvpadmin);
        tbd1 = new Tbd(tbd1admin, bank1, address(wnok), address(dvp), tbd1Name, tbd1Symbol, address(0));
        tbd2 = new Tbd(tbd2admin, bank2, address(wnok), address(dvp), tbd2Name, tbd2Symbol, address(0));

        vm.startPrank(tbd1admin);
        tbd1.add(investor1tbd);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, investor1tbd);
        tbd1.mint(investor1tbd, initBalanceInvestor1);

        vm.startPrank(tbd2admin);
        tbd2.add(investor2tbd);

        vm.startPrank(wnokadmin);
        wnok.add(bank1);
        wnok.add(bank2);
        wnok.add(address(tbd1));
        wnok.add(address(tbd2));
        wnok.mint(bank1, initAmountBank1Wnok);
        wnok.mint(bank2, initAmountBank2Wnok);
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(tbd1));
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(tbd2));
        vm.stopPrank();

        // Give TBD contracts infinite allowance over their banks' wNOK
        vm.prank(bank1);
        wnok.approve(address(tbd1), type(uint256).max);
        vm.prank(bank2);
        wnok.approve(address(tbd2), type(uint256).max);

        // Create DvP + Security (both owned by dvpadmin)
        dvp = new DvP(dvpadmin);

        params = StockParams({
            name: "EquiNor",
            symbol: "EqNr",
            isin: "NO00001234",
            issuerName: "EquiNor ASA",
            description: "EuroNext description",
            issuerAddr: dvpadmin,
            initialSupply: 1_000_000
        });

        implementationToken = address(new StockToken());
        StockTokenFactory factory = new StockTokenFactory(implementationToken, dvpadmin);
        vm.prank(params.issuerAddr);
        address clone = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.issuerName, params.description
        );
        sec = StockToken(clone);

        vm.startPrank(params.issuerAddr);
        sec.add(investor1sec);
        sec.add(investor2sec);
        assertTrue(sec.transfer(investor1sec, initBalanceInvestor1Sec));
        assertTrue(sec.transfer(investor2sec, initBalanceInvestor2Sec));
        sec.grantRole(Roles.CUSTODIAL_TRANSFER_ROLE, address(dvp));
        dvp.grantRole(Roles.SETTLE_ROLE, dvpadmin);
        vm.stopPrank();
        vm.prank(tbd1admin);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, address(dvp));
    }

    /**
     * checks no tokens stranded anywhere they should not
     */
    function _assertEmpty() internal view {
        // the contract addresses do not own wnok, tbd1, tbd2
        _assertBalanceEmpty(wnok, address(tbd1));
        _assertBalanceEmpty(wnok, address(tbd2));
        _assertBalanceEmpty(wnok, address(wnok));
        _assertBalanceEmpty(tbd1, address(tbd1));
        _assertBalanceEmpty(tbd1, address(tbd2));
        _assertBalanceEmpty(tbd1, address(wnok));
        _assertBalanceEmpty(tbd2, address(tbd1));
        _assertBalanceEmpty(tbd2, address(tbd2));
        _assertBalanceEmpty(tbd2, address(wnok));

        // the investors do not own wnok
        _assertBalanceEmpty(wnok, investor1tbd);
        _assertBalanceEmpty(wnok, investor2tbd);

        // the banks do not own tbd1, investor2 does not own tbd1
        _assertBalanceEmpty(tbd1, bank1);
        _assertBalanceEmpty(tbd1, bank2);
        _assertBalanceEmpty(tbd1, investor2tbd);

        // the banks do not own tbd2, investor1 does not own tbd2
        _assertBalanceEmpty(tbd2, bank1);
        _assertBalanceEmpty(tbd2, bank2);
        _assertBalanceEmpty(tbd2, investor1tbd);
    }

    /**
     * checks if funds are like initialized (upon reverts)
     */
    function _assertInitFunds() internal view {
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
        assertEq(tbd1.balanceOf(investor1tbd), initBalanceInvestor1);
        assertEq(tbd2.balanceOf(investor2tbd), initBalanceInvestor2);
        assertEq(sec.balanceOf(investor1sec), initBalanceInvestor1Sec);
        assertEq(sec.balanceOf(investor2sec), initBalanceInvestor2Sec);
        assertEq(wnok.allowance(bank1, address(tbd1)), type(uint256).max);
    }

    function _assertBalanceEmpty(ERC20 contr, address account) internal view {
        assertEq(contr.balanceOf(account), 0);
    }

    /**
     * checks if investor1 can do a cct to investor2, if all rights are set
     */
    function test_cctFrom() public {
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        assertEq(tbd1.balanceOf(investor1tbd), initBalanceInvestor1 - cctAmount);
        assertEq(tbd2.balanceOf(investor2tbd), cctAmount);
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok - cctAmount);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok + cctAmount);
        assertEq(wnok.allowance(bank1, address(tbd1)), type(uint256).max);
        _assertEmpty();
    }

    /**
     * checks if investor1 can't do a cct to investor2, if investor1 is not on allowlist
     */
    function test_revertIf_cctFrom_investor1_notAllowed() public {
        vm.prank(tbd1admin);
        tbd1.remove(investor1tbd);
        vm.expectRevert(abi.encodeWithSelector(Errors.AllowlistViolation.selector, tbd1Name, investor1tbd, ""));
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * checks if investor1 can't do a cct to investor2, if investor2 is not on allowlist
     */
    function test_revertIf_cctFrom_investor2_notAllowed() public {
        vm.prank(tbd2admin);
        tbd2.remove(investor2tbd);
        vm.expectRevert(abi.encodeWithSelector(Errors.AllowlistViolation.selector, tbd2Name, investor2tbd, ""));
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * checks if investor1 can't do a cct to investor2, if investor1 is not authorized
     */
    function test_cctFrom_investor1_notAuthorized() public {
        vm.prank(tbd1admin);
        tbd1.revokeRole(Roles.CCT_FROM_CALLER_ROLE, investor1tbd);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, investor1tbd, Roles.CCT_FROM_CALLER_ROLE
            )
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * checks if investor1 can't do a cct to investor2, if the wNOK contract is not authorized
     */
    function test_cctFrom_CBDC_notAuthorized() public {
        vm.prank(tbd2admin);
        tbd2.revokeRole(Roles.CBDC_CONTRACT_ROLE, address(wnok));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(wnok), Roles.CBDC_CONTRACT_ROLE
            )
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * Sender Bank address must be on wNOK allowlist.
     */
    function test_revertIf_senderBankNotWnokListed() public {
        vm.prank(wnokadmin);
        wnok.remove(bank1);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.AllowlistViolation.selector, wnokName, bank1, "originator not on allowlist")
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * Recipient TBD contract must be on wNOK allowlist.
     */
    function test_revertIf_recipientTbdNotWnokListed() public {
        vm.prank(wnokadmin);
        wnok.remove(address(tbd2));
        vm.expectRevert(
            abi.encodeWithSelector(Errors.AllowlistViolation.selector, wnokName, tbd2, "recipient not on allowlist")
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * Sender Bank must have sufficient funds.
     */
    function test_revertIf_insufficientFunds() public {
        vm.prank(wnokadmin);
        wnok.burn(bank1, initAmountBank1Wnok);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, bank1, 0, cctAmount));
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
    }

    /**
     * Caller must have sufficient allowance over sender bank's funds.
     */
    function test_revertIf_insufficientAllowance() public {
        vm.prank(bank1);
        wnok.approve(address(tbd1), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(tbd1), 0, cctAmount)
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
    }

    /**
     * Sender TBD contract must have TRANSFER_FROM_ROLE on central bank contract.
     */
    function test_revertIf_transferFromRoleMissing() public {
        vm.prank(wnokadmin);
        wnok.revokeRole(Roles.TRANSFER_FROM_ROLE, address(tbd1));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(tbd1), Roles.TRANSFER_FROM_ROLE
            )
        );
        vm.prank(investor1tbd);
        tbd1.cctFrom(investor1tbd, investor2tbd, address(tbd2), cctAmount);
        _assertEmpty();
        _assertInitFunds();
    }

    /**
     * Common settle() call executed at the end of every test below.
     */
    function _settle() public returns (bool) {
        return dvp.settle(
            address(sec),
            investor2sec, // seller
            investor1sec, // buyer
            secValue,
            investor2tbd,
            investor1tbd,
            wholesaleValue,
            address(tbd2),
            address(tbd1)
        );
    }

    /**
     * Settle works (given the necessary approvals)
     */
    function test_settle() public {
        vm.prank(dvpadmin);
        _settle();
    }

    /**
     * The DvP caller must have the SETTLE_ROLE.
     */
    function test_revertIf_missingSettleRole() public {
        vm.prank(investor1tbd);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, investor1tbd, Roles.SETTLE_ROLE
            )
        );
        _settle();
    }

    /**
     * The DvP contract must have the CCT_FROM_CALLER_ROLE
     * on the sending TBD contract.
     */
    function test_revertIf_missingFromCallerRole() public {
        vm.prank(tbd1admin);
        tbd1.revokeRole(Roles.CCT_FROM_CALLER_ROLE, address(dvp));
        vm.prank(dvpadmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Unknown,
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, address(dvp), Roles.CCT_FROM_CALLER_ROLE
                )
            )
        );
        _settle();
    }

    /**
     * The TBD sender address must be allowlisted.
     */
    function test_revertIf_tbdSenderNotListed() public {
        vm.prank(tbd1admin);
        tbd1.remove(investor1tbd);
        vm.prank(dvpadmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Unknown,
                abi.encodeWithSelector(Errors.AllowlistViolation.selector, tbd1Name, investor1tbd, "")
            )
        );
        _settle();
    }

    /**
     * The TBD recipient address must be allowlisted.
     */
    function test_revertIf_tbdRecipientNotListed() public {
        vm.prank(tbd2admin);
        tbd2.remove(investor2tbd);
        vm.prank(dvpadmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Seller,
                abi.encodeWithSelector(Errors.AllowlistViolation.selector, tbd2Name, investor2tbd, "")
            )
        );
        _settle();
    }

    /**
     * The DvP contract requires CUSTODIAL_TRANSFER_ROLE on security.
     */
    function test_revertIf_missingCustodialTransferRole() public {
        vm.startPrank(dvpadmin);
        sec.revokeRole(Roles.CUSTODIAL_TRANSFER_ROLE, address(dvp));
        vm.expectRevert(
            abi.encodeWithSelector(
                DvP.SettlementFailure.selector,
                DvP.FailureReason.Unknown,
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector,
                    address(dvp),
                    Roles.CUSTODIAL_TRANSFER_ROLE
                )
            )
        );
        _settle();
    }
}
