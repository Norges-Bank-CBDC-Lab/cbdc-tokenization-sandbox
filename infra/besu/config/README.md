# Genesis file

The genesis.json file provides configuration for initializing the Besu Ethereum
network.

The chart templates this file with QBFT `extraData` generated from the local
validator key. `validator.toml` configures the QBFT signer with Bonsai storage;
`archive.toml` configures the non-validator application endpoint with FULL sync
and Forest archive storage.

Transaction-bearing QBFT blocks use a one-second period. Idle empty blocks use
a 300-second period to avoid filling this low-TPS sandbox with mostly empty
history. The latter throttles empty blocks; it does not disable them.

Static enodes use stable headless-service DNS identities. Each process binds
P2P on all interfaces and advertises its downward-API-injected pod IP because
Besu rejects DNS names for `--p2p-host`. Besu also requires literal IPs inside
static enodes, so an init container resolves the peer's stable DNS name and
writes the runtime-only static-node file before the client starts.

Our genesis file is based on the templates at
<https://github.com/hyperledger/besu/tree/main/config/src/main/resources>
(Apache-2.0 license).
