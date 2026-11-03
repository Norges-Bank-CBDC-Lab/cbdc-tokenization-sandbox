# Besu 26.11.0 bump — Design

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Intent:** [`intent.md`](intent.md)
**Builds on:** the 26.10.2 bump (a pin sweep with an in-place upgrade) and
`docs/plans/archive/image-pin-refresh/` (how image pins are refreshed and verified).

## Decision Summary

Move the pin to 26.11.0 in one small PR, using the same sweep and in-place upgrade as the previous
bump, and treat the live upgrade as part of the proof, not an afterthought. The release changes
two things that sit on this stack's own path (the QBFT block-import shortcut and Vert.x's
WebSocket behaviour), so verification checks those two directly.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** The repo pins `hyperledger/besu:26.10.2`; the newest release is 26.11.0 (2026-11-02) | `common/images.yaml`, release list | A one-release bump |
| **Verified.** The image `hyperledger/besu:26.11.0` is published for linux/amd64 and linux/arm64 | Docker Hub tag listing | The sandbox's Apple Silicon path works |
| **Verified.** All 15 published Besu advisories are fixed in 26.10.0 or earlier | repository advisory list | 26.11.0 adds no advisory fix of its own |
| **Verified.** Vert.x 5.2.2 landed in Besu on 2026-10-28, after 26.10.2 (2026-10-26) | upgrade PR | The pin still has the vulnerable Vert.x |
| **Verified.** Peer discovery is disabled on both nodes | node configs | The DiscV5 hardening is not reachable |
| **Verified.** HTTP RPC is on for both nodes; WS RPC and the TRACE and DEBUG APIs only for the archive node; `--rpc-max-trace-steps` is not set | node configs | The Vert.x fixes apply; the `trace_rawTransaction` fix changes nothing today |
| **Verified.** Nothing tracked in the repo calls `eth_getProof`, `eth_simulateV1`, `engine_getPayload`, `trace_rawTransaction`, or state overrides | repository search | The three breaking RPC changes do not touch first-party code |
| **Verified.** Blockscout subscribes to the archive node over WebSocket, and Vert.x 5.2.2 now fails WebSocket writes after close | Blockscout env values, upgrade PR | The live indexer path needs an explicit check, including after a node restart |
| **Verified.** 26.11.0 lets a QBFT validator import a block it proposed without executing it again, and commits only the state a block changes | release notes | A consensus-path change; check that the archive node's head hash matches the validator's |
| **Verified.** Both nodes are single-replica StatefulSets on persistent volumes | chart | A rolling upgrade keeps the chain, as the previous bump did |
| **Verified.** The live stack runs `besu/v26.10.2` on chain 2018 at block 283 | read-only RPC calls, 2026-11-03 | The pre-upgrade baseline |
| **Needs verification.** Whether Blockscout's reads and decoding still behave with the 26.11.0 `eth_call` error-code and revert-reason changes | live check | Checked in the verification phase |
| **Needs verification.** The new image's trust store (the certificate register tracks distrusted roots per image) | `keytool` listing of cacerts in the image | Re-read before updating the register row |

## The Pin Sweep

| File | Change |
|---|---|
| `common/images.yaml` | `besu:` tag |
| `infra/besu/values.yaml` | `image:` fallback |
| `scripts/verification/check-besu-qbft-baseline.py` | expected-version constant (the checker is the baseline record) |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY_NOTES.md`, `infra/README.md`, `infra/DEVELOPMENT.md` | version prose |
| `docs/KNOWN_ISSUES.md` | the Besu row: image tag, trust-store source, last-checked date |

## Behaviour Changes Reviewed

| Change | Effect here |
|---|---|
| `eth_getProof` rule changes, `eth_simulateV1` unknown-override rejection, `engine_getPayload` timeout default | None: not called by first-party code, and the Engine API is not used on this QBFT chain |
| `eth_call`, `eth_estimateGas`, `callTracer` revert and error-code decoding | More informative errors; verify through Blockscout reads |
| Block-propagation retry limit | Affects Clique/PoA networks; not this chain |
| `--strict-tx-replay-protection-enabled` fix | Option not set |

## Rejected Alternatives

- **Wait for 26.11.1.** The vulnerable Vert.x stays in place meanwhile, and the previous cadence
  shows the sandbox follows point releases. The risk of waiting is small but nonzero; the risk of
  bumping is covered by the live checks.
- **Combine with other image pins.** Keeps this PR reviewable and easy to revert on its own.

## Risks

- **The QBFT import shortcut.** Mitigated by comparing head hashes on both nodes and mining a
  transaction.
- **WebSocket behaviour with Blockscout.** Mitigated by restarting the archive node after the
  upgrade and confirming Blockscout resumes indexing.
- **A new release of a client that publishes often.** A point release may follow; the plan is
  small enough to repeat.
