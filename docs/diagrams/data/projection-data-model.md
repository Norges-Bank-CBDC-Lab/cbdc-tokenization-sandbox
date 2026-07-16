# Projection Data Model

The SQLite file deliberately combines two storage classes with opposite reset
semantics. Projection tables are disposable and rebuilt from chain events;
system-of-record tables preserve data the chain cannot reproduce.

```mermaid
flowchart TB
    chain["Besu blocks, receipts, and contract logs"]
    ingestion["Serialized ingestion coordinator"]

    subgraph db["SQLite database"]
        identity["chain_identity<br/>chain ID + genesis hash binding"]

        subgraph projection["Rebuildable chain projection"]
            ingestionState["ingestion_state<br/>last block and tx checkpoint"]
            context["projection_context<br/>contract addresses and block time"]
            auctions["auctions"]
            auctionEvents["auction_events"]
            auctionBids["auction_bids"]
            allocations["auction_allocations"]
            partitions["partitions"]
            bondState["bond_state"]
            balances["balances"]
            balanceEvents["balance_events"]
            bondEvents["bond_events"]
        end

        subgraph records["Preserved system of record"]
            bidders["bidders<br/>sandbox names and private keys"]
            banks["banks<br/>deployed TBD metadata and private keys"]
            attempts["operation_attempts<br/>SUCCEEDED / REVERTED / FAILED<br/>PARTIAL reserved, not currently written"]
        end
    end

    snapshots["Atomic snapshot loaders"]
    composers["Bond and auction DTO composers"]
    api["REST responses<br/>X-Projection-Block + ETag"]

    chain --> ingestion
    ingestion -->|"validate before accepting checkpoint"| identity
    ingestion -->|"single write transaction"| ingestionState
    ingestion --> context
    ingestion --> auctions
    ingestion --> auctionEvents
    ingestion --> auctionBids
    ingestion --> allocations
    ingestion --> partitions
    ingestion --> bondState
    ingestion --> balances
    ingestion --> balanceEvents
    ingestion --> bondEvents

    projection -->|"single read transaction"| snapshots
    snapshots --> composers
    composers --> api

    api -->|"sandbox bidder CRUD"| bidders
    api -->|"bank creation and signing"| banks
    api -->|"record every attempted mutation"| attempts

    reset["schema bump or admin resync"] -->|"drop and replay only"| projection
    reset -.->|"must preserve"| records
```

`chain_identity` is preserved separately so the service can reject a database
whose chain ID/genesis pair does not match the connected RPC chain. Never add a
locally generated row to a projection table: resync will erase it.
