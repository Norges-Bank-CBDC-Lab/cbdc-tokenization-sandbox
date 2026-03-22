// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/**
 * @notice Interface for the Bond delivery-versus-payment contract.
 */
interface IBondDvP {
    /**
     * @notice Operation type for the bond leg.
     */
    enum Operation {
        None,
        TransferPartition,
        Redeem,
        Buyback
    }

    /**
     * @notice Enum describing which leg failed in SettlementFailure.
     */
    enum FailureReason {
        Security,
        Cash,
        Unknown
    }

    /**
     * @notice Generalised settlement payload describing both bond and cash legs.
     * @param bond Bond token address.
     * @param partition Partition (ISIN) identifier for the bond leg.
     * @param bondFrom Sender of the bond units.
     * @param bondTo Recipient of the bond units.
     * @param bondAmount Amount of bond units to move.
     * @param cashToken ERC20 token address used for cash leg.
     * @param cashFrom Payer address for the cash leg.
     * @param cashTo Payee address for the cash leg.
     * @param cashAmount Amount of cash token to transfer.
     * @param operator Authorized operator executing the settlement.
     * @param op Operation describing bond behaviour (transfer, redeem, buyback).
     */
    struct Settlement {
        address bond;
        bytes32 partition;
        address bondFrom;
        address bondTo;
        uint256 bondAmount;
        address cashToken;
        address cashFrom;
        address cashTo;
        uint256 cashAmount;
        address operator;
        Operation op;
    }

    event DvPEvent(
        address indexed bond,
        bytes32 indexed partition,
        Operation op,
        address indexed bondFrom,
        address bondTo,
        uint256 bondAmount,
        address cashToken,
        address cashFrom,
        address cashTo,
        uint256 cashAmount,
        address operator
    );

    function name() external view returns (string memory);

    /**
     * @notice Generalised settlement entrypoint covering transfer, redeem, buyback and cash-only paths.
     */
    function settle(Settlement calldata p) external returns (bool);
}
