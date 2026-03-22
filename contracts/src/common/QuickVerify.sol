// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/// @title QuickVerify
/// @notice Tiny contract for ad-hoc deployment/verification checks.
contract QuickVerify {
    uint256 public number;

    constructor(uint256 initialNumber) {
        number = initialNumber;
    }

    function setNumber(uint256 newNumber) external {
        number = newNumber;
    }
}
