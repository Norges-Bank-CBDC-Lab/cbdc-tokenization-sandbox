# 0004. Settle every bond cash leg in wNOK from a government reserve account

- **Status:** Accepted
- **Date:** 2026-09-07
- **Deciders:** sandbox operator
- **Tags:** contracts, cash-settlement, wnok, bonds
- **Plan:** `docs/plans/bond-cash-leg-wnok/`

## Context

The bond stack (`BondManager`, `BondAuction`, `BondToken`, `BondDvP`) models a primary market in
which primary dealers, banks holding reserves at the central bank, buy government bonds at
auction. The sandbox has two kinds of money: `Wnok`, the tokenized central-bank money with an
allowlist and role-gated `transferFrom`, and `Tbd`, per-bank tokenized deposits that a bank
issues to its customers and backs 1:1 with wNOK.

`BondManager` was built with a split cash model. Issuance debits the winning dealer in wNOK and
credits a government reserve account in wNOK. Buyback, coupon, and redemption pay the dealer
from that same reserve account, but in the government-nominated `Tbd` (`GOV_TBD`), which
`Tbd._update` funds by pulling wNOK from the reserve and minting deposit tokens. `BondManager`
therefore imported `ITbd`, learned the reserve address through `ITbd.govReserve()`, and the
deploy scripts kept a second allowlist and a second approval in sync for the payout side.

The consequences were an economic model in which a dealer pays with reserves and is paid interest
in one commercial bank's deposit money; an extra mint on every payout; a hard-coded settlement
bank recorded in `docs/KNOWN_ISSUES.md`; and a coupon deadlock on the TBD allowlist when the
manager holds unsold units. The interface had already drifted toward the intended model: the
`BondRedeemed` event names its cash parameter `wnokAmount`.

## Decision

Every bond cash leg settles in `Wnok`. `BondManager` takes a government reserve **account**
(an address, stored as `GOV_RESERVE`) instead of a government **bank contract**, and uses `WNOK`
as `cashToken` for issuance, buyback, coupon, and redemption. The bond stack has no dependency
on `contracts/src/private-bank/`.

The authorization mechanism is unchanged for now: `BondDvP` holds `TRANSFER_FROM_ROLE` on
`Wnok` and the reserve account grants it an ERC-20 allowance, exactly as the dealers do for the
issuance leg. The reserve designation stays immutable, as the value it replaces was.

## Consequences

- One money for one market: cash in and cash out are the same token; wNOK supply is constant
  across payouts.
- One allowlist and one approval to keep correct on the payout side, both on `Wnok`.
- `BondManager` redeploys with a new constructor signature; the local sandbox is recreated and
  the NB Bond API's `BondManager` ABI is refreshed. The Central Bank API resource replaces its
  "settlement bank" field with the reserve account and its wNOK balance.
- The treasury-held-units coupon deadlock moves to the wNOK allowlist; the operator workaround
  becomes an allowlist addition on the Central Bank page. The contract-side fix stays open.
- `Tbd` government nomination loses its bond-stack consumer and remains only for the
  customer-money demo.
- The closed-loop authority settlement planned in
  `docs/plans/closed-loop-settlement-and-omnibus-custody-plan.md` now applies to all four cash
  legs at once when it lands, instead of to the issuance leg alone.

## Alternatives considered

- **Keep `GOV_TBD` and let payouts draw on its wNOK backing.** Rejected: reserves still route
  through a commercial bank contract, and the second allowlist stays.
- **Fold in authority settlement (`Wnok.settle` under a new role) in the same change.**
  Rejected: two decisions in one diff; the closed-loop plan specifies it separately and benefits
  from a single-token starting point.
- **Mutable reserve designation with an admin setter.** Deferred: a governance decision about
  who may redirect state payouts, worth its own record.
- **Dedicated treasury contract holding wNOK.** Rejected: nothing in the sandbox needs an
  intermediary between the reserve account and `BondDvP`; it would need its own authority path.
