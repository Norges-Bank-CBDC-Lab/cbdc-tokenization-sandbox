// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/**
 * @notice Interface for the Bond Manager contract.
 */
interface IBondManager {
    event BondAuctionInitialised(
        bytes32 indexed id, string isin, address bondAddress, uint256 offering, uint256 maturityDurationSeconds
    );
    event BondExtensionAuctionInitialised(
        bytes32 indexed id, string isin, address bondAddress, uint256 additionalOffering
    );
    event BondBuybackAuctionInitialised(bytes32 indexed id, string isin, address bondAddress, uint256 buybackSize);
    event BondAuctionClosed(bytes32 indexed id, string isin);
    event BondAuctionFinalised(bytes32 indexed id, string isin, bool dvpSuccess);
    event BondAuctionCancelled(bytes32 indexed id, string isin, uint256 offeringReduced);

    event BondAllocationFailed(bytes32 indexed id, string isin, address indexed bidder, string reason);

    event BondIssuanceComplete(bytes32 indexed id, string isin, uint256 total);
    event BondBuybackComplete(bytes32 indexed id, string isin, uint256 total);

    // Redemption event
    event BondRedeemed(string indexed isin, address indexed holder, uint256 value, uint256 wnokAmount);
    event BondRedemptionComplete(string indexed isin);

    // Coupon payment event
    event CouponPaid(string indexed isin, address indexed holder, uint256 paymentAmount, uint256 paymentNumber);
    event AllCouponsPaid(string indexed isin);
}
