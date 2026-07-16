# Auction Lifecycle

`BondAuction` stores the authoritative state. The end timestamp soft-closes bid
submission, but an explicit issuer transaction performs the `BIDDING` to
`CLOSED` transition. Cancellation is allowed from bidding or closed.

```mermaid
stateDiagram-v2
    [*] --> NONE
    NONE --> BIDDING: createAuction
    BIDDING --> CLOSED: closeAuction after end timestamp
    BIDDING --> CANCELLED: cancelAuction
    CLOSED --> FINALISED: finaliseAuction
    CLOSED --> CANCELLED: cancelAuction
    FINALISED --> [*]
    CANCELLED --> [*]

    note right of BIDDING
        submitBid allowed while block timestamp <= end
        BondManager.bondActive[ISIN] is true
    end note

    note right of CLOSED
        sealed bids are unsealed off-chain
        operator chooses winning bid indexes
    end note

    note right of FINALISED
        allocations are public on-chain
        per-allocation DvP has been attempted
        BondManager.bondActive[ISIN] is false
    end note
```

Auction type constraints:

```mermaid
flowchart LR
    first{"First auction for ISIN?"}
    rate["RATE<br/>lowest yield preferred<br/>sets coupon and maturity timer"]
    later{"Later auction purpose"}
    price["PRICE<br/>highest price preferred<br/>extends issued supply"]
    buyback["BUYBACK<br/>lowest price preferred<br/>reduces supply"]

    first -->|"yes"| rate
    first -->|"no"| later
    later -->|"additional issuance"| price
    later -->|"repurchase outstanding units"| buyback
```
