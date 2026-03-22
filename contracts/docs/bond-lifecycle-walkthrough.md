# Bond Lifecycle Walkthrough

This is a minimal external integration walkthrough for the primary bond flow in
the sandbox:

deploy -> create auction -> encrypt and submit bids -> close and finalise ->
pay coupons -> redeem

The recommended integration surface is
[`BondManager`](../src/norges-bank/BondManager.sol). The other contracts in the
flow are still important, but most lifecycle actions are orchestrated through
that manager contract.

If you prefer a service-assisted operator path instead of calling the contracts
directly, see [`services/nb-bond-api/README.md`](../../services/nb-bond-api/README.md)
and [`services/nb-bond-api/DEVELOPMENT.md`](../../services/nb-bond-api/DEVELOPMENT.md).
That service can create auctions, close them, compute allocations off-chain,
submit finalisation, and trigger coupon or redemption flows. Dealer bid
submission still happens on-chain through the CLIs under `scripts/`.

## Before you start

- Use the full sandbox if you want the closest supported local setup:
  `./sandbox.sh start`
- Use the contracts-only path if Besu and the surrounding infra are already
  running:
  `cd contracts && ./contracts.sh start`
- Before running the contracts flow directly, create `contracts/.env` from
  `contracts/.env.example` and replace the placeholder keys with local-only
  sandbox values.
- Install the bid helper tools before trying to submit sealed bids:
  `cd scripts/bid-encryption && npm install`
  `cd scripts/bid-submitter && npm install`
- Before using the bid submitter demo inputs, create
  `scripts/bid-submitter/examples/bids.keys.json` from
  `scripts/bid-submitter/examples/bids.keys.example.json`.

The walkthrough below assumes that the deployment and setup scripts have already
granted the expected roles and approvals for the bond stack. In the repo, those
steps are handled by:

- [`contracts/script/norges-bank/10_Bond.s.sol`](../script/norges-bank/10_Bond.s.sol)
- [`contracts/script/norges-bank/11_BondSetup.s.sol`](../script/norges-bank/11_BondSetup.s.sol)

## 1. Deploy the contracts

Recommended path:

```bash
cd contracts
./contracts.sh start --verify
```

This deploys the contract set used by the sandbox and optionally verifies the
deployments in Blockscout.

If you are working against a generic RPC outside the sandbox, use:

```bash
cd contracts
./run-scripts.sh <network-or-rpc-url> <chain-id>
```

After deployment, the contract addresses are registered in
[`GlobalRegistry`](../src/common/GlobalRegistry.sol). In the sandbox, the
deployment scripts register at least the core bond stack:

- `BondAuction`
- `BondManager`
- `BondToken`
- `BondDvP`
- `Wnok`
- `Tbd` for the government reserve side

## 2. Create the initial bond auction

From a wallet with `BOND_MANAGER_ROLE`, call:

```solidity
BondManager.deployBondWithAuction(
    isin,
    end,
    auctionPubKey,
    offering,
    maturityDurationYears
);
```

What this does:

- creates a new ISIN-backed partition in `BondToken`
- opens an initial RATE auction in `BondAuction`
- marks the ISIN as active in `BondManager`

Immediately after creation, resolve the current auction id:

```solidity
bytes32 auctionId = BondAuction.getAuctionId(isin);
```

You need that `auctionId` for bid signing, encryption, and submission.

NB Bond API equivalent:

- `POST /v1/bonds/{isin}/auctions`

The response includes `auctionId`, `auctionPubKey`, and the relevant contract
addresses for the dealer-side bid flow.

## 3. Encrypt and submit bids

Use the bid encryption helper to produce contract-compatible ciphertext and
bidder signatures:

```bash
cd scripts/bid-encryption
npm run encrypt ./examples/basic/seal.example.json ./sealed.json \
  --chainId 2018 \
  --verifyingContract <bond-auction-address> \
  --auctionId <auction-id>
```

Then submit the sealed bids:

```bash
cd scripts/bid-submitter
cp ./examples/bids.keys.example.json ./examples/bids.keys.json
npm run submit --sealed-bids ./sealed.json \
  --keys ./examples/bids.keys.json \
  --bond-auction <bond-auction-address> \
  --auction-id <auction-id> \
  --rpc-url http://besu.cbdc-sandbox.local:8545
```

What the chain stores at this point:

- encrypted bid payloads
- `plaintextHash` values
- bidder addresses

What is still off-chain:

- bid decryption
- clearing logic
- allocation assembly
- bidder proof assembly

If you are operating through the NB Bond API, dealers still use this exact
on-chain bid path. The API does not accept bids over HTTP.

## 4. Close and finalise the auction

After `end` has passed, close the auction from a wallet with
`BOND_MANAGER_ROLE`:

```solidity
BondManager.closeAuction(isin);
```

This returns the sealed bids through `BondAuction`, which your off-chain logic
must decrypt and process.

Your off-chain integration then needs to build:

- `IBondAuction.Allocation[]`
- `IBondAuction.BidVerification[]`

The relevant shapes are defined in
[`contracts/src/norges-bank/interfaces/IBondAuction.sol`](../src/norges-bank/interfaces/IBondAuction.sol):

```solidity
struct Allocation {
    string isin;
    address bidder;
    uint256 units;
    uint256 rate;
    AuctionType auctionType;
}

struct BidVerification {
    uint256 bidIndex;
    uint256 bidderNonce;
    bytes bidderSig;
}
```

Then finalise the auction:

```solidity
BondManager.finaliseAuction(isin, allocations, proofs);
```

For RATE auctions this will:

- finalise the sealed-bid auction
- mint the allocated bond units
- set coupon parameters on the partition
- run DvP settlement against `Wnok`

NB Bond API equivalents:

- `POST /v1/auctions/{auctionId}/close`
- `PUT /v1/auctions/{auctionId}/finalisation`

The service owns the sealing keypair, unseals bids off-chain, computes the
allocation, and builds the proof tuples before sending
`BondManager.finaliseAuction(...)` on-chain.

For exact proof generation and allocation examples, use:

- [`contracts/test/integration/BondLifecycle.t.sol`](../test/integration/BondLifecycle.t.sol)
- [`contracts/test/norges-bank/BondManager.t.sol`](../test/norges-bank/BondManager.t.sol)
- [`contracts/test/utils/AuctionHelper.sol`](../test/utils/AuctionHelper.sol)

## 5. Pay coupons

After the coupon interval has elapsed, call:

```solidity
BondManager.payCoupon(isin, holders);
```

Important requirement:

- `holders` must cover the full current holder set for the ISIN partition.

The contract verifies that the processed balances match total supply before it
updates coupon state. If your holder list is incomplete, the payment flow
reverts instead of silently underpaying.

Repeat this step once per coupon period until the final coupon has been paid.
On the last payment, `BondToken` marks the partition as matured.

NB Bond API equivalent:

- `POST /v1/bonds/{isin}/coupon-payments`

## 6. Redeem the remaining supply

After maturity and final coupon completion, call:

```solidity
BondManager.redeem(isin, holders);
```

Again, `holders` must cover the full remaining holder set for that ISIN.

The redemption flow:

- redeems each holder's remaining bond balance
- settles the cash leg through the configured government-side `Tbd`
- verifies that the partition supply is fully reduced to zero

NB Bond API equivalent:

- `POST /v1/bonds/{isin}/redemptions`

## Common variants

### Extension

To reopen an existing bond for additional issuance, use:

```solidity
BondManager.extendBondWithAuction(isin, end, auctionPubKey, additionalOffering);
```

This creates a PRICE auction rather than a RATE auction.

### Buyback

To retire outstanding supply early, use:

```solidity
BondManager.buybackWithAuction(isin, end, auctionPubKey, buybackSize);
```

This creates a BUYBACK auction and settles through the buyback path in
`BondDvP`.

## Practical integration notes

- `BondManager` is the intended orchestration entrypoint for the lifecycle
  above. Do not bypass it unless you deliberately want lower-level control.
- The off-chain auction operator is responsible for decrypting bids and
  computing allocations. The chain does not derive the clearing result on its
  own.
- `payCoupon()` and `redeem()` depend on a complete holder list. That holder
  discovery is currently an off-chain integration concern.
- The local setup scripts also prepare cash-side allowlists and approvals. If
  those are missing, finalisation, coupon payment, or redemption can fail at
  settlement time.

## Where to go deeper

- [`contracts-reference.md`](./contracts-reference.md) for the surrounding
  contract map
- [`contracts-security.md`](./contracts-security.md) for role and trust
  assumptions
- [`contracts-versioning.md`](./contracts-versioning.md) for ABI and interface
  stability expectations
- [`scripts/bid-encryption/README.md`](../../scripts/bid-encryption/README.md)
  for ciphertext generation
- [`scripts/bid-submitter/README.md`](../../scripts/bid-submitter/README.md)
  for on-chain bid submission
- [`services/nb-bond-api/DEVELOPMENT.md`](../../services/nb-bond-api/DEVELOPMENT.md)
  for the HTTP operator flow around auctions, coupon payment, and redemption
