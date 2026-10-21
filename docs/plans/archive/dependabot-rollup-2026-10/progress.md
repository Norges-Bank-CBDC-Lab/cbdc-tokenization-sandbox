# Dependabot and security rollup (October 2026) — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Pre-flight | Done (2026-10-21) | Scratch resolve plus transplant of the target state: strict `npm ci` passed, `npm audit` reported 0, override audit clean, prettier 3.9.10 reported no changes in either workspace |
| 1 Manifests and lockfile | Done (2026-10-21) | Fresh scratch resolve was identical to the pre-flight; 35 entries transplanted (one added, none removed), `undici` constructed; the structural diff equals the design's 42-line table |
| 2 Tool consequences | Done (2026-10-21) | All gates green; test counts equal the baseline; build growth explained below |
| 3 PR and cleanup | In progress | Folder archived in the change commit; merge and bot follow-up pending |

## Deviations From Plan

None.

## Verified Claims

- Baseline on the unchanged tree: nb-bond-api 39 suites / 293 tests; nb-ui 27 files / 139 tests.
  After the change: identical counts, all passing.
- `npm ci` (npm 11.14.1) succeeds and `npm audit` finds 0 vulnerabilities, down from 16
  (14 high, 2 moderate) on `development`.
- Override audit: `ws` 8.21.0, `undici` 8.10.2, `js-yaml` 4.3.2, `qs` 6.16.0 at every lockfile
  path; all three `minimatch@3.1.5` copies resolve `brace-expansion` 1.1.21, `minimatch@10.2.5`
  resolves 5.0.12, and the unpinned `minimatch@9.0.9` resolves 2.1.7.
- The `--legacy-peer-deps` resolve again removed nine entries (`@testing-library/dom` and its
  subtree, `typescript` 6.0.3). They are resolve artefacts and were not transplanted.
- nb-bond-api: lint, `format:check`, jest, and `tsc` build pass. nb-ui: `format:check`, lint,
  vitest, and the Vite build pass. The licence, Node-version, hygiene, and link checks pass.
- nb-ui production build: the main chunk grew from 340.9 kB to 370.1 kB (gzip 97.9 kB to
  106.7 kB). This comes from upstream React: `react-dom-client.production.js` is 536 KB in 19.2.8
  and 625 KB in 19.3.1, and react-dom makes up nearly all of the chunk's vendor source. The vendor
  chunk and CSS are unchanged in size.
- Local gates ran on Node 25.8.0. CI runs the pinned 26.5.0 and is authoritative.

## Follow-ups

- Later bot PRs are expected for `vite` 8.3.x and `undici` 8.11/8.12. Batch them into the next
  rollup.
- Pre-existing and untouched by this change: `npm ls` reports `@noble/hashes` 1.3.2 (hoisted for
  `ethers`) as invalid against the optional peer range `^1.8.0 || ^2.0.0` of jsdom's
  `@exodus/bytes`. It is optional and causes no failures; it is recorded here only.

## Session Handoff

Change committed on `feature/dependabot-rollup-2026-10`. Next: operator review, push, PR
against `development`, merge on go-ahead, then confirm zero open alerts and #295–#299 closed.
