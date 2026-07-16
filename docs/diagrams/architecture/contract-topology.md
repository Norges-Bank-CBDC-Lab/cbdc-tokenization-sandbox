# Contract Topology

The deployed contract set contains two related market paths: the actively
operated primary bond lifecycle and a secondary securities/order-book path.
`GlobalRegistry` is address discovery, not an authorization boundary.

```mermaid
flowchart TB
    registry["GlobalRegistry<br/>stable local genesis address"]

    subgraph money["Money layer"]
        wnok["WNOK<br/>allowlisted wholesale cash token"]
        tbdN["TBD instances per private bank<br/>Nordea is government-nominated"]
    end

    subgraph primary["Primary bond market"]
        manager["BondManager<br/>issuer orchestration"]
        auction["BondAuction<br/>sealed bids and allocations"]
        bond["BondToken<br/>ERC-1410 partitions by ISIN"]
        bondDvp["BondDvP<br/>bond/cash settlement"]
    end

    subgraph secondary["Secondary securities market"]
        stockFactory["StockTokenFactory"]
        stock["StockToken clones<br/>BaseSecurityToken"]
        orderbook["OrderBook<br/>price-time matching"]
        broker["Broker<br/>registered client routing"]
        dvp["DvP<br/>security + TBD settlement"]
    end

    registry -.->|"registered address"| wnok
    registry -.->|"registered addresses"| tbdN
    registry -.->|"registered addresses"| manager
    registry -.->|"registered addresses"| auction
    registry -.->|"registered addresses"| bond
    registry -.->|"registered addresses"| bondDvp
    registry -.->|"registered addresses"| stockFactory
    registry -.->|"registered addresses"| orderbook
    registry -.->|"registered addresses"| broker
    registry -.->|"registered address"| dvp

    manager -->|"create / close / cancel / finalise"| auction
    manager -->|"partition, mint, coupon, redeem"| bond
    manager -->|"settle each allocation or payout"| bondDvp
    bondDvp -->|"partition transfer or redemption"| bond
    bondDvp -->|"RATE / PRICE issuance cash"| wnok
    bondDvp -->|"BUYBACK, coupon, redemption via Nordea TBD"| tbdN

    stockFactory -->|"deterministic minimal clones"| stock
    broker -->|"buy / sell / revoke"| orderbook
    orderbook -->|"settle matched orders"| dvp
    dvp -->|"custodial security transfer"| stock
    dvp -->|"same-bank or cross-bank CCT"| tbdN
    tbdN <-->|"reserve movement for cross-bank CCT"| wnok
```

The bond and stock token models shown here are current. ADR 0002 adopts a
future migration to canonical ERC-3643 for securities, but that implementation
has not landed. `OrderBookFactory`, `BondOrderBook`, and
`BondOrderBookFactory` exist in source but are not instantiated by the default
deployment scripts; the deployed secondary-market path uses a directly created
`OrderBook` for the stock token.
