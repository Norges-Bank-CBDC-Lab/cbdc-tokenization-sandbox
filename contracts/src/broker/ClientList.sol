// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "@common/Roles.sol";
import {Errors} from "@common/Errors.sol";

struct ClientAddresses {
    address clientWallet;
    address tbdWallet;
    address securitiesWallet;
    address tbdContrAddr;
}

/**
 * @title ClientList
 * @notice Maintains a registry of allowed clients and their associated money and securities wallets.
 * @dev Access control is inherited from OpenZeppelin's AccessControl. Only admins can add or remove clients.
 */
contract ClientList is AccessControl {
    /**
     *  @notice Structure to hold a client's wallet information.
     */
    struct ClientInfo {
        bool exists;
        bool allowed; // currently, always true
        address tbdWalletAddr;
        address securitiesWalletAddr;
        address tbdContrAddr;
    }

    /**
     *  @notice Mapping of client addresses to their associated wallet information.
     */
    mapping(address clientWallet => ClientInfo) private _clients;
    ClientAddresses[] private _allClients;

    /**
     *  @dev Construct a new clientlist.
     *  @param owner The owner of the new clientlist.
     */
    constructor(address owner) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(Roles.CLIENT_ADMIN_ROLE, owner);
    }

    /**
     *  @dev Add client and assign wallets to them, overwrite existing entries
     *  @param clientWallet The client address.
     * @param tbdWallet The wallet address used for cash tokens.
     * @param securitiesWallet The wallet address used for securities tokens.
     */
    function addClient(address clientWallet, address tbdWallet, address securitiesWallet, address tbdContrAddr)
        external
        onlyRole(Roles.CLIENT_ADMIN_ROLE)
    {
        if (!_clients[clientWallet].exists) {
            _allClients.push(
                ClientAddresses({
                    clientWallet: clientWallet,
                    tbdWallet: tbdWallet,
                    securitiesWallet: securitiesWallet,
                    tbdContrAddr: tbdContrAddr
                })
            );
        } else {
            _removeClient(clientWallet);
            _allClients.push(
                ClientAddresses({
                    clientWallet: clientWallet,
                    tbdWallet: tbdWallet,
                    securitiesWallet: securitiesWallet,
                    tbdContrAddr: tbdContrAddr
                })
            );
        }
        _clients[clientWallet] = ClientInfo({
            exists: true,
            allowed: true,
            tbdWalletAddr: tbdWallet,
            securitiesWalletAddr: securitiesWallet,
            tbdContrAddr: tbdContrAddr
        });
    }

    /**
     * @dev Remove a client's wallet mapping.
     * @param clientWallet The client address.
     */
    function removeClient(address clientWallet) external onlyRole(Roles.CLIENT_ADMIN_ROLE) {
        _removeClient(clientWallet);
    }

    /**
     * @dev Get a clients securities wallet address
     * @param clientWallet The client address.
     */
    function getTbdContrAddr(address clientWallet) public view returns (address) {
        return _clients[clientWallet].tbdContrAddr;
    }

    /**
     * @dev Get a clients money wallet address
     * @param clientWallet The clientWallet address.
     */
    function getTbdWallet(address clientWallet) internal view returns (address) {
        return _clients[clientWallet].tbdWalletAddr;
    }

    /**
     * @dev Get a clients securities wallet address
     * @param clientWallet The client address.
     */
    function getSecuritiesWallet(address clientWallet) internal view returns (address) {
        return _clients[clientWallet].securitiesWalletAddr;
    }

    /**
     * @dev Throws and reverts if the clientWallet is not on the client list
     * @param clientWallet The client address.
     */
    function clientExistsGuard(address clientWallet) internal view {
        if (!_clients[clientWallet].allowed) {
            revert Errors.AllowlistViolation("as", msg.sender, "clientWallet not on brokers allowlist");
        }
    }

    /**
     * @dev Query the ClientList.
     * @return _allClients with all addresses that are present on ClientList
     */
    function getAllClients() external view returns (ClientAddresses[] memory) {
        return _allClients;
    }

    /**
     * @dev Remove a client from internal lists. Remove also duplicates
     * @param clientWallet The client address.
     */
    function _removeClient(address clientWallet) internal {
        uint256 i = 0;
        delete _clients[clientWallet];
        while (i < _allClients.length) {
            if (_allClients[i].clientWallet == clientWallet) {
                _allClients[i] = _allClients[_allClients.length - 1];
                _allClients.pop();
            } else {
                i++;
            }
        }
    }
}
