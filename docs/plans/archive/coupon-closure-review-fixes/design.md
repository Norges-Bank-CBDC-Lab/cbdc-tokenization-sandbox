# Coupon closure review fixes — Design

**Status:** Draft
**Created:** 2026-09-14
**Intent:** [`intent.md`](intent.md)
**Builds on:** ADR 0004, ADR 0005, `docs/plans/archive/redeem-with-final-coupon/`.

## Decision Summary

Fix each review finding at the layer that owns the invariant. The contract keeps the rule
"unsold units are burned at maturity" by deleting the only path that could move them elsewhere,
rejects duplicate holders itself, and emits one `CouponPeriodPaid` per period so the projection
does not depend on per-holder events. The API accepts an empty holder set when the partition's
supply is zero, validates the body against duplicates, and probes the manager ABI at startup for
its health report. The projection treats an issued bond with remaining coupon periods as
`outstanding` regardless of supply, and drops the write-only redemption flag. The UI mirrors
the contract's integer per-unit coupon and compares the reserve in BigInt. Docs regain the
allowlist known issue.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** UI `couponUnits = balance × rate / 10000` (float); contract `paymentPerBond = (1000 × yield) / 10000` (integer) | `PayCouponModal.jsx` vs `BondManager.payCoupon`; sandbox `CouponPaid` 2520 for 60 units | Preview overstates by up to 0.5 WNOK per unit; reserve warning can misfire |
| **Verified.** `withdrawFailedIssuance` transfers manager-held units to `msg.sender`; `_payHolders` exempts only `address(this)` | `BondManager.sol` | Withdrawn units are paid coupon and principal, or revert on the allowlist |
| **Verified.** Coupon route 404s on an empty resolved holder list; contract accepts `[]` when supply is 0 | `app.ts` coupon route; `_payHolders` coverage check | Fully bought-back bond can never emit `BondMatured`; `bondStatus` returns `staged` for it |
| **Verified.** No duplicate check in `_payHolders`; the existing test only covers the single-holder case; `HoldersBody` is an unconstrained array | `BondManager.sol`, `BondManager.t.sol`, `contracts/bonds.ts` | `[A, A]` with two equal holders pays A twice and skips B for the period |
| **Verified.** Coupon count is projected only from `CouponPaid`; manager-held units emit none | `bond-state.ts` `coupon-paid`, `_payHolders` | Manager-only bond never advances `payments.made` until closure |
| **Verified.** Nothing couples the API image to the deployed manager; `GOV_RESERVE()` failure degrades to `null`, undecodable logs are dropped | `central-bank.ts`, `ingestion.ts` decode loop | Skew is invisible in health |
| **Verified.** `redemptionComplete` is set only alongside `isMatured` and read by nothing | `bond-state.ts`, `compose-projection.ts` | Dead derived state |
| **Verified.** Structs sit between the public API and the internal helpers | `BondManager.sol` | Breaks the documented file layout |
| **Verified.** `11_BondSetup.s.sol` no longer adds the dealer EOAs to TBD Nordea; no other script does | deploy scripts | Banking demos to those accounts fail on a fresh sandbox |
| **Verified.** `HoldersBody` description still says "coupon-payment and redemption" | `contracts/bonds.ts` | Stale spec text |

## Target Architecture

### Contract

- Delete `withdrawFailedIssuance` and `Errors.NoFailedIssuance`; the reference docs and the
  auction sequence note follow.
- `_payHolders`: before processing holder `i`, scan `j < i` for an equal address and revert
  `Errors.DuplicateHolder(isin, holder)`. O(n²) over a sandbox-sized list; no ordering
  requirement imposed on callers.
- New event `CouponPeriodPaid(string indexed isin, uint256 paymentNumber, uint256 holdersPaid,
  uint256 couponPaid)` emitted once per successful `payCoupon` after `updateCouponPayment`,
  before any `BondMatured`.
- Move `Period` and `PayoutTotals` to the types block above the constants.

### API

- Coupon route: resolve holders; if the list is empty and the projected bond's `totalSupply`
  is `0`, call `payCoupon(isin, [])` instead of 404. Otherwise unchanged.
- `HoldersBody`: `superRefine` rejecting case-insensitive duplicates; description reworded.
- Ingestion: `CouponPeriodPaid` → history `COUPON_PERIOD_PAID` with the totals and the
  existing reducer transition `coupon-paid` (paymentNumber, blockTimestamp). `CouponPaid`
  keeps inserting per-holder rows but no longer needs to drive the count (it still may; the
  reducer is monotonic).
- `bondStatus`: `matured` if `is_matured`; `auctioning` as today; `outstanding` if
  `ever_issued && (supply > 0 || remaining coupon periods > 0)`; else `staged`. Remaining periods
  derive from `maturity_duration / coupon_duration - coupon_payment_count`, guarded for nulls.
- `BondState`: remove `redemptionComplete`; the SQLite column stays with its default.
- Health: `contracts.bondManagerCompatible: boolean | null`, from a startup probe that calls
  `GOV_RESERVE()` (retrying with the ingestion loop's cadence until the registry resolves);
  `null` until probed, `false` on a revert, logged at error level.

### UI

- `PayCouponModal`: `couponPerUnit = Math.floor(1000 × rate / 10000)` WNOK; amounts in WNOK
  as BigInt strings; a `formatNokAmount` helper renders WNOK amounts (the existing
  `formatNok` takes bond units). Reserve comparison in BigInt.
- `CouponPayoutPage`: list bonds with a coupon schedule, not disabled, and either supply > 0
  or `coupon.payments.remaining > 0`; hint text updated.

### Docs

- `docs/KNOWN_ISSUES.md`: "Every bond holder must be on the WNOK allowlist" entry with the
  Central Bank page workaround.
- Contract reference: drop `withdrawFailedIssuance`; NatSpec pages hand-patched.
- `08_TbdSetup.s.sol` seeds the dealer EOAs on TBD Nordea.

## Alternatives Considered

- Expose computed payout amounts from the composer instead of mirroring the integer rule in
  the UI: better long-term, larger change; deferred.
- Require sorted holder lists on-chain instead of an O(n²) scan: cheaper gas, but ripples
  ordering into every caller and test for no sandbox benefit.
- Make `withdrawFailedIssuance` burn instead of transfer: keeps an early-cleanup path but
  duplicates what maturity already does; removal is simpler.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Unsold units | Remove `withdrawFailedIssuance` | None (approved via "fix all findings") |
| Duplicate holders | On-chain scan plus body validation | None |
| Period event | `CouponPeriodPaid` with totals | None |
| Zero-supply closure | Route passes `[]` when supply is 0; status stays `outstanding` | None |
| Local rollout | Fresh sandbox to observe the new event and closure path | Go-ahead before deleting local chain state |

## Residual Risks

- The UI still mirrors contract math; a future formula change must be made twice until the
  composer exposes amounts.
