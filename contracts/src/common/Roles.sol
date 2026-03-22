// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

library Roles {
    /**
     * AccessControl default admin role
     */
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
    /**
     * The role required to call BaseSecurityToken.custodialTransfer
     */
    bytes32 internal constant CUSTODIAL_TRANSFER_ROLE = keccak256("CUSTODIAL_TRANSFER_ROLE");
    bytes32 internal constant SECURITY_OPERATOR_ROLE = keccak256("SECURITY_OPERATOR_ROLE");
    /**
     * The role required to submit orders
     */
    bytes32 internal constant SUBMIT_ORDER_ROLE = keccak256("SUBMIT_ORDER_ROLE");
    /**
     * The role required to call DvP.settle
     */
    bytes32 internal constant SETTLE_ROLE = keccak256("SETTLE_ROLE");
    bytes32 internal constant TRANSFER_FROM_ROLE = keccak256("TRANSFER_FROM_ROLE");
    /**
     * The role required to call the cctFrom method
     */
    bytes32 internal constant CCT_FROM_CALLER_ROLE = keccak256("CCT_FROM_CALLER_ROLE");
    /**
     * The role required to call CBDC related methods in this contract
     */
    bytes32 internal constant CBDC_CONTRACT_ROLE = keccak256("CBDC_CONTRACT_ROLE");

    /**
     * The role required to manage allowlists
     */
    bytes32 internal constant ALLOWLIST_ADMIN_ROLE = keccak256("ALLOWLIST_ADMIN_ROLE");

    /**
     * The role required to manage clients
     */
    bytes32 internal constant CLIENT_ADMIN_ROLE = keccak256("CLIENT_ADMIN_ROLE");

    /**
     * The role required to mint tokens
     */
    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /**
     * The role required to burn tokens
     */
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /**
     * The role required to manage the order book
     */
    bytes32 internal constant ORDER_ADMIN_ROLE = keccak256("ORDER_ADMIN_ROLE");

    /**
     * The role required to manage bond auctions
     */
    bytes32 internal constant BOND_AUCTION_ADMIN_ROLE = keccak256("BOND_AUCTION_ADMIN_ROLE");

    /**
     * The role required to orchestrate bond operations via BondManager
     */
    bytes32 internal constant BOND_MANAGER_ROLE = keccak256("BOND_MANAGER_ROLE");

    /**
     * The role required to manager bond transfers and partitions
     */
    bytes32 internal constant BOND_CONTROLLER_ROLE = keccak256("BOND_CONTROLLER_ROLE");

    /**
     * The role required to manage bond priveleges
     */
    bytes32 internal constant BOND_ADMIN_ROLE = keccak256("BOND_ADMIN_ROLE");
}
