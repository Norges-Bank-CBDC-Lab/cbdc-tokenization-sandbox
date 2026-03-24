[![Contracts CI](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/test-contracts.yml/badge.svg)](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/test-contracts.yml)
[![Pylint + Black](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/pylint.yml/badge.svg)](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/actions/workflows/pylint.yml)
[![linting: pylint](https://img.shields.io/badge/linting-pylint-yellowgreen)](https://github.com/pylint-dev/pylint)
[![code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

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
- `services/`: in-cluster services such as Blockscout, NB Bond API, and script runner
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

6. Start the local registry and push the sandbox's pinned images into it:

```console
./infra/infra.sh registry-start
./infra/infra.sh registry-sync
```

Shared base images are pinned in `common/images.yaml`. Blockscout backend and
frontend images are pinned in `services/blockscout/values.yaml`.

7. Optional: generate the sandbox config file and edit deploy flags in
   `.env.sandbox` if you do not want the full stack. This writes the file to
   the repository root, and you can edit it there before running
   `./sandbox.sh start`:

```console
./sandbox.sh generate-config
```

Typical flags in `.env.sandbox` include `DEPLOY_INFRA`, `DEPLOY_BLOCKSCOUT`,
`DEPLOY_SCRIPTRUNNER`, `DEPLOY_CONTRACTS`, `DEPLOY_VERIFY_CONTRACTS`,
`DEPLOY_SKIP_SIMULATION`, and `DEPLOY_NB_BOND_API`. If you skip this step, the
default root-level workflow is used.

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
127.0.0.1 jupyterhub.cbdc-sandbox.local
127.0.0.1 blockscout.cbdc-sandbox.local
127.0.0.1 bond-api.cbdc-sandbox.local
```

Use `/etc/hosts` on Linux/macOS or
`C:\Windows\System32\drivers\etc\hosts` on Windows.

## Sandbox Commands

| Command | Purpose |
| --- | --- |
| `./sandbox.sh start` | Create or update the local sandbox |
| `./sandbox.sh stop` | Stop workloads while keeping the cluster and cached images |
| `./sandbox.sh delete` | Tear down the cluster and clear cached images |
| `./sandbox.sh generate-config` | Create `.env.sandbox` with deploy toggles |
| `./infra/infra.sh registry-start` | Start the local registry used by the sandbox |
| `./infra/infra.sh registry-sync` | Push the sandbox's pinned images into the local registry |

If startup fails with missing content digest errors, run `registry-start` and
`registry-sync` first. This avoids `kind` image import issues on Docker
Desktop.

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
