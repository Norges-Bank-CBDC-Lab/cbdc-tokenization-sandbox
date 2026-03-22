# Bid encryption helper

Small CLI for encrypting and decrypting auction payloads via the proposed dual-seal scheme, producing ciphertext compatible with auction contracts.

## Encryption Scheme

A random 32-byte symmetric key encrypts plaintext JSON bids with AES-256-GCM; that symmetric key is then wrapped twice (auctioneer + bidder) using secp256k1 ECDH-derived keys and AES-GCM, and then packed into a single blob (version byte + two wraps + sym nonce/tag/ciphertext) for writing on-chain.

**This is sufficient for demonstration but is not production-ready**

## Install

```bash
npm install
```

For the local sandbox flow, generate the runnable local-only inputs from the
repository root before using this CLI directly:

```bash
node scripts/generate-local-sandbox-fixtures.mjs
```

## Usage

```bash
# Encrypt a plaintext payload to file using the generated local sandbox input
npm run encrypt ../../.tmp/bid-encryption/examples/basic/seal.example.json ../../.tmp/bid-encryption/examples/basic/sealed.json
# Encrypt while overriding signing domain values for every entry
npm run encrypt ../../.tmp/bid-encryption/examples/basic/seal.example.json ../../.tmp/bid-encryption/examples/basic/sealed.json --chainId 1 --verifyingContract 0x... --auctionId 0x...

# Decrypt a ciphertext as auctioneer to file (verifies plaintextHash)
npm run decrypt /path/to/unseal.auctioneer.json ./opened.json

# Decrypt a ciphertext as bidder to console
npm run decrypt /path/to/unseal.bidder.json

# Generate a fresh keypair
npm run keygen ./new-keypair.json
```

You can also pass a JSON array to encrypt/decrypt to handle multiple payloads in a single run; the output mirrors the input shape (single object in → single object out, array in → array out).

When signing during encrypt, you can override `chainId`, `verifyingContract`, and `auctionId` for all signing entries via CLI flags; the per-entry JSON still needs `bidderPrivateKey` and `bidderNonce`.

The tracked files under `examples/` are public-safe templates. The runnable
local sandbox encrypt inputs are generated under `.tmp/bid-encryption/examples/`,
and the unseal templates should be copied to a local ignored path and filled
with values from a local encrypt output plus the generated local key material.

## Demonstration Usage

Two of the three supplied bidders will result in successful bids in the
deterministic sandbox fixture set: Nordea (`0xb18C...`) and DNB (`0x8C7A...`).
A third bidder is also supplied and is intended to demonstrate the failed DvP
path at finalisation.

Example payloads have been provided for each of the three auction types - RATE (yield), PRICE (extentions) and BUYBACK (early redemption).

## Input formats

- Encrypt: `{"payload": BidPlaintext, "auctioneerPublicKey": "0x...", "bidderPublicKey": "0x...", "version": 1, "signing": { "chainId": 1, "verifyingContract": "0x...", "auctionId": "0x...", "bidderPrivateKey": "0x...", "bidderNonce": "0" }}` or an array of those objects. If you omit `signing`, the payload must already include `bidderSig` and `bidderNonce`.
- Decrypt: `{"ciphertext": "0x...", "privateKey": "0x...", "preferredRole": "auctioneer" | "bidder", "plaintextHash": "0x..."}` (optional plaintextHash for unseal verification) or an array of those objects
- Keygen: no input file; optionally provide an output path to write the generated keypair JSON.

`BidPlaintext` matches the on-chain structure:

```json
{
  "isin": "NO0012345678",
  "bidder": "0xabc...",
  "nonce": "random string",
  "rate": "100000000000000000000",
  "units": "1000",
  "salt": "0x...",
  "bidderNonce": "0",
  "bidderSig": "0x..." // bidder's EIP-712 signature over (auctionId, plaintextHash, bidderNonce)
}
```

## Outputs

- Encrypt → `{"ciphertext": "0x...", "plaintextHash": "0x...", "bidder": "0x...", "bidderSig": "0x...", "bidderNonce": "0"}`
- Decrypt → `{"payload": BidPlaintext, "plaintextHash": "0x...", "usedWrap": "auctioneer" | "bidder", "verified": true}`
- Keygen → `{"privateKey": "0x...", "publicKey": "0x..."}`
