// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IBondManager} from "@norges-bank/interfaces/IBondManager.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {IBondToken} from "@norges-bank/interfaces/IBondToken.sol";
import {IBondDvP} from "@norges-bank/interfaces/IBondDvP.sol";

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
     * @notice Government reserve account: receives issuance proceeds and pays buyback,
     *         coupon, and redemption cash. Every cash leg settles in WNOK.
     */
    address public immutable GOV_RESERVE;

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
     * @param _wNok Address of the WNOK token used for every cash leg.
     * @param _controller Bond issuer address granted BOND_MANAGER_ROLE.
     * @param _bondAuction Address of the BondAuction instance coordinating sealed bids.
     * @param _bondToken Address of the BondToken contract (single deployment for all bonds).
     * @param _govReserve Government reserve account holding WNOK.
     * @param _durationScalar Duration scalar for coupon intervals (31556926 for year, smaller for testing)
     */
    constructor(
        string memory _name,
        address _wNok,
        address _controller,
        address _bondAuction,
        address _bondToken,
        address _bondDvp,
        address _govReserve,
        uint256 _durationScalar
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(Roles.BOND_MANAGER_ROLE, _controller);

        name = _name;

        WNOK = _wNok;
        BOND_AUCTION = IBondAuction(_bondAuction);
        BOND_TOKEN = IBondToken(_bondToken);
        BOND_DVP = IBondDvP(_bondDvp);
        if (_govReserve == address(0)) revert Errors.GovReserveAddressZero();
        GOV_RESERVE = _govReserve;

        if (_durationScalar == 0) revert Errors.DurationScalarZero();
        DURATION_SCALAR = _durationScalar;

        UNIT_NOMINAL = BOND_TOKEN.UNIT_NOMINAL();
        if (UNIT_NOMINAL == 0) revert Errors.BondUnitNominalZero();
    }

    /**
     * @notice Deploys a new bond without scheduling an auction.
     * @param _isin Human ISIN string for the issuance (used as partition identifier).
     * @param _maturityDuration Duration in years from bond distribution until maturity.
     * @dev Creates a partition with offering 0; the first auction added via
     *      `deployAuctionForBond` bumps the offering to its size.
     * @dev Maturity duration is converted to seconds using DURATION_SCALAR.
     */
    function deployBond(string calldata _isin, uint256 _maturityDuration)
        external
        onlyRole(Roles.BOND_MANAGER_ROLE)
        isBondActive(_isin, false)
    {
        _deployBond(_isin, _maturityDuration);
    }

    /**
     * @notice Schedules an auction for an existing bond partition.
     * @param _isin ISIN of an existing partition.
     * @param _end Timestamp when sealed bidding closes.
     * @param _pubKey Auctioneer public key that matches client-side sealing keys.
     * @param _offering Auction size. For RATE/PRICE: added to the partition offering ceiling.
     *        For BUYBACK: must not exceed current supply (and the offering ceiling is unchanged).
     * @param _auctionType RATE, PRICE, or BUYBACK. The first auction for an ISIN must be RATE
     *        (enforced by BondAuction); subsequent auctions must be PRICE or BUYBACK.
     */
    function deployAuctionForBond(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _offering,
        IBondAuction.AuctionType _auctionType
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        // Set the in-flight lock BEFORE any external call so slither's
        // cross-function reentrancy detector sees a check-effects-interactions
        // ordering. Mirrors the pattern from the original entrypoints.
        bondActive[_isin] = true;
        _deployAuctionForBond(_isin, _end, _pubKey, _offering, _auctionType);
    }

    /**
     * @notice Deploys a new bond and its initial RATE auction in one call.
     * @dev Back-compat composition of `deployBond` + `deployAuctionForBond(.., RATE)` so
     *      existing call sites and tests keep their semantics.
     */
    function deployBondWithAuction(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _offering,
        uint256 _maturityDuration
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        // Same effects-before-interactions ordering as the standalone
        // deployAuctionForBond wrapper above.
        bondActive[_isin] = true;
        _deployBond(_isin, _maturityDuration);
        _deployAuctionForBond(_isin, _end, _pubKey, _offering, IBondAuction.AuctionType.RATE);
    }

    /**
     * @notice Schedule a PRICE auction (bond extension) for an existing bond.
     * @dev Back-compat wrapper for `deployAuctionForBond(.., PRICE)`.
     */
    function extendBondWithAuction(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _additionalOffering
    ) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        bondActive[_isin] = true;
        _deployAuctionForBond(_isin, _end, _pubKey, _additionalOffering, IBondAuction.AuctionType.PRICE);
    }

    /**
     * @notice Schedule a BUYBACK auction for an existing bond.
     * @dev Back-compat wrapper for `deployAuctionForBond(.., BUYBACK)`.
     */
    function buybackWithAuction(string calldata _isin, uint64 _end, bytes calldata _pubKey, uint256 _buybackSize)
        external
        onlyRole(Roles.BOND_MANAGER_ROLE)
        isBondActive(_isin, false)
    {
        bondActive[_isin] = true;
        _deployAuctionForBond(_isin, _end, _pubKey, _buybackSize, IBondAuction.AuctionType.BUYBACK);
    }

    function _deployBond(string calldata _isin, uint256 _maturityDuration) internal {
        if (_maturityDuration == 0) revert Errors.MaturityDurationZero();

        uint256 maturityDurationSeconds = _maturityDuration * DURATION_SCALAR;

        BOND_TOKEN.createPartition(_isin, 0, maturityDurationSeconds);

        emit BondCreated(_isin, address(BOND_TOKEN), maturityDurationSeconds);
    }

    function _deployAuctionForBond(
        string calldata _isin,
        uint64 _end,
        bytes calldata _pubKey,
        uint256 _offering,
        IBondAuction.AuctionType _auctionType
    ) internal {
        // bondActive[_isin] is set to true and the isBondActive(false)
        // pre-check is enforced by the public wrappers (so the state write
        // happens before any external call — slither flags the inverse as
        // cross-function reentrancy).
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);
        if (!BOND_TOKEN.activePartitions(partition)) {
            revert Errors.BondDoesNotExist(_isin);
        }

        if (_offering == 0) {
            if (_auctionType == IBondAuction.AuctionType.BUYBACK) {
                revert Errors.BuybackOfferingZero(_isin);
            }
            if (_auctionType == IBondAuction.AuctionType.PRICE) {
                revert Errors.AdditionalOfferingZero();
            }
            revert Errors.OfferingZero();
        }

        if (_auctionType == IBondAuction.AuctionType.BUYBACK) {
            uint256 currentSupply = BOND_TOKEN.totalSupplyByPartition(partition);
            if (_offering > currentSupply) {
                revert Errors.BuybackExceedsSupply(_isin, _offering, currentSupply);
            }
        } else {
            // RATE and PRICE auctions both grow the partition offering ceiling.
            BOND_TOKEN.extendPartitionOffering(_isin, _offering);
        }

        bytes32 id =
            BOND_AUCTION.createAuction(_isin, msg.sender, _end, _pubKey, address(BOND_TOKEN), _offering, _auctionType);

        if (_auctionType == IBondAuction.AuctionType.RATE) {
            emit BondAuctionInitialised(
                id, _isin, address(BOND_TOKEN), _offering, BOND_TOKEN.maturityDuration(partition)
            );
        } else if (_auctionType == IBondAuction.AuctionType.PRICE) {
            emit BondExtensionAuctionInitialised(id, _isin, address(BOND_TOKEN), _offering);
        } else {
            emit BondBuybackAuctionInitialised(id, _isin, address(BOND_TOKEN), _offering);
        }
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
                cashTo: GOV_RESERVE,
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
                cashToken: WNOK,
                cashFrom: GOV_RESERVE,
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
     * @notice Disable a bond that has no minted units, no in-flight auction, and no FINALISED auction history.
     * @param _isin Target ISIN to disable.
     * @dev Gates: `bondActive[_isin] == false` (no in-flight auction — modifier), partition has zero
     *      supply (checked by BondToken.disablePartition), and no auction for this ISIN has reached
     *      FINALISED status (checked here).
     * @dev On success the partition is soft-deleted in BondToken: `activePartitions[partition]` flips
     *      to false and every per-partition mapping is cleared. The ISIN can be re-used with a fresh
     *      `deployBond` afterward.
     */
    function disableBond(string calldata _isin) external onlyRole(Roles.BOND_MANAGER_ROLE) isBondActive(_isin, false) {
        uint256 auctionCount = BOND_AUCTION.isinToAuctionCount(_isin);
        for (uint256 i = 1; i <= auctionCount; i++) {
            bytes32 auctionId = BOND_AUCTION.getAuctionIdAt(_isin, i);
            if (BOND_AUCTION.getAuctionStatus(auctionId) == IBondAuction.AuctionStatus.FINALISED) {
                revert Errors.BondHasFinalisedAuction(_isin, auctionId);
            }
        }

        // Supply gate + storage clearing happen atomically in BondToken.
        BOND_TOKEN.disablePartition(_isin);

        emit BondDisabled(_isin);
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
     * @notice Pay the next coupon to every holder; the final coupon also repays principal and closes the bond.
     * @param _isin ISIN string
     * @param _holders Every current holder of the partition, including this contract when it holds unsold units
     * @dev Restricted to BOND_MANAGER_ROLE. Atomic: any failed leg reverts the whole payment.
     * @dev Units held by this contract were never sold: they earn no coupon and are burned at maturity
     *      without any cash movement.
     * @dev On the final period each holder is settled once for coupon plus nominal, every unit is burned,
     *      partition supply must reach zero, and BondMatured is emitted exactly once.
     */
    function payCoupon(string calldata _isin, address[] calldata _holders) external onlyRole(Roles.BOND_MANAGER_ROLE) {
        bytes32 partition = BOND_TOKEN.isinToPartition(_isin);

        (
            uint256 couponDuration, // Interval between payments in seconds (e.g., 1 year = DURATION_SCALAR)
            uint256 couponYield,
            uint256 maturityDuration,
            uint256 lastPayment,
            uint256 paymentCount
        ) = BOND_TOKEN.getCouponDetails(_isin);

        uint256 expectedPayments = maturityDuration / couponDuration;
        if (paymentCount >= expectedPayments) {
            revert Errors.AllCouponsPaid(_isin);
        }

        uint256 nextPaymentTime = lastPayment + couponDuration;
        if (block.timestamp < nextPaymentTime) {
            revert Errors.CouponNotReady(_isin, nextPaymentTime, block.timestamp);
        }

        uint256 paymentNumber = paymentCount + 1;
        bool finalPeriod = paymentNumber == expectedPayments;

        // Coupon per unit: nominal * yield (bps) / PERCENTAGE_PRECISION, e.g. 1000 * 425 / 10000 = 42
        uint256 paymentPerBond = (UNIT_NOMINAL * couponYield) / PERCENTAGE_PRECISION;
        uint256 supplyBefore = BOND_TOKEN.totalSupplyByPartition(partition);

        if (finalPeriod) {
            // BondToken.redeemFor requires the partition to be matured before any burn.
            BOND_TOKEN.setMatured(_isin);
        }

        PayoutTotals memory totals = _payHolders(
            _isin,
            _holders,
            Period({
                partition: partition,
                paymentPerBond: paymentPerBond,
                paymentNumber: paymentNumber,
                finalPeriod: finalPeriod
            })
        );

        // Every unit in the partition must be accounted for, paid or unsold.
        if (totals.processed + totals.unsold != supplyBefore) {
            revert Errors.CouponPaymentBalanceMismatch(_isin, totals.processed + totals.unsold, supplyBefore);
        }

        BOND_TOKEN.updateCouponPayment(_isin, block.timestamp, paymentNumber);

        if (finalPeriod) {
            if (totals.unsold > 0) {
                BOND_TOKEN.redeemFor(address(this), _isin, totals.unsold, msg.sender);
            }
            uint256 remaining = BOND_TOKEN.totalSupplyByPartition(partition);
            if (remaining != 0) {
                revert Errors.RedemptionIncomplete(_isin, remaining);
            }
            emit BondMatured(_isin, paymentNumber, totals.principal, totals.coupon, totals.unsold);
        }
    }

    /**
     * @dev Running totals of one coupon period, in units (processed, unsold) and WNOK (coupon, principal).
     */
    struct PayoutTotals {
        uint256 processed;
        uint256 unsold;
        uint256 coupon;
        uint256 principal;
    }

    /**
     * @dev Parameters of the coupon period being paid.
     */
    struct Period {
        bytes32 partition;
        uint256 paymentPerBond;
        uint256 paymentNumber;
        bool finalPeriod;
    }

    /**
     * @dev Pays every listed holder for one period. Units held by this contract were never sold:
     *      they are counted as unsold and receive nothing.
     */
    function _payHolders(string calldata _isin, address[] calldata _holders, Period memory _p)
        internal
        returns (PayoutTotals memory totals)
    {
        for (uint256 i = 0; i < _holders.length; i++) {
            uint256 balance = BOND_TOKEN.balanceOfByPartition(_p.partition, _holders[i]);
            if (balance == 0) {
                continue;
            }
            if (_holders[i] == address(this)) {
                totals.unsold += balance;
                continue;
            }
            (uint256 couponAmount, uint256 principal) = _payHolder(_isin, _holders[i], balance, _p);
            totals.processed += balance;
            totals.coupon += couponAmount;
            totals.principal += principal;
        }
    }

    /**
     * @dev Settles one holder for one period and emits the per-holder events.
     */
    function _payHolder(string calldata _isin, address _holder, uint256 _balance, Period memory _p)
        internal
        returns (uint256 couponAmount, uint256 principal)
    {
        couponAmount = _balance * _p.paymentPerBond;
        principal = _p.finalPeriod ? _balance * UNIT_NOMINAL : 0;
        _settleHolderPayout(_p.partition, _holder, _balance, couponAmount + principal, _p.finalPeriod);

        emit CouponPaid(_isin, _holder, couponAmount, _p.paymentNumber);
        if (_p.finalPeriod) {
            emit BondRedeemed(_isin, _holder, _balance, principal);
        }
    }

    /**
     * @dev One DvP settlement per holder per period: cash-only on interim periods, coupon plus
     *      principal with the holder's units burned on the final period.
     */
    function _settleHolderPayout(
        bytes32 _partition,
        address _holder,
        uint256 _balance,
        uint256 _cashAmount,
        bool _final
    ) internal {
        IBondDvP.Settlement memory params = IBondDvP.Settlement({
            bond: address(BOND_TOKEN),
            partition: _partition,
            bondFrom: _holder,
            bondTo: _final ? address(0) : _holder,
            bondAmount: _final ? _balance : 0,
            cashToken: WNOK,
            cashFrom: GOV_RESERVE,
            cashTo: _holder,
            cashAmount: _cashAmount,
            operator: _final ? msg.sender : address(0),
            op: _final ? IBondDvP.Operation.Redeem : IBondDvP.Operation.None
        });

        bool ok = BOND_DVP.settle(params);
        if (!ok) {
            revert Errors.SettlementFailure(uint8(IBondDvP.FailureReason.Unknown), "coupon settle returned false");
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
