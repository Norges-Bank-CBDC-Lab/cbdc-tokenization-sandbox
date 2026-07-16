# Runtime Deployment

This view shows the default `./sandbox.sh start` deployment. Application,
indexing, deployment, and external JSON-RPC traffic uses the archive node; the
validator exposes only its minimal operator endpoint inside the cluster.

```mermaid
flowchart TB
    browser["Host browser / curl / Foundry"]
    docker["Host Docker daemon"]
    registry["kind-registry<br/>localhost:5001"]

    subgraph kind["Kind cluster: cluster-cbdc-monoledger"]
        gateway["NGINX Gateway Fabric<br/>active HTTP listeners: 80 and 8545"]

        subgraph uiNs["namespace: nb-ui"]
            ui["NB UI pod<br/>nginx-unprivileged + React bundle"]
            uiConfig["runtime config.js<br/>ConfigMap"]
        end

        subgraph apiNs["namespace: nb-bond-api"]
            api["NB Bond API pod<br/>Express modular monolith"]
            sqlite[("SQLite on nb-bond-api-data PVC<br/>256 MiB RWO by default")]
            apiSecrets["signing and sealing keys<br/>Kubernetes Secret"]
        end

        subgraph besuNs["namespace: besu"]
            archive["besu-archive StatefulSet<br/>FULL sync + Forest archive storage<br/>HTTP RPC 8545 / WS 8546"]
            archivePvc[("archive PVC")]
            validator["besu-validator StatefulSet<br/>single QBFT block producer"]
            validatorPvc[("validator PVC")]
            genesis["shared QBFT / Osaka genesis<br/>predeployed GlobalRegistry"]
        end

        subgraph explorerNs["namespace: blockscout"]
            frontend["Blockscout frontend"]
            backend["Blockscout backend / indexer"]
            postgres[("PostgreSQL + PVC")]
            verifier["smart-contract verifier"]
            bens["BENS microservice"]
        end

        contracts["Deployed Solidity contracts"]
    end

    browser -->|"web.cbdc-sandbox.local"| gateway
    browser -->|"bond-api.cbdc-sandbox.local"| gateway
    browser -->|"blockscout.cbdc-sandbox.local"| gateway
    browser -->|"besu.cbdc-sandbox.local:8545"| gateway

    gateway --> ui
    gateway --> api
    gateway --> frontend
    gateway --> backend
    gateway -->|"/api/v1/* with chain-ID rewrite"| bens
    gateway --> archive

    uiConfig --> ui
    ui -->|"REST + SSE"| api
    apiSecrets --> api
    api --- sqlite
    api -->|"in-cluster HTTP JSON-RPC"| archive

    archive <-->|"static Besu P2P"| validator
    archive --- archivePvc
    validator --- validatorPvc
    genesis --> archive
    genesis --> validator
    archive --- contracts

    backend --> archive
    backend --- postgres
    frontend --> backend
    backend --> verifier
    backend -->|"MICROSERVICE_BENS_URL"| bens

    docker -->|"build and push content-hash images"| registry
    registry -->|"image pulls"| ui
    registry -->|"image pulls"| api
    registry -->|"image pulls"| frontend
    registry -->|"image pulls"| backend
    registry -->|"image pulls"| bens
```

Besu WebSocket is enabled on `besu-archive` but is not routed through the
Gateway; it requires an in-cluster connection or explicit port-forward. The
NodePort service and Kind host mappings also reserve ports 443 and 8546, but
the current Gateway defines no listeners for either port. BENS has no separate
deployment toggle: it is built and deployed whenever the Blockscout step is
enabled.
