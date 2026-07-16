# Bond Lifecycle

The API derives a bond's displayed status from replayed events, current supply,
and the latest auction. `disabled` is a separate soft-delete flag rather than a
member of the public status enum.

```mermaid
flowchart TD
    snapshot["Checkpoint-consistent bond snapshot"]
    redeemed{"everIssued AND redemptionComplete<br/>AND totalSupply = 0?"}
    matured{"isMatured?"}
    auctioning{"Latest auction is<br/>open or closed?"}
    outstanding{"everIssued AND<br/>totalSupply > 0?"}
    r["status = redeemed"]
    m["status = matured"]
    a["status = auctioning"]
    o["status = outstanding"]
    s["status = staged"]
    disabled{"disabled flag?"}
    hidden["Excluded from default listing<br/>available with includeDisabled"]
    visible["Return status + lifecycle fields"]

    snapshot --> redeemed
    redeemed -->|"yes"| r --> disabled
    redeemed -->|"no"| matured
    matured -->|"yes"| m --> disabled
    matured -->|"no"| auctioning
    auctioning -->|"yes"| a --> disabled
    auctioning -->|"no"| outstanding
    outstanding -->|"yes"| o --> disabled
    outstanding -->|"no"| s --> disabled
    disabled -->|"yes"| hidden
    disabled -->|"no"| visible
```

The normal lifecycle is:

```mermaid
stateDiagram-v2
    [*] --> STAGED: create bond partition
    STAGED --> AUCTIONING: schedule first RATE auction
    AUCTIONING --> STAGED: cancel before issuance
    AUCTIONING --> OUTSTANDING: finalise RATE issuance
    OUTSTANDING --> AUCTIONING: schedule PRICE or BUYBACK
    AUCTIONING --> OUTSTANDING: finalise or cancel with supply remaining
    OUTSTANDING --> MATURED: final coupon paid
    MATURED --> REDEEMED: burn all units and pay nominal cash
    STAGED --> DISABLED: zero supply and no finalised auction history
    DISABLED --> STAGED: recreate the ISIN
    REDEEMED --> [*]
```

A full pre-maturity BUYBACK can reduce supply to zero without setting
`redemptionComplete`; under the current classifier it falls back to `staged`,
not `redeemed`. That is current behavior, not a recommended domain model.
