# Besu 26.11.2 bump — Design

**Status:** Approved (2026-11-24)
**Created:** 2026-11-24
**Intent:** [`intent.md`](intent.md)
**Builds on:** [the 26.11.0 bump](../besu-26-11-0-bump/design.md), which used the same sweep and
in-place upgrade.

## Decision Summary

Move the pin to 26.11.2 in one small PR, skipping 26.11.1, using the same pin sweep and in-place
upgrade as the previous bump. The image content is unchanged in shape (same entrypoint, user,
working directory and ports as 26.11.0), so the change is image-only: no genesis, configuration or
storage change.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** `hyperledger/besu:26.11.2` is a multi-arch index (linux/amd64, linux/arm64) with digest `sha256:19d6cf7fffda207c814778b301b9d4eb8f6f2d7acaad7e4ca4a974784b4f8554` | registry manifest read on 2026-11-24 | The pin carries tag and index digest |
| **Verified.** 26.11.1's only change (`-XX:-UseBASE64Intrinsics`) is a default JVM option in the 26.11.2 launcher | `/opt/besu/bin/besu` in the image | Skipping 26.11.1 loses nothing |
| **Verified.** The image is Temurin 25.0.5.1 on Ubuntu 24.04.5; `keytool` and `java` are present, `jcmd`, `jstack`, `jmap` and `jshell` are not | image read | Nothing in the repo uses the missing tools; the register row is re-read with `keytool` |
| **Verified.** The trust store holds 116 certificates and none of "emSign ECC Root CA - G3", "AAA Certificate Services" or any emSign or eMudhra root | `keytool -list -cacerts` in the image | The register row records a clean store |
| **Verified.** No first-party code, script or contract calls `eth_createAccessList`, any `trace_*` or `debug_*` method, or reads `BLOBBASEFEE`; no WebSocket SSL option, `--rpc-tx-feecap` or `BESU_OPTS` is set | repository search | The release's RPC and option changes do not reach this stack |
| **Verified.** The archive node uses the Forest storage format, so the `debug_accountRange` and `debug_storageRangeAt` change for Bonsai does not apply; the validator does not expose the DEBUG API | node configs | No effect |
| **Verified.** Neither release notes nor the image mention a storage migration or a one-way step | release notes | An in-place upgrade needs no data action |
| **Reported, not reproduced here.** 26.11.0 refuses to start on data last started by 26.11.2 unless the version-compatibility protection is turned off | a separate test; the option is in the 26.11.2 `--help` | Recorded in `docs/KNOWN_ISSUES.md` as a rollback note |
| **Needs verification.** The QBFT import shortcut keeps both nodes at equal block hashes and state roots | live check | Checked on mined transactions and during the soak |

## The Pin Sweep

| File | Change |
|---|---|
| `common/images.yaml` | `besu:` tag and index digest |
| `infra/besu/values.yaml` | `image:` fallback |
| `scripts/verification/check-besu-qbft-baseline.py` | expected-version constant |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY_NOTES.md`, `infra/README.md`, `infra/DEVELOPMENT.md` | version prose |
| `docs/KNOWN_ISSUES.md` | the Besu register row, the "not yet taken" bullet, a rollback note |

## Rejected Alternatives

- **Take 26.11.1 first.** Its only change is in 26.11.2, so it adds a step with no value.
- **Combine with PostgreSQL 18.7.** Different blast radius and a different rollback; one PR each.
