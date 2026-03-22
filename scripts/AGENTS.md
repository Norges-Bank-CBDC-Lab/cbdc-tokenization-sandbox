## Scripts Agent Guide

Inherits the root `AGENTS.md`. This file focuses on script-specific guidance.

### Structure
- `scripts/bid-encryption/`: CLI for bid encryption/decryption and keypair generation.
- `scripts/bid-submitter/`: CLI for submitting sealed bids to `BondAuction`.
- `scripts/verification/`: repository-level validation scripts used by CI and public-release checks.
- `scripts/DEVELOPMENT.md`: overview and usage notes.

### Commands (per tool)
- `scripts/bid-encryption/`:
  - Readme: `scripts/bid-encryption/README.md`
  - Example inputs: `scripts/bid-encryption/examples/`
  - Typical run: follow the README; keep inputs/outputs deterministic for demos.
- `scripts/bid-submitter/`:
  - Readme: `scripts/bid-submitter/README.md`
  - Example inputs: `scripts/bid-submitter/examples/`
  - Typical run: follow the README; ensure contract addresses match the current deployment.
- `scripts/verification/`:
  - Dependency/license inventory: `python3 scripts/verification/check-third-party-licenses.py`
  - Public repo hygiene: `python3 scripts/verification/check-public-repo-hygiene.py`
  - Markdown links: `python3 scripts/verification/check-markdown-links.py`

### Style and conventions (scripts)
- Treat scripts as reference implementations; keep them readable and minimal.
- Prefer explicit CLI flags and clear error messages.
- Keep example inputs in `examples/` deterministic and documented.
- Avoid hardcoding secrets; read from env or local config.
- Keep repo-maintenance checks grouped under `scripts/verification/` rather than at the top of `scripts/`.
- When changing manifests, public docs, or repo metadata, run the relevant verification scripts before finalizing the change.
