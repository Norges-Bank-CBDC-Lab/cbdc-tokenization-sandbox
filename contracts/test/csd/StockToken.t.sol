// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {IAccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";
import {StockToken, BaseSecurityToken} from "@csd/StockToken.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";
import {Test} from "forge-std/Test.sol";

contract StockTokenTest is Test {
    // region Variables
    // Structs to hold parameters for the StockToken and the environment
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
        bytes32 custodialTransferRole;
        bytes32 securityOperatorRole;
        address alice;
        address bob;
    }

    StockToken token;
    address implementationToken;
    StockParams params;
    Environment env;

    // endregion

    // region Setup

    function setUp() public {
        env = Environment({
            issuerOwner: address(0x1),
            csd1: address(0x2),
            csd2: address(0x3),
            operator1: address(0x4),
            custodialTransferRole: Roles.CUSTODIAL_TRANSFER_ROLE,
            securityOperatorRole: Roles.SECURITY_OPERATOR_ROLE,
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
            initialSupply: 1_000_000
        });

        implementationToken = address(new StockToken());
        StockTokenFactory factory = new StockTokenFactory(implementationToken, params.issuerAddr);
        vm.prank(params.issuerAddr);
        address clone = factory.createStockToken(
            params.name, params.symbol, params.isin, params.initialSupply, params.issuerName, params.description
        );
        token = StockToken(clone);
    }

    // endregion

    // region Tests

    // Test to verify that total supply is set correctly and given to correct address
    function test_InitialBalanceAssignedToIssuer() public {
        vm.prank(env.issuerOwner);
        assertEq(
            token.balanceOf(env.issuerOwner), params.initialSupply, "Initial balance should be assigned to the issuer"
        );
    }

    // test to verify that the issuer can approve a CSD
    function test_IssuerCanApproveCSD() public {
        assertFalse(token.isCSDApproved(env.csd1), "CSD should not be approved initially");

        vm.prank(env.issuerOwner);
        token.grantRoleTo(env.custodialTransferRole, env.csd1);

        assertTrue(token.isCSDApproved(env.csd1), "CSD should be approved after issuer grants role");
    }

    // test that it reverts if a non-approved operator tries to approve a CSD
    function test_Revert_NonOperator_CanNot_Approve_CSD() public {
        vm.expectRevert(abi.encodeWithSelector(BaseSecurityToken.NotApprovedOperator.selector, env.operator1));

        vm.prank(env.operator1);
        token.grantRoleTo(env.custodialTransferRole, env.csd1);
    }

    // test that an approved Operator can approve a CSD
    function test_ApprovedOperator_Can_Approve_CSD() public {
        assertFalse(token.isCSDApproved(env.csd1), "CSD should not be approved initially");

        vm.prank(env.issuerOwner);
        token.grantRoleTo(env.securityOperatorRole, env.operator1);

        vm.prank(env.operator1);
        token.grantRoleTo(env.custodialTransferRole, env.csd1);

        assertTrue(token.isCSDApproved(env.csd1), "CSD should be approved after operator grants role");
    }

    // test that an approved CSD can use custodial transfer
    function test_ApprovedCSD_CanUse_CustodialTransfer() public {
        vm.startPrank(env.issuerOwner);
        token.grantRoleTo(env.custodialTransferRole, env.csd1);
        token.add(env.alice);
        assertTrue(token.transfer(env.alice, 1000));
        token.add(env.bob);
        vm.stopPrank();

        vm.prank(env.csd1);
        bool result = token.custodialTransfer(env.alice, env.bob, 500);

        assertEq(token.balanceOf(env.alice), 500, "Alice should have 500 tokens after custodial transfer");
        assertEq(token.balanceOf(env.bob), 500, "Bob should have 500 tokens after custodial transfer");
        assertTrue(result);
    }

    // test that a non-approved CSD cannot use custodial transfer
    function test_Revert_UnapprovedCSD_Cannot_CustodialTransfer() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, env.csd1, env.custodialTransferRole
            )
        );

        vm.prank(env.csd1);
        token.custodialTransfer(env.alice, env.bob, 100);
    }

    // the receiver must be in the allowlist
    function test_revertIf_receiverIsNotInAllowlist() public {
        vm.startPrank(env.issuerOwner);
        token.grantRoleTo(env.custodialTransferRole, env.csd1);
        token.add(env.alice);
        assertTrue(token.transfer(env.alice, 1000));
        vm.stopPrank();

        _expectAllowlistViolation(env.bob, "");

        vm.prank(env.csd1);
        token.custodialTransfer(env.alice, env.bob, 500);
    }
    // endregion

    function _expectAllowlistViolation(address account, string memory message) private {
        vm.expectRevert(abi.encodeWithSelector(Errors.AllowlistViolation.selector, params.name, account, message));
    }
}
// Add a new task for improved testing on the StockToken roles check and basic ERC20 token.
//
