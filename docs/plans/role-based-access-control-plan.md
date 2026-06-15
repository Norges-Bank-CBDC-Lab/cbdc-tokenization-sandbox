# `role-based-access-control` — Implementation Plan

**Status:** Approved — implemented on `feature/role-based-access-control`, pending review/merge
**Branch suggestion:** `feature/role-based-access-control` — defer the actual branch / commit / PR / CI-gate workflow to `sandbox-pr-workflow`
**Components touched:** `services/nb-ui/` (auth seam, gate, nav, config, chart), `services/nb-bond-api/` (auth middleware, env-vars, OpenAPI, chart example), `docs/` (ARCHITECTURE, AZURE_BOUNDARY, per-service DEVELOPMENT, DOCUMENTATION_INDEX)

> Mirrors the header block of `docs/plans/archive/nb-ui-frontend-plan.md` and `docs/plans/archive/bidders-and-central-bank-plan.md`. Update `Status:` as the plan progresses (`Draft` → `Approved` → `✅ Implemented and shipped`); when shipped, move this file to `docs/plans/archive/`.

## Goal

Today both the NB UI and the NB Bond API are **all-or-nothing once authenticated**: any user who completes Entra sign-in sees every page (including Central Bank) and the API accepts any valid token on every endpoint (including WNOK mint / burn / allowlist). Now that the service is publicly reachable on Azure behind Entra ID, that is too coarse. This plan adds **role-based access** keyed off Entra **App Roles**, so that:

- **Sandbox-Tester** can use the UI (Bonds, Auctions, Bidders) but **cannot** see or use the Central Bank surface.
- **Sandbox-Operator** has full access including Central Bank.
- **Norges Bank** members are trusted operators with rights equal to Sandbox-Operator.
- A signed-in user with **none** of these roles is shown an "access denied" screen rather than the app, and is rejected by the API.

Access is enforced at **both tiers**: the UI hides what a role cannot use, and the API rejects what a role is not allowed to call — so the boundary cannot be bypassed with a hand-crafted request. The local sandbox (`AUTH_MODE=none`) is **unchanged**: RBAC only activates in `entra` mode.

## Current-State Evidence

- **Docs read:** `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/AZURE_BOUNDARY.md`, `docs/DOCUMENTATION_INDEX.md`, `services/nb-ui/DEVELOPMENT.md`, `services/nb-bond-api/helm/values.local.example.yaml`.
- **Frontend declarations inspected:**
  - Auth seam `services/nb-ui/src/auth/` — `index.js` (resolver), `entraAuth.js` (MSAL Browser `5.13.0`), `noneAuth.js`, `AuthProvider.js` (7-method contract; `AuthAccount` = `{ username, name }` only).
  - `entraAuth.js` acquires tokens via `acquireTokenSilent({ scopes })` and uses only the Bearer header — **no claim is decoded today**; `getAccount()` returns `{ username, name }`.
  - Gate + router `src/App.jsx` (hash router, gate at lines 48–61 is binary: signed-in → full app). Nav `src/components/Layout.jsx:159–162` renders all four tabs unconditionally. CB page `src/pages/CentralBankPage.jsx` calls `CentralBankApi` (mint/burn/transfer/allowlist).
  - Runtime config: `window.__APP_CONFIG__` ← `/config.js` ← chart ConfigMap. Reader `src/config.js`; template `public/config.template.js`; chart `helm/templates/configmap.yaml` + `helm/values.yaml` (`runtimeConfig` block). Existing keys: `AUTH_MODE`, `AUTH_TENANT_ID`, `AUTH_CLIENT_ID`, `AUTH_AUTHORITY`, `AUTH_SCOPES`, `AUTH_REDIRECT_URI`.
  - Test surface: `services/nb-ui/tests/` (Vitest + Testing Library) incl. `authGate.test.jsx`, `entraAuth.test.js`, `CentralBankPage.test.jsx`.
- **Backend declarations inspected:**
  - `services/nb-bond-api/src/auth.ts` — `authMiddleware`; `entra` mode verifies JWT **signature (JWKS) + `iss` + `aud` only**. **No scope/role/group check.** `jose 6.2.3`, Express 5.
  - `src/index.ts` — public routes (`/docs`, `/v1/openapi.json`, `/v1/health`) mounted before `app.use(authMiddleware)` at `index.ts:243`; CB routes at `index.ts:1078–1260` all under `/v1/central-bank/`.
  - `src/env-vars.ts` — `NB_BOND_API_AUTH_MODE` (`none`|`entra`), `NB_BOND_API_AUTH_ENTRA_TENANT_ID`, `NB_BOND_API_AUTH_ENTRA_AUDIENCE`, with a fail-fast block when `entra` config is incomplete.
  - Chart: `helm/templates/configmap.yaml` renders **all** of `.Values.env` generically → new env keys need no template change. `values.local.example.yaml:66–88` documents the env/secret rows.
  - Test surface: `services/nb-bond-api/tests/` (Jest) incl. `central-bank.test.ts`, `env-vars.test.ts`. **No `auth.test.ts` exists yet.**
- **Live local checks (Phase 0 baseline): BLOCKED — local sandbox is down** (Docker daemon not running; `kind get clusters` and `helm list -A` failed; kube context is `kind-cluster-cbdc-monoledger` but unreachable). This does not block the work: validation is unit tests + `helm template`, and RBAC is inert locally (`AUTH_MODE=none`). Re-run live checks after `./sandbox.sh start` if a running-cluster sanity check is wanted.
- **Local validation entry points:** `cd services/nb-ui && npm test`; `cd services/nb-bond-api && npm test`; `helm template` for both charts; `python3 scripts/verification/check-public-repo-hygiene.py` + `check-markdown-links.py`.

## Scope

### In Scope

- A reusable **role → capability** model in both tiers, driven by config (no role-name strings hardcoded in compiled output).
- **nb-ui:** read App Role claims, derive capabilities, hide the Central Bank nav item and guard the `#/central-bank` route for non-operators, and show an access-denied screen for users with no recognized role. New runtime-config knobs `AUTH_OPERATOR_ROLES`, `AUTH_TESTER_ROLES` (chart + template + reader).
- **nb-bond-api:** capture the `roles` claim during JWT validation; a **baseline gate** (any recognized role) on all authenticated endpoints in `entra` mode; an **operator gate** on `/v1/central-bank/*`. New env `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES`, `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES` + fail-fast. OpenAPI `403` documentation on CB ops.
- Unit tests on both tiers; docs + portability-flag updates; `none`-mode regression proof.

### Out Of Scope

- **Entra portal configuration** (defining the App Roles, assigning the Sandbox-Tester / Sandbox-Operator / Norges Bank groups to them) and the **Azure / ArgoCD redeploy** that sets the role env values + `AUTH_MODE=entra`. These live in the deployment repo per `docs/AZURE_BOUNDARY.md`; this plan documents them as prerequisites and provides the local example rows, but does not execute them.
- Making the **Bidders** page operator-only. Testers need it to place test bids, so it stays tester-visible; the baseline gate already keeps non-recognized users out. (If wanted later, it is the same `requireOperator` primitive on `/v1/bidders` + a nav/route guard — noted, not done.)
- Per-action sub-roles inside Central Bank (e.g. separate mint vs burn roles) and audit logging for destructive admin operations. (The `/v1/admin/*` operator-role gate, originally deferred, was added on request — admin is now operator-only.)
- Any change to the local `AUTH_MODE=none` behavior or the local fixture set.

## Role Model And Claim Flow

App Roles are the mechanism; your **security groups** are assigned to them in Entra. The token then carries stable role **strings**, not group GUIDs.

| Entra security group (yours) | Assigned to App Role (value in token) | Capability |
|---|---|---|
| `Sandbox-Operator` | `Sandbox.Operator` | full incl. Central Bank |
| `Norges Bank` | `Sandbox.Operator` | full incl. Central Bank (NB = operator) |
| `Sandbox-Tester` | `Sandbox.Tester` | UI minus Central Bank |
| *(none of the above)* | *(no role claim)* | access denied (UI + API) |

Because "Norges Bank = operator" is just **one more group→role assignment in Entra**, there is **no special-case code** for it — NB members simply arrive with `roles: ["Sandbox.Operator"]`.

Claim flow:

1. Operator defines App Roles `Sandbox.Operator` / `Sandbox.Tester` on the app registration and assigns the three groups (out-of-repo, see Prerequisites).
2. After sign-in, MSAL exposes the role claim on `account.idTokenClaims.roles`; nb-ui reads it (no manual JWT decode needed).
3. nb-ui derives `{ canUseApp, canAccessCentralBank }` from `roles` ∩ configured role lists.
4. On every API call the same access token carries `roles`; nb-bond-api re-derives the decision server-side. **The API is the real boundary; the UI checks are UX.**

The role-value strings (`Sandbox.Operator`, `Sandbox.Tester`) are **not secrets** — they are safe to ship as chart defaults/examples. The **one rule** to keep three places in sync: the Entra App Role *value* must equal the nb-ui `AUTH_*_ROLES` entry must equal the nb-bond-api `..._ROLES` entry.

## Decisions And Open Questions

All blocking choices are resolved (operator-confirmed):

| Decision | Choice | Rationale |
|---|---|---|
| Claim mechanism | **App Roles** (`roles` claim) | Stable strings, no GUIDs in repo, no >200-group overage; "NB = operator" is a pure Entra assignment. |
| Enforcement tier | **UI + API** | A tester cannot bypass the UI via curl/devtools; API is the true boundary. |
| What "Norges Bank" means | **A security group** assigned to the operator role | Zero special-case code. |
| No-recognized-role behavior | **Access-denied screen (UI) + `403` (API)** | Matches "only these groups have access to the web-UI." |
| Baseline API gate | **Include** (any recognized role required on authenticated endpoints in `entra` mode) | Server mirror of the UI lockout; keeps non-recognized tokens off `/v1/bidders` (plaintext sandbox keys) and the rest. |
| Bidders page audience | **Stays tester-visible** | Testers need it; out of scope to restrict now. |

No open questions remain. If any assumption below is wrong, stop and confirm before Phase 1.

## Portability Flags

Local-acceptable now; the deployment repo owns the cloud side. Add these to the nb-ui `DEVELOPMENT.md` Portability Flags list (per `docs/AZURE_BOUNDARY.md` "clean rule"):

- **Role-value strings are config, not constants.** nb-ui reads them from `/config.js`; nb-bond-api from env. The cloud deployment must set `AUTH_OPERATOR_ROLES` / `AUTH_TESTER_ROLES` (nb-ui) and `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` / `..._TESTER_ROLES` (nb-bond-api) to match the Entra App Role values.
- **Frontend reads roles from the ID token** (`idTokenClaims.roles`). This assumes the App Roles surface in the ID token — true when the SPA and API share one app registration (the simplest setup). If the deployment uses a **separate API app registration** and roles land only in the access token, add the documented access-token-decode fallback (a dependency-free base64url decode of the token's payload segment). Flagged, not built.
- **Baseline gate assumes all legitimate API callers carry a recognized role.** A future non-UI consumer (service principal / daemon) would need its own App Role assignment or a path exemption.

## Acceptance Criteria

| Criterion | Why it matters | Verification evidence | Target state |
|---|---|---|---|
| nb-ui policy unit-tested | Core of the gate | `npm test` covers: `none`→full; operator→full; tester→no CB; no-role→denied; both-roles→operator wins | All green |
| nb-ui gate + nav behavior | UX boundary | Tests: no-role account → AccessDenied screen; tester → no CB nav item + `#/central-bank` shows not-authorized panel; operator → CB nav + page render | All green |
| nb-bond-api authz unit-tested | True boundary | `npm test` covers: `none`→pass-through; operator token→CB allowed; tester token→CB `403` + baseline endpoint allowed; no-role token→baseline `403`; missing token→`401` | All green |
| Fail-fast on misconfig | Prevent silent lockout | `env-vars.test.ts`: `entra` mode without operator roles throws at startup | Throws |
| `none`-mode regression | Local sandbox untouched | Full existing suites pass; `none`-mode middleware is a no-op; nb-ui capabilities = full | No behavior change |
| Charts carry the knobs | Cloud-installable | `helm template` nb-ui shows `AUTH_OPERATOR_ROLES`/`AUTH_TESTER_ROLES` in rendered `config.js`; nb-bond-api example documents the new env rows | Present |
| Lint/format/build | CI gates | nb-ui `format-lint-test-build`; nb-bond-api `format-lint-test` pass locally (per `sandbox-pr-workflow`) | Green |
| Docs + hygiene | Maintainability | ARCHITECTURE / AZURE_BOUNDARY / both DEVELOPMENT.md / DOCUMENTATION_INDEX updated; `check-public-repo-hygiene.py` + `check-markdown-links.py` pass | Pass |
| (Out-of-repo, post-deploy) real-world check | Proves end-to-end | In Azure: tester sees no CB nav and gets `403` on a direct CB curl; operator/NB user sees CB and can mint | Confirmed after cutover |

## Assumptions

- Single app registration for SPA + API (roles in both ID and access tokens). If not, apply the access-token-decode portability flag.
- The cloud `nb-bond-api` accepts an access token whose `aud` is its own audience and which carries the `roles` claim (i.e. App Roles are defined on the API's app registration). Standard for Entra App Roles.
- No new npm/Node dependencies are required (MSAL already exposes `idTokenClaims`; backend uses existing `jose`). If any phase appears to need a new dependency, **stop and ask** (per root `AGENTS.md`).
- `none`-mode remains the local default and is never gated.

## Plan Order

```
Phase 0  Baseline                       (record current green tests; note sandbox down; confirm none-mode)
Phase 1  Backend authorization (nb-bond-api)   [code + tests]   ─┐ independent code,
Phase 2  Frontend capability gating (nb-ui)    [code + tests]   ─┘ must ship in lockstep
Phase 3  Chart / config updates + render validation
Phase 4  Local validation (none-mode regression + entra unit evidence)
Phase 5  Docs + public-repo hygiene
Prereq   (Out-of-repo) Entra App Roles + group assignments + cloud cutover  — deployment repo
```

> Phases 1 and 2 touch disjoint files and can be built in either order or in parallel, but they agree on the role-value strings and must be **deployed together** (a tier mismatch produces clear `403`s/lockouts, not silent partial behavior — same contract as the existing `AUTH_MODE` sync rule).

## Phase 0: Baseline Verification

### Goal
Prove the starting state before changing anything.

### Steps
- `cd services/nb-ui && npm ci && npm test` — record the current green baseline.
- `cd services/nb-bond-api && npm ci && npm test` — record the current green baseline.
- Confirm `AUTH_MODE`/`NB_BOND_API_AUTH_MODE` default to `none` in tracked values (`services/nb-ui/helm/values.yaml:38`, `services/nb-bond-api/helm/values.local.example.yaml:76`).
- (Optional, needs a running cluster) `./sandbox.sh start`, then `curl -s http://web.cbdc-sandbox.local/config.js` and `curl -s http://bond-api.cbdc-sandbox.local/v1/health` to confirm the live deployment is `none`-mode.

### Verification Stop
- Both suites green; no uncommitted changes; `none` is the tracked default on both tiers.

### Fix Iteration / Rollback
- If a baseline test is already failing, stop and fix/triage that first — do not build RBAC on a red baseline.

### Exit Criteria
- Recorded green baselines for both packages.

## Phase 1: Backend Authorization (nb-bond-api)

### Goal
Make the API the real boundary: capture `roles`, require a recognized role on authenticated endpoints, require operator on `/v1/central-bank/*`. No change in `none` mode.

### Scope
`services/nb-bond-api/src/env-vars.ts`, `src/auth.ts`, `src/index.ts`, `src/schemas.ts` (OpenAPI), `tests/auth.test.ts` (new), `tests/env-vars.test.ts`.

### Steps
1. **env-vars** (`src/env-vars.ts`): add `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` and `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES` as optional strings (comma-separated; split where consumed, mirroring `CORS_ALLOWED_ORIGINS` at `index.ts:111`). Extend the existing `entra` fail-fast block: `entra` mode requires **operator roles non-empty** (else CB is unreachable). Tester roles optional (document that empty = only operators can use the API).
2. **auth.ts** — capture roles: after `jwtVerify` succeeds, set `res.locals.authRoles = Array.isArray(payload.roles) ? payload.roles : []`. (`jwtVerify` returns `{ payload }`.)
3. **auth.ts** — authorization helpers (SRP, separate from authn): export `requireAnyRole(allowed: string[])` returning Express middleware that calls `next()` when **not in `entra` mode** (no-op, sandbox unchanged) and otherwise `403` (RFC 7807 via `buildProblem(req, 403, 'Forbidden', …)`) unless `res.locals.authRoles` intersects `allowed`. Precompute `operatorRoles` and `recognizedRoles = operatorRoles ∪ testerRoles` from env.
4. **index.ts** — apply gates:
   - Baseline: immediately after `app.use(authMiddleware)` (`index.ts:243`), add `app.use(requireAnyRole(recognizedRoles))`.
   - CB: at the top of the Central Bank region (before `index.ts:1078`), add `app.use('/v1/central-bank', requireAnyRole(operatorRoles))` so all seven CB routes inherit it via one line.
5. **OpenAPI** (`src/schemas.ts`): add a shared `403` problem response to the CB operations and note the operator-role requirement in the `bearerAuth` scheme description. Regenerate `openapi.json` per the existing generation step.

### Verification Stop
- New `tests/auth.test.ts` (mock `jose.jwtVerify` to return chosen `roles`; manipulate `process.env` + `jest.resetModules` like `env-vars.test.ts`):
  - `none` mode → `requireAnyRole` no-ops.
  - `entra` + operator role → CB middleware calls `next()`.
  - `entra` + tester-only → CB middleware `403`; baseline middleware `next()`.
  - `entra` + no recognized role → baseline `403`.
  - missing/invalid token → `401` (existing `authMiddleware`).
- `tests/env-vars.test.ts`: `entra` without operator roles throws.
- `npm test`, `npm run lint`, `npm run build` (or the package's typecheck) green.

### Fix Iteration / Rollback
- All changes are additive and gated on `entra`; revert the four files to restore prior behavior. Nothing touches `none`-mode paths.

### Exit Criteria
- CB endpoints reject non-operator tokens with `403`; baseline rejects no-role tokens; `none` mode unchanged; tests green.

## Phase 2: Frontend Capability Gating (nb-ui)

### Goal
Read roles, derive capabilities, hide/guard Central Bank, and lock out no-role users — all inert in `none` mode.

### Scope
`services/nb-ui/src/config.js`, `public/config.template.js`, `helm/templates/configmap.yaml`, `helm/values.yaml`, `src/auth/AuthProvider.js`, `src/auth/entraAuth.js`, `src/auth/capabilities.js` (new), `src/hooks/useCapabilities.js` (new), `src/App.jsx`, `src/components/Layout.jsx`, `src/components/AccessDeniedPage.jsx` (new), plus tests.

### Steps
1. **Config plumbing:** add `AUTH_OPERATOR_ROLES` and `AUTH_TESTER_ROLES` (comma-separated) to `src/config.js` defaults (empty), `public/config.template.js` placeholders, `helm/values.yaml` `runtimeConfig` (default to `Sandbox.Operator` / `Sandbox.Tester`), and the `helm/templates/configmap.yaml` render block.
2. **Provider contract:** extend `AuthProvider.js` `AuthAccount` typedef with `roles: string[]`. In `entraAuth.js` `setActiveAccount`, set `roles: account.idTokenClaims?.roles ?? []` on `cachedAccount`. `noneAuth.js` stays returning `null` (capability layer treats `none` mode as full access regardless).
3. **Policy module** `src/auth/capabilities.js`: pure function `capabilitiesForAccount(account)` reading `AppConfig.AUTH_MODE` + the two role lists. `none` mode → `{ canUseApp: true, canAccessCentralBank: true }`. `entra` → `isOperator = roles ∩ operatorRoles`; `isTester = roles ∩ testerRoles`; `canUseApp = isOperator || isTester`; `canAccessCentralBank = isOperator`. No React import here.
4. **Hook** `src/hooks/useCapabilities.js`: subscribe to `auth` and return `capabilitiesForAccount(auth.getAccount())` reactively (mirrors the `AuthChrome` subscription pattern).
5. **Gate** (`src/App.jsx`): after the existing signed-in/expired check, compute caps from `authState.account`; if `authMode === 'entra' && !caps.canUseApp` render `<AccessDeniedPage account={authState.account} />`. For the route switch, render `central-bank` only when `caps.canAccessCentralBank`, else a not-authorized panel (reuse `EmptyState` from `ui.jsx`) so the privileged page never mounts. Pass `canAccessCentralBank` into `Layout`.
6. **Nav** (`src/components/Layout.jsx`): render the Central Bank nav item only when `canAccessCentralBank` (prop or `useCapabilities()`).
7. **Access-denied screen** `src/components/AccessDeniedPage.jsx`: mirror `LoginPage.jsx` styling (NB logo, message naming the signed-in account, "ask an operator to add you to Sandbox-Tester or Sandbox-Operator"), with a **Sign out** button so the user can switch accounts.

### Verification Stop
- `tests/capabilities.test.js` (new): `none`→full; operator→full; tester→no CB; no-role→neither; both→operator.
- Extend `tests/authGate.test.jsx`: no-role → AccessDenied; tester → app renders, CB nav absent; operator → CB nav present.
- Extend `tests/entraAuth.test.js`: `getAccount().roles` reflects mocked `idTokenClaims.roles`.
- New nav/route-guard test: as tester, navigating to `#/central-bank` shows the not-authorized panel, not the CB surface.
- `npm test`, `npm run lint`, `npm run build` green. (Per project convention, nb-ui "verify" stops at build/lint/test/grep — no preview/screenshot.)

### Fix Iteration / Rollback
- All gating is `entra`-only via `capabilitiesForAccount`; in `none` mode every component sees full caps. Revert the new files + edits to restore prior behavior.

### Exit Criteria
- CB nav/page gated to operators; no-role users see access-denied; `none` mode shows everything; tests green.

## Phase 3: Chart / Config Updates And Render Validation

### Goal
Prove the new knobs render and the charts stay cloud-installable.

### Steps
- **nb-ui:** confirm `helm/values.yaml` `runtimeConfig` carries `authOperatorRoles` / `authTesterRoles` and `helm/templates/configmap.yaml` emits `AUTH_OPERATOR_ROLES` / `AUTH_TESTER_ROLES` into `config.js`.
- **nb-bond-api:** add documented (commented) `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` / `..._TESTER_ROLES` rows under the `entra` section of `helm/values.local.example.yaml:77`. No template change (the ConfigMap renders `.Values.env` generically).

### Verification Stop
- `helm template nb-ui services/nb-ui/helm --set image=placeholder:0 --set runtimeConfig.authMode=entra --set runtimeConfig.authOperatorRoles=Sandbox.Operator --set runtimeConfig.authTesterRoles=Sandbox.Tester` → rendered `config.js` shows both keys.
- `helm template nb-bond-api services/nb-bond-api/helm --values services/nb-bond-api/helm/values.local.example.yaml --set image=placeholder:0` renders cleanly.
- `diff` old vs new rendered manifests reviewed; no unexpected deletes (classify per `sandbox-stack-verifier`).

### Fix Iteration / Rollback
- Do not apply while any unexplained manifest delta remains.

### Exit Criteria
- Both charts render with the new knobs; diffs are additive and explained.

## Phase 4: Local Validation (none-mode regression + entra evidence)

### Goal
Prove the local sandbox is unaffected and the `entra` paths are exercised by tests (the real Entra login is validated post-cutover, out of repo).

### Steps
- Full `npm test` on both packages (green = `entra` behavior covered by unit tests; `none` paths unchanged).
- (Optional, needs a running cluster) `./sandbox.sh start` and confirm the UI still loads with no sign-in chrome and CB is reachable (because local = `none`). This is a **regression** check, not an RBAC check.
- (Optional) flip `services/nb-ui/public/config.js` to `AUTH_MODE=entra` with dummy tenant/client + role lists per `DEVELOPMENT.md` "try the Entra plugin locally" to eyeball the access-denied screen and nav hiding against a mocked account. Real `login.microsoftonline.com` redirect will fail — expected.

### Verification Stop
- Both suites green; local `none`-mode behavior identical to Phase 0 baseline.

### Fix Iteration / Rollback
- Any `none`-mode regression is a release blocker — fix before proceeding.

### Exit Criteria
- Local sandbox behavior matches the Phase 0 baseline; `entra` logic covered by tests.

## Phase 5: Documentation And Public-Repo Hygiene

### Goal
Leave the repo's docs accurate and public-safe.

### Steps
- `docs/ARCHITECTURE.md`: in "Trust Boundaries" / the NB UI section, note that `entra` mode now enforces role-based access (Sandbox-Tester / Sandbox-Operator; Central Bank operator-only) on both tiers; `none` mode stays fully open.
- `docs/AZURE_BOUNDARY.md`: extend the CORS/auth bullet to mention the role-env knobs the deployment repo must supply, and that the Entra App Role definition + group assignment are deployment-repo responsibilities.
- `services/nb-ui/DEVELOPMENT.md`: document `AUTH_OPERATOR_ROLES` / `AUTH_TESTER_ROLES`, the capability model, the access-denied screen, and add the three Portability Flags above.
- `services/nb-bond-api/DEVELOPMENT.md` §7.7: document the new env vars, the baseline + CB role gates, `401` vs `403`, and the fail-fast.
- `services/nb-bond-api/README.md`: add the two env vars to the environment table.
- `docs/DOCUMENTATION_INDEX.md`: add this plan under the active-plans list (it references no `.claude/` paths, so it is indexed normally).

### Verification Stop
- `python3 scripts/verification/check-public-repo-hygiene.py`
- `python3 scripts/verification/check-markdown-links.py`
- (No dependency/third-party change, so `check-third-party-licenses.py` is not required — confirm `package*.json` are untouched.)

### Fix Iteration / Rollback
- Fix any hygiene/link failure before opening the PR.

### Exit Criteria
- Docs accurate; hygiene + link checks pass.

## Out-of-Repo Prerequisites (deployment repo / Entra portal)

These must be done in the Azure/ArgoCD context **before** the role config takes effect; this repo only ships the mechanism.

1. **Define App Roles** on the app registration backing the API audience (and the SPA, ideally the same registration): value `Sandbox.Operator` and value `Sandbox.Tester`, allowed member types = Users/Groups.
2. **Assign groups to roles** in the Enterprise Application: `Sandbox-Operator` → `Sandbox.Operator`; `Norges Bank` → `Sandbox.Operator`; `Sandbox-Tester` → `Sandbox.Tester`. **Assign at least the deploying admin to the operator role first**, or the first sign-in after cutover hits the access-denied screen.
3. **Set role env** in the cloud values: nb-ui `AUTH_OPERATOR_ROLES=Sandbox.Operator`, `AUTH_TESTER_ROLES=Sandbox.Tester`; nb-bond-api `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES=Sandbox.Operator`, `NB_BOND_API_AUTH_ENTRA_TESTER_ROLES=Sandbox.Tester`. Keep `AUTH_MODE`/`NB_BOND_API_AUTH_MODE=entra` in sync across tiers (existing rule).
4. **Post-cutover check:** a Sandbox-Tester sees no Central Bank nav and gets `403` on `curl …/v1/central-bank`; an operator/NB user sees Central Bank and can mint.

## Documentation And PR Plan

Branch naming (`feature/<kebab>` → `development`), commit/PR style, and CI gates are owned by `sandbox-pr-workflow`.

- **PR 1 (single PR recommended):** backend authz + frontend gating + chart knobs + docs. Frontend and backend must land together to keep the tiers in sync. If a smaller first PR is preferred, split as backend-first (additive, safe in `none` mode) then frontend — but do not flip any cloud `AUTH_MODE` until both are deployed.
- **Docs/runbooks to update:** as Phase 5.
- **Evidence to include in PR body:** both `npm test` runs (incl. the new auth/capability tests), the two `helm template` renders showing the new keys, and `none`-mode regression confirmation. Note the out-of-repo Entra prerequisites so reviewers know the cloud side is gated on them.

## Residual Risks

- **Role/value mismatch across the three places** (Entra App Role value, nb-ui `AUTH_*_ROLES`, nb-bond-api `..._ROLES`) → lockouts or `403`s. Mitigation: the single sync rule in "Role Model," a deploy checklist, and fail-fast on empty operator roles.
- **Roles assigned after cutover** → everyone locked out until assignment propagates. Mitigation: assign the operator role to the admin **before** flipping to `entra`; the access-denied screen tells users exactly what to request.
- **Claim staleness:** removing a user's group/role takes effect on the next token refresh (≈access-token lifetime). Sign-out/in is immediate. Acceptable for this sandbox; documented.
- **Separate API app registration** could mean roles are absent from the ID token → frontend sees no role and denies access. Mitigation: the access-token-decode portability flag; verify roles appear in the ID token during cutover.
- **localStorage token exposure to XSS** is pre-existing (documented in `entraAuth.js`) and unchanged by this work.

## Done Criteria

- Both tiers enforce the role model; CB is operator-only; no-role users are denied at UI and API; `none`-mode local sandbox is unchanged.
- All new + existing tests green; both charts render the new knobs; docs + index updated; hygiene/link checks pass.
- Out-of-repo prerequisites are documented for the deployment repo to execute at cutover.
