// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "@common/Roles.sol";

/**
 * A simple on-chain allowlist based on the `mapping` type.
 */
abstract contract Allowlist is AccessControl {
    /**
     * The names of key and value are only relevant for the ABI.
     * See <https://docs.soliditylang.org/en/v0.8.29/types.html#mapping-types>
     */
    mapping(address account => bool allowed) _allowlist;
    address[] _allAllowed;

    /**
     * @dev Construct a new allowlist.
     * @param owner The owner of the new allowlist.
     */
    constructor(address owner) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(Roles.ALLOWLIST_ADMIN_ROLE, owner);
    }

    /**
     * @dev Add a new address to the allowlist.
     * @param account The address to be added.
     */
    function add(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE) {
        if (!_allowlist[account]) {
            _allowlist[account] = true;
            _allAllowed.push(account);
        }
    }

    /**
     * @dev Remove an address from the allowlist. Succeeds also if the address
     * was not previously included in the list.
     * @param account The address to be removed.
     */
    function remove(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE) {
        _allowlist[account] = false;
        for (uint256 i = 0; i < _allAllowed.length; i++) {
            if (_allAllowed[i] == account) {
                _allAllowed[i] = _allAllowed[_allAllowed.length - 1];
                _allAllowed.pop();
                break;
            }
        }
    }

    /**
     * @dev Query the allowlist.
     * @param account The account for which to query the allowlist status
     * @return True if `account` is present on the allowlist, false otherwise
     */
    function allowlistQuery(address account) external view returns (bool) {
        return _allowlist[account];
    }

    /**
     * @dev Query the allowlist.
     * @return allowlist The array of all allowed addresses
     */
    function allowlistQueryAll() external view returns (address[] memory) {
        return _allAllowed;
    }
}
