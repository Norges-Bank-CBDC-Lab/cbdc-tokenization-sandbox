# `npm audit` minimatch and glob advisories (November 2026) — Design

**Status:** Approved (2026-11-03)
**Created:** 2026-11-03
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-10/` and
`docs/plans/archive/dependabot-rollup-2026-11/` (classified transplant, override audit).

## Decision Summary

Force `minimatch` 11.0.4 and `glob` 14.0.3 through global root overrides, remove the consumers
that cannot run on them, and hold back the one that cannot be moved. A scratch resolve is
transplanted into the tracked lockfile as classified entries only.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** Upstream has not moved: eslint 10.14 needs `minimatch ^10.2.6`, typescript-estree `^10.2.2`, `@jest/reporters` and `jest-config` 30.5.2 `glob ^13.0.6`, `test-exclude` 8.0.0 `glob ^13` | `npm view` | Only `overrides` can reach the patched lines |
| **Verified.** `minimatch` 3.x and 9.x have no backport | registry dist-tags, advisory range `<11.0.1` | Every copy must reach 11.x to clear the audit |
| **Verified.** `minimatch` 11 is ESM-first with a CommonJS build, `engines` `20 || >=22`, and exports an object (`{ minimatch, Minimatch }`), not a function | package metadata, `require` check | Callers of `minimatch(...)` as a function break |
| **Verified.** `test-exclude@6.0.0` does `promisify(require('glob'))`; `glob` 14 exports an object, so loading it throws | scratch `require` | `babel-plugin-istanbul` 7 cannot run on the override |
| **Verified.** `glob@7.2.3` (pulled in by `test-exclude` 6) fails on `minimatch` 11 (`rawGlob.charAt` of undefined) | scratch run | glob 7 has to leave the tree, not be overridden |
| **Verified.** `babel-jest` 30.5.2 depends on `babel-plugin-istanbul ^8.0.0`, which depends on `test-exclude ^7.0.2` (`glob ^10.4.1`, `minimatch ^10.2.2`); `test-exclude` 7 loads and globs correctly on `glob` 14 | registry, scratch run | Bumping `babel-jest` removes the glob 7 chain; jest already runs 30.5.2 internally |
| **Verified.** `eslint-plugin-react` 7.37.5 (nb-ui, the newest release, last published April 2025) calls `minimatch(name, pattern)` in `forbid-component-props`, `no-danger`, `jsx-handler-names`, `jsx-pascal-case`, and `no-unstable-nested-components` | source read | Would throw on `minimatch` 11 once any of those rules is enabled. nb-ui's current lint config does not enable them, so lint stays green and would hide the break |
| **Verified.** `@eslint/eslintrc`, `@eslint/config-array`, `eslint`, and `typescript-estree` use `Minimatch` or `minimatch.minimatch` (named exports) | source read | Safe on 11 |
| **Verified.** `minimatch` 11 (any version from 11.0.1) requires `@isaacs/nonrecursive-glob-match` | `npm view` | One unavoidable new transitive package |
| **Verified.** The `--legacy-peer-deps` resolve removes eight entries (`@testing-library/dom` subtree, `typescript` 6.0.3) | scratch diff | Resolve artefacts, not transplanted |

## Target State

Overrides:

```json
"minimatch": "11.0.4",
"glob": "14.0.3",
"eslint-plugin-react": { "minimatch": { ".": "3.1.5", "brace-expansion": "1.1.21" } }
```

The `ws`, `undici`, `js-yaml`, and `qs` pins stay. The two scoped `brace-expansion` pins go: the
`minimatch@10.2.5` copy no longer exists, and `minimatch` 11 itself requires `brace-expansion`
`^5.0.12`. The `brace-expansion` 1.1.21 floor moves under the `eslint-plugin-react` scope.

Manifests: `babel-jest` 30.5.2 in `services/nb-bond-api`.

Lockfile (1,124 to 904 entries; 5 added, 225 removed, 16 changed):

| Class | Entries |
|---|---|
| Intended | `minimatch` 11.0.4, `glob` 14.0.3, `path-scurry` 3.0.0 (root); new `@isaacs/nonrecursive-glob-match` 1.0.3; `babel-jest` 30.5.2, `babel-plugin-istanbul` 8.0.0, `test-exclude` 7.0.2 (root); the `services/nb-bond-api` workspace entry (exact pin) |
| Sibling alignment | root `@jest/pattern`, `@jest/transform`, `@jest/types`, `babel-plugin-jest-hoist`, `babel-preset-jest`, `jest-haste-map`, `jest-regex-util`, `jest-util`, `jest-worker` to the 30.5.x line; new nested `@jest/types/node_modules/@jest/schemas` |
| Obsolete, removed (222) | nested copies of the 30.5.x packages that now equal the root; the glob 10, `minimatch` 9, `path-scurry` 1, `lru-cache` 10, `jackspeak`, `foreground-child` chain; the glob 7, `inflight`, `fs.realpath`, `minimatch` 3, `brace-expansion` 1 chain of `test-exclude` 6; `walker`, `makeerror`, `tmpl` |
| Moved | nb-ui's `minimatch` 3.1.5, `brace-expansion` 1.1.21, `balanced-match` 1.0.2 move under `eslint-plugin-react/node_modules/` (content identical) |
| Left out | the eight legacy-peer artefacts; `eslint-plugin-react` hoisting to the root and `node-exports-info` 1.6.2 (resolve layout noise, kept at the tracked state) |

## Rejected Alternatives

- **Force `minimatch` 11 everywhere, including `eslint-plugin-react`.** Clears the audit and leaves
  a latent crash behind five rules. Rejected as a false fix.
- **Hold back `test-exclude` 6 and glob 7 as well.** Keeps the whole jest chain flagged although an
  upstream fix (`babel-jest` 30.5.2) exists.
- **Scope `glob` as `glob@>=9` and keep glob 7.** Glob 7 cannot run on `minimatch` 11, and the
  `babel-jest` bump removes it anyway.
- **`npm audit fix`.** Proposes jest 25 and eslint 4.
- **Wait for upstream.** No consumer's range admits the patched lines, so the advisories would
  stay open indefinitely.

## Residual Findings

`npm audit` is expected to report 7 findings: `minimatch` (the 3.1.5 copy under `eslint-plugin-react`)
and `eslint-plugin-react`, both moderate, until `eslint-plugin-react` ships a release that takes
`minimatch` 11; and `deepmerge` GHSA-gcqx-w48m-w2h4 with `jest-config`, `@jest/core`, `jest`, and
`jest-cli` (low), which has no upstream fix. `npm ls` prints `invalid` annotations on the shared
`minimatch` 11 copy because the scoped override leaks through `eslint-plugin-react`'s peer edge to
`eslint` in its display. `npm ci` and a default (peer-aware) `npm install --package-lock-only`
both accept the lockfile unchanged.
