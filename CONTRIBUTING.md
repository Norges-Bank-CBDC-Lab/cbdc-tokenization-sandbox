# Contributing

This repository is an experimental sandbox for local CBDC-related workflows.
Contributions should keep that scope clear: favor readability, small changes,
and explicit documentation over broad refactors or production-style
generalization.

## Before You Start

- Base contributions on the `development` branch unless maintainers say
  otherwise.
- Keep changes focused. Avoid unrelated cleanup in the same pull request.
- Do not commit secrets, private keys, credentials, or environment-specific
  files.
- If your change affects behavior, scripts, interfaces, or operational
  guidance, update the relevant documentation as part of the same change.

## Development Expectations

Run the checks relevant to the area you changed.

### Contracts

```console
cd contracts
forge soldeer install
forge fmt --check
forge build --sizes
bash ./check-verify-latest-mapping.sh
forge test -vvv
```

### NB Bond API

From the repository root (the npm workspaces install once at the root, as in
CI):

```console
npm ci
npm run lint -w nb-bond-api
npm run format:check -w nb-bond-api
npm test -w nb-bond-api
```

### NB UI

From the repository root:

```console
npm ci
npm run format:check -w nb-ui
npm run lint -w nb-ui
npm test -w nb-ui
npm run build -w nb-ui
```

### Repository Checks

Run these from the repository root for every change:

```console
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

Run the matching check when you change the files it covers:

```console
python3 scripts/verification/check-third-party-licenses.py   # dependency manifests, lockfile, or third-party material
python3 scripts/verification/check-node-version-consistency.py   # Node pin, Dockerfiles, common/ pins, or package manifests
bash scripts/verification/check-image-hash-inputs.sh   # common/helpers.sh or a locally built image's inputs
python3 scripts/verification/check-besu-qbft-baseline.py   # infra/besu/, common/images.yaml, or Foundry config
```

[`scripts/verification/README.md`](scripts/verification/README.md) describes
each check.

### Documentation-Only Changes

If your change is documentation-only, note that clearly in the pull request and
update cross-references such as `README.md` and
`docs/DOCUMENTATION_INDEX.md` when needed.

## Pull Requests

Pull requests should:

- explain what changed and why;
- list the checks you ran, or explain why they were not run;
- call out any operational, security, or license impact;
- include documentation updates when behavior or setup changed.

## Licensing And Provenance

Unless explicitly stated otherwise, contributions intentionally submitted for
inclusion in this repository are expected to be under Apache-2.0, consistent
with the repository license.

If you add or update third-party material:

- preserve upstream SPDX identifiers, copyright notices, and attribution;
- document copied or adapted files in `docs/THIRD_PARTY_NOTES.md`;
- update `THIRD_PARTY_LICENSES.md` when direct dependencies or notable
  deployment-time components change;
- avoid adding material under terms that are incompatible with the repository's
  intended Apache-2.0 distribution model without prior maintainer review.
