# Scripts - Information for Developers

This document is for maintainers of the scripts in this directory. The public
entrypoint stays in `scripts/README.md`; this file captures the repo-specific
maintenance rules and shared expectations.

## Script Overview

### Bid encryption helper
(`scripts/bid-encryption`)

CLI for encrypting or decrypting auction payloads and generating keypairs for
the dual-seal scheme.

The decryption side is mirrored inside `services/nb-bond-api`, so changes here
should stay aligned with the auctioneer-side implementation.

### Bid submitter
(`scripts/bid-submitter`)

CLI for submitting sealed bids to the `BondAuction` contract. Treat it as a
reference implementation for bidder-side tooling, not as a production client.

### Repository verification helpers
(`scripts/verification`)

Small Python utilities for repository maintenance. These are used to validate:

- curated third-party inventory drift
- publication-hygiene guardrails for local-only config
- local links inside tracked Markdown files

See each script's README for setup and usage details.

## Example Data

Examples of input payloads are provided for the bidder-side CLIs so the bond
lifecycle can be demonstrated deterministically. Keep those example files free
of real credentials and suitable for public repository distribution.

## Makefile Shortcuts

Use `Makefile` targets when you want to run the bidder-side tools from the
project root:

```console
make sandbox-local-fixtures
make bid-tools-install
make bid-encrypt BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
make bid-submit BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
make bid-place BOND_AUCTION=0x... AUCTION_ID=0x... BID_TYPE=initial
```

Use `make help` to see variable defaults (`BID_ENCRYPT_INPUT`,
`BID_ENCRYPT_OUTPUT`, `BID_KEYS`, `BID_CHAIN_ID`, `BESU_RPC_URL`).
The default bid input and output paths now live under `.tmp/` so the runnable
local fixtures stay out of the tracked examples.

## Maintenance Notes

- If you change bidder-side CLI arguments or file formats, update the relevant
  README examples and root `Makefile` shortcuts together.
- If you change deterministic example payloads, keep them suitable for public
  distribution and consistent with the local sandbox assumptions.
- If you change public-release, documentation, or compliance files, run the
  verification scripts from `scripts/verification/` before committing.

## Verification Commands

Run these from the repository root when updating release hygiene or compliance
documentation:

```console
python3 scripts/verification/check-third-party-licenses.py
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```
