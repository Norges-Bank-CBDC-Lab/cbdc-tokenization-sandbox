# Coupon and Maturity Sequence

Coupon cash is WNOK, paid from the government reserve account fixed on
`BondManager` at deployment (`GOV_RESERVE`). Payouts move existing WNOK; nothing
is minted. The final coupon also repays principal, burns every unit, and closes
the bond in the same transaction; there is no separate redemption step. The API
derives holders from the chain projection unless the operator supplies an
explicit list.

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
    participant WNOK as Wnok
    actor Holder as Bond holder

    Note over Operator,BT: RATE auction has enabled the bond,<br/>set yield, and started its maturity timer

    loop Each due coupon interval
        Operator->>UI: Approve coupon payment
        UI->>API: POST /v1/bonds/{isin}/coupon-payments<br/>{holders?}
        API->>DB: Resolve active holders when omitted
        API->>BM: payCoupon(isin, holders)
        BM->>BT: getCouponDetails(isin)
        BM->>BM: Verify due time; compute nominal × yield per unit;<br/>final period = last expected payment

        opt Final period
            BM->>BT: setMatured(isin)
        end

        loop Every supplied holder with balance
            BM->>BT: balanceOfByPartition(partition, holder)
            alt Holder is BondManager itself (unsold units)
                BM->>BM: Count as unsold, pay nothing
            else Interim period
                BM->>DVP: settle cash-only coupon
                DVP->>WNOK: transferFrom(government reserve, holder, coupon)
                WNOK-->>Holder: WNOK balance increases
            else Final period
                BM->>DVP: settle Redeem: burn units + coupon plus principal
                DVP->>BT: redeemFor(holder, isin, balance)
                DVP->>WNOK: transferFrom(government reserve, holder, coupon + nominal)
                WNOK-->>Holder: WNOK balance increases, units gone
            end
        end

        BM->>BT: Verify paid + unsold balances equal total supply
        BM->>BT: updateCouponPayment(timestamp, count)
        opt Final period
            BM->>BT: redeemFor(BondManager, isin, unsold) — burn without payment
            BM->>BT: Require partition totalSupply == 0
            BM-->>API: BondMatured(isin, paymentCount, principalPaid, couponPaid, unsoldBurned)
        end
        API->>DB: Wait for receipt block projection
        API-->>UI: Updated bond (status matured after the final period) or HTTP 202 if pending
    end
```

Unlike auction allocation settlement, this loop does not catch DvP failures.
Any failure reverts the entire coupon transaction, including the closing one,
so a reserve shortfall on the final period blocks closure rather than paying
some holders. Coupon payout also reverts unless the supplied holders (plus any
unsold units the manager holds) account for the full partition supply, and the
final period reverts unless no supply remains afterward.
