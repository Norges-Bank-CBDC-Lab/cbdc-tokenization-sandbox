// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1363Receiver} from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";

import {Allowlist} from "@common/Allowlist.sol";
import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title The wNOK tokenized currency
 * @notice A contract for a currency that adheres to the ERC20 token standard.
 * This contract implements an ERC1363 function (transferFromAndCall), but is
 * not IERC1363-compliant because no other functions from that standard are
 * currently needed by our protocol. It would be straightforward to make this
 * token ERC1363-compliant by implementing the remaining functions.
 */
contract Wnok is ERC20, AccessControl, Allowlist {
    /**
     * ERC165 supported interfaces.
     */
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /**
     * An event emitted when the contract is successfully invoked by a TBD
     * contract for settlement.
     */
    event Settlement(address indexed fromBankAddr, address indexed toTbdContrAddr, uint256 value);

    /**
     * @dev Create a new wNOK token.
     * @param admin The admin account of the token
     * @param name_ of the Wnok contract
     * @param symbol_ of the Wnok token
     */
    constructor(address admin, string memory name_, string memory symbol_) Allowlist(admin) ERC20(name_, symbol_) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(Roles.MINTER_ROLE, admin);
        _grantRole(Roles.BURNER_ROLE, admin);
        _supportedInterfaces[Wnok(address(0)).transferFromAndCall.selector] = true;
        _supportedInterfaces[Wnok(address(0)).supportsInterface.selector] = true;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return _supportedInterfaces[interfaceId] || super.supportsInterface(interfaceId);
    }

    /**
     * @dev A mint function callable by the contract admin.
     * @param account Receiving account of the newly minted tokens
     * @param value Value to mint in token units
     */
    function mint(address account, uint256 value) public onlyRole(Roles.MINTER_ROLE) {
        if (!_allowlist[account]) {
            revert Errors.AllowlistViolation(ERC20.name(), account, "mint address not on allowlist");
        }
        _mint(account, value);
    }

    /**
     * @dev A burn function callable by the contract admin.
     * @param account Account from which to remove the burned tokens
     * @param value Value to burn in token units
     */
    function burn(address account, uint256 value) public onlyRole(Roles.BURNER_ROLE) {
        if (!_allowlist[account]) {
            revert Errors.AllowlistViolation(ERC20.name(), account, "burn address not on allowlist");
        }
        _burn(account, value);
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual override returns (uint8) {
        return 0;
    }

    /**
     * Override transfer with allowlist checks for the sender and {to}, but
     * otherwise identical to the OpenZeppelin ERC20 implementation.
     */
    function transfer(address to, uint256 value) public virtual override(ERC20) returns (bool) {
        address owner = _msgSender();
        if (!_allowlist[owner]) {
            revert Errors.AllowlistViolation(ERC20.name(), owner, "originator not on allowlist");
        }
        if (!_allowlist[to]) {
            revert Errors.AllowlistViolation(ERC20.name(), to, "recipient not on allowlist");
        }
        return super.transfer(to, value);
    }

    /**
     * Override transferFrom with allowlist checks for {from} and {to}, but
     * otherwise identical to the OpenZeppelin ERC20 implementation.
     * Note: The caller of this function needs only TRANSFER_FROM_ROLE and does
     * not have to be allowlisted.
     */
    function transferFrom(address from, address to, uint256 value)
        public
        override(ERC20)
        onlyRole(Roles.TRANSFER_FROM_ROLE)
        returns (bool)
    {
        if (!_allowlist[from]) {
            revert Errors.AllowlistViolation(ERC20.name(), from, "originator not on allowlist");
        }
        if (!_allowlist[to]) {
            revert Errors.AllowlistViolation(ERC20.name(), to, "recipient not on allowlist");
        }
        return super.transferFrom(from, to, value);
    }

    /**
     * @dev Trigger a transfer and call {onTransferReceived} on the receiver
     * contract.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool) {
        IERC1363Receiver toTbdContract = IERC1363Receiver(to);
        transferFrom(from, to, value);
        emit Settlement(from, to, value);
        bytes4 success = toTbdContract.onTransferReceived(msg.sender, from, value, "");
        bytes4 expected = IERC1363Receiver.onTransferReceived.selector;
        if (success != expected) {
            revert Errors.CallbackFailed(success);
        }
        return true;
    }
}
