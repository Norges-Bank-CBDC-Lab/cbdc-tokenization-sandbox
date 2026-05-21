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

## Auction close timing is chain-enforced — no operator discretion
- `BondAuction.closeAuction` reverts with `InBidPhase()` (selector
  `0xeec5b85e`) when `block.timestamp <= metadata.end`. Once an auction
  is created, no one — not even the issuer admin — can close it before
  the scheduled end time, even with a legitimate operational reason
  (data error, network event, regulatory pause, etc.).
- The Test-mode toggle in the operator UI (`services/nb-ui/`) lets the
  operator bypass the API-side end-time pre-check, but the chain
  itself still rejects the close transaction. This is acceptable in
  the sandbox but limits the testbed when bidders / auctioneer
  workflows need to be exercised end-to-end without waiting on
  wall-clock time.
- Planned follow-up — asymmetric timing model:
  - Keep the chain check on `submitBid` (`block.timestamp <=
    metadata.end`) so bidders retain a hard-enforced submit deadline.
  - Drop the timing check on `closeAuction`. The operator can close
    any time after BIDDING begins.
  - Require an on-chain `reason` argument when closing before
    `metadata.end` and emit `AuctionClosedEarly(auctionId,
    scheduledEnd, actualClose, reason)` for audit.
  - UI: confirmation modal asks for a reason when closing early;
    surfaces an informational warning when closing past schedule but
    proceeds without one.
- Touches `BondAuction.sol`, `IBondAuction.sol`, `BondManager`,
  `nb-bond-api` ingestion + schemas, `nb-ui` `AuctionLifecyclePanel`,
  and tests across all four layers. Warrants its own iteration plan
  via the `sandbox-implementation-planner` skill before implementation.

## BondAuction has no `cancelBid` — bids are final once sealed
- `contracts/src/norges-bank/BondAuction.sol` does not expose a
  `cancelBid` / `withdrawBid` function. Once `submitBid()` succeeds in
  the `BIDDING` phase, the bid stays on-chain until the auction
  closes — neither the bidder nor the operator can withdraw it.
- The Bidders page (`services/nb-ui/#/bidders`) reflects this: there
  is no "remove bid" affordance, and the API hard-blocks bidder
  deletion while the bidder has unrevealed bids on an open auction
  (409 with the offending auction id in `errors[]`).
- Planned follow-up: if real-world auction semantics require revision
  before close, add `cancelBid(bytes32 auctionId, uint256 bidIndex)`
  guarded by `msg.sender == bid.bidder` and the `BIDDING` phase, with
  a `BidCancelled` event picked up by ingestion. Tracked in
  [`docs/plans/bidders-and-central-bank-plan.md`](plans/bidders-and-central-bank-plan.md).

## Central Bank operator is not on its own WNOK allowlist by default
- The local WNOK deploy (`contracts/script/norges-bank/03_Wnok.s.sol`
  + `11_BondSetup.s.sol`) allowlists Nordea, DNB, and the relevant
  protocol contracts, but does **not** add the Norges Bank operator
  account itself. As a result, `POST /v1/central-bank/wnok/transfer`
  from CB reverts on-chain with `originator not on allowlist` until
  the operator explicitly adds the CB to its own allowlist.
- The Central Bank page (`services/nb-ui/#/central-bank`) detects this
  and surfaces a hint on both the action card and the transfer modal.
- Planned follow-up: decide whether the deploy script should self-add
  the CB to the allowlist by default. For now the explicit step is
  retained because it mirrors the "CB normally only mints, doesn't
  hold" pattern.

## sandbox.sh build-images is Blockscout-only today
- `./sandbox.sh build-images` only wraps
  `services/blockscout/build-images.sh`, which clones upstream Blockscout
  and builds the backend + frontend images from source as a fallback for
  testing upstream changes. The other Dockerfile-based local services
  (`services/nb-ui`, `services/nb-bond-api`) build their images inside
  their own `<svc>.sh start`.
- Planned follow-up: decide whether `./sandbox.sh build-images` should
  remain a Blockscout-only escape hatch, or grow to drive every
  per-service Docker build in one command (parallel `nb-ui.sh start
  --build-only`-style invocations). The right answer depends on how often
  developers want a "rebuild every image without deploying" path.
