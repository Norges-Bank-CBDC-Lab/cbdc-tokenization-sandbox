// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Roles} from "@common/Roles.sol";

/**
 * A simple on-chain allowlist based on the `mapping` type.
 */
abstract contract AllowlistUpgradeable is AccessControlUpgradeable {
    /**
     * The names of key and value are only relevant for the ABI.
     * See <https://docs.soliditylang.org/en/v0.8.29/types.html#mapping-types>
     */
    /// @custom:storage-location erc7201:cbdc.Allowlist
    struct AllowlistStorage {
        mapping(address account => bool allowed) _allowlist;
        address[] _allAllowed;
    }

    // keccak256(abi.encode(uint256(keccak256("cbdc.Allowlist")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ALLOWLIST_STORAGE_LOCATION =
        0x681f0e71da647f540c6449ed1596871848c3cbd7ee0430f865b5103cdaaee500;

    function _getAllowlistStorage() private pure returns (AllowlistStorage storage $) {
        assembly {
            $.slot := ALLOWLIST_STORAGE_LOCATION
        }
    }

    /**
     * @dev Construct a new allowlist.
     * @param owner The owner of the new allowlist.
     */
    // forge-lint: disable-next-line(mixed-case-function)
    function __Allowlist_init(address owner) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(Roles.ALLOWLIST_ADMIN_ROLE, owner);
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function __Allowlist_init_unchained(address owner) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(Roles.ALLOWLIST_ADMIN_ROLE, owner);
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function __Allowlist_initAndAddOwnerToAllowlist(address owner) internal onlyInitializing {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(Roles.ALLOWLIST_ADMIN_ROLE, owner);

        AllowlistStorage storage $ = _getAllowlistStorage();
        $._allowlist[owner] = true;
    }

    /**
     * @dev Add a new address to the allowlist.
     * @param account The address to be added.
     */
    function add(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE) {
        AllowlistStorage storage $ = _getAllowlistStorage();
        if (!$._allowlist[account]) {
            $._allowlist[account] = true;
            $._allAllowed.push(account);
        }
    }

    /**
     * @dev Remove an address from the allowlist. Succeeds also if the address
     * was not previously included in the list.
     * @param account The address to be removed.
     */
    function remove(address account) external onlyRole(Roles.ALLOWLIST_ADMIN_ROLE) {
        AllowlistStorage storage $ = _getAllowlistStorage();
        $._allowlist[account] = false;
        for (uint256 i = 0; i < $._allAllowed.length; i++) {
            if ($._allAllowed[i] == account) {
                $._allAllowed[i] = $._allAllowed[$._allAllowed.length - 1];
                $._allAllowed.pop();
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
        AllowlistStorage storage $ = _getAllowlistStorage();
        return $._allowlist[account];
    }

    /**
     * @dev Query the allowlist.
     * @return _allAllowed with all addresses that are present on allowlist
     */
    function allowlistQueryAll() external view returns (address[] memory) {
        AllowlistStorage storage $ = _getAllowlistStorage();
        return $._allAllowed;
    }

    function allowlistQueryInternal(address account) internal view returns (bool) {
        AllowlistStorage storage $ = _getAllowlistStorage();
        return $._allowlist[account];
    }
}
