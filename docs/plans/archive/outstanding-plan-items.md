# Outstanding Plan Items

**Status:** Archived 2026-06-09 — triage complete. The stale `operator-ui-backlog.md` items (11 + 12) were corrected; the remaining bond-lifecycle Phase-5 documentation updates were accepted as low-priority debt; the optional code-cleanup and auction-test items were declined. Archived alongside `bond-lifecycle-management-plan.md`; retained for historical reference.

These are leftover, deferred, or lower-priority pointers extracted from plans that are otherwise shipped or only partially complete. This file is intentionally **not** a plan — it is a holding area so nothing is silently lost when a plan is archived or left partly done. For each item, decide: **do it**, **fold into another plan**, or **drop**.

---

## From `bond-lifecycle-management-plan.md`

All operator-facing functionality (backlog items 11 + 12) shipped via [#127](https://github.com/Norges-Bank-CBDC-Lab/cbdc-tokenization-sandbox/pull/127). The plan is kept active only because its Phase 5 (documentation) never ran. The leftovers are almost entirely documentation hygiene.

### Documentation (Phase 5 — never executed)

- [ ] **`docs/plans/archive/operator-ui-backlog.md` is stale (highest-value fix).** Items 11 + 12 (≈ lines 41–62) shipped via #127 but are still listed under "## Open items" describing the gaps as unsolved (e.g. "`BondManager.sol` has no `removeBond`/`disableBond`"). Move them to the "What already shipped" list, or drop them.
- [ ] **`contracts/docs/contracts-reference.md`** — document the new entrypoints `deployBond`, `deployAuctionForBond`, `disableBond`, and `BondToken.disablePartition`; add the residual-risk note about ISIN re-use re-using the partition key.
- [ ] **`contracts/docs/bond-lifecycle-walkthrough.md`** — add the "pre-stage a bond, then schedule its auction" path (currently only documents `deployBondWithAuction`).
- [ ] **`services/nb-bond-api/README.md` + `DEVELOPMENT.md`** — document `POST /v1/bonds`, `DELETE /v1/bonds/{isin}`, the `?includeDisabled` query, and the `partitions.disabled` column / pre-flight 409 semantics.
- [ ] **`services/nb-ui/README.md` + `DEVELOPMENT.md`** — document the disable affordance, the "show disabled" toggle, and the `nb-ui:bonds:showDisabled` localStorage key.
- [ ] **`docs/ARCHITECTURE.md`** — one-paragraph note that bond inventory is now independent of the auction calendar.
- [ ] **Archive the plan once the above land** — move `docs/plans/bond-lifecycle-management-plan.md` → `docs/plans/archive/` with a PR-linked status line. (Its `docs/DOCUMENTATION_INDEX.md` entry is already added to the active list during this cleanup.)

### Optional code cleanup / recorded deviations (functional today; flagged for accuracy)

- [ ] **Finish the `deployAuctionForBond` rewire.** `services/nb-bond-api/src/index.ts` `POST /v1/bonds/{isin}/auctions` still calls `bondManager.deployBondWithAuction` rather than the new `deployAuctionForBond`. Behaviour is correct (the former is now a composition); decide whether to complete the refactor or accept current wiring.
- [ ] **`status: 'unknown'` for pre-staged / limbo bonds persists** (`services/nb-bond-api/src/compose.ts`). "Disabled" is surfaced via the `disabled` boolean, but the `unknown` status the plan flagged as a smell was never reclassified. Decide whether to reclassify.
- [ ] **Minor parity deviations (no action needed unless you want plan/impl parity):** `BondDisabled` event is non-indexed (plan said `indexed`; immaterial for a `string`); localStorage key is `nb-ui:bonds:showDisabled` (plan said `nbui.showDisabledBonds`); lifecycle tests live in `contracts/test/integration/BondLifecycle.t.sol` (plan said `contracts/test/norges-bank/`).

---

## From `auction-web-fixes-plan.md` (shipped via #129, now archived)

- [ ] **Optional UI test not added** (plan flagged best-effort, not an acceptance criterion): a `services/nb-ui/tests/AuctionDetailPage` test for the clearing-yield gate. The gate logic is indirectly covered by the existing `AllocationCard` test. Decide whether to add or drop.

---

## Accounted for — not leftovers (recorded so they are not re-investigated)

- **`docs/plans/jupyter-removal-plan.md`** — intentionally **deferred** (JupyterHub is still deployed). A coherent standalone deferred plan; left active as-is and not extracted here.
- **Auction-deletion contract change (`disableAuction`)** — **decided against** (delivered as a no-op) per the bond-lifecycle plan's decision D3; the existing `cancelAuction` + UI filter is sufficient. Correctly not built.
