# Besu 26.11.0 bump — Intent

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Requested by:** sandbox operator

## Outcome

The sandbox's chain nodes run Besu 26.11.0, upgraded in place on the existing chain with no wipe and
no contract redeployment. Every pin, checker, and document that names the Besu version agrees, and
the local stack is shown healthy on the new version before the change merges.

## Why This Change

Besu 26.11.0 was published on 2026-11-02; the repo pins 26.10.2. The release carries no fix for any
published Besu advisory (the newest, fixed in 26.10.0, is already in the pin). Its security value
is in dependencies and hardening:

- **Vert.x 5.1.6 to 5.2.2.** Fixes Vert.x advisories from mid-October 2026 that reach Besu's
  HTTP servers: HTTP/1.x request smuggling through canonicalised headers (JSON-RPC HTTP and the
  Engine API), no allocation limit on compressed WebSocket frames, and an incomplete HTTP client
  SSL context cache key. The upgrade merged two days after 26.10.2 was cut, so the pin still has
  Vert.x 5.1.6.
- **DiscV5 memory hardening.** Not reachable here: peer discovery is disabled.
- **`trace_rawTransaction`.** Now honours `--rpc-max-trace-steps`. The archive node enables the TRACE
  API and does not set the cap, so the fix changes nothing unless the cap is configured.

Both nodes serve HTTP JSON-RPC on 8545 and the archive node serves WebSocket JSON-RPC on 8546. The
HTTP endpoint is reachable through the local gateway. The practical risk for a single-user local
sandbox is low; this is a hygiene bump with a real, if small, security component.

## Scope

### In Scope

- The image pin in `common/images.yaml` and the chart fallback in `infra/besu/values.yaml`.
- The expected-version constant in `scripts/verification/check-besu-qbft-baseline.py`.
- The prose that names the version: root `README.md`, `docs/ARCHITECTURE.md`,
  `docs/THIRD_PARTY_NOTES.md`, `infra/README.md`, `infra/DEVELOPMENT.md`.
- The Besu row of the certificate-authority register in `docs/KNOWN_ISSUES.md`, re-read from the
  new image.
- A live in-place upgrade and verification on the local stack.

### Out of Scope

- Setting `--rpc-max-trace-steps` or any other new Besu option.
- Adopting 26.11.0's new features (`SNAP2` sync, `--Xevm-v2`).
- Changing node configuration, genesis, or storage format.
- Any non-local rollout.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Both nodes report `besu/v26.11.0` on chain 2018 and the head advances past the pre-upgrade block | Upgrade breaks block production or the validator/archive link | `web3_clientVersion`, `eth_blockNumber` before and after |
| The archive node follows the validator after the upgrade with equal head hashes | The QBFT block-import change (validator skips re-executing its own proposals) diverges state | `eth_getBlockByNumber` hash comparison on both nodes |
| A transaction is mined after the upgrade | Consensus path regression | mined receipt |
| NB Bond API ingestion follows the head with lag 0 and the read endpoints answer | Consumer regression | API status endpoint, a read call |
| Blockscout indexes new blocks, including after the archive node restarts | Vert.x 5.2.2 WebSocket changes break the live block feed | explorer API block height, Blockscout logs |
| The baseline checker, hygiene, link, licence, node-version, and image-hash checks pass | Pin drift | script output |
| The `docs/KNOWN_ISSUES.md` Besu row reflects a fresh read of the 26.11.0 image's trust store | Stale trust-store register | `keytool` listing recorded in the row |

## Constraints

- No new dependency: same image repository, new tag, Apache-2.0.
- No chain wipe and no contract redeployment. If either becomes necessary, stop and ask.
- One PR against `development`. Public-repo rules apply.
