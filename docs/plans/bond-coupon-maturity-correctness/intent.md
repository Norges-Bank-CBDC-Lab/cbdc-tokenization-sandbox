# Bond coupon and maturity correctness — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

A bond's cash flows and lifecycle transitions are correct at the contract level. Every holder
receives the coupon their holding is actually owed at the auction's clearing rate, not a
per-unit value truncated to whole wNOK. A bond cannot end up with units that no coupon or
maturity payment can ever reach: a cancelled first auction no longer locks the ISIN out of a
rate auction, a bond that never cleared a RATE auction cannot be minted into or have its coupon
called, and a matured bond cannot be minted into. One holder can no longer make the coupon
payment revert for every other holder by receiving units at an address that cannot receive
wNOK. The operator's payout preview and auction-type choices in the UI match what the chain
will do.

## Why This Change

A contract review on 2026-09-28 found four lifecycle defects in the bond stack
(`BondManager`, `BondAuction`, `BondToken`), each reachable through normal operator actions:

- **Coupon underpayment.** `BondManager.payCoupon` computes one per-unit coupon,
  `(UNIT_NOMINAL × couponYield) / 10000`, rounds it down to whole wNOK (wNOK has 0 decimals),
  and multiplies that by each holding. At 425 bps a unit is owed 42.5 wNOK and receives 42, so
  every holder is underpaid by about 1.2 % every period; any yield that is not a multiple of
  10 bps loses money. The UI preview was aligned to this truncation in #278, so both show the
  wrong number consistently.
- **Stranded ISIN after a cancelled RATE auction.** "The first auction must be RATE" is
  enforced by counting auctions per ISIN, not by whether a RATE auction ever cleared. After a
  cancelled RATE auction only PRICE or BUYBACK can be scheduled, and the count survives
  `disableBond`, so a re-used ISIN is locked the same way. A PRICE auction then mints units into
  a bond that has no coupon parameters, `payCoupon` panics with a division by zero, and
  `disableBond` is blocked because a finalised auction now exists.
- **Units minted into a matured bond.** Nothing stops scheduling a PRICE auction on a matured
  bond, or finalising one that was open across the final coupon. The minted units can never be
  paid: every further `payCoupon` reverts with `AllCouponsPaid`.
- **One holder blocks everyone's coupon.** Bond units move freely between any addresses, but
  coupon and principal are paid in wNOK, which requires both ends to be on the wNOK allowlist.
  One holder at a non-allowlisted address makes the atomic payment revert for all holders; the
  existing known issue describes the workaround. The on-chain duplicate-holder check is also
  quadratic in the number of holders.

These sit in the same code as the maturity closure shipped by ADR 0005 and should be fixed
before further lifecycle work builds on them.

## Scope

### In Scope

- **Coupon amount (S3).** Per-holding coupon `floor(balance × UNIT_NOMINAL × yield / 10000)`
  in `BondManager`; totals in `CouponPeriodPaid` and `BondMatured` stay the sum of the
  per-holder amounts; the UI payout preview uses the same rule from one helper.
- **Auction-type rule (S4).** "RATE first" is decided by whether the bond has coupon parameters
  (a RATE auction cleared in this lifecycle), not by the auction count; `payCoupon` on a bond
  without coupon parameters reverts with a named error instead of a panic; the API pre-check
  and the UI auction-type picker follow the same rule.
- **Matured bonds stay closed (S5).** No auction can be scheduled on, and no unit minted into,
  a matured partition; the final coupon cannot be paid while an auction is in flight; cancelling
  a BUYBACK auction no longer reduces the partition offering (required so an in-flight buyback
  can always be cleared before maturity).
- **Coupon robustness (S6).** Bond units can only be transferred to an address on the wNOK
  allowlist; the holder list passed to `payCoupon` must be strictly ascending (linear duplicate
  check); the API sorts it. Subject to the operator decision in `design.md`.
- **Cleanups in touched code.** Stale "mock DVP / REDEEM_EOA" comments in `BondToken`;
  duplicated checks in `BondToken.createPartition`; a custom error instead of the
  `"coupon settle returned false"` string; `ERC1410Minimal.DECIMALS` from 18 to 0.
- Contract, API, and UI tests; contract reference, security, and walkthrough docs; hand-patched
  NatSpec pages; API ABI artifacts; `docs/KNOWN_ISSUES.md`; a fresh local sandbox run.

### Out of Scope

- Items owned by a separate hardening change.
- Coupon payment pagination (several transactions per period); recorded as a follow-up.
- Closing a fully bought-back bond without paying its remaining empty periods one by one
  (`test_PayCoupon_EmptyHolders_ClosesZeroSupplyBond` documents the current behaviour).
- Changing event signatures, including making `isin` indexed on every `BondManager` event.
- Replacing the `string reason` in `BondAllocationFailed` (not in a touched path; an event
  signature change).
- Moving wNOK to a sub-unit denomination (decimals > 0).
- The ERC-3643 migration (ADR 0002); the transfer eligibility check here is an interim rule it
  will replace.
- A coupon holder removed from the wNOK allowlist after acquiring units still blocks the
  payment; the known-issue workaround stays for that case.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| At 425 bps a holding of 60 units receives 2 550 wNOK per period (not 2 520); a holding of 1 unit receives 42; the period total in `CouponPeriodPaid` and `BondMatured.couponPaid` equals the sum of the per-holder `CouponPaid` amounts | Underpayment; totals drifting from per-holder events | Foundry amount and event assertions; fuzz over balance and yield against the reference formula |
| The pay-coupon preview shows the same per-holder and total amounts the contract pays, including for a yield that is not a multiple of 10 bps (7 units at 333 bps → 233) | Preview and chain disagree | nb-ui test at 425 bps and 333 bps |
| After a cancelled RATE auction, a new RATE auction can be scheduled and cleared on the same bond; PRICE and BUYBACK are refused until a RATE auction has cleared; the same holds after `disableBond` and ISIN re-use | Stranded ISIN | Foundry tests for cancel-then-RATE, reuse-then-RATE, PRICE refused before enablement |
| `payCoupon` on a bond with no coupon parameters reverts with a named error, not `Panic(0x12)` | Opaque failure | Foundry `expectRevert` with the error selector |
| Scheduling any auction on a matured bond reverts; `BondToken.mintByIsin` and `extendPartitionOffering` revert on a matured partition; the final coupon reverts while an auction is in flight and succeeds after it is finalised or cancelled | Unpayable units in a matured bond | Foundry tests for each path |
| Cancelling a BUYBACK auction on a fully issued bond succeeds and leaves the partition offering unchanged | In-flight buyback that can never be cleared, which would now also block maturity | Foundry test |
| A bond unit transfer to an address not on the wNOK allowlist reverts; issuance, coupon, maturity, and buyback flows still pass for allowlisted holders | One holder blocking the whole coupon | Foundry tests; existing suites green |
| `payCoupon` rejects a holder list that is not strictly ascending; the API always sends a sorted list and the coupon route works with the default holder set | Quadratic duplicate check; API/contract mismatch | Foundry tests; API route test |
| No event signature changes; the projection replays a fresh chain to the same bond states and history as before for the flows exercised | Ingestion breakage | ABI diff shows only errors, views, and the constructor change; fresh-sandbox run |
| A fresh local sandbox runs a bond through RATE auction, interim coupon, PRICE extension, final coupon, and closure with the corrected amounts | End-to-end regression | Balance trail in `progress.md` |

## Constraints

- sandbox-sized; local-first; nothing here needs a non-local deployment change beyond
  redeploying the bond contracts
- public repo: no secrets, private identifiers, or home-directory paths
- no new dependencies
- the bond contracts are redeployed (new addresses): the local sandbox is recreated with the
  operator's go-ahead

## Open Questions

- Whether to adopt the transfer eligibility rule (S6) now or leave it to the ERC-3643
  migration — owner: sandbox operator; `design.md` decision D6 recommends adopting it now.
- Whether the rounding rule gets its own ADR — owner: sandbox operator; `design.md` decision D1.
