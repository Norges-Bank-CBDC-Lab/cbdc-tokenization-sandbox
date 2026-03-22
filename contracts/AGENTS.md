## Contracts Agent Guide

Inherits the root `AGENTS.md`. This file adds Foundry- and Solidity-specific guidance.

### Commands
- Build: `forge build`
- Tests: `forge test`
- Format: `forge fmt`
- Static analysis: `./slither.sh` (if configured)

### Commands (detail)
- Config: `contracts/foundry.toml`
- Env: copy `contracts/.env.example` to `contracts/.env` before direct runs
- Lint config: `contracts/slither.config.json`
- Common entrypoints:
  - `contracts/src/`: production contracts
  - `contracts/test/`: Foundry tests
  - `contracts/script/`: deployment and setup scripts

### Configuration
- Foundry config: `contracts/foundry.toml`
- Env: `contracts/.env` (local-only; create from `contracts/.env.example`)

### Linting and warnings (Solidity)
- If a warning is about micro-optimization (e.g., asm keccak), prefer suppressing with
  `// forge-lint: disable-next-line(<rule>)` rather than rewriting.
- Keep suppressions as narrow as possible (single-line or local block).

### Testing expectations
- After Solidity changes, run `forge build` at minimum.
- If behavior changes, run targeted tests or `forge test` if feasible.

### Solidity style preferences
- Use named struct initialization where it improves clarity.
- Use explicit checks and early reverts for readability.
- Maintain public API signatures unless instructed.
- Prefer code as documentation: use descriptive names, cohesive functions, and
  predictable control flow before adding comments.
- Use comments and NatSpec for intent, invariants, units or precision, and
  non-obvious trade-offs; do not narrate obvious code.
- Prefer readability over micro-optimizations.

### Solidity architecture guidance
- Prefer concrete contracts by default.
- Add interfaces only at real boundaries: cross-contract calls, external
  integrations, or multiple implementations.
- Add abstract contracts only when they enforce shared behavior or storage
  across multiple inheritors.
- Prefer libraries for stateless reusable logic.
- If an abstraction has one consumer and no boundary value, do not add it.
- Keep orchestrator contracts narrow. Do not expand manager contracts with
  unrelated workflows when a dedicated module is clearer.
- Keep file layout predictable: types, constants, immutables, storage,
  modifiers, constructor, external or public API, then internal or private
  helpers.

### Solidity best practices and patterns
- Favor explicit `require`/custom errors over implicit failure paths.
- Validate inputs early, then perform state changes, then external calls.
- Use `nonReentrant` where reentrancy risk exists; otherwise keep functions simple.
- Prefer `immutable` for constructor-set references and `constant` for fixed values.
- Use custom errors (cheaper and clearer than revert strings).
- Emit events for state-changing actions that matter off-chain.
- Avoid shadowing and ambiguous names; keep parameter names descriptive.
- Use `view`/`pure` when possible; avoid unnecessary `payable`.

### Upgradeability
- Keep storage layout stable when touching upgradeable contracts.
- Do not introduce proxy or upgradeable patterns without a clear project need.

### Common patterns in this repo
- Allowlist checks before sensitive transfers.
- Role-gated admin actions (AccessControl).
- Use of `try/catch` to map low-level errors to domain errors.

### Solidity safety checklist
- Check for zero addresses in constructors and setters.
- Validate array lengths and byte sizes before casting.
- Guard against partial settlement paths in DvP flows.
- Use named struct fields for readability in tests and scripts.
