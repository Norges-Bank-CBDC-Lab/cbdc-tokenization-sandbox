// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {ClientList} from "@broker/ClientList.sol";
import {ClientAddresses} from "@broker/ClientList.sol";
import {Errors} from "@common/Errors.sol";
import {Test} from "forge-std/Test.sol";

/**
 * Test wrapper to expose internal methods for testing purposes.
 */
contract TestableClientList is ClientList {
    constructor(address admin) ClientList(admin) {}

    function getTbdWalletPublic(address clientWallet) external view returns (address) {
        return getTbdWallet(clientWallet);
    }

    function getSecuritiesWalletPublic(address clientWallet) external view returns (address) {
        return getSecuritiesWallet(clientWallet);
    }

    function clientExistsGuardPublic(address clientWallet) external view {
        clientExistsGuard(clientWallet);
    }
}

contract ClientListTest is Test {
    TestableClientList clientList;

    address admin = address(this);
    address clientWallet = address(0x1);
    address tbdWallet = address(0x2);
    address secWallet = address(0x3);
    address stranger = address(0x4);
    address tbdContrAddr = address(0x5);

    function setUp() public {
        clientList = new TestableClientList(admin);
    }

    /// @notice Admin can add a clientWallet and assign wallets; wallets are retrievable.
    function test_addClient_asAdmin() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        assertEq(clientList.getTbdWalletPublic(clientWallet), tbdWallet);
        assertEq(clientList.getSecuritiesWalletPublic(clientWallet), secWallet);
    }

    /// @notice Admin can remove a clientWallet, clearing both wallet mappings.
    function test_removeClient_asAdmin() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        clientList.removeClient(clientWallet);
        assertEq(clientList.getTbdWalletPublic(clientWallet), address(0));
        assertEq(clientList.getSecuritiesWalletPublic(clientWallet), address(0));
    }

    /// @notice Non-admin attempting to add a clientWallet should be denied access.
    function test_revertIf_addClient_asNonAdmin() public {
        vm.expectRevert();
        vm.prank(stranger);
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
    }

    /// @notice Non-admin attempting to remove a clientWallet should be denied access.
    function test_revertIf_removeClient_asNonAdmin() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        vm.expectRevert();
        vm.prank(stranger);
        clientList.removeClient(clientWallet);
    }

    /// @notice clientExistsGuard should pass silently for a valid clientWallet.
    function test_clientExistsGuard_allows_validClient() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        clientList.clientExistsGuardPublic(clientWallet); // should not revert
    }

    /// @notice ClientList can be queried. Admin can add clientWallet to clientList.
    function test_getAllClients() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        ClientAddresses[] memory clients = clientList.getAllClients();
        ClientAddresses[] memory expectedClientList = new ClientAddresses[](1);
        expectedClientList[0] = ClientAddresses({
            clientWallet: clientWallet, tbdWallet: tbdWallet, securitiesWallet: secWallet, tbdContrAddr: tbdContrAddr
        });
        assertEq(clients.length, expectedClientList.length);
        for (uint256 i = 0; i < clients.length; i++) {
            assertEq(clients[i].clientWallet, expectedClientList[i].clientWallet);
            assertEq(clients[i].tbdWallet, expectedClientList[i].tbdWallet);
            assertEq(clients[i].securitiesWallet, expectedClientList[i].securitiesWallet);
            assertEq(clients[i].tbdContrAddr, expectedClientList[i].tbdContrAddr);
        }
    }

    /// @notice clientExsistsGuard should revert for an unknown clientWallet.
    function test_revertIf_clientExsistsGuard_invalidClient() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.AllowlistViolation.selector, "as", address(this), "clientWallet not on brokers allowlist"
            )
        );
        clientList.clientExistsGuardPublic(clientWallet);
    }

    /// @notice Adding a clientWallet again should overwrite existing wallet mappings.
    function test_overwritingClient_shouldUpdateWallets() public {
        clientList.addClient(clientWallet, tbdWallet, secWallet, tbdContrAddr);
        address newTbdWallet = address(0x5);
        address newSecWallet = address(0x6);
        clientList.addClient(clientWallet, newTbdWallet, newSecWallet, tbdContrAddr);

        assertEq(clientList.getTbdWalletPublic(clientWallet), newTbdWallet);
        assertEq(clientList.getSecuritiesWalletPublic(clientWallet), newSecWallet);
    }

    /// @notice Removing a non-existent clientWallet should not revert or affect state.
    function test_remove_nonExistingClient_shouldNotRevert() public {
        // Should succeed without error even if clientWallet wasn't added
        clientList.removeClient(clientWallet);
    }
}
