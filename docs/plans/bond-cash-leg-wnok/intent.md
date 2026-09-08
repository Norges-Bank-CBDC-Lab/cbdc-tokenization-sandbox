# Bond cash leg in wNOK — Intent

**Status:** Draft
**Created:** 2026-09-07
**Requested by:** sandbox operator

## Outcome

Every cash movement in the bond lifecycle settles in wNOK, the tokenized central-bank money
held by primary dealers as reserves. Primary dealers pay for allocated bonds in wNOK at auction
finalisation (already the case today), and they receive coupon, buyback, and redemption cash in
wNOK from the government's reserve account. The government-nominated tokenized bank deposit
(`Tbd`) drops out of the bond stack entirely: `BondManager` no longer knows a settlement bank,
only a reserve account and one cash token.

## Why This Change

The sandbox models primary dealers as banks holding reserves at the central bank. In that
model the inbound leg (dealer pays the state) and the outbound leg (state pays the dealer) are
the same money. Today they are not:

- Issuance: `BondManager._settleIssuance` debits the bidder in wNOK and credits the
  government reserve account in wNOK.
- Buyback, coupon, redemption: `BondManager._settleBuyback`, `payCoupon`, and `redeem` pay the
  holder from the government reserve account in the government-nominated TBD (`GOV_TBD`,
  Nordea's TBD in the local deploy), which `Tbd._update` backs by pulling wNOK from the same
  reserve account and minting TBD 1:1.

So a dealer buys bonds with reserves and is paid interest in a commercial bank's deposit
money. Beyond being the wrong economic model, the indirection costs a second contract, a
second allowlist, a second approval, and an extra mint on every payout, and it is the origin of
two entries in `docs/KNOWN_ISSUES.md` (the hard-coded `GOV_TBD` and the treasury-held-units
coupon deadlock on the TBD allowlist).

## Scope

### In Scope

- `BondManager`: replace the `GOV_TBD` / `ITbd` dependency with a wNOK reserve account, and use
  `WNOK` as the cash token for the buyback, coupon, and redemption legs.
- Deploy scripts `10_Bond.s.sol` and `11_BondSetup.s.sol`: constructor wiring and the reserve
  account's wNOK allowance for `BondDvP`; drop the government-TBD wiring.
- Foundry tests that construct `BondManager` or assert payout balances
  (`BondManager.t.sol`, `BondLifecycle.t.sol`), plus new cases for the wNOK payout paths.
- NB Bond API: regenerated `BondManager` ABI, the Central Bank resource field that today
  exposes the settlement bank, revert-decoding interfaces for coupon and redemption, the
  treasury-held-units hint text, and live-change publication (`bidders`, `central-bank`) from
  the coupon, redemption, and finalisation mutations so wNOK balances refresh after every
  cash movement.
- NB UI: the Central Bank page KPI and the coupon-payout warning text.
- Docs: contracts reference, security notes, lifecycle walkthrough, coupon/redemption sequence
  diagram, `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md`, documentation index, and an ADR
  recording the decision.

### Out of Scope

- Removing the bidder or reserve ERC-20 allowance in favour of authority settlement. That is
  Phase 1 of `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md` and lands
  afterwards, uniformly across all four cash legs.
- Making the reserve account designation mutable (governance change; keep it immutable like
  the value it replaces and narrow the known issue instead).
- Any change to `Tbd`, the Banking page, the interbank-settlement contracts, or the
  government-nomination mechanism in `Tbd`; those stay for the customer-money demo.
- Burning or skipping treasury-held units in `payCoupon` / `redeem` (existing follow-up).
- ERC-3643 migration of the bond token (ADR 0002).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Coupon, buyback, and redemption cash is transferred in wNOK from the reserve account to the holder; no TBD balance changes anywhere in the bond flow | Wrong money on the outbound leg | Foundry tests assert `wnok.balanceOf` deltas and that no `Tbd` is deployed in the bond test fixtures |
| Total wNOK supply is unchanged by a coupon, buyback, or redemption | Hidden minting on payout (today `Tbd._update` mints) | Conservation assertion in the coupon and redemption tests |
| An underfunded reserve makes `payCoupon` / `redeem` revert with `SettlementFailure(Cash, ERC20InsufficientBalance)` and no partial payment | Silent partial payout | Foundry test with reserve balance below the due amount |
| A holder missing from the wNOK allowlist fails the cash leg with `FailureReason.Cash` | Allowlist moved from TBD to wNOK | Foundry test; API 409 detail names the wNOK contract |
| `BondManager` compiles without importing anything from `contracts/src/private-bank/` | Residual coupling to `Tbd` | `forge build` plus a grep in CI-equivalent local gate |
| Local deploy scripts bring up the bond stack without a government-nominated TBD; the API and UI show the reserve account | Deploy wiring drift | Fresh `./sandbox.sh start`, Central Bank page, `cast call BondManager GOV_RESERVE()` |
| Existing auction, cancel, disable, and failed-issuance behaviour is unchanged | Regression in the inbound leg | Full `forge test` green (baseline: 390 tests) |

## Constraints

- sandbox-sized; local-first; portable to a non-local deployment only when the cost is small
- public repo: no secrets, private identifiers, or home-directory paths
- dependencies and licences need the approvals in root `AGENTS.md`; this plan adds none
- `BondManager` redeploys and gets a new address, so the local chain state must be recreated
  or the API projection resynced

## Open Questions

- None blocking. Decisions with a recommendation are listed in `design.md`.
