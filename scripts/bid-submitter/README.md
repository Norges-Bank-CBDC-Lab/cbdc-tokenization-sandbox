# Bid submitter

Simple CLI for submitting sealed bids to the `BondAuction` contract.

## Install

```bash
npm install
```

## Usage

```bash
npm run submit --sealed-bids ./sealed.json --keys ./examples/bids.keys.json --bond-auction 0x... --auction-id 0x... --rpc-url http://localhost:8545
```

- `--sealed-bids` path to JSON containing `{ ciphertext, plaintextHash, bidder }` objects (single or array).
- `--keys` path to JSON mapping bidder addresses to `{ "privateKey": "0x..." }` (extra fields are ignored).
- `--bond-auction` target `BondAuction` contract address.
- `--auction-id` auction ID (bytes32) returned from createAuction/buybackWithAuction on BondManager.
- `--rpc-url` RPC endpoint used for submissions.

## Demonstration Usage

Before running the demo flow, create the local example keys file:

```bash
cp ./examples/bids.keys.example.json ./examples/bids.keys.json
```

Then replace the placeholder values with your local sandbox bidder keys. The
example shape matches the two verified bidders plus a third bidder used to
trigger the failure mode in finalisation demos.

Example payloads provided are the sealed example payloads found within `/scripts/bid-encryption`.
