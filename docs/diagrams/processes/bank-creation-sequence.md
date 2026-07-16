# Sandbox Bank Creation Sequence

Bank creation is a sandbox-only orchestration that creates a bank signing key,
deploys its TBD token, registers the token, optionally enables WNOK settlement,
and finally preserves the bank record in SQLite.

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator or tester
    participant UI as NB UI
    participant API as NB Bond API
    participant DB as SQLite system of record
    participant Registry as GlobalRegistry
    participant Chain as Besu archive RPC / ledger
    participant TBD as New TBD contract
    participant WNOK as WNOK
    participant Audit as operation_attempts

    User->>UI: Create bank
    UI->>API: POST /v1/banking/banks
    API->>API: Generate or validate bank private key<br/>derive bank address and TBD name
    API->>DB: Reject duplicate bank name or address
    API->>Registry: Check registry name and resolve WNOK + DvP

    API->>Chain: Deploy TBD signed by bank key<br/>admin = bank, bank = bank, govReserve = zero
    Chain-->>API: TBD contract address
    API->>Registry: setContract("TBD name", address)<br/>signed by central-bank registry owner

    opt enableWnokSettlement is true or omitted
        API->>WNOK: Add bank reserve address to allowlist<br/>signed by central-bank key
    end

    API->>DB: Insert bank name, address, TBD address,<br/>and plaintext sandbox private key
    API->>Audit: Record BANK_CREATE as SUCCEEDED<br/>without a single transaction hash
    API-->>UI: 200 bank summary
```

This is not an atomic workflow: contract deployment, registry registration,
optional WNOK allowlisting, and the SQLite insert are separate operations. A
failure after deployment can leave on-chain side effects without a bank row.
The current audit wrapper records the overall request as `REVERTED` or `FAILED`;
the reserved `PARTIAL` status is not yet assigned to this case.
