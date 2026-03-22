// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

library Errors {
    // --- Common (shared across multiple contracts) ---
    error AllowlistViolation(string contractname, address account, string message);
    error AdminAddressZero();
    error WnokAddressZero();
    error DvpAddressZero();
    error OrderBookAddressZero();
    error SecurityMismatch();
    error InvalidAmount();
    error InvalidPrice();
    error OrderNotFound();
    error UnauthorizedBroker();
    error DuplicateOrderBook(address security);
    error SecurityAddressZero();
    error OfferingZero();
    error MaturityDurationZero();
    error AdditionalOfferingZero();
    error NoAllocations();
    error SettlementFailure(uint8 reason, bytes lowLevelData);
    error InvalidRecipient();
    error InvalidHolder(address holder);
    error InsufficientBalance();
    error InsufficientPartitionBalance();
    error NotMultipleOfGranularity();
    error UnauthorizedOperator();
    error TbdAddressZero();
    error PartitionZero();

    // --- Registry (GlobalRegistry) ---
    error ContractNotFound(string contractAddress);
    error InvalidContractAddress(address contractAddress);

    // --- StockTokenFactory ---
    error NotDeployer();
    error DeployerAddressZero();
    error ImplementationAddressZero();
    error StockTokenCloneFailed(string name, string symbol, address implementation);
    error DuplicateStockToken(string isin, address token);

    // --- OrderBook (CSD) ---
    error MissingRole(bytes32 role, address account);
    error NotInAllowlist(string list, address addr);

    // --- Wnok ---
    error BankAddressZero();
    error CallbackFailed(bytes4 received);

    // --- Private-bank Tbd ---
    error InvalidReceiver();
    error TokenTransferFailed();
    error CctFailed();
    error NotGovernmentNominated();

    // --- BondOrderBookFactory ---
    error BondTokenAddressZero();

    // --- BondManager ---
    error DurationScalarZero();
    error BondUnitNominalZero();
    error BondDoesNotExist(string isin);
    error IncorrectBondState(string isin, bool expected);
    error NoFailedIssuance();
    error InvalidGovTbd();
    error RedemptionIncomplete(string _isin, uint256 remaining);
    error BuybackExceedsSupply(string isin, uint256 buybackSize, uint256 currentSupply);
    error BuybackOfferingZero(string isin);
    error CouponNotReady(string isin, uint256 nextPaymentTime, uint256 currentTime);
    error AllCouponsPaid(string isin);
    error CouponPaymentBalanceMismatch(string isin, uint256 processedBalance, uint256 totalSupply);

    // --- BondAuction ---
    error IncorrectAuctionPhase(bytes32 id, uint8 expected, uint8 actual);
    error AuctioneerPubkeyMissing();
    error InvalidAuctionOwner();
    error BiddingEndNotFuture();
    error FirstAuctionMustBeRate();
    error PreviousAuctionActive(bytes32 id);
    error AuctionTypeMustBePrice();
    error AuctionNotFound(bytes32 id);
    error AuctionNotFoundForIsin(string isin);
    error NotAuctionOwner();
    error InBidPhase();
    error CannotCancelAuctionInThisState();
    error AllocationTypeMismatch();
    error InvalidUnits();
    error RatesMustMatch();
    error InvalidRate();
    error OverAllocation(uint256 total, uint256 offering);
    error NotInBidPhase();
    error CiphertextRequired();
    error PlaintextHashRequired();
    error ProofLengthMismatch(uint256 expected, uint256 actual);
    error InvalidBidIndex(uint256 max, uint256 actual);
    error MissingBidSig();
    error InvalidBidSig();
    error InvalidBidNonce();

    // --- BondToken / coupon ---
    error ControllerAddressZero();
    error CouponDurationZero();
    error CouponYieldZero();
    error ReductionAmountZero();
    error ReductionExceedsOffering(uint256 offering, uint256 reduction);
    error ReductionBelowSupply(uint256 currentSupply, uint256 offeringAfterReduction);
    error PartitionNotActive(string isin);
    error DuplicatePartition(string isin);
    error ExceedsOffering(string isin, uint256 currentSupply, uint256 mintAmount, uint256 offering);
    error NotMatured(string isin, uint256 maturityDate, uint256 currentTime);
    error MaturityDateZero();

    // --- ERC1410 base ---
    error InvalidGranularity();
    error ControllerZeroAddress();

    // --- BondDvP ---
    error PayerOrPayeeZero();
    error InvalidOperation();

    // --- BaseSecurityToken ---
    error NotAdmin();
}
