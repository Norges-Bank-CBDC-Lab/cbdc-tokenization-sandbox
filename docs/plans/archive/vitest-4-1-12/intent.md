# Vitest 4.1.12 security bump — Intent

**Status:** Approved (2026-10-22)
**Created:** 2026-10-22
**Requested by:** sandbox operator

## Outcome

`npm audit` reports no vulnerabilities again, because nb-ui's test runner moves from vitest
4.1.11 to 4.1.12, the first release patched for both advisories published on 2026-10-21.

## Why This Change

`npm audit` flags `@vitest/mocker` 4.1.11, which vitest pins exactly:

| Advisory | Severity | Affected | Fixed |
|---|---|---|---|
| GHSA-qxg6-89mg-rqv8: code injection via unauthenticated manual mock registration | moderate | `>=2.1.0-beta.7 <4.1.12` | 4.1.12 |
| GHSA-xp26-3454-mjgp: Windows backslash traversal bypasses the mocker redirect allowlist fix | moderate | `>=4.1.11 <4.1.12` | 4.1.12 |

Both affect only the nb-ui test tooling (dev). GitHub had not raised Dependabot alerts for them
when this change was made.

## Scope

### In Scope

- `vitest` 4.1.11 → 4.1.12 in `services/nb-ui/package.json` (exact pin).
- `package-lock.json`: `vitest`, its seven exact-pinned `@vitest/*` packages, and the nb-ui
  workspace range. Nothing else.
- `THIRD_PARTY_LICENSES.md`: one row.

### Out of Scope

- Vitest 5 (5.0.5 is the current major). It is a major upgrade with its own risk; a later bot PR
  or rollup.
- The Node pin (#313, open separately).

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| `npm audit` reports 0 | Advisories not actually cleared | command output |
| Lockfile diff is exactly vitest, the seven `@vitest/*` entries, and the workspace range | Incidental churn | structural diff |
| nb-ui and nb-bond-api gates pass with baseline test counts | Test-runner regression; both workflows watch the root lockfile | package gates |
| The licence check passes | Inventory drift | script output |

## Constraints

- No new dependency; vitest and the `@vitest/*` packages are MIT.
- One PR against `development`. Public-repo rules apply.
