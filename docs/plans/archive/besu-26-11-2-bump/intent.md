# Besu 26.11.2 bump — Intent

**Status:** Approved (2026-11-24)
**Created:** 2026-11-24
**Requested by:** sandbox operator

## Outcome

The sandbox's chain nodes run Besu 26.11.2, upgraded in place on the existing chain with no wipe and
no contract redeployment. Every pin, checker, and document that names the Besu version agrees, and
the local stack is shown healthy on the new version before the change merges.

## Why This Change

Besu 26.11.2 is the current release; the repo pins 26.11.0. Release 26.11.1 changed one thing (a JVM
option that switches off the Base64 intrinsics, a mitigation for a JVM heap-overflow bug on x86-64
CPUs with AVX-512), and 26.11.2 carries it, so the bump goes straight to 26.11.2. The release also
brings:

- **A Temurin 25.0.5.1 JRE image.** The image no longer ships the JDK tools `jcmd`, `jstack`, `jmap`
  and `jshell`; `java`, `jfr` and `keytool` remain.
- **QBFT import without re-execution.** A validator imports a committed block without executing it
  again, including after a round change.
- **Transaction-pool and parallel-execution changes**, and a fix for a node that stopped mid-import
  and could not restart.
- **RPC behaviour changes** in `eth_createAccessList`, `trace_filter`, the `trace_*` methods
  (`pending` is rejected), the default `debug_trace*` tracer, zero-fee `BLOBBASEFEE` calls and legacy
  calls that carry another chain's chain ID.

The practical risk for a single-user local sandbox is low; this is a hygiene bump that keeps the pin
current and takes the JVM mitigation.

## Scope

### In Scope

- The image pin in `common/images.yaml` and the chart fallback in `infra/besu/values.yaml`.
- The expected-version constant in `scripts/verification/check-besu-qbft-baseline.py`.
- The prose that names the version: root `README.md`, `docs/ARCHITECTURE.md`,
  `docs/THIRD_PARTY_NOTES.md`, `infra/README.md`, `infra/DEVELOPMENT.md`.
- The Besu row of the certificate-authority register and the "patch releases not yet taken" bullet
  in `docs/KNOWN_ISSUES.md`, plus a note on the version-compatibility guard.
- A live in-place upgrade and verification on the local stack.

### Out of Scope

- PostgreSQL 18.7 (a separate pin, a separate change).
- Any new Besu option, node configuration, genesis or storage change.
- A fresh-genesis start, unless the in-place checks show a problem.
- Any non-local rollout.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Both nodes report `besu/v26.11.2` on chain 2018 and the old head block keeps its hash and state root | Upgrade breaks the existing chain | `web3_clientVersion`, `eth_getBlockByNumber` before and after |
| Mined transactions have equal block hashes and state roots on both nodes | The QBFT import change diverges state | hash and state-root comparison |
| NB Bond API ingestion follows the head with lag 0 and Blockscout indexes the same height | Consumer regression | health endpoint, explorer API |
| The bond lifecycle (deploy, auction with bids and finalisation, coupon) works on the upgraded chain | Zero-fee transaction-pool path regression | lifecycle run |
| Each node restarts cleanly and Blockscout resumes; a `trace_block` call answers on the archive node | Restart and trace regression | pod status, explorer height, RPC response |
| A 20-minute soak with a transaction trickle keeps both nodes at equal heads and lag 0 | Slow divergence or leak | periodic snapshots |
| The baseline checker, hygiene, link, licence, node-version, image-pin and image-hash checks pass | Pin drift | script output |
| The `docs/KNOWN_ISSUES.md` Besu row reflects a fresh read of the 26.11.2 image's trust store | Stale trust-store register | `keytool` listing recorded in the row |

## Constraints

- No new dependency: same image repository, new tag, Apache-2.0.
- No chain wipe and no contract redeployment. If either becomes necessary, stop and ask.
- One PR against `development`. Public-repo rules apply.
