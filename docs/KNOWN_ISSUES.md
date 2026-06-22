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

## nb-ui: Entra silent renewal is refresh-token-based (no redirect-bridge); runtime-unverified locally
- Superseded design (was: "MSAL v5 needs a redirect-bridge for silent token
  refresh"). `acquireTokenSilent` renews access tokens with the refresh token
  MSAL caches for SPAs — a plain network call, no hidden iframes — so no COOP
  redirect-bridge page is needed while a session is valid. Iframe-based silent
  auth was additionally ruled out because third-party-cookie blocking breaks it
  in modern browsers.
- When the refresh token is spent (Entra issues SPAs a fixed ~24 h refresh
  token), `acquireTokenSilent` fails with an interaction-required error; the
  auth layer then flips to a "session expired" state and the auth gate renders
  the login page (`services/nb-ui/src/components/LoginPage.jsx`) instead of
  letting API calls 401 silently.
- The Entra auth path (`services/nb-ui/src/auth/entraAuth.js`) remains dormant
  in the local sandbox (`AUTH_MODE=none`) and cannot be exercised here, so
  silent renewal is build/lint/test-verified but runtime-unverified until a
  real Entra deployment runs the timed renewal check. Owned by the cloud
  deployment work.

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
- Related: a *finalised* auction is terminal on-chain (no un-finalise and no
  closed→open transition). Correcting a bad outcome — e.g. a fat-finger bid
  that set the wrong clearing rate — means running a fresh auction for the
  bond, not mutating the finalised one.

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

## Babel 8 (`@babel/core`, `@babel/preset-env`) upgrade deferred
- Dependabot proposed bumping `@babel/core` 7.29.7 → 8.0.1 and
  `@babel/preset-env` 7.29.5 → 8.0.2 — `nb-bond-api` dev dependencies used only
  by `babel-jest` to transform `.js` / `.mjs` test inputs (including the ESM
  `@noble/secp256k1`). The bump is **functionally fine** (under Babel 8 the
  `nb-bond-api` suite stays green: jest, lint, build), but it was held.
- Why deferred — a correct upgrade is more than a version bump:
  - Babel 8 requires Node `^22.18.0 || >=24.11.0`. That is satisfied (the repo
    pins Node 25 via `common/node-version.env`), but `@babel/core` 8 hoisted to
    the workspace root breaks `nb-ui`'s `@vitejs/plugin-react`, which
    peer-requires `@babel/core ^7`. A correct upgrade needs a **dual tree** —
    keep core 7 for `nb-ui`, pin core 8 for `nb-bond-api`. `@babel/preset-env`
    8 peer-requires core 8, so the two bumps are coupled and must land together.
  - The raw Dependabot PRs also fail the `validate-inventory` check because they
    do not update `THIRD_PARTY_LICENSES.md`.
  - With the dual tree in place, a full `npm install` re-serialises
    `package-lock.json` by ~18k lines (only ~18 entries are genuinely new; the
    rest is npm reordering identical entries) — an unreviewable diff for a
    dev-only transform dependency.
- Planned follow-up: revisit deliberately if there is a concrete reason (a
  security advisory on Babel 7, or `@vitejs/plugin-react` moving to Babel 8 so
  the dual tree collapses). The work is: bump both in
  `services/nb-bond-api/package.json`, let npm build the dual tree, update the
  `@babel/core` + `@babel/preset-env` rows in `THIRD_PARTY_LICENSES.md`, and
  verify both `nb-bond-api` and `nb-ui` build. The Dependabot PRs were closed
  (not merged) with this rationale.
