# Dependabot security rollup (September 2026) — Implementation Plan

**Status:** Implemented — shipped via #281; alerts #78–#81 fixed; archived 2026-09-15
**Created:** 2026-09-15
**Scope:** root `package.json` (`overrides`), `services/nb-ui/package.json`, `package-lock.json`, `THIRD_PARTY_LICENSES.md`
**Intent:** [`intent.md`](intent.md) · **Design:** [`design.md`](design.md) · **Progress:** [`progress.md`](progress.md)

## Plan Order

```text
Phase 1  Manifests and lockfile transplant, structural diff, override audit
Phase 2  Gates: npm ci, both package gates, inventory, hygiene
Phase 3  PR, merge, alert check; optional v0.9.1
```

One PR, one commit.

## Phase 1: Manifests and lockfile

### Steps

1. `git show HEAD:package-lock.json > <scratch>/lock.before.json`.
2. Root `package.json`: `overrides.js-yaml` → `4.3.2`. `services/nb-ui/package.json`:
   `devDependencies.vitest` → `4.1.11`.
3. Copy `package.json`, `package-lock.json`, and every workspace `package.json` (same relative
   paths) into `<scratch>/resolve/`; run `npm install --package-lock-only --ignore-scripts`
   there.
4. Transplant into the tracked lockfile only: `node_modules/js-yaml`; `node_modules/vitest`;
   `node_modules/@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}`; the
   `services/nb-ui` workspace entry's `devDependencies.vitest`. Preserve key order and
   formatting (write with the same indentation and trailing newline).
5. Structural diff: parse before/after, list changed, added, and removed package paths. Expected:
   nine changed, zero added, zero removed. Anything else is a stop-and-decide.
6. Override audit: for each root override key, list every lockfile path ending in
   `node_modules/<name>` and assert the pinned version (scoped `minimatch@…` pins check the
   `brace-expansion` under the matching `minimatch` parent).
7. `THIRD_PARTY_LICENSES.md`: nb-ui `vitest` row → `4.1.11`.

### Verification Stop

- Structural diff and override audit output pasted into `progress.md`.

### Failure Diagnosis / Fix Forward / Rollback

- Extra changed entries: the patched version needs a sibling lift; include it only if
  `npm ci` fails without it, and record why.
- Override reported at a non-pinned version: the transplant dropped the override effect; re-copy
  the entry from the scratch lockfile.
- Rollback: `git checkout -- package.json package-lock.json services/nb-ui/package.json THIRD_PARTY_LICENSES.md`.

### Exit Criteria

- [ ] Diff limited to the nine entries; every override at its pin.

## Phase 2: Gates

1. `npm ci` at the repo root.
2. `cd services/nb-ui && npm run format:check && npm run lint && npm test && npm run build`.
3. `cd services/nb-bond-api && npm run lint && npm run format:check && npm test && npm run build`.
4. `python3 scripts/verification/check-third-party-licenses.py`,
   `check-public-repo-hygiene.py`, `check-markdown-links.py`,
   `check-node-version-consistency.py` (the lockfile is in its path filter).

### Exit Criteria

- [ ] All gates green; nb-ui test count unchanged (125).

## Phase 3: PR and alert check

1. Commit the four files plus this plan folder; PR against `development` titled
   `Security rollup: js-yaml 4.3.2, vitest 4.1.11` with the alert table in the body.
2. After merge: confirm alerts #78–#81 read fixed on GitHub; archive this folder.
3. Optional: `v0.9.1` promotion if the operator wants the release tag alert-free.

## Test Matrix

| Layer | Risk | Evidence |
|---|---|---|
| Lockfile | Incidental churn, un-applied overrides | structural diff, override audit |
| Install | Inconsistent lockfile | `npm ci` |
| nb-ui | Runner behaviour change | vitest suite on 4.1.11 |
| nb-bond-api | eslint config loader on js-yaml 4.3.2 | lint step |
| Inventory | Version drift | licence checker |

## Done Criteria

- [x] Four alerts fixed; no other lockfile entry changed; gates green; inventory matches.
