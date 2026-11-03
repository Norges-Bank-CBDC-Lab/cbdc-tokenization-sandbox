# React lint plugin swap — Implementation Plan

**Status:** Proposed — implementation deferred by the operator (2026-11-03)
**Created:** 2026-11-03
**Scope:** root `package.json` (overrides), `services/nb-ui/package.json`, `services/nb-ui/eslint.config.mjs`, `services/nb-bond-api/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`, `docs/KNOWN_ISSUES.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/plans/archive/eslint-react-plugin-swap/`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 0  Operator approval of the new dependency set and the ESLint 10 bump
Phase 1  Branch, baseline, manifests and override, scratch resolve, transplant, inventory
Phase 2  Lint configuration change
Phase 3  Proof: strict npm ci, audit, both workspace gates, verification scripts
Phase 4  Docs, archive the plan folder, PR, merge on go-ahead, confirm the alert
```

One PR, one commit (plus a fix-up only if CI disagrees with the local gate).

## Phase 0: Approval

Required before any manifest changes: `@eslint-react/eslint-plugin` 5.28.8 and its 15 new
transitive packages (`@eslint-react/{ast,core,eslint,jsx,shared,var}`,
`eslint-plugin-react-{dom,jsx,naming-convention,rsc,web-api,x}`, `compare-versions`, `string-ts`,
`ts-pattern`), all MIT; and `eslint` 10.4.0 for nb-ui.

Exit: explicit operator approval. Recovery: without approval, stop; the fallback is dismissing the
alert as dev-only.

## Phase 1: Manifests and lockfile

1. Branch `feature/eslint-react-plugin-swap` from `origin/development`, in a separate worktree.
2. Baseline: `npm ci`; record nb-ui lint (zero output), nb-ui 139 tests, nb-bond-api 293 tests, and
   `npm audit`.
3. Edit the manifests and remove the scoped override as in the design's target state.
4. Scratch copy of the manifests and lockfile; resolve with
   `npx -y npm@11.14.1 install --package-lock-only --ignore-scripts --legacy-peer-deps`.
5. Order-normalised whole-entry structural diff. Transplant the 16 new packages, the changed
   `typescript-eslint` and ESLint entries, and the removals that belong to the old plugin and the
   ESLint 9 nested tree. Leave out the `--legacy-peer-deps` artefacts (the `@testing-library/dom`
   subtree and similar). Confirm the JSON round-trip of the tracked lockfile is byte-identical first.
6. Override audit; inventory rows (remove `eslint-plugin-react`; add the new plugin; update
   `eslint`, `@eslint/js`, `typescript-eslint`).

Exit: lockfile diff matches the classified table; zero nested `@typescript-eslint` duplicates.

Recovery: anything outside the table is classified before transplanting. Never fall back to an
in-place full install.

## Phase 2: Lint configuration

1. In `services/nb-ui/eslint.config.mjs`, replace the `eslint-plugin-react` import and its
   `recommended` rules with the new plugin's `recommended` preset scoped to `**/*.{js,jsx}`.
2. Keep `react-hooks` rules; switch off the thirteen new-plugin rules named in the design.
3. Run lint on ESLint 10; expect zero output.

Exit: `npm run lint` and `npm run format:check` clean in nb-ui.

Recovery: any new warning is either a real finding (fix it narrowly) or a rule to switch off with a
reason; never raise the warning count.

## Phase 3: Proof

1. Strict `npm ci` with npm 11.14.1; `npm ls minimatch glob` shows one copy each; `npm audit`
   shows 5 low findings.
2. nb-bond-api: lint, `format:check`, `npm test` (293), `npm run build`.
3. nb-ui: `format:check`, lint, `npm test` (139), `npm run build`.
4. A probe file with a genuinely unused import is still flagged (then removed).
5. `check-third-party-licenses.py`, `check-node-version-consistency.py`,
   `check-public-repo-hygiene.py`, `check-markdown-links.py`.

Exit: all green, counts equal the baseline.

## Phase 4: Docs and PR

1. Update the `docs/KNOWN_ISSUES.md` entry that describes the hold; archive this folder under
   `docs/plans/archive/` and add the index entry, in the same commit.
2. Push and open a PR against `development` with the bump table, the classified lockfile diff, the
   lost-rules table, and the audit result. No AI attribution.
3. Merge only on the operator's go-ahead. Then confirm no `minimatch` below 11.0.1 remains in the
   lockfile on `development`. Remove the worktree and branch.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Churn, duplicates, resolve artefacts, held copy remains | classified diff, `npm ls`, strict `npm ci` |
| Security | Held-back copy remains | `npm audit`; lockfile audit after merge |
| Lint (nb-ui) | Noise, lost coverage, JSX-use regression | zero-output lint, unused-import probe |
| Lint (nb-bond-api) | `typescript-eslint` 8.72.1 behaviour change | lint and `format:check` |
| Runtime | None expected (dev tooling only) | nb-ui tests and build; nb-bond-api tests |
| Inventory | Version drift | licence checker |

## Rollback

Revert the commit. The change touches dev tooling only, and nothing in a built image depends on it.

## Done Criteria

- [ ] Approval recorded (Phase 0).
- [ ] Lockfile diff equals the classified table; one `minimatch` and one `glob`.
- [ ] Strict `npm ci`, audit with no moderate findings, both workspace gates, all scripts pass.
- [ ] PR merged on go-ahead; no held-back `minimatch` left on `development`.
