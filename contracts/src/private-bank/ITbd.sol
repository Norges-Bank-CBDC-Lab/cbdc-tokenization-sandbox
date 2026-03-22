// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

interface ITbd {
    /*
    * NOTE: the ERC-165 identifier for this interface is 2cc34a49.
    * 2cc34a49 ===
    *   bytes4(keccak256('cctFrom(address,address,address,uint256)')) ^     = 6c8bb815
    *   bytes4(keccak256('cctSetToAddr(address)'))                          = 4048f25c
    */

    /**
     * @dev Moves a `value` amount of tokens from the from account to `to`
     * via the customer credit transfer (cct) settlement process, using the CBDC.
     * @param from The TBD address from which tokens are being transferred.
     * @param to The TBD address to which tokens are being transferred.
     * @param toTbdContract The receiving TBD contract.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating the operation succeeded unless throwing.
     */
    function cctFrom(address from, address to, address toTbdContract, uint256 value) external returns (bool);

    /**
     * @dev Sets a client payout address for the caller within the receiving TBD contract
     * @param to The client's TBD address to which tokens are being transferred during all following
     * cct calls from the same sending TBC contract.
     */
    function cctSetToAddr(address to) external;

    /**
     * @dev Returns government reserve address if nominated.
     */
    function govReserve() external view returns (address);

    /**
     * @dev Returns if TBD has been government nominated for reserve access.
     */
    function isGovernmentNominated() external view returns (bool);
}
