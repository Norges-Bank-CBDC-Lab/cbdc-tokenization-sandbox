// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IBondManager} from "@norges-bank/interfaces/IBondManager.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {IBondToken} from "@norges-bank/interfaces/IBondToken.sol";
import {IBondDvP} from "@norges-bank/interfaces/IBondDvP.sol";
import {ITbd} from "@private-bank/ITbd.sol";

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondManager
 * @dev Atomic auction/bond creation & auction finalisation/DVP settlement.
 * @notice Access-controlled entrypoint for issuers to create bond partitions (ISINs), open/close auctions, and settle allocations.
 */
contract BondManager is IBondManager, AccessControl {
    uint256 private constant PERCENTAGE_PRECISION = 10000; // bps precision (e.g., 425 = 4.25%)

    string public name;

    /**
     * @notice Duration scalar for coupon intervals (for testing vs production)
     * @dev In production: 31556926 seconds (1 year), for testing: can be minutes
     */
    uint256 public immutable DURATION_SCALAR;

    /**
     * @notice Conversion rate from bond units to nominal value (e.g., 1 BOND = 1000 WNOK)
     * @dev Used to calculate payment amounts during issuance, buyback, redemption, and coupon
     */
    uint256 private immutable UNIT_NOMINAL;

    IBondAuction public immutable BOND_AUCTION;
    address public immutable WNOK;
    IBondToken public immutable BOND_TOKEN;

    IBondDvP public immutable BOND_DVP;

    /**
     * @notice Store target TBD for bond payments (cash leg)
     */
    address public immutable GOV_TBD;
    address private immutable _GOV_RESERVE;

    /**
     * @notice Assert bond active state to prevent parallel auctions on the same ISIN
     */
    mapping(string => bool) public bondActive;

    modifier isBondActive(string calldata _isin, bool _active) {
        _isBondActive(_isin, _active);
        _;
    }

    function _isBondActive(string calldata _isin, bool _active) internal view {
        if (bondActive[_isin] != _active) revert Errors.IncorrectBondState(_isin, _active);
    }

    /**
     * @param _name Name of the BondManager instance.
     * @param _wNok Address of the mock WNOK token used for the cash leg.
     * @param _controller Bond issuer address granted BOND_MANAGER_ROLE.
     * @param _bondAuction Address of the BondAuction instance coordinating sealed bids.
     * @param _bondToken Address of the BondToken contract (single deployment for all bonds).
     * @param _govTbd Government nominated TBD.
     * @param _durationScalar Duration scalar for coupon intervals (31556926 for year, smaller for testing)
     */
    constructor(
        string memory _name,
        address _wNok,
        address _controller,
        address _bondAuction,
        address _bondToken,
        address _bondDvp,
        address _govTbd,
        uint256 _durationScalar
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(Roles.BOND_MANAGER_ROLE, _controller);

        name = _name;

        WNOK = _wNok;
        BOND_AUCTION = IBondAuction(_bondAuction);
        BOND_TOKEN = IBondToken(_bondToken);
        BOND_DVP = IBondDvP(_bondDvp);
        GOV_TBD = _govTbd;

        _GOV_RESERVE = ITbd(GOV_TBD).govReserve();
        if (_GOV_RESERVE == address(0)) revert Errors.InvalidGovTbd();

        if (_durationScalar == 0) revert Errors.DurationScalarZero();
        DURATION_SCALAR = _durationScalar;

        UNIT_NOMINAL = BOND_TOKEN.UNIT_NOMINAL();
        if (UNIT_NOMINAL == 0) revert Errors.BondUnitNominalZero();
    }

    /**
     * @notice Deploys a new bond with a rate auction (initial bond issuance).
     * @param _isin Human ISIN string for the issuance (used as partition identifier).
     * @param _end Timestamp when sealed bidding closes.
     * @param _pubKey Auctioneer public key that matches client-side sealing keys.
     * @param _offering Total supply ceiling (offering size) for this partition.
     * @param _maturityDuration Duration in years from bond distribution until maturity.
     * @dev Always creates a RATE auction for initial bond issuance.
     * @dev Coupon yield is set from clearing rate when finalising the auction.
     * @dev Maturity duration is converted to seconds using DURATION_SCALAR (years * scalar = seconds).
     */
    function deployBondWithAuction(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _offering,
        uint256 _maturityDuration
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        bondActive[_isin] = true;
        if (_offering == 0) revert Errors.OfferingZero();
        if (_maturityDuration == 0) revert Errors.MaturityDurationZero();

        // Convert maturity duration from years to seconds using scalar
        uint256 maturityDurationSeconds = _maturityDuration * DURATION_SCALAR;

        // Create partition with offering size and maturity duration in seconds (coupon parameters set later)
        BOND_TOKEN.createPartition(_isin, _offering, maturityDurationSeconds);

        // Create RATE auction for initial bond issuance
        bytes32 id = BOND_AUCTION.createAuction(
            _isin, msg.sender, _end, _pubKey, address(BOND_TOKEN), _offering, IBondAuction.AuctionType.RATE
        );

        emit BondAuctionInitialised(id, _isin, address(BOND_TOKEN), _offering, maturityDurationSeconds);
    }

    /**
     * @notice Extends an existing bond with a price auction (bond extension).
     * @param _isin Human ISIN string for the existing bond.
     * @param _end Timestamp when sealed bidding closes.
     * @param _pubKey Auctioneer public key that matches client-side sealing keys.
     * @param _additionalOffering Additional offering size to add to the partition.
     * @dev Always creates a PRICE auction for bond extensions.
     * @dev Extends the partition offering size before creating the auction.
     */
    function extendBondWithAuction(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _additionalOffering
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        bondActive[_isin] = true;

        // Verify the bond exists by checking if partition is active in BondToken
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        if (!BOND_TOKEN.activePartitions(partition)) {
            revert Errors.BondDoesNotExist(_isin);
        }

        if (_additionalOffering == 0) revert Errors.AdditionalOfferingZero();

        // Extend partition offering size
        BOND_TOKEN.extendPartitionOffering(_isin, _additionalOffering);

        // Create PRICE auction for bond extension
        bytes32 id = BOND_AUCTION.createAuction(
            _isin, msg.sender, _end, _pubKey, address(BOND_TOKEN), _additionalOffering, IBondAuction.AuctionType.PRICE
        );

        emit BondExtensionAuctionInitialised(id, _isin, address(BOND_TOKEN), _additionalOffering);
    }

    /**
     * @notice Creates a buyback auction for an existing bond without changing the offering ceiling.
     * @param _isin Existing ISIN to buy back from.
     * @param _end Timestamp when sealed bidding closes.
     * @param _pubKey Auctioneer public key that matches client-side sealing keys.
     * @param _buybackSize Maximum units targeted for buyback (must not exceed current supply).
     */
    function buybackWithAuction(string calldata _isin, uint64 _end, bytes calldata _pubKey, uint256 _buybackSize)
        external
        onlyRole(Roles.BOND_MANAGER_ROLE)
        isBondActive(_isin, false)
    {
        bondActive[_isin] = true;

        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        if (!BOND_TOKEN.activePartitions(partition)) {
            revert Errors.BondDoesNotExist(_isin);
        }

        if (_buybackSize == 0) revert Errors.BuybackOfferingZero(_isin);

        uint256 currentSupply = BOND_TOKEN.totalSupplyByPartition(partition);
        if (_buybackSize > currentSupply) {
            revert Errors.BuybackExceedsSupply(_isin, _buybackSize, currentSupply);
        }

        bytes32 id = BOND_AUCTION.createAuction(
            _isin, msg.sender, _end, _pubKey, address(BOND_TOKEN), _buybackSize, IBondAuction.AuctionType.BUYBACK
        );

        emit BondBuybackAuctionInitialised(id, _isin, address(BOND_TOKEN), _buybackSize);
    }

    /**
     * @notice Finalises the auction and performs a naive DVP by transferring WNOK and Bond per allocation.
     * @dev Settlement enforces a single clearing rate and emits DVPFailed when ERC20 calls revert.
     * @dev For RATE auctions: payment is at full face value (rate represents interest rate).
     * @dev For PRICE auctions: payment is discounted based on price per 100 (rate represents price per 100).
     * @param _isin Target ISIN to settle.
     * @param _alloc Uniform-rate allocations produced off-chain.
     * @param _proofs Bidder signatures proving consent to each allocation.
     */
    function finaliseAuction(
        string calldata _isin,
        IBondAuction.Allocation[] memory _alloc,
        IBondAuction.BidVerification[] memory _proofs
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, true) {
        bondActive[_isin] = false;

        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        if (!BOND_TOKEN.activePartitions(partition)) {
            revert Errors.BondDoesNotExist(_isin);
        }

        if (_alloc.length == 0) revert Errors.NoAllocations();

        // Get auction type from first allocation (all should match)
        IBondAuction.AuctionType auctionType = _alloc[0].auctionType;

        // Call finalise
        bytes32 auctionId = BOND_AUCTION.getAuctionId(_isin);
        (uint256 total, uint256 clearingRate) = BOND_AUCTION.finaliseAuction(auctionId, msg.sender, _alloc, _proofs);

        // TODO: Post root of bids for transparency

        bool dvpSuccess;

        if (auctionType == IBondAuction.AuctionType.BUYBACK) {
            dvpSuccess = _settleBuyback(auctionId, _isin, partition, _alloc, total);
        } else {
            dvpSuccess = _settleIssuance(auctionId, _isin, partition, auctionType, _alloc, total, clearingRate);
        }

        // Remaining tokens in contract can be considered failed issuance.
        emit BondAuctionFinalised(auctionId, _isin, dvpSuccess);
    }

    function _settleIssuance(
        bytes32 _id,
        string calldata _isin,
        bytes32 _partition,
        IBondAuction.AuctionType _auctionType,
        IBondAuction.Allocation[] memory _alloc,
        uint256 _total,
        uint256 _clearingRate
    ) internal returns (bool) {
        // Mint tokens to this contract for the specific ISIN partition
        BOND_TOKEN.mintByIsin(_isin, address(this), _total);

        // For RATE auctions: set coupon parameters from clearing rate
        // Coupon duration is automatically set to 1 year (1 * DURATION_SCALAR)
        if (_auctionType == IBondAuction.AuctionType.RATE) {
            // Set coupon duration to 1 year (DURATION_SCALAR represents 1 year in seconds)
            uint256 couponDurationInSeconds = DURATION_SCALAR;

            // Set coupon yield and start maturity timer
            BOND_TOKEN.enableByIsin(_isin, couponDurationInSeconds, _clearingRate);
        }

        bool dvpSuccess = true;

        for (uint256 i = 0; i < _alloc.length; i++) {
            uint256 paymentDue;

            if (_auctionType == IBondAuction.AuctionType.RATE) {
                paymentDue = _alloc[i].units * UNIT_NOMINAL;
            } else {
                paymentDue = (_clearingRate * (_alloc[i].units * UNIT_NOMINAL)) / PERCENTAGE_PRECISION;
            }

            IBondDvP.Settlement memory params = IBondDvP.Settlement({
                bond: address(BOND_TOKEN),
                partition: _partition,
                bondFrom: address(this),
                bondTo: _alloc[i].bidder,
                bondAmount: _alloc[i].units,
                cashToken: WNOK,
                cashFrom: _alloc[i].bidder,
                cashTo: _GOV_RESERVE,
                cashAmount: paymentDue,
                operator: address(0),
                op: IBondDvP.Operation.TransferPartition
            });

            try BOND_DVP.settle(params) returns (bool ok) {
                if (!ok) {
                    dvpSuccess = false;
                    _handleAllocationFailure(_id, _isin, _alloc[i].bidder, abi.encode(IBondDvP.FailureReason.Unknown));
                }
            } catch (bytes memory errData) {
                dvpSuccess = false;
                _handleAllocationFailure(_id, _isin, _alloc[i].bidder, errData);
            }
        }

        emit BondIssuanceComplete(_id, _isin, _total);

        return dvpSuccess;
    }

    function _settleBuyback(
        bytes32 _id,
        string calldata _isin,
        bytes32 _partition,
        IBondAuction.Allocation[] memory _alloc,
        uint256 _total
    ) internal returns (bool) {
        uint256 supply = BOND_TOKEN.totalSupplyByPartition(_partition);
        if (_total > supply) {
            revert Errors.BuybackExceedsSupply(_isin, _total, supply);
        }

        bool dvpSuccess = true;

        for (uint256 i = 0; i < _alloc.length; i++) {
            uint256 paymentDue = (_alloc[i].rate * (_alloc[i].units * UNIT_NOMINAL)) / PERCENTAGE_PRECISION;

            IBondDvP.Settlement memory params = IBondDvP.Settlement({
                bond: address(BOND_TOKEN),
                partition: _partition,
                bondFrom: _alloc[i].bidder,
                bondTo: address(0),
                bondAmount: _alloc[i].units,
                cashToken: GOV_TBD,
                cashFrom: _GOV_RESERVE,
                cashTo: _alloc[i].bidder,
                cashAmount: paymentDue,
                operator: msg.sender,
                op: IBondDvP.Operation.Buyback
            });

            try BOND_DVP.settle(params) returns (bool ok) {
                if (!ok) {
                    dvpSuccess = false;
                    _handleAllocationFailure(_id, _isin, _alloc[i].bidder, abi.encode(IBondDvP.FailureReason.Unknown));
                }
            } catch (bytes memory errData) {
                dvpSuccess = false;
                _handleAllocationFailure(_id, _isin, _alloc[i].bidder, errData);
            }
        }

        emit BondBuybackComplete(_id, _isin, _total);

        return dvpSuccess;
    }

    /**
     * @notice Closes bidding and retrieves bids for decryption.
     * @param _isin Target ISIN.
     * @return bids Array of sealed bids returned by BondAuction.
     */
    function closeAuction(string calldata _isin)
        external
        onlyRole(Roles.BOND_MANAGER_ROLE)
        isBondActive(_isin, true)
        returns (IBondAuction.Bid[] memory)
    {
        bytes32 auctionId = BOND_AUCTION.getAuctionId(_isin);
        emit BondAuctionClosed(auctionId, _isin);

        return BOND_AUCTION.closeAuction(auctionId, msg.sender);
    }

    /**
     * @notice Cancel an auction and reduce the offering size while keeping the partition reserved.
     * @param _isin Target ISIN to cancel.
     * @dev Does NOT mint bonds - only reduces offering size and reserves the ISIN partition.
     * @dev Sets auction status to CANCELLED and marks bond as inactive.
     * @dev Can cancel auctions in BIDDING or CLOSED states (status < FINALISED && status != NONE).
     */
    function cancelAuction(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, true) {
        bondActive[_isin] = false;
        bytes32 auctionId = BOND_AUCTION.getAuctionId(_isin);
        uint256 offering = BOND_AUCTION.cancelAuction(auctionId, msg.sender);

        // Reduce the offering size in BondToken (but keep partition active/reserved)
        BOND_TOKEN.reducePartitionOffering(_isin, offering);

        emit BondAuctionCancelled(auctionId, _isin, offering);
    }

    /**
     * @notice Convenience proxy used by monitoring tools to inspect sealed bids.
     * @param _isin Target ISIN.
     * @return bids Array of sealed bids.
     */
    function getSealedBids(string calldata _isin) external view returns (IBondAuction.Bid[] memory) {
        bytes32 auctionId = BOND_AUCTION.getAuctionId(_isin);
        return BOND_AUCTION.getSealedBids(auctionId);
    }

    /**
     * @notice Allows the issuer to recover bonds that failed to settle during DVP.
     * @param _isin Target ISIN with failed issuance.
     */
    function withdrawFailedIssuance(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE) {
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        uint256 failedIssuance = BOND_TOKEN.balanceOfByPartition(partition, address(this));

        if (failedIssuance == 0) revert Errors.NoFailedIssuance();

        bytes32 returnedPartition = BOND_TOKEN.transferByPartition(partition, msg.sender, failedIssuance, "");
        if (returnedPartition != partition) {
            revert Errors.SettlementFailure(uint8(IBondDvP.FailureReason.Security), "partition mismatch");
        }
    }

    /**
     * @notice Redeem bonds on behalf of holders
     * @param _isin ISIN string
     * @param _holders Array of addresses holding the bonds to be redeemed and receiving WNOK payment
     * @dev Restricted to BOND_MANAGER_ROLE
     * @dev Passes msg.sender (BOND_MANAGER_ROLE holder) as operator
     * @dev Payment is atomic for all holders
     */
    function redeem(string calldata _isin, address[] calldata _holders) external onlyRole(Roles.BOND_MANAGER_ROLE) {
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        // Process each holder's redemption
        for (uint256 i = 0; i < _holders.length; i++) {
            address holder = _holders[i];
            uint256 balance = BOND_TOKEN.balanceOfByPartition(partition, holder);

            if (balance == 0) {
                continue; // Skip zero-value redemptions
            }

            // Calculate WNOK amount to pay (1 BOND = 1000 WNOK)
            uint256 tbdAmount = balance * UNIT_NOMINAL;

            IBondDvP.Settlement memory params = IBondDvP.Settlement({
                bond: address(BOND_TOKEN),
                partition: partition,
                bondFrom: holder,
                bondTo: address(0),
                bondAmount: balance,
                cashToken: GOV_TBD,
                cashFrom: _GOV_RESERVE,
                cashTo: holder,
                cashAmount: tbdAmount,
                operator: msg.sender,
                op: IBondDvP.Operation.Redeem
            });

            bool ok = BOND_DVP.settle(params);
            if (!ok) {
                revert Errors.SettlementFailure(uint8(IBondDvP.FailureReason.Unknown), "redeem settle returned false");
            }
            emit BondRedeemed(_isin, holder, balance, tbdAmount);
        }

        uint256 totalSupply = BOND_TOKEN.totalSupplyByPartition(partition);
        if (totalSupply != 0) {
            revert Errors.RedemptionIncomplete(_isin, totalSupply);
        }

        emit BondRedemptionComplete(_isin);
    }

    /**
     * @notice Pay coupon to bond holders for a specific ISIN
     * @param _isin ISIN string
     * @param _holders Array of holder addresses to receive coupon payments
     * @dev Restricted to BOND_MANAGER_ROLE
     * @dev Payment is atomic for all holders
     * @dev Flags bond as matured after final coupon payment
     */
    function payCoupon(string calldata _isin, address[] calldata _holders) external onlyRole(Roles.BOND_MANAGER_ROLE) {
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);

        // Get all coupon parameters in a single call
        (
            uint256 couponDuration, // Interval between payments in seconds (e.g., 1 year = DURATION_SCALAR)
            uint256 couponYield,
            uint256 maturityDuration,
            uint256 lastPayment,
            uint256 paymentCount
        ) = BOND_TOKEN.getCouponDetails(_isin);

        // Calculate expected number of coupon payments based on maturity and interval
        uint256 expectedPayments = maturityDuration / couponDuration;

        // Check if all coupons have been paid
        if (paymentCount >= expectedPayments) {
            revert Errors.AllCouponsPaid(_isin);
        }

        // Check if enough time has passed since last payment
        uint256 nextPaymentTime = lastPayment + couponDuration;
        if (block.timestamp < nextPaymentTime) {
            revert Errors.CouponNotReady(_isin, nextPaymentTime, block.timestamp);
        }

        // Calculate payment per bond: (face value * yield) / PERCENTAGE_PRECISION
        // couponYield is stored in bps (1e4 precision), e.g., 425 = 4.25%, 400 = 4.00%
        // e.g., 1000 NOK face value * 4.25% (425) = 42.5 NOK per bond per interval
        // Coupon is based on bond's face value (nominal), not purchase price
        uint256 paymentPerBond = (UNIT_NOMINAL * couponYield) / PERCENTAGE_PRECISION;
        // Pay each holder proportionally to their balance
        uint256 totalProcessedBalance = 0;
        for (uint256 i = 0; i < _holders.length; i++) {
            address holder = _holders[i];
            uint256 balance = BOND_TOKEN.balanceOfByPartition(partition, holder);

            if (balance == 0) {
                continue; // Skip holders with no balance
            }

            // Calculate payment for this holder: balance * payment per bond
            uint256 paymentAmount = balance * paymentPerBond;

            IBondDvP.Settlement memory params = IBondDvP.Settlement({
                bond: address(BOND_TOKEN),
                partition: partition,
                bondFrom: holder,
                bondTo: holder,
                bondAmount: 0, // cash-only coupon payment
                cashToken: GOV_TBD,
                cashFrom: _GOV_RESERVE,
                cashTo: holder,
                cashAmount: paymentAmount,
                operator: address(0),
                op: IBondDvP.Operation.None
            });

            bool ok = BOND_DVP.settle(params);
            if (!ok) {
                revert Errors.SettlementFailure(uint8(IBondDvP.FailureReason.Unknown), "coupon settle returned false");
            }
            totalProcessedBalance += balance;

            emit CouponPaid(_isin, holder, paymentAmount, paymentCount + 1);
        }

        // Verify that all bonds in the partition have been accounted for
        uint256 totalSupply = BOND_TOKEN.totalSupplyByPartition(partition);
        if (totalProcessedBalance != totalSupply) {
            revert Errors.CouponPaymentBalanceMismatch(_isin, totalProcessedBalance, totalSupply);
        }

        // Update payment tracking
        uint256 newPaymentCount = paymentCount + 1;
        BOND_TOKEN.updateCouponPayment(_isin, block.timestamp, newPaymentCount);

        // Check if this was the final payment
        if (newPaymentCount == expectedPayments) {
            BOND_TOKEN.setMatured(_isin);
            emit AllCouponsPaid(_isin);
        }
    }

    function _handleAllocationFailure(bytes32 id, string memory isin, address bidder, bytes memory errData) internal {
        string memory reason = "Unknown";
        if (errData.length >= 4) {
            bytes4 sel;
            assembly {
                sel := mload(add(errData, 32))
            }
            if (sel == Errors.SettlementFailure.selector && errData.length > 4) {
                bytes memory inner;
                assembly {
                    inner := add(errData, 4)
                    mstore(inner, sub(mload(errData), 4))
                }
                (uint8 code,) = abi.decode(inner, (uint8, bytes));
                if (code == uint8(IBondDvP.FailureReason.Security)) {
                    reason = "Security";
                } else if (code == uint8(IBondDvP.FailureReason.Cash)) {
                    reason = "Cash";
                }
            }
        }

        emit BondAllocationFailed(id, isin, bidder, reason);
    }
}
