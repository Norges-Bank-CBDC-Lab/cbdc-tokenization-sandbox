# Roles
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/Roles.sol)


## Constants
### DEFAULT_ADMIN_ROLE
AccessControl default admin role


```solidity
bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00
```


### CUSTODIAL_TRANSFER_ROLE
The role required to call BaseSecurityToken.custodialTransfer


```solidity
bytes32 internal constant CUSTODIAL_TRANSFER_ROLE = keccak256("CUSTODIAL_TRANSFER_ROLE")
```


### SECURITY_OPERATOR_ROLE

```solidity
bytes32 internal constant SECURITY_OPERATOR_ROLE = keccak256("SECURITY_OPERATOR_ROLE")
```


### SUBMIT_ORDER_ROLE
The role required to submit orders


```solidity
bytes32 internal constant SUBMIT_ORDER_ROLE = keccak256("SUBMIT_ORDER_ROLE")
```


### SETTLE_ROLE
The role required to call DvP.settle


```solidity
bytes32 internal constant SETTLE_ROLE = keccak256("SETTLE_ROLE")
```


### TRANSFER_FROM_ROLE

```solidity
bytes32 internal constant TRANSFER_FROM_ROLE = keccak256("TRANSFER_FROM_ROLE")
```


### CCT_FROM_CALLER_ROLE
The role required to call the cctFrom method


```solidity
bytes32 internal constant CCT_FROM_CALLER_ROLE = keccak256("CCT_FROM_CALLER_ROLE")
```


### CBDC_CONTRACT_ROLE
The role required to call CBDC related methods in this contract


```solidity
bytes32 internal constant CBDC_CONTRACT_ROLE = keccak256("CBDC_CONTRACT_ROLE")
```


### ALLOWLIST_ADMIN_ROLE
The role required to manage allowlists


```solidity
bytes32 internal constant ALLOWLIST_ADMIN_ROLE = keccak256("ALLOWLIST_ADMIN_ROLE")
```


### CLIENT_ADMIN_ROLE
The role required to manage clients


```solidity
bytes32 internal constant CLIENT_ADMIN_ROLE = keccak256("CLIENT_ADMIN_ROLE")
```


### MINTER_ROLE
The role required to mint tokens


```solidity
bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE")
```


### BURNER_ROLE
The role required to burn tokens


```solidity
bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE")
```


### ORDER_ADMIN_ROLE
The role required to manage the order book


```solidity
bytes32 internal constant ORDER_ADMIN_ROLE = keccak256("ORDER_ADMIN_ROLE")
```


### BOND_AUCTION_ADMIN_ROLE
The role required to manage bond auctions


```solidity
bytes32 internal constant BOND_AUCTION_ADMIN_ROLE = keccak256("BOND_AUCTION_ADMIN_ROLE")
```


### BOND_MANAGER_ROLE
The role required to orchestrate bond operations via BondManager


```solidity
bytes32 internal constant BOND_MANAGER_ROLE = keccak256("BOND_MANAGER_ROLE")
```


### BOND_CONTROLLER_ROLE
The role required to manager bond transfers and partitions


```solidity
bytes32 internal constant BOND_CONTROLLER_ROLE = keccak256("BOND_CONTROLLER_ROLE")
```


### BOND_ADMIN_ROLE
The role required to manage bond priveleges


```solidity
bytes32 internal constant BOND_ADMIN_ROLE = keccak256("BOND_ADMIN_ROLE")
```


