# Contracts Versioning And ABI Expectations

This document describes the current versioning expectations for external
integrators consuming the contracts in [`contracts/`](../README.md).

## Current posture

The repository does not currently publish a formal semantic-versioning policy
for contract ABIs. Until that exists, external integrators should treat the
contract surface as evolving and pin integrations to a specific git commit,
release tag, or deployed environment snapshot.

Practical implication:

- do not treat the `development` branch as a stable ABI line;
- do not assume deployment addresses remain stable across fresh sandbox
  deployments;
- do not assume new function, event, or struct shapes are backward compatible
  unless explicitly stated.

## What to treat as the public integration boundary

For direct contract integrations, the best available boundary is the set of
interface files and externally consumed contract entrypoints:

- [`contracts/src/norges-bank/interfaces/IBondAuction.sol`](../src/norges-bank/interfaces/IBondAuction.sol)
- [`contracts/src/norges-bank/interfaces/IBondDvP.sol`](../src/norges-bank/interfaces/IBondDvP.sol)
- [`contracts/src/norges-bank/interfaces/IBondManager.sol`](../src/norges-bank/interfaces/IBondManager.sol)
- [`contracts/src/norges-bank/interfaces/IBondToken.sol`](../src/norges-bank/interfaces/IBondToken.sol)
- [`contracts/src/interfaces/IOrderBook.sol`](../src/interfaces/IOrderBook.sol)
- [`contracts/src/norges-bank/ERC1410/IERC1410.sol`](../src/norges-bank/ERC1410/IERC1410.sol)
- [`contracts/src/private-bank/ITbd.sol`](../src/private-bank/ITbd.sol)

For service-assisted integrations, the HTTP boundary is documented separately
under [`services/nb-bond-api/DEVELOPMENT.md`](../../services/nb-bond-api/DEVELOPMENT.md).

## What counts as a breaking change

The following should be treated as breaking for external integrators:

- changing a public or external function signature;
- removing a public or external function;
- changing event names, indexed fields, field types, or field ordering when
  off-chain consumers depend on them;
- changing custom error names or argument shapes if downstream tooling parses
  revert data;
- changing struct field names, types, or ordering for values that are passed
  across contract or tool boundaries, such as:
  - `IBondAuction.Allocation`
  - `IBondAuction.BidVerification`
  - `IBondAuction.AuctionMetadata`
  - `IBondDvP.Settlement`
  - `IOrderBook.Order`
  - `IOrderBook.PriceLevel`
- changing enum members or ordering when those values are persisted or exposed
  to external tooling;
- changing numeric unit conventions or precision, for example:
  - bond `units` representing whole 1,000 NOK nominal units;
  - `rate` and price values using bps precision;
- changing required role assignments or approvals for the documented flows;
- renaming registry keys relied on by external deployment or automation.

## What is usually additive and safer

The following are usually safer, though still worth documenting:

- adding new view functions;
- adding new events while keeping existing ones stable;
- adding new helper contracts that do not replace existing integration points;
- expanding documentation, NatSpec, or examples without changing runtime
  behavior.

Even additive changes can still require regenerated bindings or updated client
validation logic, so consumers should still pin to a known revision.

## Repo-specific semantic constraints

Some compatibility concerns are behavioral, not just ABI-level:

- `BondAuction` assumes off-chain unsealing and allocation calculation;
- `BondManager.payCoupon()` and `BondManager.redeem()` depend on a complete
  holder list supplied by the caller or resolved by the NB Bond API;
- `BondDvP` and `csd/DvP` are different settlement models and should not be
  treated as interchangeable even if they both express a DvP concept;
- `Wnok` and `Tbd` embed allowlist and role assumptions that affect runtime
  compatibility, not just type compatibility.

If any of those semantics change, external integrators should treat the change
as significant even if the raw ABI remains similar.

## Recommended integration practice

- Pin contract ABIs and generated bindings to a specific commit or release tag.
- Pin deployed addresses per environment, or resolve them through a known
  `GlobalRegistry` snapshot.
- Re-run code generation and regression tests whenever interface files change.
- Validate event consumers against real emitted logs after any update.
- Prefer the interface files over concrete contract ABIs when generating
  application bindings.
- If you integrate through the NB Bond API instead of direct contract calls,
  version and pin the HTTP/OpenAPI surface separately from the raw contract
  ABIs.

## Recommended change discipline inside the repo

When changing externally consumed contract surfaces:

- update the relevant interface file first or in the same change;
- update [`contracts-reference.md`](./contracts-reference.md) if the runtime
  contract map or expectations changed;
- update [`bond-lifecycle-walkthrough.md`](./bond-lifecycle-walkthrough.md) if
  the operational lifecycle changed;
- update [`services/nb-bond-api/DEVELOPMENT.md`](../../services/nb-bond-api/DEVELOPMENT.md)
  if the service-assisted integration path changed;
- call out breaking changes explicitly in the PR or release notes.
