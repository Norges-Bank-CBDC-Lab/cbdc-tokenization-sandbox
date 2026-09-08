// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/**
 * @notice Interface for the Bond Manager contract.
 */
interface IBondManager {
    event BondCreated(string isin, address bondAddress, uint256 maturityDurationSeconds);
    event BondDisabled(string isin);
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

    // Coupon payment event (one per holder per period)
    event CouponPaid(string indexed isin, address indexed holder, uint256 paymentAmount, uint256 paymentNumber);

    // Principal repayment event (one per holder, final period only)
    event BondRedeemed(string indexed isin, address indexed holder, uint256 value, uint256 wnokAmount);

    /**
     * @notice Emitted once when the final coupon closes the bond: every unit is burned, holders
     *         were paid coupon plus principal, and unsold units held by the manager were burned
     *         without payment.
     * @param isin ISIN of the closed bond.
     * @param paymentCount Number of coupon periods paid over the bond's life.
     * @param principalPaid Total nominal repaid to holders in WNOK.
     * @param couponPaid Total coupon paid in the final period in WNOK.
     * @param unsoldBurned Units held by the manager that were burned without payment.
     */
    event BondMatured(
        string indexed isin, uint256 paymentCount, uint256 principalPaid, uint256 couponPaid, uint256 unsoldBurned
    );
}
