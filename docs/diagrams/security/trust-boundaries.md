# Trust Boundaries

The entire default deployment is a trusted-local sandbox. The optional Entra
mode adds identity and role checks, but it does not turn the local topology,
fixture keys, or operational defaults into a production security design.

```mermaid
flowchart LR
    user["Human user"]
    entra["Microsoft Entra ID"]

    subgraph browserZone["Browser trust zone"]
        ui["NB UI"]
        token["access token<br/>entra mode only"]
    end

    subgraph edgeZone["Local Gateway boundary"]
        gateway["NGINX Gateway API"]
        public["Unauthenticated local endpoints<br/>Besu RPC and Blockscout"]
    end

    subgraph appZone["NB Bond API trust zone"]
        health["Public: /docs, OpenAPI, /v1/health"]
        anyRole["Recognised operator or tester role<br/>general API + SSE + banking"]
        operatorOnly["Operator role<br/>admin and central-bank operations"]
        serviceKeys["Service signing material<br/>bond admin, sealing, central bank<br/>Kubernetes Secret / environment"]
        sqliteKeys["Sandbox participant keys<br/>bidder and bank private keys"]
        sqlite[("SQLite<br/>plaintext sandbox key records")]
    end

    subgraph chainZone["Ledger trust zone"]
        rpc["Besu archive JSON-RPC"]
        access["On-chain Ownable / AccessControl roles<br/>and token allowlists"]
        contracts["Smart contracts and balances"]
    end

    user --> ui
    ui <-->|"OIDC redirect"| entra
    entra -->|"JWT"| token
    ui -->|"HTTP / SSE + optional bearer token"| gateway
    gateway --> health
    gateway --> anyRole
    gateway --> operatorOnly
    gateway --> public
    anyRole --> serviceKeys
    anyRole --> sqliteKeys
    operatorOnly --> serviceKeys
    sqliteKeys --- sqlite
    serviceKeys -->|"sign privileged transactions"| rpc
    sqliteKeys -->|"sign impersonated participant transactions"| rpc
    public --> rpc
    rpc --> access
    access --> contracts
```

Security consequences:

- API `NB_BOND_API_AUTH_MODE=none` makes its role gates no-ops; UI
  `runtimeConfig.authMode=none` disables the login flow. Both are local defaults.
- API authorization and on-chain authorization are independent layers; a valid
  web role does not replace the contract role held by the signing address.
- The API intentionally stores fixture bidder and bank keys in plaintext and
  can hold issuer/central-bank keys. It must not be exposed as a real custody
  system.
- Failed gas-estimation attempts never reach the ledger; the preserved
  `operation_attempts` table is their only durable audit record.
- `PARTIAL` is a reserved audit status but is not currently written. A mined
  auction finalisation with failed allocations returns successfully and is
  therefore recorded as `SUCCEEDED`; allocation events must be inspected to
  identify its partial settlement outcome.
