[![Contracts CI](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/test-contracts.yml/badge.svg)](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/test-contracts.yml)

# CBDC Sandbox Monoledger

> Experimental sandbox: this repository is a local development prototype for
> CBDC-related workflows. It is not production-ready and is provided "AS IS",
> without warranties or guarantees of security, correctness, fitness, or
> regulatory suitability. You use it at your own risk and are responsible for
> validating any deployment, usage, or redistribution, including compliance
> with third-party software licenses for external components, images, charts,
> and dependencies. Unless a file-level SPDX identifier or attribution notice
> states otherwise, repository-owned source code, documentation, examples, and
> repository-generated artifacts in this repository are licensed under
> Apache-2.0.

This is a monorepo for the local CBDC sandbox. The root README is intentionally
short: use it to get the sandbox running, then jump to the component-specific
documentation.

## Monorepo Layout

- `infra/`: local cluster, gateway, Besu, and shared deployment plumbing
- `services/`: in-cluster services such as Blockscout, NB Bond API, and NB UI
- `contracts/`: Solidity contracts and Foundry workflows
- `scripts/`: reference CLIs for off-chain workflows
- `docs/`: architecture notes, diagrams, runbooks, and reports

## Documentation

Start here after cloning:

- [architecture overview](docs/ARCHITECTURE.md): what the sandbox contains and how it fits together
- [known issues](docs/KNOWN_ISSUES.md): current limitations and planned follow-up work
- [post-mortems](docs/post-mortems/README.md): incident write-ups and troubleshooting history
- [documentation index](docs/DOCUMENTATION_INDEX.md): all major docs in one place
- [infra README](infra/README.md): infra entrypoint and registry workflow
- [services README](services/README.md): service overview and where to go next
- [scripts README](scripts/README.md): CLI overview and usage pointers
- [contracts README](contracts/README.md): contract-specific workflow and verification
- [contributing guide](CONTRIBUTING.md)
- [security policy](SECURITY.md)

## AI Ready

This repository includes dedicated guidance for AI coding agents. These files
also help human contributors understand repo-specific workflow and guardrails:

- `AGENTS.md`: root-level repository guidance
- `contracts/AGENTS.md`: contract and Foundry guidance
- `infra/AGENTS.md`: infra and deployment guidance
- `scripts/AGENTS.md`: script and CLI guidance
- `services/AGENTS.md`: service-specific guidance

## Current Local Chain

The validated local baseline is Besu 26.7.0 with Osaka active from genesis,
one QBFT validator, and one separate non-validator archive/RPC node. Solidity
0.8.36 and OpenZeppelin 5.6.1 are pinned to that execution baseline. All local
application, Blockscout, Foundry, and gateway traffic uses the archive/RPC
node; the validator is not an application endpoint.

Transaction-bearing blocks use a one-second period. When the transaction pool
is empty, QBFT produces an empty block only every five minutes to keep this
low-throughput sandbox from accumulating mostly empty history.

This one-validator topology is deterministic but is not Byzantine fault
tolerant. It has no beacon client or bootnode profile. See
[ADR 0003](docs/decisions/0003-adopt-besu-qbft-osaka-with-archive-rpc.md) and
the [archived implementation plan](docs/plans/archive/besu-qbft-osaka-upgrade-plan.md)
for the decision, migration constraints, and acceptance evidence.

## Quick Setup

Commands are expected to run on Linux or macOS. On Windows, use WSL.

1. Install Docker.
2. Install Foundry and use the latest stable release:

```console
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

3. Install the local tooling:

```console
# Ubuntu/Debian example
go install sigs.k8s.io/kind@v0.27.0
sudo snap install kubectl --classic
sudo snap install helm --classic
sudo snap install yq
sudo apt install jq
```

```console
# macOS (Homebrew)
brew install kind kubectl helm yq jq
```

4. Generate the required local-only fixture files:

```console
node scripts/generate-local-sandbox-fixtures.mjs
```

This writes ignored local files for `contracts/.env`,
`services/nb-bond-api/helm/values.local.yaml`,
`scripts/bid-submitter/examples/bids.keys.json`, and the runnable bid-encryption
inputs under `.tmp/bid-encryption/examples/`.

The start scripts also generate these files automatically if they are missing.
They are for local sandbox use only and must never be reused outside local
development.

5. Install contract dependencies:

```console
cd contracts
forge soldeer install
cd ..
```

6. Start the local registry the sandbox pulls all images through:

```console
./infra/infra.sh registry-start
```

The registry container persists across cluster lifecycles, so this is a
one-time setup (and a no-op on subsequent runs). `./sandbox.sh start`
pulls and pushes any missing images into this registry on demand via
`loadImageToKind`.

Current Blockscout backend/frontend release tags are not published as pullable
images upstream. On a fresh machine or after `registry-reset`, build the pinned
sources into the local registry before `registry-sync` or `start`:

```console
./sandbox.sh build-images
```

Optionally pre-warm the registry with every pinned third-party image so
the first deploy doesn't pay the pull cost mid-flight:

```console
./infra/infra.sh registry-sync
```

Sandbox deploy/build image pins are centralized in `common/images.yaml`.
The shared Node.js toolchain pin is centralized in `common/node-version.env`.

7. Optional: generate the sandbox config file and edit deploy flags in
   `.env.sandbox` if you do not want the full stack. This writes the file to
   the repository root, and you can edit it there before running
   `./sandbox.sh start`:

```console
./sandbox.sh generate-config
```

Typical flags in `.env.sandbox` include `DEPLOY_INFRA`, `DEPLOY_BLOCKSCOUT`,
`DEPLOY_CONTRACTS`, `DEPLOY_VERIFY_CONTRACTS`, `DEPLOY_SKIP_SIMULATION`,
`DEPLOY_NB_BOND_API`, and `DEPLOY_NB_UI`. If you skip this step, the default
root-level workflow is used.

8. Start the sandbox:

```console
./sandbox.sh start
```

If a required local file is missing, `./sandbox.sh start` exits early with a
copy command pointing to the matching example file.

`./sandbox.sh start` will try to append the required `*.cbdc-sandbox.local`
host entries on Linux/macOS. If you prefer not to edit hosts files, or if you
are on Windows/WSL, add the host entries manually or use `kubectl port-forward`
against the specific service you need.

If the script does not update your hosts file, add these entries manually:

```text
127.0.0.1 besu.cbdc-sandbox.local
127.0.0.1 blockscout.cbdc-sandbox.local
127.0.0.1 bond-api.cbdc-sandbox.local
127.0.0.1 web.cbdc-sandbox.local
```

Use `/etc/hosts` on Linux/macOS or
`C:\Windows\System32\drivers\etc\hosts` on Windows.

## Sandbox Commands

| Command | Purpose |
| --- | --- |
| `./sandbox.sh start` | Create or update the local sandbox |
| `./sandbox.sh stop` | Stop workloads while keeping the cluster and cached images |
| `./sandbox.sh delete` | Tear down the Kind cluster. The local registry container and its cached images are kept (they live in the `kind-registry` Docker container, which is independent of the Kind cluster lifecycle). To reclaim that space, run `./sandbox.sh registry-reset` (or `docker rm -f kind-registry`). |
| `./sandbox.sh generate-config` | Create `.env.sandbox` with deploy toggles |
| `./infra/infra.sh registry-start` | Start the local registry container (one-time setup; no-op if already running) |
| `./infra/infra.sh registry-sync` | Optional pre-warm: push every pinned third-party image into the local registry up front so `sandbox.sh start` doesn't pull them on demand |
| `./sandbox.sh image-report` | Read-only report: running pod images, local registry tags per service, and which tag is the current build / deployed |
| `./sandbox.sh cleanup-images` | Prune old content-hash images for `nb-ui` / `nb-bond-api` / `bens-microservice` (keeps current + 2 newest and the deployed tag; never removes shared base images). `--keep N` changes retention; `--prune-build-cache` also clears the global Docker build cache |
| `./sandbox.sh registry-reset` | Recreate the `kind-registry` container and re-sync base images, clearing accumulated registry tags. Repo-owned images rebuild on the next start |
| `./sandbox.sh build-images` | Build the pinned Blockscout backend/frontend source tags and push them into the local registry; required once on a fresh machine or after `registry-reset` |

If startup fails with missing content digest errors, run `build-images` when
the Blockscout backend/frontend tags are absent, then run `registry-sync`.
This avoids image preparation racing the deploy steps on slow links and is the
common fix when `kind` image imports look flaky on Docker Desktop.

## Makefile Shortcuts

Use the `Makefile` if you prefer shorter commands from the repo root:

```console
make sandbox-start
make sandbox-stop
make sandbox-delete
make help
```

The Make targets are wrappers around the same root-level workflow and are meant
to complement `sandbox.sh`, not replace the component-specific docs.

## License

This repository is licensed under Apache-2.0. See [LICENSE](LICENSE).

For third-party provenance notes and dependency/license caveats, see
[docs/THIRD_PARTY_NOTES.md](docs/THIRD_PARTY_NOTES.md) and
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
