# Blockscout ↔ Besu Debugging Playbook

This guide documents how to diagnose Blockscout indexing issues against Besu,
using commands that run inside the cluster.

## Quick triage

1) **Blockscout logs (what is failing)**
```sh
kubectl logs -n blockscout deploy/blockscout-blockscout-stack-blockscout --tail=200
```
Shows stack traces and which fetcher is failing (e.g., realtime block fetcher).

2) **Besu logs (is RPC receiving calls)**
```sh
kubectl logs -n besu besu-0 --tail=200
```
Confirms Besu is reachable and whether JSON-RPC / WebSocket calls are arriving.

## Validate RPC connectivity from Blockscout pod

3) **Basic JSON-RPC health (eth_blockNumber)**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'curl -s -X POST --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}" \
http://besu.besu.svc.cluster.local:8545'
```
If this fails, it's a network / RPC endpoint issue, not Blockscout logic.

4) **Trace method sanity check**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'curl -s -X POST --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"trace_block\",\"params\":[\"0x1fa\"]}" \
http://besu.besu.svc.cluster.local:8545'
```
If this fails, Besu trace support or permissions are the issue.

## Reproduce with Blockscout’s live node (critical)

> Note: `bin/blockscout eval` runs in a **new, non-booted VM**.  
> Use `bin/blockscout rpc` to execute inside the running node.

5) **Inspect realtime fetcher state**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'bin/blockscout rpc "IO.inspect(:sys.get_state(Process.whereis(Indexer.Block.Realtime.Fetcher)))"'
```
Shows JSON-RPC transport options and URLs that Blockscout is using.

6) **Force a live fetch through Blockscout’s client**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'bin/blockscout rpc "state = :sys.get_state(Process.whereis(Indexer.Block.Realtime.Fetcher)); \
args = state.block_fetcher.json_rpc_named_arguments; \
IO.inspect(EthereumJSONRPC.fetch_blocks_by_numbers([506], args))"'
```
If this fails but curl works, the issue is in Blockscout client config.

## Common pitfalls

- **`ETHEREUM_JSONRPC_HTTP_INSECURE=true` on plain HTTP**  
  In the current Blockscout/Tesla adapter, `insecure: true` triggers `:badarg` on HTTP
  and bubbles up as timeouts. Keep it `false` unless you are truly using HTTPS.

- **`eval` vs `rpc` confusion**  
  `eval` won’t show issues in the running node; it starts a separate VM. Use `rpc`.

## If you need TLS with self-signed certs

1) Terminate TLS at a reverse proxy (nginx/envoy/traefik) in front of Besu.  
2) Mount the CA bundle into Blockscout and set a standard CA env var (e.g., `SSL_CERT_FILE`).  
3) Avoid `ETHEREUM_JSONRPC_HTTP_INSECURE=true` unless the adapter explicitly supports it.

