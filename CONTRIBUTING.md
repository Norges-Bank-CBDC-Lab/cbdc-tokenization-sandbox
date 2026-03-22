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
forge test -vvv
```

### NB Bond API

```console
cd services/nb-bond-api
npm ci
npm run lint
npm run format:check
npm test
```

### Script Runner Notebook

```console
python3 -m pip install -r services/script-runner/notebook/requirements.txt
python3 -m pip install pylint==3.3.7 "black[jupyter]"==25.1.0
pylint --rcfile=services/script-runner/notebook/.pylintrc services/script-runner/notebook
black --check --diff services/script-runner/notebook
```

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
- document copied or adapted files in `THIRD_PARTY.md`;
- update `THIRD_PARTY_LICENSES.md` when direct dependencies or notable
  deployment-time components change;
- avoid adding material under terms that are incompatible with the repository's
  intended Apache-2.0 distribution model without prior maintainer review.
