# Dependabot rollup (23 November 2026) — Design

**Status:** Approved (2026-11-23)
**Created:** 2026-11-23
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-11-17/` (classified transplant).

## Decision Summary

Take the five PR versions, resolve once in a scratch copy, and transplant only the classified
lockfile entries.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** The five PR versions are the newest releases for their packages | registry | No newer patch to take |
| **Verified.** `typescript-eslint` 8.73.0 keeps the peer range `typescript >=4.8.4 <6.1.0`, which the repository's `typescript` 7.0.2 is outside of, so a strict scratch resolve stops with ERESOLVE | npm resolve | The scratch resolve uses `--legacy-peer-deps`, as the earlier rollups did |
| **Verified.** `vite` 8.3.8 requires `rolldown ~1.2.18`; `rolldown` 1.2.19 pins `@oxc-project/types` 0.156.0, moves its fifteen platform bindings to 1.2.19 and adds a sixteenth optional one, `@rolldown/binding-wasm32-wasi` (cpu `wasm32`, MIT), with three nested `@emnapi/*` entries (MIT, one a `2.0.0-beta.2` pre-release) | scratch diff, Dependabot #391 diff | Four optional lockfile entries are added; they install only on a `wasm32` host. `@napi-rs/wasm-runtime` moves to 1.2.6 because the new binding pins it |
| **Verified.** `vitest` 5.1.1 raises `tinybench` to `^6.2.3`; the lockfile held 6.2.2 | scratch diff | `tinybench` moves to 6.2.4 |
| **Verified.** The nested `ignore` (7.0.6 to 7.0.16) and `semver` (7.8.5 to 7.8.6) entries under `@typescript-eslint/*` are still satisfied by the declared ranges (`^7.0.5`, `^7.7.3`) | scratch diff | Incidental; left out |
| **Verified.** A scratch resolve with no manifest change at all removes the same fourteen entries (the `@testing-library/dom` subtree, `typescript` 6.0.3, four hoisted `@babel/plugin-syntax-*` copies that also exist nested under `jest-snapshot`); the Dependabot PRs carry the same removals | control resolve | Resolve artefacts of the installed npm version, not caused by the five bumps; not transplanted |
| **Verified.** `nb-ui` signs in with `loginRedirect`, `logoutRedirect`, `handleRedirectPromise` and `acquireTokenSilent`; it never uses the popup flow | `services/nb-ui/src/auth/entraAuth.js` | The `@azure/msal-browser` 5.30.0 popup-relay protocol v2 (opt-in) and the deprecation of v1 do not apply. The 5.30.0 patch that stops silent requests for different account tenants sharing one in-flight acquisition is on the path nb-ui uses |
| **Verified.** `nb-bond-api` uses `createRemoteJWKSet` and `jwtVerify` from `jose` in its `entra` auth mode, with `issuer` and `audience` only | `services/nb-bond-api/src/auth.ts` | The `jose` 6.2.18 fixes (JWE compression errors, `alg` required on direct AKP key inputs, JWKS body-read timeouts, mixed-case `ago` suffixes, claim replication headers) concern options and paths this code does not use |
| **Verified.** No published advisory affects the old versions of the five packages or `rolldown` | GitHub advisory database | No security fix to record; `npm audit` is clean before and after |

## Target State

Manifests: `@azure/msal-browser 5.30.0`, `vite 8.3.8`, `vitest 5.1.1` (nb-ui);
`jose 6.2.18`, `typescript-eslint 8.73.0` (nb-bond-api).

Lockfile, 43 entries: 39 changed (the five packages, `@azure/msal-common`, the ten
`@typescript-eslint/*` siblings, `rolldown` with its fifteen bindings, `@oxc-project/types`,
`@napi-rs/wasm-runtime`, `@vitest/mocker`, `@vitest/spy`, `tinybench`, and the
`services/nb-bond-api` and `services/nb-ui` workspace entries, written exact) and 4 added (the
`wasm32` binding and its three nested `@emnapi/*` entries). Root overrides are untouched.

## Rejected Alternatives

- **Merge the bot PRs as they are.** Five lockfile rewrites that conflict with each other.
- **Pin `rolldown` below 1.2.19 to avoid the new optional binding.** It would diverge from what
  the `vite` 8.3.8 range resolves to and from the bot PR; the entries are optional and
  host-conditional.
