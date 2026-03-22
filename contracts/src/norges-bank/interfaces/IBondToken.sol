// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {IERC1410} from "@norges-bank/ERC1410/IERC1410.sol";

/**
 * @notice Interface for the ERC1410-partitioned bond token keyed by ISIN.
 */
interface IBondToken is IERC1410 {
    event IsinIssued(string isin, uint256 offering);
    event IsinEnabled(string isin, uint256 couponDuration, uint256 couponYield);
    event IsinExtended(string isin, uint256 delta, uint256 newOffering);
    event IsinReduced(string isin, uint256 delta, uint256 newOffering);
    event IsinMinted(string isin, address dst, uint256 value);
    event IsinRedeemed(string isin, address indexed holder, uint256 value, address operator);

    function UNIT_NOMINAL() external view returns (uint256);

    function activePartitions(bytes32 partition) external view returns (bool);

    function partitionOffering(bytes32 partition) external view returns (uint256);

    function maturityDuration(bytes32 partition) external view returns (uint256);

    function maturityDate(bytes32 partition) external view returns (uint256);

    function couponDuration(bytes32 partition) external view returns (uint256);

    function couponYield(bytes32 partition) external view returns (uint256);

    function lastCouponPayment(bytes32 partition) external view returns (uint256);

    function couponPaymentCount(bytes32 partition) external view returns (uint256);

    function isMatured(bytes32 partition) external view returns (bool);

    function addController(address _controller) external;

    function isinToPartition(string memory _isin) external pure returns (bytes32 partition);
    function partitionToIsin(bytes32 partition) external view returns (string memory);

    function createPartition(string memory _isin, uint256 _offering, uint256 _maturityDuration) external;

    function enableByIsin(string memory _isin, uint256 _couponDuration, uint256 _couponYield) external;

    function extendPartitionOffering(string memory _isin, uint256 _additionalOffering) external;

    function reducePartitionOffering(string memory _isin, uint256 _reductionAmount) external;

    function mintByIsin(string memory _isin, address account, uint256 value) external;

    function redeemFor(address _holder, string memory _isin, uint256 _value, address _operator) external;

    function buybackRedeemFor(address _holder, string memory _isin, uint256 _value, address _operator) external;

    function updateCouponPayment(string memory _isin, uint256 _timestamp, uint256 _paymentCount) external;

    function setMatured(string memory _isin) external;

    function getCouponDetails(string memory _isin)
        external
        view
        returns (
            uint256 _couponDuration,
            uint256 _couponYield,
            uint256 _maturityDuration,
            uint256 _lastCouponPayment,
            uint256 _couponPaymentCount
        );
}
