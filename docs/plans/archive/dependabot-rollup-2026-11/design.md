# Dependabot rollup (November 2026) — Design

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-10/` (classified transplant, override audit).

## Decision Summary

Take the four PR versions as they are, resolve once in a scratch copy, and transplant only the
classified lockfile entries. Hold #346. The scratch resolve produced no added entries and no new
platform binding, so nothing in the change needs a separate dependency approval.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** #344, #345, #347, and #348 fail only `validate-inventory` | PR checks | The inventory rows are the missing edit |
| **Verified.** The PR versions are the newest releases for all four packages | registry | No newer patch to take; the bot closes the PRs on merge |
| **Verified.** #346 installs `@babel/preset-env` 8.0.7, which peer-requires `@babel/core ^8`, next to `@babel/core` 7.29.7 | bot branch lockfile | An invalid tree; the pair would need a dual Babel tree. It also rewrites about 23,000 lockfile lines (182 Babel entries against 107 today) |
| **Verified.** `docs/KNOWN_ISSUES.md` records the Babel 8 upgrade as deliberately deferred, with its reasons | repository | Held again; no new reason to revisit |
| **Verified.** `vite` 8.3.5 declares `rolldown ~1.2.14`, `postcss ^8.5.30`, `picomatch ^4.0.7`; the lockfile already has `rolldown` 1.2.14 and `picomatch` 4.0.7 | scratch diff | Only `postcss` (8.5.32) and its `nanoid` (3.3.20) move |
| **Verified.** The bot lockfiles rewrite about 9,500 lines each by re-serialising | bot branch diffs | Not transplanted; the real change is 60 lines |
| **Verified.** The `--legacy-peer-deps` resolve removes eight entries (`@testing-library/dom` and its subtree, `typescript` 6.0.3) and re-orders `body-parser` and `qs` dependency keys | scratch diff | Resolve artefacts and ordering noise; not transplanted |
| **Verified.** `npm audit` reports 32 findings (3 low, 29 moderate) on `development` before any change, all from the `deepmerge`, `glob`, and `minimatch` advisories in dev tooling | `npm audit` | Unchanged by this rollup; tracked separately |

## Target State

Manifests: `vite 8.3.5` and `@testing-library/user-event 14.6.8` in nb-ui; `zod-openapi 6.0.2` in
nb-bond-api; `@noble/secp256k1 3.2.0` in nb-bond-api, bid-encryption, and bid-submitter.

Lockfile, exactly ten entries, 60 changed lines: the four packages, `postcss`, `nanoid`, and the
`services/nb-bond-api`, `services/nb-ui`, `scripts/bid-encryption`, and `scripts/bid-submitter`
workspace entries (exact pins, no carets). Root overrides are untouched.

## Rejected Alternatives

- **Merge the bot PRs as they are.** They fail the inventory check, and each re-serialises the
  whole lockfile.
- **Include #346 with a dual Babel tree.** Larger than the rest of the rollup combined, for a
  dev-only transform, with no concrete motivation.
- **Fold in the `minimatch` and `glob` fixes.** A different class of change (override edits across
  major lines); it deserves its own review.
