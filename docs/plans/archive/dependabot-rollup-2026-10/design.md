# Dependabot and security rollup (October 2026) — Design

**Status:** Approved (2026-10-21)
**Created:** 2026-10-21
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-09-25/` (classified transplant) and
`docs/plans/archive/dependabot-security-rollup-2026-09/` (override audit).

## Decision Summary

Bump each Dependabot package to its newest patch, and pair `react` with `react-dom`. Close each
security alert with the smallest fix on the package's current line: a direct pin for `vite`, a
root override edit for `undici` and both overridden `brace-expansion` copies, and a lockfile-only
refresh for the other transitives. Resolve once in a scratch copy, then transplant only the
classified entries. Construct the `undici` entry by hand, because npm does not re-apply a changed
override. A pre-flight of exactly this procedure on 2026-10-21 passed strict `npm ci`, and
`npm audit` reported zero vulnerabilities.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** All five bot PRs fail only `validate-inventory`, except #298 | PR checks | The inventory rows are the missing edit |
| **Verified.** #298 fails 16 nb-ui suites with React's version-mismatch error (react 19.3.0, react-dom 19.2.8) | #298 CI log | `react-dom` moves with `react`; `react-dom` 19.3.x requires `scheduler ^0.28.0` (lockfile has 0.27.0) |
| **Verified.** Newer patches have shipped since the PRs opened: express-rate-limit 8.7.1, jose 6.2.13, globals 17.13.0, react 19.3.1, prettier 3.9.10 | registry | Taking them lets Dependabot close the PRs instead of retargeting them |
| **Verified.** Upstream notes for those patches: jose 6.2.13 refactors terminology and preserves error causes; react 19.3.1 changes Server Components transport only; prettier 3.9.10 fixes a Markdown table parser; globals 17.13.0 refreshes data | upstream release notes | None changes an API the repo calls |
| **Verified.** `jose` 6.2.13 was published on 2026-10-20, one day before this plan | registry | Shortest soak in the set; see Decisions |
| **Verified.** The ip-address alert is in runtime code, but express-rate-limit only compares IPv6 to IPv6 (`::/96` and `/56`) in `ipKeyGenerator`, and never uses the NAT64 classifier | `express-rate-limit` dist, `services/nb-bond-api/src/app.ts` | Practical exposure is low; it is fixed anyway |
| **Verified.** `vite` 8.2.4 is the first patched release on 8.2.x (8.2.3 was never published) and requires `rolldown ~1.2.4`; the lockfile has 1.2.3 | registry | `rolldown` resolves to 1.2.14 with 15 platform bindings and `@oxc-project/types` 0.154.0 |
| **Verified.** `rolldown` 1.2.14 adds one optional binding, `@rolldown/binding-android-arm-eabi` (MIT, `os: android`, `cpu: arm`) | registry, scratch diff | One new lockfile entry that is never installed on macOS or Linux; see Decisions |
| **Verified.** `undici` is pinned to 8.10.1 in root `overrides`, and an incremental resolve leaves it at 8.10.1 after the pin changes | scratch resolve | Construct the 8.10.2 entry from `npm view undici@8.10.2 dist.tarball dist.integrity` |
| **Verified.** `brace-expansion` 5.0.9 (override `minimatch@10.2.5`) has three advisories fixed in 5.0.12, per `npm audit`; GitHub shows no alert for them | `npm audit` on the current tree and on the scratch tree | Fold in: an override edit plus a lockfile entry |
| **Verified.** prettier 3.9.10 reports no formatting changes in either workspace | `prettier --check .` against current sources | No reformat commit expected |
| **Verified.** The `--legacy-peer-deps` resolve removes nine entries (`@testing-library/dom` and its subtree, `typescript` 6.0.3) | scratch diff | Removals are resolve artefacts and are not transplanted, as in earlier rollups |
| **Verified.** `development` is the default branch | GitHub | Alerts close when the rollup merges; no promotion to `main` needed |

## Target State

Manifests:

- nb-bond-api: `express-rate-limit 8.7.1`, `jose 6.2.13`, `globals 17.13.0`, `prettier 3.9.10`.
- nb-ui: `react 19.3.1`, `react-dom 19.3.1`, `vite 8.2.4`, `globals 17.13.0`, `prettier 3.9.10`.

Root overrides:

- `undici 8.10.2`
- `minimatch@3.1.5` → `brace-expansion 1.1.21`
- `minimatch@10.2.5` → `brace-expansion 5.0.12`

Lockfile, classified (pre-flight result, 42 lines):

| Class | Entries |
|---|---|
| Bumped direct | `express-rate-limit`, `jose`, `globals`, `prettier`, `react`, `react-dom`, `vite`, plus nine exact workspace ranges |
| Required sibling | `scheduler` 0.28.0; `rolldown` 1.2.14; 14 `@rolldown/binding-*` 1.2.3 → 1.2.14, plus `binding-android-arm-eabi` 1.2.14 added; `@oxc-project/types` 0.154.0 |
| Override-pinned | `undici` 8.10.2 (constructed); `brace-expansion` 5.0.12; four `brace-expansion` 1.1.21 copies |
| Transitive security | `ip-address` 10.7.4; `source-map-js` 1.2.2; `glob/node_modules/brace-expansion` 2.1.7 |
| Incidental or artefact | none transplanted |

Inventory: nine rows (`express-rate-limit`, `jose`, `globals` ×2, `prettier` ×2, `react`,
`react-dom`, `vite`). The override and transitive packages have no rows. No change is expected
in `docs/THIRD_PARTY_NOTES.md`: rolldown and its bindings are MIT, and the existing `lightningcss`
note still holds.

## Alternatives Considered

- **Take the bot PRs' exact versions.** Dependabot would retarget four of the five PRs to the
  newer patches at its next run, and those would fail inventory again.
- **`vite` 8.3.5.** It is a minor upgrade on a still-churning line, with no security reason to take
  it now. 8.2.4 is the minimal fix.
- **Hold `rolldown` at 1.2.4 to avoid the new binding.** `vite` allows `~1.2.4`, so any fresh
  resolve lands on the newest 1.2.x. Holding it would need either a new root override or
  hand-built entries for 16 packages. Both diverge from what the next Dependabot run produces.
- **`undici` 8.12.x.** jsdom 30.0.1 only needs `^8.9.0`, and 8.12.0–8.12.3 shipped within the last
  week. 8.10.2 is the minimal patch on the pinned line and has been out for seven weeks.
- **Leave `brace-expansion` 5.0.9 because GitHub has no alert for it.** The advisories exist
  (`npm audit`), and the pin is ours, so an alert would follow shortly.
- **Individual PRs.** Five bot branches would each need a human commit, which stops Dependabot
  from rebasing them, and #298 would still lack `react-dom`.

## Decisions

| Decision | Recommendation | Operator action |
|---|---|---|
| Newest patches rather than the PR versions | Yes, so all five PRs close | Decided at approval (2026-10-21) |
| `jose` 6.2.13 (one day old, refactor-only) or 6.2.12 (seven weeks old) | 6.2.13; the API's token-verification tests are the gate. Choosing 6.2.12 means #296 retargets once more | 6.2.13, decided at approval |
| Accept `rolldown` 1.2.14 with the new optional `@rolldown/binding-android-arm-eabi` entry | Accept: same project, MIT, never installed on supported platforms | Approved (2026-10-21) |
| Fold in the `brace-expansion` 5.0.12 override bump (no GitHub alert yet) | Yes | Decided at approval |
| Live check of nb-bond-api | Optional smoke: deploy locally, read endpoints answer, `RateLimit` headers present | Not wanted |
| Release afterwards | None | Decided at approval |

## Residual Risks

- React 19.3 is a minor release. The nb-ui suite and build are the control; Server Components are
  not used.
- `rolldown` moves eleven patch releases inside `vite`'s range. The nb-ui build and the vitest run
  (which also runs on vite) are the control.
- New advisories can land between approval and merge. Re-run `npm audit` just before pushing.
