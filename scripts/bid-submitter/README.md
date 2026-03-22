# Bid submitter

Simple CLI for submitting sealed bids to the `BondAuction` contract.

## Install

```bash
npm install
```

## Usage

```bash
node ../generate-local-sandbox-fixtures.mjs
npm run submit --sealed-bids ../../.tmp/bid-encryption/examples/basic/sealed.json --keys ./examples/bids.keys.json --bond-auction 0x... --auction-id 0x... --rpc-url http://localhost:8545
```

- `--sealed-bids` path to JSON containing `{ ciphertext, plaintextHash, bidder }` objects (single or array).
- `--keys` path to JSON mapping bidder addresses to `{ "privateKey": "0x..." }` (extra fields are ignored).
- `--bond-auction` target `BondAuction` contract address.
- `--auction-id` auction ID (bytes32) returned from createAuction/buybackWithAuction on BondManager.
- `--rpc-url` RPC endpoint used for submissions.

## Demonstration Usage

Before running the demo flow, generate the local fixture files from the
repository root:

```bash
node scripts/generate-local-sandbox-fixtures.mjs
```

That creates `scripts/bid-submitter/examples/bids.keys.json` as an ignored
local-only file. The tracked `examples/bids.keys.example.json` file is a
public-safe template only.

Example payloads provided are the sealed example payloads found within `/scripts/bid-encryption`.
