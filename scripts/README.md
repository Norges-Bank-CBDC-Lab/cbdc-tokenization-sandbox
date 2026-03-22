# Scripts

This folder contains reference CLIs for off-chain workflows that interact with
the sandbox, plus repository-level verification utilities.

## Scripts In This Repo

- `bid-encryption/`: encrypt, decrypt, and key-generation helpers for sealed
  bids
- `bid-submitter/`: submit sealed bids to on-chain auctions
- `verification/`: repository maintenance checks used by local review and CI

These scripts are reference implementations for the sandbox. They are not
production tooling.

## Start Here

If you want to use the bidder-side tools from the repo root, prefer the Make
targets:

```console
make sandbox-local-fixtures
make bid-tools-install
make bid-encrypt BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
make bid-submit BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
make bid-place BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
```

Run `make help` to see the supported variables and defaults.

## Example Inputs And Local-Only Data

The tracked files under `bid-encryption/examples/` and
`bid-submitter/examples/bids.keys.example.json` are public-safe templates.

Use `make sandbox-local-fixtures`, `node scripts/generate-local-sandbox-fixtures.mjs`,
or the normal sandbox start scripts to materialize the runnable local-only files:

- `.tmp/bid-encryption/examples/...`
- `scripts/bid-submitter/examples/bids.keys.json`
- `contracts/.env`
- `services/nb-bond-api/helm/values.local.yaml`

Keep those generated files local-only and never replace the tracked templates
with real credentials.

## Repository Verification

The repo-level maintenance checks live in `scripts/verification/`.

Use these when updating public-release hygiene, markdown documentation, or the
curated third-party license inventory:

```console
python3 scripts/verification/check-third-party-licenses.py
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```

## Read Next

- [DEVELOPMENT.md](DEVELOPMENT.md) for maintainer-focused script notes
- [bid-encryption/README.md](bid-encryption/README.md) for encryption input and
  output details
- [bid-submitter/README.md](bid-submitter/README.md) for submission details
- [verification/README.md](verification/README.md) for repo-maintenance checks
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the scripts fit
  into the broader sandbox flow
