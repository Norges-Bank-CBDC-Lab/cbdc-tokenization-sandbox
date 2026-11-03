# React lint plugin swap — Intent

**Status:** Proposed
**Created:** 2026-11-03
**Requested by:** sandbox operator

## Outcome

nb-ui no longer depends on `eslint-plugin-react`. After the change the lockfile holds a single
`minimatch` (11.0.4) and a single `glob` (14.0.3), the reason for dismissing the medium `minimatch`
Dependabot alert (as a tolerable dev-only risk) no longer applies, `npm audit` reports only what
upstream cannot fix, and nb-ui's lint run is as quiet and as strict
as it is today.

## Why This Change

`eslint-plugin-react` 7.37.5 is the latest release and was last published in April 2025. It does
two things that now cost the repo:

- It calls `minimatch()` as a function, which `minimatch` 11 no longer allows. The advisory fix
  therefore had to hold one copy of `minimatch` 3.1.5 back for it with a scoped override. That
  copy is below the patched range, so the Dependabot alert for it cannot close (it was dismissed
  as a tolerable dev-only risk on 2026-11-03), and `npm audit` keeps two moderate findings
  (`minimatch` and `eslint-plugin-react`).
- Its peer range for ESLint ends at ^9.7, so it is what keeps nb-ui on ESLint 9.39.5 while
  nb-bond-api runs ESLint 10.4.0.

The affected code is dev tooling only: no copy is a production dependency, and the built nb-ui
image contains only the static bundle.

## Scope

### In Scope

- Replace `eslint-plugin-react` with `@eslint-react/eslint-plugin` in nb-ui's lint configuration.
- Move nb-ui to ESLint 10.4.0 and `@eslint/js` 10.0.1, matching nb-bond-api. ESLint 10 tracks JSX
  references itself, which replaces `jsx-uses-vars`.
- Move `typescript-eslint` in nb-bond-api from 8.70.1 to 8.72.1, which the new plugin's
  `@typescript-eslint/utils` ^8.72.0 requirement needs to avoid about 90 nested duplicate copies.
- Remove the scoped `eslint-plugin-react` override from root `package.json`.
- Update the licence inventory rows and the Known Issues entry that describes the hold.

### Out of Scope

- Adopting the new plugin's stricter or React 19 modernisation rules (see Follow-ups in the design).
- Replacing ESLint itself or `eslint-plugin-react-hooks`.
- The `deepmerge` advisory, which has no upstream fix.
- Any change to nb-bond-api's lint rules.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| Strict `npm ci` succeeds and the lockfile holds one `minimatch` and one `glob` | Held-back copy remains | `npm ls`, lockfile audit |
| `npm audit` reports no moderate findings | Alert stays open | command output |
| nb-ui and nb-bond-api `lint` and `format:check` report zero warnings and zero errors | Lint becomes noisy or breaks | package gates |
| nb-ui tests (139) and build pass; nb-bond-api tests (293) pass | Toolchain bump regressions | package gates |
| Lockfile diff adds only the 16 packages in the design and no nested duplicates | Duplicate or unreviewed packages | classified structural diff |
| Rules lost in the swap are listed, each with its exposure in current code | Silent loss of coverage | design table |
| No `minimatch` below 11.0.1 remains, so the dismissal of the `minimatch` alert no longer rests on a held-back copy | Dismissal outlives its reason | lockfile audit |

## Constraints

- The new plugin and its 15 new transitive packages are a new dependency set. The operator must
  approve it explicitly before any manifest changes. All 16 are MIT.
- ESLint 10 for nb-ui is a major bump of a dev tool already used in the repo.
- One PR against `development`. Public-repo rules apply.
