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

## nb-ui: create-auction fails from the running frontend
- After PR 3 landed, `web.cbdc-sandbox.local` loads and the bonds + auctions
  indexes populate from the live NB Bond API, but issuing a new bond /
  creating a new auction from the UI fails.
- Root cause not yet diagnosed. Likely candidates: a frontend payload field
  shape mismatch with `createAuctionRequestSchema`, a missing required
  field, or a chain-side precondition (e.g. the issuer signer needs
  pre-funded WNOK for issuing-auction simulation).
- Planned follow-up: reproduce against `services/nb-bond-api` directly via
  `curl POST /v1/bonds/{isin}/auctions`, capture the 400 / 500 response,
  and either fix the frontend payload or extend the backend validation
  message so the UI can surface a useful error.

## nb-bond-api still ships via host-mount + pod-side npm build
- After PR 3, `services/nb-ui` deploys as a self-contained Docker image
  built and pushed to the local Kind registry by `./nb-ui.sh start`.
  `services/nb-bond-api` still uses the older pattern: a generic
  `node:24.15.0` image with the host's `services/nb-bond-api` directory
  mounted via `infra/cluster/cluster-config.yaml` and `npm ci + npm run
  build` running at container start.
- Planned follow-up: migrate `nb-bond-api` to the same image-baked shape
  (multi-stage Dockerfile, content-hash tag, push to local registry, drop
  the Kind extra-mount). The work is a small refactor of `deployNBBondAPI`
  in `common/helpers.sh` plus a new `services/nb-bond-api/Dockerfile`.
  Once migrated, the only remaining Kind extra-mount can be removed
  entirely and adding any future service stops requiring a sandbox
  delete + start.

## sandbox.sh build-images is Blockscout-only today
- `./sandbox.sh build-images` only wraps
  `services/blockscout/build-images.sh`, which clones upstream Blockscout
  and builds the backend + frontend images from source as a fallback for
  testing upstream changes. Other services that now use Dockerfile-based
  local images (nb-ui today, nb-bond-api in the follow-up above) build
  their images inside their own `<svc>.sh start`.
- Planned follow-up: decide whether `./sandbox.sh build-images` should
  remain a Blockscout-only escape hatch, or grow to drive every
  per-service Docker build in one command (parallel `nb-ui.sh start
  --build-only`-style invocations). The right answer depends on how often
  developers want a "rebuild every image without deploying" path.
