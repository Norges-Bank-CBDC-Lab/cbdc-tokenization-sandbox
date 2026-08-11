# Mutation and Projection Catch-Up

Mutation responses are projection-aligned. A mined transaction is never
reported as failed merely because ingestion did not catch up within the bounded
HTTP wait. This flow applies to projection-backed bond and auction mutations;
local-record mutations and direct WNOK/TBD administration compose their
responses through different paths.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Route / feature service
    participant Audit as operation_attempts
    participant RPC as Besu archive RPC
    participant Chain as QBFT ledger
    participant Ingest as Serialized ingestion coordinator
    participant Projection as SQLite projection

    Client->>API: POST / PATCH / PUT / DELETE
    API->>RPC: staticCall / gas estimation where applicable

    alt Preflight or submission rejects
        RPC-->>API: Revert or transport failure
        API->>Audit: REVERTED or FAILED + decoded reason
        API-->>Client: RFC 7807 error
    else Transaction accepted
        API->>RPC: Send with managed nonce
        RPC->>Chain: Include transaction in block N
        Chain-->>API: Receipt for block N
        API->>Audit: SUCCEEDED + transaction hash
        API->>Ingest: Actively advance shared projection through N
        Ingest->>RPC: Read logs and block metadata
        Ingest->>Projection: Apply reducers + checkpoint in one transaction
        Projection-->>Ingest: Commit block N
        Ingest-->>API: Projection reached N

        alt Catch-up finishes within bound
            API->>Projection: Compose updated parent resource
            API-->>Client: 200 resource + X-Projection-Block
        else Catch-up exceeds bound
            API-->>Client: 202 MutationAccepted<br/>tx hash, block N, resource key
            Note over Ingest,Projection: Ingestion continues after the HTTP response
        end
    end
```

Clients must not retry a `202` as though the transaction failed. They should
poll or revalidate the identified resource until its projection includes the
receipt block.
