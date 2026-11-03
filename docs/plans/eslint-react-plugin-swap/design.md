# React lint plugin swap — Design

**Status:** Proposed
**Created:** 2026-11-03
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/npm-audit-minimatch-glob-2026-11/` (the advisory fix that held
`minimatch` 3.1.5 back for this plugin).

## Decision Summary

Use `@eslint-react/eslint-plugin` for the React rules, keep `eslint-plugin-react-hooks` as the
single owner of hooks rules, and move nb-ui to ESLint 10. Switch off the new plugin's duplicate
hooks rules and four advisory rules so lint output stays at zero warnings. Land it as one PR,
because the pieces depend on each other: ESLint 10 needs the old plugin gone, the old plugin's
`jsx-uses-vars` replacement is ESLint 10 itself, and the `typescript-eslint` bump keeps the
lockfile free of duplicates.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** nb-ui lints 94 files (53 JSX) with `eslint-plugin-react` `recommended` (19 rules active) plus `eslint-plugin-react-hooks` `recommended` (16 rules), with `react-in-jsx-scope` and `prop-types` off. Baseline output is empty. | `eslint --print-config`, `npm run lint` | The bar is zero warnings and zero errors |
| **Verified.** The plugin's peer range for ESLint is `^9.7`, and its latest release is 7.37.5 (April 2025) | registry | It pins nb-ui to ESLint 9 and has no fix coming |
| **Verified.** It calls `minimatch()` as a function; `minimatch` 11 exports an object | prior plan | Source of the held-back `minimatch` 3.1.5 |
| **Verified.** Every `minimatch`, `glob`, `deepmerge`, and related copy is dev-only; the nb-ui image ships only `dist/` and nb-bond-api prunes dev dependencies | lockfile flags, Dockerfiles | Severity is low; the swap is hygiene, not an incident fix |
| **Verified.** `@eslint-react/eslint-plugin` 5.28.8 is MIT, supports any ESLint and TypeScript peer, and declares no `minimatch` or `glob` dependency; it has 7 sibling plugin packages pinned to the same version | registry | Removes the held copy |
| **Verified by prototype.** Replacing only the plugin on ESLint 9 yields 286 `no-unused-vars` warnings, because `<Component />` is no longer counted as a use. The same config on ESLint 10 yields 0 | lint run on both versions | ESLint 10 is part of the change, not optional |
| **Verified by prototype.** A genuinely unused import is still reported under ESLint 10 | probe file | No loss of `no-unused-vars` coverage |
| **Verified by prototype.** The new plugin's `recommended` preset (65 rules) overlaps the hooks rules; its own conflict preset would switch off 12 `react-hooks/*` rules and make nb-ui's three existing `react-hooks` suppression comments dead | preset contents | Keep `react-hooks` as owner; switch off the new plugin's nine duplicates |
| **Verified by prototype.** With `react-hooks` as owner, the new plugin raises 16 warnings and no errors: 7 `no-context-provider`, 5 `no-array-index-key`, 3 `no-use-context`, 1 `naming-convention-context-name` | lint run | React 19 modernisation advice; switch off for now |
| **Verified.** A lockfile-only resolve of the target (swap, ESLint 10, `typescript-eslint` 8.72.1) adds 16 packages, removes 125 entries, leaves one `minimatch` (11.0.4) and one `glob` (14.0.3), and `npm audit` reports 5 low findings (the `deepmerge` and jest chain) | scratch resolve | Matches the acceptance criteria |
| **Verified.** Without the `typescript-eslint` bump the same resolve adds 112 entries, 84 of them nested `@typescript-eslint` duplicates, because the plugin requires `@typescript-eslint/utils` ^8.72.0 and the repo pins 8.70.1 | scratch resolve | The bump is part of the change |
| **Verified.** With all of it in place in a prototype: nb-ui lint and `format:check` clean on ESLint 10.4.0, nb-ui tests 139 and build pass, nb-bond-api lint and `format:check` clean on `typescript-eslint` 8.72.1 | prototype run | The target works end to end |

## Rules Lost In The Swap

| Old rule | Replacement | Exposure in current code |
|---|---|---|
| `jsx-key` | `@eslint-react/no-missing-key` | covered |
| `jsx-no-comment-textnodes`, `no-children-prop`, `no-danger-with-children`, `no-direct-mutation-state`, `no-find-dom-node`, `no-render-return-value` | same-purpose rules in the new plugin | covered |
| `jsx-no-undef` | core `no-undef` | covered |
| `jsx-uses-react`, `jsx-uses-vars` | ESLint 10 JSX reference tracking | covered |
| `no-deprecated` | partly (`dom-no-*`, `no-component-will-*`) | partial |
| `display-name` | none | gap; baseline has none |
| `jsx-no-duplicate-props` | none | gap; baseline has none |
| `jsx-no-target-blank` | none | gap; one `target="_blank"` link, with `rel="noreferrer"` |
| `no-unescaped-entities`, `no-unknown-property` | none | gap; typo-catching, baseline has none |
| `no-is-mounted`, `no-string-refs`, `require-render-return` | none | no class components and no string refs in the code |

Net: eight rules are not replaced. None has a current violation, and the code has no class
components. The main thing given up is typo-catching for unknown DOM properties and duplicate
JSX props, which review and tests catch.

## Target State

- nb-ui `devDependencies`: remove `eslint-plugin-react`; add `@eslint-react/eslint-plugin` 5.28.8;
  `eslint` 10.4.0; `@eslint/js` 10.0.1. nb-bond-api: `typescript-eslint` 8.72.1. All exact pins.
- Root `overrides`: remove the scoped `eslint-plugin-react` entry.
- nb-ui `eslint.config.mjs`: the new plugin's `recommended` preset on `**/*.{js,jsx}`;
  `react-hooks` rules unchanged; thirteen new-plugin rules set to `off` (nine hooks duplicates and
  four advisory rules), with a one-line reason comment each group; the old `react/*` rules removed.
- Lockfile: the 16 new packages, the changed `typescript-eslint` family and ESLint 10 entries, and
  the removals of the old plugin's tree. Resolve artefacts are not transplanted.
- Docs: licence inventory rows, the Known Issues entry, the documentation index.

## Rejected Alternatives

- **Keep the hold-back and dismiss the alert.** Cheapest, and a fair choice for a dev-only package,
  but the plugin is unmaintained and keeps nb-ui on ESLint 9. The swap is the lasting fix.
- **Use the new plugin's own hooks preset.** It would retire three existing suppressions and add
  hook warnings, a behaviour change unrelated to the goal.
- **Replace ESLint with another linter.** A much larger migration across both workspaces, with
  React rule coverage not assessed, for a dev-only alert.
- **Land ESLint 10 and `typescript-eslint` first.** Not possible on their own: the old plugin's
  peer range blocks ESLint 10 for nb-ui.

## Risks

- **A fast-moving dependency.** The new plugin is on 5.28.x and publishes often; an exact pin plus
  its seven siblings moving in lockstep means Dependabot PRs for this one direct dependency.
- **Lost typo-catching** (above). Accepted.
- **Hidden hooks-rule drift.** The nine duplicates are switched off by name; a future preset
  change could add new overlapping rules. Mitigation: lint stays at zero warnings, so any new
  duplicate would show up.

## Follow-ups (not in this change)

- Adopt the four advisory rules by fixing the 16 sites (React 19 `Context` as provider, `use()`
  instead of `useContext`, stable keys), then turn the rules on.
- Review the stricter presets on their own merits.
