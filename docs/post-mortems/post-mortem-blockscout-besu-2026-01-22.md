# Post-Mortem: Blockscout Indexer Timeouts on Besu (2026-01-22)

## Executive summary
Blockscout appeared to time out while indexing Besu, even though Besu RPC endpoints
were reachable and returned data via direct `curl`. The root cause was a configuration
flag (`ETHEREUM_JSONRPC_HTTP_INSECURE=true`) that injects an HTTP option (`insecure: true`)
unsupported for **plain HTTP** in Blockscout’s Tesla adapter. That error surfaced as
timeouts in logs, masking the true failure (`:badarg`).

Resolution: set `ETHEREUM_JSONRPC_HTTP_INSECURE` to `"false"` for HTTP endpoints.

## Impact
- Indexer failed to advance; no new transactions appeared in Blockscout UI.
- Blockscout realtime fetcher repeatedly crashed and restarted.
- Perception of Besu trace instability, despite RPC health.

## Timeline (approximate)
- **Initial symptom:** Blockscout indexer timeouts on trace requests.
- **Investigation:** Verified Besu RPC and trace methods via `curl` from the Blockscout pod.
- **Deep dive:** Executed Blockscout client calls inside the live node; reproductions
  showed `:badarg` bubbling as timeouts.
- **Root cause identified:** `insecure: true` in HTTP options for non‑TLS endpoint.
- **Fix applied:** Set `ETHEREUM_JSONRPC_HTTP_INSECURE=false` and revert debug logging.

## Detection
Primary signal was Blockscout log spam:
- `Tesla.Middleware.Timeout.repass_error/1`
- `EthereumJSONRPC.HTTP.chunked_json_rpc/3`
These were interpreted as timeouts but were actually wrapping `:badarg`.

## Root cause
`ETHEREUM_JSONRPC_HTTP_INSECURE=true` adds `insecure: true` to Tesla’s HTTP options.
For non‑TLS HTTP, Tesla/Mint treats this as invalid and throws `:badarg`. This error
is rethrown via timeout middleware, producing misleading timeouts.

**Mismatch:** HTTP URL + TLS‑only `insecure` option.

## Contributing factors
- The top‑level error looked like a timeout, masking the real failure.
- Manual `curl` tests succeeded, which hid the client‑side configuration problem.
- Debugging relied on `eval` at first; `rpc` is needed to run in the live node.

## Resolution
Set the environment variable to false:
- `ETHEREUM_JSONRPC_HTTP_INSECURE: "false"`
File: `services/blockscout/values.backend.env.yaml`

Logging changes used during the investigation were reverted to normal (INFO) and
custom log4j overrides removed.

## Verification
Blockscout’s live client calls succeed once `insecure` is removed from HTTP options.

## Workarounds (if you truly need insecure TLS)
1) **Use HTTPS with a trusted cert**  
   Terminate TLS at a reverse proxy (nginx/envoy/traefik), mount CA bundle into
   Blockscout, and set `SSL_CERT_FILE` or equivalent.
2) **Use HTTPS and skip verification only if supported**  
   This depends on whether the Blockscout/Tesla adapter supports insecure TLS on HTTPS.
3) **Stay on HTTP**  
   Keep `ETHEREUM_JSONRPC_HTTP_INSECURE=false` (it has no effect on HTTP).

## Commands used (with purpose)
1) **Blockscout logs**
```sh
kubectl logs -n blockscout deploy/blockscout-blockscout-stack-blockscout --tail=200
```
Identify which fetcher is failing and the top‑level stack trace.

2) **Besu logs**
```sh
kubectl logs -n besu besu-0 --tail=200
```
Confirm RPC/WebSocket traffic and general node health.

3) **Basic RPC health from Blockscout pod**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'curl -s -X POST --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}" \
http://besu.besu.svc.cluster.local:8545'
```
Validates connectivity and HTTP RPC responsiveness.

4) **Trace call sanity check**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'curl -s -X POST --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"trace_block\",\"params\":[\"0x1fa\"]}" \
http://besu.besu.svc.cluster.local:8545'
```
Ensures trace methods work on the node itself.

5) **Live Blockscout node introspection**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'bin/blockscout rpc "IO.inspect(:sys.get_state(Process.whereis(Indexer.Block.Realtime.Fetcher)))"'
```
Shows the actual JSON‑RPC options Blockscout is using.

6) **Trigger a live client fetch**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'bin/blockscout rpc "state = :sys.get_state(Process.whereis(Indexer.Block.Realtime.Fetcher)); \
args = state.block_fetcher.json_rpc_named_arguments; \
IO.inspect(EthereumJSONRPC.fetch_blocks_by_numbers([506], args))"'
```
Reproduces the failure using Blockscout’s real client path.

7) **Confirm that removing `insecure` fixes it**
```sh
kubectl exec -n blockscout deploy/blockscout-blockscout-stack-blockscout -- sh -c \
'bin/blockscout rpc "state = :sys.get_state(Process.whereis(Indexer.Block.Realtime.Fetcher)); \
args = state.block_fetcher.json_rpc_named_arguments; \
topts = args[:transport_options]; \
http_opts = Keyword.delete(topts[:http_options], :insecure); \
args2 = Keyword.put(args, :transport_options, Keyword.put(topts, :http_options, http_opts)); \
IO.inspect(EthereumJSONRPC.fetch_blocks_by_numbers([506], args2))"'
```
Proves the invalid option was the trigger.

## Lessons learned
- **Timeouts can be wrappers.** Always check if the error is a downstream exception.
- **Test inside the live process.** `rpc` reflects the real runtime state; `eval` does not.
- **Validate client options, not just endpoint health.** Direct `curl` success isn’t enough.
- **Document fixes.** Add issues and workarounds to `docs/known_issues.md` when requested.

## Related docs
- Blockscout debugging playbook: `services/blockscout/debugging.md`
