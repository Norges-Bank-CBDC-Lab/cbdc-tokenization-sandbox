# Dependabot rollup (17 November 2026) — Design

**Status:** Approved (2026-11-17)
**Created:** 2026-11-17
**Intent:** [`intent.md`](intent.md)
**Builds on:** `docs/plans/archive/dependabot-rollup-2026-11/` (classified transplant).

## Decision Summary

Take the five PR versions, resolve once in a scratch copy, and transplant only the classified
lockfile entries.

## Current-State Evidence

| Finding | Evidence | Consequence |
|---|---|---|
| **Verified.** The five PR versions are the newest releases for their packages | registry | No newer patch to take |
| **Verified.** `@babel/core` 8.1.2 raises its own ranges on `@babel/generator`, `helpers`, `parser`, `template`, `traverse` and `types` to `^8.1.2` | scratch diff | Those entries move with it, as does `helper-string-parser` (8.0.8 to 8.1.2) |
| **Verified.** The lockfile keeps `@vitejs/plugin-react` nested under `services/nb-ui`; a scratch resolve hoists it | scratch diff | The nested entry is updated in place |
| **Verified.** The `--legacy-peer-deps` resolve removes fourteen entries (the `@testing-library/dom` subtree, `typescript` 6.0.3, four `@babel/plugin-syntax-*` peers) | scratch diff | Resolve artefacts; not transplanted |
| **Verified.** `nb-bond-api` uses `createRemoteJWKSet` and `jwtVerify` from `jose` in its `entra` auth mode, with `issuer` and `audience` only | `services/nb-bond-api/src/auth.ts` | The jose fixes (negative `clockTolerance`, `maxTokenAge` and JWKS cache durations rejected; JWE decompression limit; general JWS/JWE options) concern options and paths this code does not use |
| **Verified.** `@vitejs/plugin-react` 6.3.0 only widens optional peer ranges and changes how `reactCompilerPreset` is referenced | release notes | nb-ui does not use the React compiler preset |

## Target State

Manifests: `@babel/core 8.1.2` (root, nb-bond-api), `dotenv 18.0.10` and `jose 6.2.17`
(nb-bond-api), `globals 17.14.0` (nb-bond-api, nb-ui), `@vitejs/plugin-react 6.3.0` (nb-ui).

Lockfile, fifteen entries: the five packages (`@vitejs/plugin-react` as the nested entry), seven
further `@babel/*` entries (`generator`, `helper-string-parser`, `helpers`, `parser`, `template`,
`traverse`, `types`), and the root, `services/nb-bond-api` and `services/nb-ui` entries, written
exact. Root overrides are untouched.

## Rejected Alternatives

- **Merge the bot PRs as they are.** Five lockfile rewrites that conflict with each other.
- **Wait for newer releases.** The registry has none; the youngest target is `@babel/core` 8.1.2.
