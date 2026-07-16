# Live Update and Revalidation Flow

SSE messages are notification-only. They carry coarse resource keys and never
replace the REST projection as the source of truth.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as NB UI tab
    participant Auth as Auth provider
    participant API as NB Bond API
    participant DB as SQLite projection
    participant Chain as Besu

    UI->>Auth: Initialize noneAuth or entraAuth
    UI->>API: GET /v1/events with optional bearer token
    API->>API: Authenticate and require recognised role
    API-->>UI: Open text/event-stream
    UI->>API: GET resource with cached ETag
    API->>DB: Read checkpoint-consistent snapshot
    API-->>UI: 200 data or 304 Not Modified

    Chain-->>API: New contract logs during ingestion
    API->>DB: Commit reducers and new checkpoint
    API-->>UI: changed {resources: [coarse keys]}
    UI->>API: Re-run only matching mounted queries<br/>with existing ETags
    API->>DB: Read authoritative projection
    API-->>UI: 200 changed data or 304
    UI-->>User: Refresh content without blanking stale data

    loop Idle connection
        API-->>UI: SSE comment heartbeat
    end

    alt Stream disconnects
        UI->>UI: Exponential backoff with jitter
        UI->>Auth: Reacquire token when needed
        UI->>API: Reconnect GET /v1/events
        API-->>UI: Open stream
        UI->>API: Coarse reconciliation GETs
    end

    par Independent health signal
        UI->>API: Poll GET /v1/health
        API-->>UI: API / RPC / ingestion status
    and Manual refresh remains available
        User->>UI: Refresh
        UI->>API: GET current resource
    end
```

There is no replay buffer or `Last-Event-ID` contract. Reconciliation on every
connection recovers missed changes. The broadcaster is process-local, so this
implementation is intentionally deployed with one API replica.
