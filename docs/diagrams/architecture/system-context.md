# System Context

The sandbox is a trusted-local environment for operating a CBDC-oriented
monoledger prototype. The browser operator path is the main supported product
surface; bidder CLIs and direct JSON-RPC remain reference/integration paths.

```mermaid
flowchart LR
    operator["Norges Bank operator"]
    dealer["Primary dealer / bidder"]
    developer["Developer / integrator"]
    entra["Microsoft Entra ID<br/>optional non-local identity provider"]

    subgraph sandbox["CBDC tokenization sandbox"]
        ui["NB UI<br/>operator web application"]
        api["NB Bond API<br/>privileged orchestration and projection"]
        bidderTools["Bid encryption and submitter CLIs<br/>reference tools"]
        explorer["Blockscout<br/>chain explorer"]
        ledger["Besu QBFT monoledger<br/>smart contracts and events"]
    end

    operator -->|"browser<br/>HTTP locally, HTTPS when supplied non-locally"| ui
    ui -->|"REST + SSE"| api
    dealer -->|"API sandbox bidder flow"| api
    dealer -->|"seal and submit directly"| bidderTools
    bidderTools -->|"JSON-RPC transaction"| ledger
    developer -->|"inspect transactions"| explorer
    developer -->|"Foundry / JSON-RPC"| ledger
    api -->|"signed transactions + reads"| ledger
    explorer -->|"index blocks and logs"| ledger
    entra -.->|"OIDC login<br/>UI runtimeConfig.authMode = entra"| ui
    entra -.->|"JWKS and token claims"| api
```

The local defaults are UI `runtimeConfig.authMode=none` (published to browser
`AUTH_MODE`) and API `NB_BOND_API_AUTH_MODE=none`. Entra is an optional
deployment mode, not part of the default Kind startup.
