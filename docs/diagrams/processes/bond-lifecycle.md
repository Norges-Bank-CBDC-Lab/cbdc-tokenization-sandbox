# Bond Lifecycle

The API derives a bond's displayed status from replayed events, current supply,
and the latest auction. `disabled` is a separate soft-delete flag rather than a
member of the public status enum.

```mermaid
flowchart TD
    snapshot["Checkpoint-consistent bond snapshot"]
    matured{"isMatured?<br/>(final coupon paid principal and burned every unit)"}
    auctioning{"Latest auction is<br/>open or closed?"}
    outstanding{"everIssued AND<br/>totalSupply > 0?"}
    m["status = matured"]
    a["status = auctioning"]
    o["status = outstanding"]
    s["status = staged"]
    disabled{"disabled flag?"}
    hidden["Excluded from default listing<br/>available with includeDisabled"]
    visible["Return status + lifecycle fields"]

    snapshot --> matured
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
    OUTSTANDING --> MATURED: final coupon plus principal paid, all units burned
    STAGED --> DISABLED: zero supply and no finalised auction history
    DISABLED --> STAGED: recreate the ISIN
    MATURED --> [*]
```

`MATURED` is terminal: the final `payCoupon` pays coupon plus principal to every
holder, burns unsold units the manager holds without payment, and emits
`BondMatured` once (ADR 0005). A full pre-maturity BUYBACK can reduce supply to
zero without maturing the bond; under the current classifier it falls back to
`staged`. That is current behavior, not a recommended domain model.
