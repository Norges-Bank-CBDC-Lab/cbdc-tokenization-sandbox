# 0005. Redeem principal with the final coupon and close the bond in one transaction

- **Status:** Proposed
- **Date:** 2026-09-09
- **Deciders:** sandbox operator
- **Tags:** contracts, bonds, coupon, redemption, lifecycle
- **Plan:** `docs/plans/redeem-with-final-coupon/`

## Context

The bond lifecycle in `BondManager` treats maturity and redemption as two operator steps. The
final `payCoupon` pays the last coupon and sets `BondToken.isMatured`; a separate
`BondManager.redeem` later burns each holder's units and pays the principal in wNOK. Between the
two calls the bond is `matured` while holders still own units that are owed principal.

Validating the wNOK cash-leg change (ADR 0004) on the local sandbox showed the cost of the
split: the redemption step existed only as an API route and a client function that no operator
page called, so through the UI a bond could mature but never close, and the Coupon payout page
kept a matured bond listed with nothing left to pay. The split also kept a known deadlock alive:
a bond whose auction was not fully allocated leaves unsold units on the manager contract, which
is not on the wNOK allowlist, so neither a coupon nor a redemption could complete.

A bond at maturity pays its final coupon together with the principal and ceases to exist.
Unsold units earn nothing.

## Decision

`BondManager.payCoupon` is the only lifecycle exit. On the final coupon period it marks the
partition matured, settles each real holder once through `BondDvP` with the `Redeem` operation
for `balance × (nominal + coupon per unit)` in wNOK, burns any units the manager holds itself
without paying cash, requires partition supply to be zero, and emits one
`BondMatured(isin, paymentCount, principalPaid, couponPaid, unsoldBurned)` event. On interim
periods, manager-held units receive no coupon.

`BondManager.redeem`, the `POST /v1/bonds/{isin}/redemptions` route, the unused UI client
function, and the `AllCouponsPaid` and `BondRedemptionComplete` events are removed. The
projection's terminal bond status is `matured`, meaning closed with zero supply; `redeemed` is
dropped.

## Consequences

- One operator action closes a bond, from the Coupon payout page, and the page's work queue is
  exact: a bond is listed until its final payout.
- The treasury-held-units deadlock in `docs/KNOWN_ISSUES.md` is resolved by construction:
  unsold units are skipped on coupons and burned at maturity.
- `BondMatured` gives later processing (reporting, a settlement layer, the closed-loop plan's
  maturity phase) a single event with totals to key on; per-holder `CouponPaid` and
  `BondRedeemed` remain for balance-level detail.
- The final payout is the largest single wNOK movement in the lifecycle; an underfunded
  reserve blocks closure entirely rather than one coupon. The transaction reverts cleanly, the
  Central Bank page shows the reserve balance, and the pay-coupon confirmation warns beforehand.
- `BondManager` redeploys; the local sandbox is recreated. Bonds closed under the old model are
  not representable on the new contracts and need no migration.
- The `NotMatured` gate on `BondToken.redeemFor` stays; the manager sets the flag first in the
  same transaction, so the gate protects only against direct misuse.
- A bond fully bought back before maturity is unchanged by this decision and still needs its
  own status handling.

## Alternatives considered

- **Add a Redeem action to the UI and keep two steps.** Rejected: preserves the "matured but
  held" state and a second code path that already drifted from the first.
- **Burn unsold units at finalisation.** Rejected here: touches finalisation and
  `withdrawFailedIssuance`; burning at maturity confines the change to `payCoupon`.
- **Reuse `AllCouponsPaid` as the closure signal.** Rejected: the closure record should carry
  totals and a name that cannot be confused with the old flag-only semantics.
