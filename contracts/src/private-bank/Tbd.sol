// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Allowlist} from "@common/Allowlist.sol";
import {Errors} from "@common/Errors.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1363Receiver} from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import {ITbd} from "./ITbd.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title The TBD tokenized bank money
 * @notice A contract for a tokenized bank deposit that adheres to the ERC20 token standard.
 */
contract Tbd is ITbd, IERC1363Receiver, ERC20, AccessControl, Allowlist {
    /**
     * ERC165 supported interfaces.
     */
    mapping(bytes4 => bool) internal _supportedInterfaces;

    /**
     * mapping which allows to set a to for each TBD contract
     * TBD will be minted to this address during cct calls
     */
    mapping(address from => address to) private _cctFromToList;

    address private immutable _BANK;
    Wnok private immutable _WNOK;

    /**
     * Defined government reserve account;
     */
    address public govReserve;

    /**
     * @dev Create a new TBD token.
     * @param admin The user to receive DEFAULT_ADMIN_ROLE
     * @param bank The bank which owns the token
     * @param wnok The global central bank contract
     * @param dvp The global DvP contract
     * @param name_ of the TBD contract
     * @param symbol_ of the TBD token
     */
    constructor(
        address admin,
        address bank,
        address wnok,
        address dvp,
        string memory name_,
        string memory symbol_,
        address _govReserve
    ) Allowlist(admin) ERC20(name_, symbol_) {
        if (admin == address(0)) revert Errors.AdminAddressZero();
        if (bank == address(0)) revert Errors.BankAddressZero();
        if (wnok == address(0)) revert Errors.WnokAddressZero();
        if (dvp == address(0)) revert Errors.DvpAddressZero();

        // ERC-165
        _supportedInterfaces[Tbd(address(0)).supportsInterface.selector] = true;
        // ERC-1363Receiver
        _supportedInterfaces[Tbd(address(0)).onTransferReceived.selector] = true;
        // ITbd
        _supportedInterfaces[Tbd(address(0)).cctFrom.selector ^ Tbd(address(0)).cctSetToAddr.selector] = true;

        govReserve = _govReserve;
        _BANK = bank;
        _WNOK = Wnok(wnok);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(Roles.MINTER_ROLE, admin);
        _grantRole(Roles.BURNER_ROLE, admin);
        _grantRole(Roles.CBDC_CONTRACT_ROLE, address(wnok));
        _grantRole(Roles.CCT_FROM_CALLER_ROLE, address(dvp));
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return _supportedInterfaces[interfaceId] || super.supportsInterface(interfaceId);
    }

    /**
     * @inheritdoc IERC1363Receiver
     */
    function onTransferReceived(address operator, address, uint256 value, bytes calldata) external returns (bytes4) {
        _checkRole(Roles.CBDC_CONTRACT_ROLE, msg.sender);

        address to = _cctFromToList[operator];
        if (to == address(0)) revert Errors.InvalidReceiver();

        // Allowlist check for the receiver TBD address
        if (!_allowlist[to]) {
            revert Errors.AllowlistViolation(ERC20.name(), to, "");
        }

        // Mint the amount on the receiver address, do this before the next
        // external call to prevent possible reentrancy attacks
        _mint(to, value);

        // Pass token from this contract on to the bank address
        bool success = _WNOK.transfer(_BANK, value);
        if (!success) revert Errors.TokenTransferFailed();

        // Required by the interface
        return Tbd(address(0)).onTransferReceived.selector;
    }

    /**
     * @inheritdoc ITbd
     */
    function cctSetToAddr(address to) external {
        //TODO: consider introducing roles here, only TBD_CONTRACT_ROLE can call this

        _cctFromToList[msg.sender] = to;
    }

    /**
     * @inheritdoc ITbd
     */
    function cctFrom(address from, address to, address toTbdContrAddr, uint256 value)
        external
        onlyRole(Roles.CCT_FROM_CALLER_ROLE)
        returns (bool)
    {
        bool success;

        if (toTbdContrAddr == address(this)) {
            // internal transfer
            _transfer(from, to, value); // checks allowlist
        } else {
            // inter-bank transfer
            // only check the sender (via _burn), the receiver is checked by the receiver bank
            Tbd toTbd = Tbd(toTbdContrAddr);

            _burn(from, value);
            toTbd.cctSetToAddr(to);
            success = _WNOK.transferFromAndCall(_BANK, toTbdContrAddr, value);
            if (!success) revert Errors.CctFailed();
        }
        return true;
    }

    /**
     * @dev Get the registered bank address for this contract.
     * @return The bank address.
     */
    function getBankAddress() external view returns (address) {
        return _BANK;
    }

    /**
     * @dev Is TBD used for government issuance.
     * @return Boolean if TBD has been nominated.
     */
    function isGovernmentNominated() public view returns (bool) {
        return govReserve != address(0);
    }

    /**
     * @dev A mint function to convert gov. WNOK to TBD.
     * @param _value Value to mint in token units.
     */
    function _mintFromGovReserve(uint256 _value) internal {
        if (govReserve == address(0)) revert Errors.NotGovernmentNominated();
        bool ok = _WNOK.transferFrom(govReserve, address(this), _value);
        if (!ok) revert Errors.TokenTransferFailed();
        _mint(govReserve, _value);
    }

    /**
     * @dev A mint function callable by MINTER_ROLE.
     * @param account Receiving account of the newly minted tokens
     * @param value Value to mint in token units
     */
    function mint(address account, uint256 value) public onlyRole(Roles.MINTER_ROLE) {
        _mint(account, value);
    }

    /**
     * @dev A burn function callable by the BURNER_ROLE.
     * @param account Account from which to remove the burned tokens
     * @param value Value to burn in token units
     */
    function burn(address account, uint256 value) public onlyRole(Roles.BURNER_ROLE) {
        _burn(account, value);
    }

    /**
     * @dev Overwritten default transfer function to include also an allowlist check.
     *      Alternatively mints (or burns) if spender (or recipient) is the zero address
     * @param spender Account from which to transfer the tokens
     * @param recipient Account to which to transfer the tokens
     * @param value Value to transfer in token units
     */
    function _update(address spender, address recipient, uint256 value) internal override {
        if (spender != address(0) && !_allowlist[spender]) {
            revert Errors.AllowlistViolation(ERC20.name(), spender, "");
        }
        if (recipient != address(0) && !_allowlist[recipient]) {
            revert Errors.AllowlistViolation(ERC20.name(), recipient, "");
        }

        // Gov. reserve account will deposit and mint when transfer is requested
        if (isGovernmentNominated() && spender == govReserve) {
            _mintFromGovReserve(value);
        }

        return super._update(spender, recipient, value);
    }

    /**
     * @inheritdoc ERC20
     */
    function decimals() public view virtual override returns (uint8) {
        return 0;
    }
}
