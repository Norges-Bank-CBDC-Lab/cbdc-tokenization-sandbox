# Secondary-Market Matching and Settlement

Registered retail clients submit orders through their broker. The order book
resolves the best opposing price, applies price-time order, and invokes the
general DvP contract for the security and tokenized-deposit legs.

```mermaid
flowchart TD
    client["Registered broker client"]
    broker["Broker<br/>resolves securities wallet,<br/>TBD wallet, and TBD contract"]
    submit["OrderBook.buy or sell"]
    best["Read best opposing price level"]
    cross{"Prices cross?"}
    rest["Insert remaining order at price level<br/>preserve FIFO links and volume"]
    maker["Select head order<br/>maker price determines settlement value"]
    amount["tradeAmount = min(taker remaining, maker amount)"]
    dvp["DvP.settle"]
    security["BaseSecurityToken.custodialTransfer<br/>seller securities wallet → buyer securities wallet"]
    cash{"Same bank TBD?"}
    internal["Internal TBD transfer<br/>buyer deposit → seller deposit"]
    crossbank["Cross-bank CCT<br/>burn buyer TBD, move WNOK reserves,<br/>mint seller TBD"]
    ok{"Both legs succeed?"}
    update["Decrease order amounts and level volume<br/>remove fully filled maker"]
    remaining{"Taker amount remains<br/>and another match exists?"}
    reason{"Failure attributed to"}
    invalidMaker["Remove invalid maker order<br/>and continue"]
    preserve["Preserve valid unmatched state<br/>or return partial result"]
    result(["SettlementInfo returned"])

    client --> broker --> submit --> best --> cross
    cross -->|"no"| rest --> result
    cross -->|"yes"| maker --> amount --> dvp
    dvp --> security --> cash
    cash -->|"yes"| internal --> ok
    cash -->|"no"| crossbank --> ok
    ok -->|"yes"| update --> remaining
    remaining -->|"yes"| best
    remaining -->|"no"| result
    ok -->|"no"| reason
    reason -->|"opposing maker at fault"| invalidMaker --> remaining
    reason -->|"taker or unknown failure"| preserve --> result
```

Each matched slice is one atomic DvP call. A larger order may fill through
multiple DvP calls inside the same submitted order transaction; caught failures
can therefore leave earlier successful slices settled. The order book reports
whether the order was fully settled, still valid, and how much traded.
