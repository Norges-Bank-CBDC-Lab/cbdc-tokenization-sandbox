# React lint plugin swap — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Evidence and prototype | Done (2026-11-03) | Scratch resolves and a throwaway prototype confirmed the target state; findings are in the design |
| 0 Approval | Pending | The operator deferred implementation (2026-11-03). The new dependency set and ESLint 10 for nb-ui still need explicit approval before Phase 1 |
| 1 Manifests and lockfile | Not started | |
| 2 Lint configuration | Not started | |
| 3 Proof | Not started | |
| 4 Docs and PR | Not started | |

## Deviations From Plan

None yet.

## Verified Claims

See the design's evidence table. Everything marked "by prototype" came from a throwaway checkout
that was discarded; it was not committed.

## Follow-ups

- Adopt the four advisory rules (design, Follow-ups).

## Session Handoff

Plan drafted and stored; implementation deferred by the operator. The `minimatch` and `deepmerge`
Dependabot alerts were dismissed on 2026-11-03 as tolerable dev-only risks (neither copy is in a
built runtime image; `deepmerge` has no upstream fix). When this plan is picked up, start at
Phase 0, re-run the scratch resolve against the then-current `development`, and re-check the
versions in the design against the registry.
