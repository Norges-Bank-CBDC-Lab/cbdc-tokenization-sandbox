# SettlementInfo
[Git Source](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/blob/e5dd7d7e99990db27d5acf5ec43a6d906d577e7d/src/common/SettlementInfo.sol)


```solidity
struct SettlementInfo {
// True if matched + settled
bool settled;
// False if matched + settlement failure due to order
bool validOrder;
// Unique order ID
// Existing order ID if a new order was settled
// New order ID if the order was unmatched or dropped
bytes32 orderId;
// Settlement amount (0 if unmatched or dropped)
uint256 settlementAmount;
}
```

