// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IBondToken} from "@norges-bank/interfaces/IBondToken.sol";
import {ERC1410Minimal as ERC1410} from "@norges-bank/ERC1410/ERC1410.sol";

import {Errors} from "@common/Errors.sol";
import {Roles} from "@common/Roles.sol";

/**
 * @title BondToken
 * @notice ERC1410-compatible token for bonds using partitions keyed by ISIN.
 * @dev Single deployment for all bonds, with partitions representing different ISINs using a lightweight ERC1410 base.
 */
contract BondToken is IBondToken, ERC1410, AccessControl {
    /**
     * @notice Each bond unit represents this nominal value in WNOK (e.g., 1 BOND = 1000 WNOK)
     */
    uint256 public constant UNIT_NOMINAL = 1000;

    /**
     * @notice Mapping to track active partitions (ISINs that have been activated)
     */
    mapping(bytes32 => bool) public activePartitions;

    /**
     * @notice Mapping from partition to ISIN string for lookups
     */
    mapping(bytes32 => string) private _partitionIsin;

    /**
     * @notice Mapping to track total supply ceiling (offering size) per partition
     */
    mapping(bytes32 => uint256) public partitionOffering;

    /**
     * @notice Mapping to track maturity duration per partition (seconds until maturity from distribution)
     */
    mapping(bytes32 => uint256) public maturityDuration;

    /**
     * @notice Mapping to track maturity date per partition (timestamp when bonds can be redeemed)
     */
    mapping(bytes32 => uint256) public maturityDate;

    /**
     * @notice Mapping to track coupon duration (number of payment intervals) per partition
     */
    mapping(bytes32 => uint256) public couponDuration;

    /**
     * @notice Mapping to track coupon yield (percentage) per partition
     */
    mapping(bytes32 => uint256) public couponYield;

    /**
     * @notice Mapping to track last coupon payment timestamp per partition
     */
    mapping(bytes32 => uint256) public lastCouponPayment;

    /**
     * @notice Mapping to track number of coupon payments made per partition
     */
    mapping(bytes32 => uint256) public couponPaymentCount;

    /**
     * @notice Mapping to track if bond is matured (after final coupon payment) per partition
     */
    mapping(bytes32 => bool) public isMatured;

    /**
     * @notice Constructor initializes ERC1410 token with bond-specific settings
     * @param _name Name of the token
     * @param _symbol Symbol of the token
     */
    constructor(string memory _name, string memory _symbol)
        ERC1410(
            _name, // tokenName
            _symbol, // tokenSymbol
            1 // tokenGranularity (1 = indivisible units, suitable for zero-decimal bonds)
        )
    {
        _grantRole(Roles.DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(Roles.BOND_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Add new controller
     * @dev To add dedicated manager role
     * @param _controller of new controller
     */
    function addController(address _controller) external onlyRole(Roles.BOND_ADMIN_ROLE) {
        if (_controller == address(0)) revert Errors.ControllerAddressZero();
        _grantRole(Roles.BOND_CONTROLLER_ROLE, _controller);

        if (_isController[_controller]) {
            return;
        }

        address[] memory newControllers = new address[](_controllers.length + 1);
        for (uint256 i = 0; i < _controllers.length; i++) {
            newControllers[i] = _controllers[i];
        }
        newControllers[_controllers.length] = _controller;

        _setControllers(newControllers);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1410, AccessControl, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Convert ISIN string to partition bytes32
     * @param _isin ISIN string
     * @return partition bytes32 representation
     */
    function isinToPartition(string memory _isin) public pure returns (bytes32 partition) {
        // forge-lint: disable-next-line(asm-keccak256)
        return keccak256(abi.encodePacked(_isin));
    }

    /**
     * @notice Retrieve ISIN string for a partition.
     */
    function partitionToIsin(bytes32 partition) external view returns (string memory) {
        return _partitionIsin[partition];
    }

    /**
     * @notice Create a partition for an ISIN (initializes partition without minting)
     * @param _isin ISIN string
     * @param _offering Total supply ceiling (offering size) for this partition
     * @param _maturityDuration Duration in seconds from bond distribution until maturity
     * @dev This explicitly creates the partition in the ERC1410 tracking before any real minting
     * @dev Sets the partition as active in the activePartitions mapping and stores the offering size and maturity duration
     * @dev Coupon parameters are set later via setCouponParameters (for RATE auctions, yield comes from clearing rate)
     */
    function createPartition(string memory _isin, uint256 _offering, uint256 _maturityDuration)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);
        if (activePartitions[partition]) {
            revert Errors.DuplicatePartition(_isin);
        }
        if (_offering == 0) revert Errors.OfferingZero();
        if (_maturityDuration == 0) revert Errors.MaturityDurationZero();

        _partitionIsin[partition] = _isin;
        _createPartition(partition, _offering, _maturityDuration);
        _initializePartition(partition);

        emit IsinIssued(_isin, _offering);
    }

    /**
     * @notice Internal function to create partition and set offering/duration
     */
    function _createPartition(bytes32 partition, uint256 _offering, uint256 _maturityDuration) internal {
        if (activePartitions[partition]) {
            revert Errors.DuplicatePartition(_partitionIsin[partition]);
        }

        if (_offering == 0) revert Errors.OfferingZero();
        if (_maturityDuration == 0) revert Errors.MaturityDurationZero();

        activePartitions[partition] = true;
        partitionOffering[partition] = _offering;
        maturityDuration[partition] = _maturityDuration;
    }

    /**
     * @notice Set coupon parameters & start timer
     * @param _isin ISIN string
     * @param _couponDuration Coupon internal in seconds (e.g., 1 year = durationScalar)
     * @param _couponYield Coupon yield with 4 decimal places (e.g., 425 = 4.25%, 400 = 4.00%)
     * @dev Restricted to CONTROLLER_ROLE
     * @dev For RATE auctions, _couponYield should be the clearing rate from the auction (with 4 decimal places)
     * @dev Number of coupon payments = maturityDuration / _couponDuration
     */
    function enableByIsin(string memory _isin, uint256 _couponDuration, uint256 _couponYield)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);

        // Ensure partition has been activated
        if (!activePartitions[partition]) {
            revert Errors.PartitionNotActive(_isin);
        }

        // Set coupon yield from clearing rate (clearing rate is the interest rate bid)
        _setCouponParameters(partition, _couponDuration, _couponYield);
        // Set maturity date based on distribution time (starts the timer)
        _startMaturityTimer(partition);

        emit IsinEnabled(_isin, _couponDuration, _couponYield);
    }

    /**
     * @notice Set coupon parameters for a partition (called after RATE auction finalization)
     * @param _partition Partition identifier (hashed ISIN)
     * @param _couponDuration Interval between coupon payments in seconds (e.g., 1 year = durationScalar)
     * @param _couponYield Coupon yield with 4 decimal places (e.g., 425 = 4.25%, 400 = 4.00%)
     * @dev Restricted to CONTROLLER_ROLE
     * @dev For RATE auctions, _couponYield should be the clearing rate from the auction (with 4 decimal places)
     * @dev Number of coupon payments = maturityDuration / _couponDuration
     */
    function _setCouponParameters(bytes32 _partition, uint256 _couponDuration, uint256 _couponYield) internal {
        if (_couponDuration == 0) revert Errors.CouponDurationZero();
        if (_couponYield == 0) revert Errors.CouponYieldZero();

        couponDuration[_partition] = _couponDuration;
        couponYield[_partition] = _couponYield;
    }

    /**
     * @notice Extend the offering size for an existing partition
     * @param _isin ISIN string
     * @param _additionalOffering Additional offering size to add to the partition
     * @dev Requires partition to be active
     * @dev Increases the total offering ceiling for the partition
     */
    function extendPartitionOffering(string memory _isin, uint256 _additionalOffering)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);
        uint256 newOffering = _updatePartitionOffering(partition, _isin, _additionalOffering, true);
        emit IsinExtended(_isin, _additionalOffering, newOffering);
    }

    /**
     * @notice Reduce the offering size for an existing partition (used when auction is cancelled)
     * @param _isin ISIN string
     * @param _reductionAmount Amount to reduce from the offering size
     * @dev Requires partition to be active
     * @dev Reduces the total offering ceiling for the partition
     * @dev Ensures the reduction doesn't make offering less than current supply
     */
    function reducePartitionOffering(string memory _isin, uint256 _reductionAmount)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);
        uint256 newOffering = _updatePartitionOffering(partition, _isin, _reductionAmount, false);
        emit IsinReduced(_isin, _reductionAmount, newOffering);
    }

    /**
     * @notice Internal helper to update offering up or down for a partition
     * @dev Keeps public ISIN functions thin and reuses validation logic.
     * @param partition Partition identifier
     * @param _isin ISIN string (used for error context)
     * @param delta Amount to add or subtract
     * @param increase True to increase offering, false to decrease
     * @return newOffering Updated offering amount for the partition
     */
    function _updatePartitionOffering(bytes32 partition, string memory _isin, uint256 delta, bool increase)
        internal
        returns (uint256 newOffering)
    {
        if (!activePartitions[partition]) {
            revert Errors.PartitionNotActive(_isin);
        }

        if (delta == 0) {
            if (increase) revert Errors.AdditionalOfferingZero();
            revert Errors.ReductionAmountZero();
        }

        uint256 currentOffering = partitionOffering[partition];
        if (increase) {
            newOffering = currentOffering + delta;
            partitionOffering[partition] = newOffering;
            return newOffering;
        }

        uint256 currentSupply = _totalSupplyOfPartition(partition);

        if (currentOffering < delta) {
            revert Errors.ReductionExceedsOffering(currentOffering, delta);
        }
        uint256 offeringAfterReduction = currentOffering - delta;
        if (offeringAfterReduction < currentSupply) {
            revert Errors.ReductionBelowSupply(currentSupply, offeringAfterReduction);
        }

        partitionOffering[partition] = offeringAfterReduction;
        return offeringAfterReduction;
    }

    /**
     * @notice Mint to a specific partition (ISIN)
     * @param _isin ISIN string
     * @param account Recipient address
     * @param value Number of units to mint
     * @dev Requires partition to be activated
     * @dev Validates that minting does not exceed the partition's offering size (total supply ceiling)
     */
    function mintByIsin(string memory _isin, address account, uint256 value)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);

        // Ensure partition has been activated
        if (!activePartitions[partition]) {
            revert Errors.PartitionNotActive(_isin);
        }

        // Validate that minting does not exceed the offering size
        uint256 currentSupply = _totalSupplyOfPartition(partition);
        uint256 offering = partitionOffering[partition];
        if (currentSupply + value > offering) {
            revert Errors.ExceedsOffering(_isin, currentSupply, value, offering);
        }

        _issueByPartition(partition, msg.sender, account, value, "");

        emit IsinMinted(_isin, account, value);
    }

    /**
     * @notice Start the maturity timer for a partition (sets maturity date from current time + duration)
     * @param partition Partition identifier (hashed ISIN)
     * @dev Calculates maturity date as current timestamp + stored maturity duration
     * @dev Initializes coupon payment tracking (sets lastCouponPayment to current time)
     * @dev Should be called when bonds are distributed (after finaliseAuction)
     */
    function _startMaturityTimer(bytes32 partition) internal {
        uint256 duration = maturityDuration[partition];
        if (duration == 0) {
            revert Errors.MaturityDateZero();
        }

        // Calculate maturity date from current time + duration
        // This starts the timer when bonds are distributed
        maturityDate[partition] = block.timestamp + duration;

        // Initialize coupon payment tracking (starts coupon payment timer)
        lastCouponPayment[partition] = block.timestamp;
        couponPaymentCount[partition] = 0;
    }

    /**
     * @notice Redeem bonds from a specific ISIN partition for WNOK
     * @param _holder Address holding the bonds to be redeemed and receiving WNOK payment
     * @param _isin ISIN string
     * @param _value Number of bonds to redeem
     * @param _operator Address with BOND_MANAGER_ROLE performing the redemption
     * @dev Validates maturity and burns bonds
     * @dev WNOK payment is handled via mock DVP in BondManager using REDEEM_EOA
     * @dev Restricted to CONTROLLER_ROLE
     */
    function redeemFor(address _holder, string memory _isin, uint256 _value, address _operator)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);

        // Validate partition is active
        if (!activePartitions[partition]) {
            revert Errors.PartitionNotActive(_isin);
        }

        // Check if bonds have matured (must have completed all coupon payments)
        if (!isMatured[partition]) {
            revert Errors.NotMatured(_isin, 0, block.timestamp);
        }

        // Call parent to burn the bonds from the holder
        // WNOK payment is handled via mock DVP in BondManager
        _redeemByPartition(partition, _operator, _holder, _value, "", "");

        emit IsinRedeemed(_isin, _holder, _value, _operator);
    }

    /**
     * @notice Burn bonds before maturity for buyback flows
     * @param _holder Address selling the bonds back
     * @param _isin ISIN string
     * @param _value Number of bonds to burn
     * @param _operator Address with CONTROLLER_ROLE executing the burn
     */
    function buybackRedeemFor(address _holder, string memory _isin, uint256 _value, address _operator)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);

        if (!activePartitions[partition]) {
            revert Errors.PartitionNotActive(_isin);
        }

        _redeemByPartition(partition, _operator, _holder, _value, "", "");

        emit IsinRedeemed(_isin, _holder, _value, _operator);
    }

    /**
     * @notice Update coupon payment tracking (called by BondManager after coupon payment)
     * @param _isin ISIN string
     * @param _timestamp Timestamp of the payment
     * @param _paymentCount New payment count
     * @dev Restricted to CONTROLLER_ROLE
     */
    function updateCouponPayment(string memory _isin, uint256 _timestamp, uint256 _paymentCount)
        external
        onlyRole(Roles.BOND_CONTROLLER_ROLE)
    {
        bytes32 partition = isinToPartition(_isin);
        lastCouponPayment[partition] = _timestamp;
        couponPaymentCount[partition] = _paymentCount;
    }

    /**
     * @notice Mark bond as matured (called after final coupon payment)
     * @param _isin ISIN string
     * @dev Restricted to CONTROLLER_ROLE
     */
    function setMatured(string memory _isin) external onlyRole(Roles.BOND_CONTROLLER_ROLE) {
        bytes32 partition = isinToPartition(_isin);
        isMatured[partition] = true;
    }

    /**
     * @notice Get all coupon details for a partition in a single call
     * @param _isin ISIN string
     * @return _couponDuration Interval between coupon payments in seconds
     * @return _couponYield Coupon yield percentage
     * @return _maturityDuration Duration in seconds until maturity
     * @return _lastCouponPayment Timestamp of last coupon payment
     * @return _couponPaymentCount Number of coupon payments made
     */
    function getCouponDetails(string memory _isin)
        external
        view
        returns (
            uint256 _couponDuration,
            uint256 _couponYield,
            uint256 _maturityDuration,
            uint256 _lastCouponPayment,
            uint256 _couponPaymentCount
        )
    {
        bytes32 partition = isinToPartition(_isin);
        return (
            couponDuration[partition],
            couponYield[partition],
            maturityDuration[partition],
            lastCouponPayment[partition],
            couponPaymentCount[partition]
        );
    }
}
