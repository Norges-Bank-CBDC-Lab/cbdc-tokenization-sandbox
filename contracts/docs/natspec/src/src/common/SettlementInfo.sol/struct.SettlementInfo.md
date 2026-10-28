# SettlementInfo
[Git Source](../../../../../../src/common/SettlementInfo.sol)


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

