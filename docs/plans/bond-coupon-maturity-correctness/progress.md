# Bond coupon and maturity correctness — Progress

**Plan:** [`plan.md`](plan.md)
**Last updated:** 2026-09-28 — plan folder written from the 2026-09-28 contract review; findings re-verified against `development` at `db92409`
**Current phase:** Not started
**Next action:** Operator reviews `intent.md` and answers D1 (rounding rule, ADR or not), D6 (transfer eligibility now or at the ERC-3643 migration), and D12 (fresh-sandbox go-ahead at the end); then start Phase 0 by writing the five scratch reproductions listed in `plan.md` against `development`.

## Phase Log

| Phase | Status | Evidence | PR |
|---|---|---|---|
| 0 — Baseline, scratch reproductions, per-holder gas | Not started | | |
| 1 — Coupon per holding (S3) | Not started | | |
| 2 — Auction-type rule from enabled state (S4) | Not started | | |
| 3 — Matured bonds stay closed (S5) | Not started | | |
| 4 — Holder eligibility and sorted holders (S6) | Not started (needs D6) | | |
| 5 — Cleanups in touched code | Not started | | |
| 6 — Fresh local sandbox run | Not started (needs D12) | | |
| 7 — Documentation and archive | Not started | | |

## Deviations From the Plan

Corrections to the review findings, made while writing the plan:

- **"API coupon preview math" does not exist.** The NB Bond API performs no coupon arithmetic;
  it exposes `coupon.rateBps` and the holders and stores event amounts as emitted. Only the UI
  preview (`PayCouponModal.jsx`) and `format.js` `formatNok` hard-code the unit nominal. The
  alignment phase is therefore UI-only.
- **`_handleAllocationFailure` is not a revert path.** It emits `BondAllocationFailed` with a
  string reason; replacing the string changes an event signature and the function is not touched
  by any fix here. Moved to follow-ups.
- **Event `isin` indexing left alone.** No fix requires an event change, and ingestion resolves
  indexed and non-indexed `isin` differently; changing it is recorded as a follow-up.
- **Added: BUYBACK cancel reduces the offering.** Not in the review, but the S5 rule "no final
  coupon while an auction is in flight" cannot be safe while a BUYBACK auction can become
  impossible to cancel. It is in scope under the repository's scope rule because the requested
  behaviour depends on it.
- **R5 (`DECIMALS = 18`) included** as a cleanup: no API or UI code reads `BondToken.decimals()`,
  and `BondToken` emits no ERC-20 `Transfer` event, so explorers do not treat it as a token.
- **R2 (bought-back bond needs empty periods) left out of scope** as a known behaviour.

## Verified So Far

- `BondManager.payCoupon` truncates the per-unit coupon before multiplying (`BondManager.sol`
  lines 525–526, 604); wNOK `decimals()` is 0 (`Wnok.sol`) — verified by reading on 2026-09-28.
- `BondAuction.createAuction` enforces the type by `isinToAuctionCount`, `CANCELLED` orders after
  `FINALISED`, and the count is never reset by `disableBond` — verified by reading on 2026-09-28.
- `BondManager._settleIssuance` calls `enableByIsin` only for RATE; `payCoupon` divides by
  `couponDuration` without a zero check; `disableBond` refuses when any auction is `FINALISED` —
  verified by reading on 2026-09-28.
- `payCoupon` has no `bondActive` check; `_deployAuctionForBond`, `BondToken.mintByIsin`, and
  `extendPartitionOffering` never read `isMatured` — verified by reading on 2026-09-28.
- `BondManager.cancelAuction` reduces the offering for every auction type while a BUYBACK auction
  never raised it; no test cancels a BUYBACK — verified by reading and grep on 2026-09-28
  (runtime reproduction is Phase 0).
- ERC-1410 transfers (`transferByPartition`, `operatorTransferByPartition` → `_move`) have no
  eligibility check; the duplicate-holder scan in `_payHolders` is a nested loop — verified by
  reading on 2026-09-28.
- The API auction pre-check (`features/auctions/service.ts`) and the UI picker
  (`CreateAuctionModal.jsx`) replicate the count-based rule — verified by reading on 2026-09-28.
- The projection resets bond state on `BondCreated`, so `coupon` is `null` for a re-used ISIN
  until `IsinEnabled` — verified in `projection/bond-state.ts` on 2026-09-28.
- Baseline `forge test`: 24 suites, 390 tests passed; `payCoupon` median gas 180 157 with one or
  two holders — verified by running on 2026-09-28.
- `BondOrderBook` is not deployed by `contracts/script/` — verified by grep on 2026-09-28.

## Blocked / Waiting On

- D6 (transfer eligibility) — sandbox operator; blocks Phase 4 steps 1–4 and 8–9.
- D12 (fresh sandbox) — sandbox operator; blocks Phase 6.
- D1 ADR choice — sandbox operator; does not block Phase 1 code.

## Follow-ups Found Along the Way

- Coupon payment pagination (several transactions per period) — `BondManager.payCoupon` —
  size from the Phase 0 gas measurement; propose only if the holder limit is within reach of a
  demo.
- A fully bought-back bond needs one empty `payCoupon` call per remaining period before it can
  mature — `BondManager.payCoupon`, `test_PayCoupon_EmptyHolders_ClosesZeroSupplyBond` — known
  behaviour; a single "close empty bond" path could collapse them.
- `updateCouponPayment` records `block.timestamp`, so a late payment shifts every later coupon
  date — `BondManager.payCoupon` line 550 — consider advancing by `couponDuration` instead.
- `BondAllocationFailed` carries a free-text `reason` decoded with inline assembly —
  `BondManager._handleAllocationFailure` — replace with an enum when the event is next changed.
- `isin` is indexed on coupon and maturity events but not on auction and lifecycle events —
  `IBondManager.sol` — align when the ABI next breaks, together with ingestion's `resolveIsin`.
- The UI mirrors contract math for the payout preview — `services/nb-ui/src/domain/coupon.js`
  (after Phase 1) — a composer-computed preview in the API would remove the mirror.
- A shared Foundry fixture for the bond stack would remove the `setUp` duplicated between
  `BondManager.t.sol`, `BondManagerLifecycle.t.sol`, and `BondLifecycle.t.sol`.

## Changes Since Planning (2026-09-28)

Changes merged after this plan was written (#300, #302, which also carry
#301 and #303). Effects on this plan:

- `BondOrderBook`, `BondOrderBookFactory`, and their tests were removed (#302). The design rows
  and plan steps that mention them, including `BondOrderBook.t.sol` in the Phase 4 test list,
  no longer apply.
- `ERC1410._transferByPartition` and `_move` now take a single partition, and operator transfers
  never change partition (#300). Phase 4 (transfer eligibility) builds on that signature.
- `BondToken.addController` no longer grants `BOND_CONTROLLER_ROLE`; `BondManager` holds the role
  but is not an ERC-1410 controller, and `BondDvP` is both (#302). Test fixtures that wire roles
  follow that shape.
- Re-run the Phase 0 reproductions on current `development` before starting; line references in
  `design.md` predate these changes.

## Session Handoff

- Nothing implemented; no branch exists. The plan was written against `development` at
  `db92409` with a clean tree.
- A separate hardening change also edits contract code; check whether it has landed
  before starting Phase 4 and rebase accordingly.
