# Coupon and Redemption Sequence

Coupon and redemption cash is the government-nominated TBD, paid from its
configured government reserve. The API derives holders from the chain
projection unless the operator supplies an explicit list.

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Norges Bank operator
    participant UI as NB UI
    participant API as NB Bond API
    participant DB as SQLite projection
    participant BM as BondManager
    participant BT as BondToken
    participant DVP as BondDvP
    participant TBD as Government-nominated TBD
    actor Holder as Bond holder

    Note over Operator,BT: RATE auction has enabled the bond,<br/>set yield, and started its maturity timer

    loop Each due coupon interval
        Operator->>UI: Approve coupon payment
        UI->>API: POST /v1/bonds/{isin}/coupon-payments<br/>{holders?}
        API->>DB: Resolve active holders when omitted
        API->>BM: payCoupon(isin, holders)
        BM->>BT: getCouponDetails(isin)
        BM->>BM: Verify due time and calculate<br/>nominal × yield per unit

        loop Every supplied holder with balance
            BM->>BT: balanceOfByPartition(partition, holder)
            BM->>DVP: settle cash-only coupon
            DVP->>TBD: transferFrom(government reserve, holder, amount)
            TBD-->>Holder: Tokenized-deposit balance increases
        end

        BM->>BT: Verify processed balance equals total supply
        BM->>BT: updateCouponPayment(timestamp, count)
        opt Final expected coupon
            BM->>BT: setMatured(isin)
        end
        API->>DB: Wait for receipt block projection
        API-->>UI: Updated bond or HTTP 202 if projection is pending
    end

    Operator->>UI: Approve redemption
    UI->>API: POST /v1/bonds/{isin}/redemptions {holders?}
    API->>DB: Resolve active holders when omitted
    API->>BM: redeem(isin, holders)

    loop Every supplied holder with balance
        BM->>BT: balanceOfByPartition(partition, holder)
        BM->>DVP: settle redemption<br/>nominal cash + bond burn
        DVP->>BT: redeemFor(holder, isin, balance, operator)
        DVP->>TBD: transferFrom(government reserve, holder, nominal)
        TBD-->>Holder: Tokenized-deposit balance increases
    end

    BM->>BT: Require partition totalSupply == 0
    API->>DB: Wait for receipt block projection
    API-->>UI: Redeemed bond or HTTP 202 if projection is pending
```

Unlike auction allocation settlement, these loops do not catch DvP failures.
Any failure reverts the entire coupon or redemption transaction. Coupon payout
also reverts unless the supplied holders account for the full partition supply;
redemption reverts unless no supply remains afterward.
