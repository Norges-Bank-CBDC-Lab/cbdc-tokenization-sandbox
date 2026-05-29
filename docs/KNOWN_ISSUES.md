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
- `AuctionsApi.reopenAuction()` throws a `NotImplementedError` (HTTP 501)
  and the UI shows a toast.
- Planned follow-up: either add a server-side endpoint that resets the
  ingestion cache + clears the allocation, or extend `BondAuction` with an
  on-chain reopen transition. The UI behaviour reverts to "just works" once
  the endpoint exists.

## nb-ui: operator-selectable winners
- The finalise modal in `services/nb-ui/` lets the operator pick a subset of
  bids to include before approving. The selection is local — the API
  call carries only `{ allocationHash, approve }`, and the backend
  computes the allocation server-side.
- The UI still shows the selection workflow so operators can preview the
  proposed allocation before approving; the panel's clearing-rate and
  coverage summary are informational only.
- Planned follow-up: if operator-selectable winners are intended, update
  the `finaliseRequestSchema` and the allocation pipeline to accept a winner
  subset (with validation that the subset matches the previously-published
  `allocationHash` to prevent inconsistent on-chain state), and have the UI
  send the selected indices through `AuctionsApi.finaliseAuction`.

## Auction `status: open` doesn't flip when end-time passes (chain semantic)
- `BondAuction.AuctionStatus` only transitions from `BIDDING` to
  `CLOSED` when `closeAuction()` is explicitly called. The end-time
  passing alone doesn't change the status — auctions sit in a
  "limbo": chain refuses new bids (`submitBid` requires
  `block.timestamp <= metadata.end`), but the on-chain status still
  reads `open`.
- This is correct chain behaviour and matches the asymmetric-timing
  follow-up tracked further down — the two windows (bid-accept and
  close-permitted) don't overlap. The UI, however, must reflect the
  time edge so it doesn't offer the operator an un-bidable auction.
- Fixed in the UI by `selectBidAcceptingAuctions(bonds)` (selectors)
  + `isAuctionExpired(auction)` predicate. `PlaceBidModal` shows
  expired-but-open auctions in the dropdown disabled with an inline
  "ended X ago" note; `AuctionDetailPage` hides the "Place bid"
  button on expired auctions; `BiddersPage` disables the per-row
  Place bid button when nothing is biddable. Test mode bypasses the
  UI filter so the operator can confirm the chain-level revert path.
- No backend change needed — the API's pre-check on
  `POST /v1/bidders/{address}/bids` already returns
  `409 bidding window has closed` for expired auctions; the UI fix
  prevents the operator from triggering it by accident.

## ~~nb-bond-api ingestion loop doesn't self-heal when Besu is briefly unreachable~~ — resolved

Resolved by Plan B
([`docs/plans/archive/health-indicator-and-self-healing-plan.md`](plans/archive/health-indicator-and-self-healing-plan.md)).
`startIngestionLoopWithRetry()` in
[`services/nb-bond-api/src/ingestion.ts`](../services/nb-bond-api/src/ingestion.ts)
now wraps the boot in exponential backoff (1s → 2s → … → 30s, retries
forever), so a transient `getaddrinfo EAI_AGAIN` at PC/Docker restart
no longer leaves the API silently serving stale data. The same plan
adds `chain` + `ingestion` blocks to `/v1/health` and a polling
`HealthBadge` in the operator UI top bar so any future degradation is
visible at a glance.

## nb-bond-api request-path chain reads bubble up as opaque 500s
- Same root trigger as the ingestion bug above. When the operator runs
  a request that needs a fresh chain read (auction create, close,
  finalise, central-bank tx, bidder bid submission, even GETs that
  resolve contract addresses), and the chain is unreachable, the
  request fails with `500 Internal Server Error` and a `detail` like
  `unhandled: RPC unavailable: request timeout (code=TIMEOUT,
  version=6.16.0)`.
- The operator can't tell from the response whether the contract
  reverted (a real domain error worth understanding) or the chain
  is simply unreachable (a wait-and-retry condition). The UI surfaces
  the raw 500 as a toast, which is unhelpful.
- Planned follow-up: in `services/nb-bond-api/src/index.ts`'s error
  middleware, detect `RpcUnavailableError` (already exported by
  `chain.ts`) and `getaddrinfo EAI_AGAIN` / `ECONNREFUSED` /
  `request timeout` patterns from raw ethers errors, and translate
  them to `503 Service Unavailable` with `detail: "RPC unavailable
  — wait for the Besu pod to become ready, then retry"`. The
  frontend's `httpClient.js` already maps `detail` into the toast
  body, so the change lands without UI work.

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
- Update (shipped): closing an auction *after* its scheduled end now
  works reliably. The local Besu mints blocks only on transactions
  (`createemptyblocks: false`), so its clock lags wall-clock and
  `eth_estimateGas` would simulate the close against a stale block and
  false-revert `InBidPhase()` before broadcast. The API now retries the
  close once with an explicit gas-limit fallback
  (`NB_BOND_API_CLOSE_GAS_LIMIT`) to skip that stale estimation; the mined
  block is stamped at wall-clock > end and the contract accepts it. A
  genuine before-end close (e.g. Test-mode) now returns a clear `409`
  (the `InBidPhase` revert is decoded). This does **not** relax the chain
  rule above — closing *before* `metadata.end` is still rejected on-chain;
  that remains the asymmetric-timing follow-up below.
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
  [`docs/plans/archive/bidders-and-central-bank-plan.md`](plans/archive/bidders-and-central-bank-plan.md).

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

## Local registry and Docker image cache grow unbounded
- Each content-hash build of `nb-ui`, `nb-bond-api`, or `bens-microservice`
  produces a new image id on the host and a new tag + blobs in the
  `kind-registry` container. Nothing prunes them automatically.
- `<repo>:<tag>` and `localhost:5001/<repo>:<tag>` are **aliases of the same
  image id** — that pair is *not* the waste. The real growth is the
  accumulation of old unique content-hash image ids on the host, plus
  un-garbage-collected blobs in the registry container (registry deletes are
  disabled by default and the container has no volume, so it also survives
  `kind delete cluster`).
- Inspect with `./sandbox.sh image-report` (read-only: running pod images,
  registry tags per service, and which tag is the current build / deployed).
- Reclaim host disk with `./sandbox.sh cleanup-images` — keeps the current +
  2 newest tags per service and the deployed tag, and never removes shared
  base images. Add `--keep N` to change the retention or `--prune-build-cache`
  to also clear the global Docker build cache (affects all projects).
- Reclaim registry space with `./sandbox.sh registry-reset` — recreates the
  registry container and re-syncs base images; repo-owned images rebuild on
  the next start. This is preferred over enabling registry delete + GC for a
  disposable local registry.
