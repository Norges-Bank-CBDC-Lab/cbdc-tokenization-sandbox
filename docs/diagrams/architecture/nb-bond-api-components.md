# NB Bond API Components

The service is a modular monolith. `index.ts` is the composition root and
`app.ts` composes the HTTP pipeline; feature services and projection snapshots
keep transaction orchestration separate from response mapping.

```mermaid
flowchart TB
    ui["NB UI / API client"]

    subgraph process["NB Bond API process"]
        index["index.ts<br/>composition root + lifecycle"]
        app["app.ts<br/>Express routes and middleware"]
        auth["auth.ts<br/>none or Entra JWT + App Roles"]
        contracts["Zod contracts + OpenAPI assembly"]

        subgraph features["Application services"]
            auctionSvc["Auction service<br/>create / close / cancel / finalise"]
            lifecycle["Bond lifecycle handlers<br/>create / disable / coupon / redeem"]
            banking["Banking and central-bank services"]
            bidder["Sandbox bidder and bid service"]
            operations["Operation-attempt recorder"]
        end

        chain["Chain gateway<br/>ethers contracts + managed nonce"]
        crypto["Bid allocation and cryptography<br/>seal / unseal / EIP-712 proof assembly"]
        composer["Projection snapshots and DTO composers"]

        subgraph ingestion["Serialized ingestion coordinator"]
            poller["block-range poller"]
            reducers["event reducers"]
            checkpoint["atomic projection checkpoint"]
            events["process-local SSE broadcaster"]
        end

        db[("SQLite")]
    end

    besu["Besu archive/RPC node"]

    ui -->|"REST / OpenAPI"| app
    ui <-->|"GET /v1/events"| events
    index --> app
    index --> poller
    app --> auth
    app --> contracts
    app --> auctionSvc
    app --> lifecycle
    app --> banking
    app --> bidder
    auctionSvc --> crypto
    auctionSvc --> chain
    lifecycle --> chain
    banking --> chain
    bidder --> crypto
    bidder --> chain
    auctionSvc --> operations
    lifecycle --> operations
    banking --> operations
    bidder --> operations
    app --> composer
    composer -->|"single SQLite read transaction"| db
    operations -->|"preserved attempt record"| db
    bidder -->|"preserved bidder keys"| db
    banking -->|"preserved bank keys"| db
    chain <-->|"JSON-RPC"| besu
    poller -->|"logs and block metadata"| besu
    poller --> reducers
    reducers -->|"one SQLite transaction"| db
    reducers --> checkpoint
    checkpoint -->|"publish after commit"| events
```

Reads for bonds and auctions are projection-backed and checkpoint-consistent;
they do not fan out to Besu during ordinary composition.
