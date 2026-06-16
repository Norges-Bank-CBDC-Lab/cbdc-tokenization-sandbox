# Closed-Loop Auction Settlement & Omnibus Custody — Implementation Plan

**Status:** Proposed — design agreed in a design session. **Phase 1 is diff-level and implementation-ready**; Phases 2–6 are roadmap. No contract code changed yet — implementation needs a separate explicit go-ahead.
**Branch suggestion:** `feature/closed-loop-settlement-authority` (Phase 1 only; later phases get their own branches).
**Components touched (Phase 1):** `contracts/src/common/Roles.sol`, `contracts/src/norges-bank/Wnok.sol`, `contracts/src/norges-bank/BondDvP.sol`, new `contracts/src/norges-bank/interfaces/ISettlementToken.sol`, `contracts/script/norges-bank/11_BondSetup.s.sol`, tests under `contracts/test/norges-bank/`, and `docs/DOCUMENTATION_INDEX.md`.

## Goal

Make the primary bond auction settle the **cash leg by central-bank authority** instead of by an ERC-20 allowance the bidder must pre-grant — eliminating the `ERC20InsufficientAllowance` failure class — and lay out the phased path to **omnibus broker custody** with confidentiality, a unified primary-dealer registry, and two-tier coupon/redemption.

The closed-loop model: **wNOK is central-bank money; only allowlisted entities hold it; the central bank does not require a holder's approval to debit it for a binding auction.** A vetted settlement contract moves it by privilege, scoped, allowlist-checked, and event-audited.

## Non-Goals

- **No locking / escrow of bidder funds.** Nothing is reserved during the multi-day bidding window — only winning dealers are debited at finalisation. (Locking would also distort the corridor-style nightly interest-on-holdings model.)
- **No change to plain ERC-20 `transferFrom`** — it stays allowance-respecting for any future open-loop (secondary-market) use. The authority path is a *separate, explicit* function.
- **No Diamond pattern.** Specialized contracts + interfaces + factory + minimal-proxy clones; per-contract UUPS only if upgradeability is needed.
- **No Azure / infra change.** Everything runs on the existing Besu-on-AKS runtime; deployment is the existing Foundry scripts against the Besu RPC.

## Guiding Invariants (agreed)

1. **Authority, not consent, in the closed loop.** The CB settles by privilege; no bidder `approve`.
2. **Never lock — debit winners at finalisation.** Protects liquidity *and* the interest-on-holdings accrual.
3. **One authoritative ledger per holding.** Omnibus ⇒ the off-chain broker sub-ledger is truth; the broker is the *sole on-chain hand* for its pool. Never run two authorities over the same balance.
4. **Unify custody, let settlement diverge.** One omnibus model for primary + secondary; only the trade-trigger differs (authority vs. consent).
5. **DRY identity.** One `PrimaryDealerRegistry`, not parallel allowlists.

## Current-State Evidence

- **The live failure that motivated this:** tx `0x139fb59dba8ca3dbc176f89abac5920bda09a0c818f3727b9a0e0d347e6d4456` (chain 2018, block 87) — a `BondManager.finaliseAuction("AM0053754816", …)` that **succeeded at the EVM level** (`status 0x1`) but emitted `BondAllocationFailed(actor, "Cash")` + `BondAuctionFinalised(success=false)`. Replaying the cash leg against pre-state returns `ERC20InsufficientAllowance(spender=BondDvP, allowance=0, needed=…)`. Bidder wNOK balance was sufficient; **the bidder simply never `approve`d BondDvP.** 1000 units were minted to BondManager and parked there (never delivered).
- **The cash leg lives in BondDvP, not BondManager:** `BondDvP._settleCashLeg` (`contracts/src/norges-bank/BondDvP.sol:97`) does `IERC20(p.cashToken).transferFrom(p.cashFrom, p.cashTo, p.cashAmount)` and maps a revert to `FailureReason.Cash`. `BondManager` only builds the `Settlement` struct and calls `BOND_DVP.settle(...)` — **so the Phase 1 fix does not touch BondManager.**
- **wNOK is already role-gated but *also* allowance-gated:** `Wnok.transferFrom` (`contracts/src/norges-bank/Wnok.sol:113`) is `onlyRole(Roles.TRANSFER_FROM_ROLE)` **and** calls `super.transferFrom` (allowance). The role is the authority we want; the allowance is the redundant gate that breaks. wNOK does **not** override `_update`, so allowlist is enforced only in the public `transfer`/`transferFrom` overrides — the new `settle()` must re-check it explicitly.
- **The bond token already has the controller/operator/redeem surface** custody needs: `addController`/`isController`/`controllers`, `authorizeOperatorByPartition`/`operatorTransferByPartition`, `redeemFor`/`buybackRedeemFor` (`contracts/src/norges-bank/BondToken.sol`). The bond leg in `BondDvP._settleSecurityLeg` already moves partitions via `operatorTransferByPartition` — no change needed for Phase 1.
- **Existing role wiring:** `contracts/script/norges-bank/11_BondSetup.s.sol:54` grants `SETTLE_ROLE` on BondDvP to BondManager; line **64** grants `TRANSFER_FROM_ROLE` on wNOK to BondDvP. That line 64 is the single wiring line Phase 1 changes.
- **A two-tier money/custody model already exists for the customer side:** `Tbd` (tokenized bank deposit, `contracts/src/private-bank/Tbd.sol`) with `IERC1363Receiver.onTransferReceived`, and `ClientList` (`contracts/src/broker/ClientList.sol`) mapping clients → `tbdContrAddr`/`securitiesWallet`. The auction path does **not** use them — it treats the dealer as a bare wNOK wallet. Phases 2–6 reconcile this.
- **The secondary market presumes on-chain per-holder balances:** `BondOrderBook` (`contracts/src/norges-bank/BondOrderBook.sol`) is a holder-level on-chain limit book vs. wNOK — *incompatible with omnibus custody* (see Phase 5).

---

## Phased Roadmap

| Phase | Objective | Touches | MVP? |
|---|---|---|---|
| **1** | Cash-leg settlement by authority (the bug fix) | Roles, Wnok, BondDvP, deploy wiring | ✅ standalone |
| **2** | `PrimaryDealerRegistry` — vetted once, one source of truth | new registry; auction gate; wNOK allowlist wiring | ✅ |
| **3** | Omnibus custody — `IBrokerage`/`BondBrokerage`/factory + off-chain sub-ledger service | new custody layer; issuance `bondTo` = broker | ✅ (MVP completes) |
| **4** | Integrity — on-chain Merkle commitments of the broker sub-ledger | brokerage `commitSubLedger` + verification | later |
| **5** | Secondary venue refactor to broker-level (replaces holder-level `BondOrderBook`) | new venue; EIP-712 signed orders (open-loop cash) | later |
| **6** | Coupon & redemption — two-tier via gov bank → brokers; maturity reverse-DvP | coupon engine; `redeemFor`/`buybackRedeemFor` wiring | later |

**Sequencing:** Phase 1 ships alone and fixes production. 2 + 3 give a working confidential closed-loop primary auction (the MVP). 4/5/6 depend on 3 and can reorder — recommend **6 before 5** (coupon is core lifecycle; secondary trading is later).

---

## Phase 1 — Cash-leg settlement authority (diff-level spec)

**Design decision:** keep the DvP atomic (bond + cash in one `settle()`), and swap *only the cash leg's authorization* from allowance (`transferFrom`) to authority (`settle`). This is the minimal blast radius: **BondManager is untouched**; the bond leg is untouched.

**Authority chain after this change:**
`auction operator → BondManager (SETTLE_ROLE on BondDvP) → BondDvP (CASH_SETTLEMENT_ROLE on wNOK) → debit any allowlisted holder`. Every link is role-gated; the only entity that can *originate* a debit is whoever may call `BondManager.finaliseAuction` (the CB's auction operator).

### Change 1 — `contracts/src/common/Roles.sol` (add a role)

```solidity
/**
 * The role required to settle central-bank money (wNOK) by authority — no allowance.
 */
bytes32 internal constant CASH_SETTLEMENT_ROLE = keccak256("CASH_SETTLEMENT_ROLE");
```

### Change 2 — `contracts/src/norges-bank/Wnok.sol` (add the authority entrypoint)

Add an event (with the other events, near line 31):

```solidity
/**
 * Emitted when wNOK is moved by settlement authority (no allowance).
 */
event Settled(address indexed from, address indexed to, uint256 value, bytes32 indexed cause);
```

Add the function (after `transferFrom`, ~line 126). `_transfer` is OZ ERC-20 internal (balance-checked, **no allowance**); `_allowlist` comes from the `Allowlist` base; `Roles`/`Errors` are already imported:

```solidity
/**
 * @notice Authority settlement of central-bank money: move wNOK between allowlisted
 * parties by privilege, with NO ERC20 allowance. Mirrors ERC-1400 controllerTransfer.
 * @dev Caller must hold CASH_SETTLEMENT_ROLE. Both parties must be on the allowlist.
 * @param from Payer (debited).
 * @param to Payee (credited).
 * @param value Amount in token units.
 * @param cause Opaque settlement reference for audit (bond partition / auction id).
 */
function settle(address from, address to, uint256 value, bytes32 cause)
    external
    onlyRole(Roles.CASH_SETTLEMENT_ROLE)
    returns (bool)
{
    if (!_allowlist[from]) {
        revert Errors.AllowlistViolation(ERC20.name(), from, "originator not on allowlist");
    }
    if (!_allowlist[to]) {
        revert Errors.AllowlistViolation(ERC20.name(), to, "recipient not on allowlist");
    }
    _transfer(from, to, value); // OZ ERC20 internal: balance-checked, NO allowance
    emit Settled(from, to, value, cause);
    return true;
}
```

### Change 3 — new `contracts/src/norges-bank/interfaces/ISettlementToken.sol`

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

/**
 * @notice Minimal interface for authority-based cash settlement (closed-loop CBDC).
 */
interface ISettlementToken {
    function settle(address from, address to, uint256 value, bytes32 cause) external returns (bool);
}
```

### Change 4 — `contracts/src/norges-bank/BondDvP.sol` (swap the cash leg)

Add the import; **remove** the now-unused `IERC20` import (keep `IERC20Errors` — still used in the catch):

```solidity
import {ISettlementToken} from "@norges-bank/interfaces/ISettlementToken.sol";
```

Replace `_settleCashLeg` (lines 97–114):

```solidity
function _settleCashLeg(Settlement calldata p) internal {
    // Closed-loop authority settlement: the role IS the authority — no payer allowance.
    try ISettlementToken(p.cashToken).settle(p.cashFrom, p.cashTo, p.cashAmount, p.partition) returns (bool ok) {
        if (!ok) {
            revert Errors.SettlementFailure(uint8(FailureReason.Cash), "settle returned false");
        }
    } catch (bytes memory lowLevelData) {
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes4 selector = lowLevelData.length >= 4 ? bytes4(lowLevelData) : bytes4(0);
        if (
            selector == IERC20Errors.ERC20InsufficientBalance.selector
                || selector == Errors.AllowlistViolation.selector
        ) {
            revert Errors.SettlementFailure(uint8(FailureReason.Cash), lowLevelData);
        }
        revert Errors.SettlementFailure(uint8(FailureReason.Unknown), lowLevelData);
    }
}
```

Note: the `ERC20InsufficientAllowance` branch is dropped — it can no longer occur on the authority path. A genuine `ERC20InsufficientBalance` (a dealer that truly cannot pay) still maps to `FailureReason.Cash`, which is now a *meaningful default signal* rather than a spurious missing-approval.

### Change 5 — `contracts/script/norges-bank/11_BondSetup.s.sol` (deploy wiring)

Line 64 — grant the authority role to BondDvP instead of `TRANSFER_FROM_ROLE`:

```solidity
// before:
wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(bondDvp));
// after:
wnok.grantRole(Roles.CASH_SETTLEMENT_ROLE, address(bondDvp));
```

`TRANSFER_FROM_ROLE` is no longer needed by BondDvP — both the issuance and buyback cash legs now route through `settle()`. (Confirm no other path on this BondDvP instance relies on `transferFrom`.)

### Behavior change

| Scenario | Before | After |
|---|---|---|
| Dealer has balance, **no allowance** | revert `ERC20InsufficientAllowance` → `BondAllocationFailed("Cash")` (spurious) | **settles**; bond delivered, cash debited, `Settled` emitted |
| Dealer lacks balance (genuine default) | `BondAllocationFailed("Cash")` | `BondAllocationFailed("Cash")` — now a *real* default signal |
| Dealer or reserve not allowlisted | `AllowlistViolation` → `BondAllocationFailed("Cash")` | same (allowlist still enforced in `settle()`) |
| Funds during multi-day bidding | none locked | still none — debit only at finalisation |

### Tests (add under `contracts/test/norges-bank/`)

1. **Regression for the live failure** — dealer balance ≥ due, **allowance = 0** ⇒ assert finalisation **succeeds**: `BondAuctionFinalised(success=true)`, bond delivered to `bondTo`, dealer wNOK debited, `Settled(from, to, value, cause=partition)` emitted, **no `approve` anywhere in the path**.
2. **Genuine shortfall stays graceful** — dealer balance < due ⇒ `BondAllocationFailed(reason="Cash")`, finalisation does **not** revert, other allocations still settle, no partial cash movement for the failed allocation.
3. **Access control** — a caller without `CASH_SETTLEMENT_ROLE` cannot call `wNOK.settle`; a BondDvP missing the role surfaces as a caught `FailureReason` rather than silent success.
4. **Allowlist still binds** — non-allowlisted payer/payee ⇒ `FailureReason.Cash`.

### Security considerations

- **`CASH_SETTLEMENT_ROLE` on wNOK is root-equivalent for cash** — it can move any allowlisted holder's funds. Grant it **only** to vetted settlement contracts (BondDvP), never casually to EOAs. Govern *grants* with a multisig + timelock in production (sandbox may use a single admin key with this requirement documented).
- **Narrow, purpose-bound, audited.** Funds move only as a side-effect of `finaliseAuction`; every debit emits `Settled(cause)`. `cause = partition` ties the cash movement to the ISIN; threading the auction id for richer audit is a later enhancement (adds a field to the `Settlement` struct → ripples to BondManager, so deferred).
- **Closed-loop invariants preserved:** `settle()` still enforces allowlist membership and a balance check (no overdraft / no unbacked money). Only the *allowance* requirement is removed.

### Out of scope for Phase 1

PrimaryDealerRegistry (Phase 2), any custody/broker change (Phase 3+), coupon/redemption (Phase 6). Phase 1 is purely the cash-leg authorization fix and is independently shippable.

---

## Phases 2–6 (roadmap detail)

**Phase 2 — `PrimaryDealerRegistry`.** Vetted-once admission (`admitDealer(dealer, broker, couponPath)`, `suspendDealer`, `isActive`, `brokerOf`), `DEALER_ADMIN_ROLE`-gated; admission side-effects add the dealer to the wNOK allowlist and enable auction participation. The auction participation gate reads the registry — **no separate allowlist**. Register in `GlobalRegistry`.

**Phase 3 — Omnibus custody (MVP completes).** `IBrokerage` interface; `BondBrokerage` omnibus implementation (on-chain holds *broker totals only*); `BrokerageFactory` deploying per-broker EIP-1167 clones registered in `GlobalRegistry` with an `instance → operator firm` map. Issuance delivers to `brokerOf(dealer)` (`bondTo = broker`) and records a beneficial-ownership **commitment** at finalisation. CB stays a `controller` on the bond token for clawback. **Off-chain track (the glue):** broker wallet/sub-ledger service — authoritative per-client balances, KYC/AML, dealer web app, outbox pattern (off-chain debit → idempotent on-chain inter-broker move). Reconciliation invariant: `omnibusBalance == Σ client balances`. Beneficial owners do **not** transact on-chain — the custodian is the on-chain hand.

**Phase 4 — Integrity (Model B).** `commitSubLedger(merkleRoot, asOfBlock)` on the brokerage; periodic root commitment of `{client → balance}` ⇒ provable balances, detectable fraud, customer-portable proofs, without revealing balances to peers.

**Phase 5 — Secondary venue refactor.** Replace the holder-level `BondOrderBook` (which presumes segregated on-chain balances, incompatible with omnibus) with a **broker-level venue**: same-broker fills = off-chain book entries; cross-broker fills = on-chain DvP with **EIP-712 signed orders + open-loop cash authorization** (the legitimately-open-loop leg that *does* use signatures/allowances).

**Phase 6 — Coupon & redemption.** Coupon: CB debits the gov reserve (authority) → the gov's designated bank mints **backed** TBD (`Tbd._mintFromGovReserve` already backs it) → distributes **per broker** (fan-out scales) → brokers credit clients off-chain. Redemption at maturity: reverse DvP via `redeemFor`/`buybackRedeemFor` (burn bond ↔ return principal in wNOK by authority).

---

## Decisions And Open Questions

| Decision | Options | Recommendation | Needed from operator |
|---|---|---|---|
| **D1 — role name** | `CASH_SETTLEMENT_ROLE` / `CBDC_SETTLEMENT_ROLE` / `CASH_CONTROLLER_ROLE` | `CASH_SETTLEMENT_ROLE` — distinct from DvP's `SETTLE_ROLE`, mirrors the `BOND_CONTROLLER_ROLE` intent for the cash side | confirm name |
| **D2 — drop `TRANSFER_FROM_ROLE` on BondDvP?** | drop / keep both | **Drop** — both cash legs now use `settle()`; the role is unused by BondDvP | confirm no other BondDvP path needs `transferFrom` |
| **D3 — cash-leg failure semantics** | graceful (`BondAllocationFailed`) vs hard revert | **Keep graceful** — a batch finalisation shouldn't revert because one dealer defaults | confirm |
| **D4 — `cause` content** | `partition` now / thread `auctionId` later | `partition` now (no struct change); `auctionId` is a later enhancement | confirm acceptable |
| **D5 — role-grant governance (prod)** | single admin key (sandbox) / multisig + timelock (prod) | Single key acceptable in sandbox **with the prod requirement documented** | confirm sandbox posture |
| **D6 — custody model (Phase 3)** | omnibus title custody / operator custody / direct | **Omnibus title custody** (confidentiality is a first-class test goal; erases the EOA self-authorization friction) | confirm at Phase 3 |
| **D7 — reconciliation trust (Phase 4)** | trust + audit (Model A) / on-chain commitments (Model B) | Model A for MVP, **Model B** next | confirm at Phase 4 |

## Boundary / Ownership

This plan targets the **`cbdc-tokenization-sandbox`** repo (contracts + broker software). It requires **no Azure/Bicep change** — the existing Besu-on-AKS runtime hosts it; deployment is the existing Foundry scripts against the Besu RPC. The plan was authored read-only; implementing any contract change here is a separate, explicitly-authorized step.
