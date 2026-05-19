# Known Issues

## Current Besu baseline is intentionally conservative
- The local sandbox is still pinned to Clique proof-of-authority consensus and
  the London EVM milestone.
- This is intentional: newer EVM milestones and QBFT have not yet been
  re-validated end-to-end across contract deployment, fee handling, and
  Blockscout behavior in this repo.
- Planned follow-up: move the sandbox to QBFT and a newer milestone after the
  full local workflow has been retested.

## Besu + Solidity `PUSH0` opcode
- Contract deployment on the local Besu network can fail with
  `Invalid opcode: 0x5f` if the chain or compiler configuration drifts away
  from the current London baseline.
- See `infra/DEVELOPMENT.md` for the current genesis settings and the
  supported local chain baseline.

## Foundry + Besu fee settings
- Some deployments require explicit gas settings to avoid
  `upfront cost exceeds account balance`.
- Example working flags are documented in `infra/DEVELOPMENT.md`.

## Foundry signature cache warning (sandbox)
- In constrained environments, Foundry may warn about failing to write
  `~/.foundry/cache/signatures`.
- This does not affect compilation results; ensure the cache directory is
  writable if you want a clean warning-free build.

## nb-ui: reopenAuction needs backend / on-chain support
- The `services/nb-ui/` operator UI exposes a "Reopen…" action on closed
  auctions (see `AuctionLifecyclePanel`), but there is no matching backend
  endpoint and the `BondAuction` contract has no closed→open transition.
- In real-backend mode, `AuctionsApi.reopenAuction()` throws a
  `NotImplementedError` (HTTP 501) and the UI shows a toast. The mock client
  fakes the transition so the UI button can still be exercised in mock mode.
- Planned follow-up: either add a server-side endpoint that resets the
  ingestion cache + clears the allocation, or extend `BondAuction` with an
  on-chain reopen transition. The UI behaviour reverts to "just works" once
  the endpoint exists.

## nb-ui: operator-selectable winners
- The finalise modal in `services/nb-ui/` lets the operator pick a subset of
  bids to include before approving. The frontend sends the chosen indices in
  the `winners` field of `PUT /v1/auctions/{auctionId}/finalisation`, but
  the backend currently computes the allocation server-side and ignores
  `winners` (Zod schemas strip unknown fields by default).
- Planned follow-up: if operator-selectable winners are intended, update
  the `finaliseRequestSchema` and the allocation pipeline to accept a winner
  subset (with validation that the subset matches the previously-published
  `allocationHash` to prevent inconsistent on-chain state).
