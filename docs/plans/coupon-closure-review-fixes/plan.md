# Coupon closure review fixes — Implementation Plan

**Status:** In progress
**Created:** 2026-09-14
**Scope:** `contracts/src/norges-bank/BondManager.sol`, `IBondManager.sol`, `Errors.sol`, `contracts/script/private-bank/08_TbdSetup.s.sol`, contract tests and docs; `services/nb-bond-api` (coupon route, `contracts/bonds.ts`, `contracts/health.ts`, ingestion, reducer, composer, health probe, ABI artifact, openapi); `services/nb-ui` (`PayCouponModal.jsx`, `CouponPayoutPage.jsx`, `format.js`, tests); `docs/KNOWN_ISSUES.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Contracts: remove withdrawFailedIssuance, DuplicateHolder, CouponPeriodPaid, struct placement, TBD seeding
Phase 2  API: empty-holder closure, body validation, ingestion + reducer + status, health probe, drop redemptionComplete
Phase 3  UI: integer preview, BigInt reserve check, queue filter
Phase 4  Docs: known issue, reference, NatSpec; progress
Phase 5  Fresh sandbox check (optional, operator go-ahead)
```

One PR; contracts and API land together because the event and the route change are paired.

## Phase 1: Contracts

1. `IBondManager`: add `CouponPeriodPaid`. `Errors.sol`: add `DuplicateHolder(string isin,
   address holder)`, remove `NoFailedIssuance`.
2. `BondManager`: move structs to the types block; delete `withdrawFailedIssuance`; duplicate
   scan in `_payHolders`; emit `CouponPeriodPaid` after `updateCouponPayment`.
3. Tests: replace `test_WithdrawFailedIssuance*` with nothing (the unsold-units closure test
   covers the residue); add `test_PayCoupon_RevertIf_DuplicateHolder_TwoHolders`,
   `test_PayCoupon_EmptyHolders_ClosesZeroSupplyBond` (issue, buy back everything, pay
   periods with `[]`, expect `BondMatured(…, 0, 0, 0)`), and event assertions for
   `CouponPeriodPaid`.
4. `08_TbdSetup.s.sol`: add the two dealer EOAs to TBD Nordea's allowlist.
5. `forge fmt`, `forge build`, `forge test`; copy the ABI artifact.

Exit: tests green; `grep withdrawFailedIssuance` empty outside archived docs and ADRs.

## Phase 2: API

1. `contracts/bonds.ts`: `HoldersBody` duplicate refine and description.
2. Coupon route: empty resolved list plus `totalSupply === '0'` → call with `[]`.
3. Ingestion: `CouponPeriodPaid` branch; `bond-state.ts` drop `redemptionComplete`;
   `compose-projection.ts` `bondStatus` with remaining-periods rule.
4. Health: probe module `bondManagerCompatibility` (startup, retry), `contracts.bondManagerCompatible`.
5. Tests: reducer (period event advances count), composer status rows (zero supply with
   periods remaining → `outstanding`), Zod duplicate rejection, health schema.
6. Regenerate `openapi.json`; package gate.

## Phase 3: UI

1. `format.js`: `formatNokAmount(wnok)`. `PayCouponModal`: integer per-unit coupon, BigInt
   totals and reserve comparison, empty-holder zero-supply preview text.
2. `CouponPayoutPage`: filter and hint.
3. Tests: 25.20 K NOK for 600 units; exact-reserve no warning; zero-supply bond listed.
4. Package gate.

## Phase 4: Docs

`docs/KNOWN_ISSUES.md` entry; `contracts/docs/contracts-reference.md`; `docs/diagrams/processes/
auction-sequence.md` note; NatSpec pages for `BondManager`, `IBondManager`, `Errors`;
`progress.md`; hygiene and link checks.

## Phase 5: Fresh sandbox (optional)

Full buyback to zero then close with empty holders; manager-only bond interim coupon advances
`payments.made`; health shows `bondManagerCompatible: true`.

## Test Matrix

| Layer | Behaviour | Test |
|---|---|---|
| Contract | Duplicate holder reverts | new Foundry test |
| Contract | Empty holders close a zero-supply bond | new Foundry test |
| Contract | `CouponPeriodPaid` per period | event assertions |
| Projection | Period event advances count; status rule | reducer and composer tests |
| API | Duplicate body rejected; empty set accepted at zero supply | Zod and route tests |
| API | Health compatibility field | contract test |
| UI | Integer amounts, reserve warning threshold, queue filter | vitest |

## Done Criteria

- [ ] All ten reported findings fixed or explicitly skipped with a reason in `progress.md`.
- [ ] `forge test`, both package gates, hygiene and link checks pass.
