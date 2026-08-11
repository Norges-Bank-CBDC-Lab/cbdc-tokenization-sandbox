# Azure / ArgoCD Boundary

This repository is the **local sandbox** for the CBDC tokenization
prototype. It is tuned for a developer running `./sandbox.sh start` on a
single machine. A separate deployment repository owns the cloud /
ArgoCD deployment story.

This document captures **what this repo's artifacts can and cannot
reasonably be reused from a non-local deployment context**, so that
changes here don't silently break the cloud surface and changes there
don't get tangled with local sandbox concerns.

## TL;DR

| Artifact | Reusable from ArgoCD? | Notes |
|---|---|---|
| `services/nb-ui/helm/` chart | Yes, with env-supplied values | Operator-supplied `image`, runtime config, hostnames, auth values, ingress/gateway differences. The chart's `image` is `required`; no default. |
| `services/nb-bond-api/helm/` chart | Yes, with env-supplied values | Operator-supplied `image`, real secrets, `RPC_URL`, `GLOBAL_REGISTRY_ADDRESS`, CORS/auth/network config, persistence decisions, probe/security policy. |
| `infra/besu/` chart | Only if Azure actually deploys Besu from this chart | Needs Azure-specific storage, exposure, network policy values. |
| `services/blockscout/` chart wrapper | **Not directly.** | This repo *composes* the upstream Blockscout-stack chart at start time by `helm pull` + copying template files into the unpacked chart. That's a local-build-time pattern, not an ArgoCD-friendly contract. If Azure deploys Blockscout, prefer a stable wrapping chart or Kustomize overlay there rather than reproducing the local compose step. |
| `infra/gateway/` chart | Local-shape only | Hostnames, NodePort wiring, and `*.cbdc-sandbox.local` listeners are all local-specific. Use it as a reference for the listener/route shape, not as a deployable chart for Azure. |
| `sandbox.sh`, `infra/infra.sh` | No | Local lifecycle scripts only. Not for ArgoCD consumption. |
| Local fixture generation (`scripts/generate-local-sandbox-fixtures.mjs`) | No | Produces public-safe fixture keys for local development; never use the keys it generates in any non-local context. |
| `/etc/hosts` behavior | No | Local-only convenience. |
| `localhost:5001/...` image refs | No | Local Kind-registry convention. Non-local environments supply their own image registry refs. |

## Charts that are intended as reusable inputs

`services/nb-ui/helm/` and `services/nb-bond-api/helm/` are deliberately
shaped so that a non-local environment can install them by supplying
its own values:

- The container image is `required`. No default. The local sandbox sets
  it to `localhost:5001/<service>:<content-hash>`; ArgoCD would set it
  to whatever container registry that environment uses (e.g.
  `<acr>.azurecr.io/<service>:<digest>`).
- Hostnames are env-driven (`rootDnsZone` for `nb-ui`; nb-bond-api's
  `HTTPRoute` references the same convention).
- Secrets are env-driven. The local values examples have `<placeholder>`
  rows that are obviously not real keys; ArgoCD supplies real key
  material from Key Vault or equivalent.
- Hardening defaults (`podSecurityContext`, `securityContext`, probes)
  are surfaced as overridable values in `values.local.example.yaml`.
  ArgoCD can tighten further (e.g. `readOnlyRootFilesystem: true` is
  already on for `nb-ui`; for `nb-bond-api` it is intentionally not on
  in this repo and a non-local deployment may want to enable it with
  appropriate writable tmp/cache mounts).
- CORS and auth: nb-bond-api defaults `CORS_ALLOWED_ORIGINS` to the
  local frontend origin and ships unauthenticated. ArgoCD supplies the
  real origin list, the real OIDC/Entra config (via nb-ui's runtime
  `config.js`), and whatever validating proxy fronts nb-bond-api. The
  charts do not embed any of this. Role-based access (entra mode) adds
  `AUTH_OPERATOR_ROLES` / `AUTH_TESTER_ROLES` (nb-ui) and
  `NB_BOND_API_AUTH_ENTRA_OPERATOR_ROLES` / `..._TESTER_ROLES`
  (nb-bond-api), which must match the Entra App Role values. Defining the
  App Roles and assigning groups to them is a deployment-repo / Entra-portal
  responsibility, not this repo's.

## Authenticated SSE deployment contract

The UI's live-update transport is `GET /v1/events`. It uses browser `fetch`
rather than native `EventSource` so it can attach the Entra access token. The
API validates that token and requires a recognised operator or tester App
Role before opening the stream. The stream payload contains resource keys
only; subsequent GET endpoints retain their existing authorization.

The Azure deployment repository must explicitly verify and configure all of
the following:

- Keep nb-ui `AUTH_MODE=entra` and nb-bond-api
  `NB_BOND_API_AUTH_MODE=entra`, tenant, audience, scopes, and role values in
  sync. The gateway must forward the `Authorization` header unchanged.
- Disable response buffering for `/v1/events`. `X-Accel-Buffering: no` is a
  useful response hint, but it cannot override every Application Gateway,
  ingress, proxy, or WAF configuration.
- Set the backend request/idle timeout comfortably above
  `NB_BOND_API_SSE_HEARTBEAT_MS` (default 15 seconds), and confirm heartbeat
  bytes arrive incrementally rather than in batches.
- Keep nb-bond-api at one replica for this sandbox implementation. The
  broadcaster is process-local; multiple replicas would give each subscriber
  only the events observed by its selected pod unless shared fan-out or sticky
  routing is added deliberately.
- Do not log or inspect the streaming response body. Normal access metadata
  is sufficient and avoids noisy, long-lived log records.
- Bound concurrent connections at the Azure edge. The API's request-rate
  limiter covers reconnect attempts but does not cap sockets that remain
  open.
- Verify `401` without a token, `403` with no recognised role, successful
  incremental streaming for a recognised user, token reacquisition on
  reconnect, and stream abort on sign-out.

`LIVE_UPDATES=false` in nb-ui runtime config is the deployment-safe fallback:
it disables the stream while leaving manual refresh and the independent
health poll available.

## Charts that are local-shape and need new wrappers for cloud

### Blockscout

`common/helpers.sh:composeBlockscoutChart` is a local convenience that
runs `helm pull blockscout/blockscout-stack` and copies our extra
templates (HTTPRoute, BENS deployment) into the unpacked upstream
chart. That makes local deploys easy at the cost of being dependent on
chart-fetch network behavior at deploy time.

For an ArgoCD-deployed Blockscout, prefer one of:

- A stable wrapping chart in the deployment repo that pins the upstream
  Blockscout-stack version as a dependency and adds the gateway and
  BENS resources as ordinary templates, or
- A Kustomize overlay over a vendored copy of the upstream Blockscout
  manifests at the pinned tag.

Either way, the deployment repo owns the choice. This repo's
`composeBlockscoutChart` is not a stable input contract.

### Gateway and routes

`infra/gateway/` is shaped around `*.cbdc-sandbox.local` hostnames and
the Kind-specific NodePort + extraPortMappings model. A real cloud
ingress has its own Gateway/Ingress controller and its own hostnames.
Treat the local listener + route shape as a *reference* (what hostnames
exist, what ports they need, which sectionName each `HTTPRoute`
attaches to) rather than as a deployable input.

### Besu

`infra/besu/` ships one QBFT validator and one Forest archive/RPC node for the
local sandbox. It is intentionally not a production-resilient validator set.
If Azure runs Besu in cloud, expect to fork or wrap
this chart with Azure-specific storage classes, exposure (likely behind
Application Gateway, not a NodePort), and network policy.

The role split is a reusable architectural constraint even though the local
chart is not a production template:

- application, indexing, tracing, and deployment traffic belongs on dedicated
  non-validator RPC/archive capacity, not on validator RPC;
- every validator needs its own key, persistent volume, Kubernetes identity,
  and advertised P2P address;
- one validator provides no Byzantine fault tolerance; meaningful QBFT fault
  tolerance starts with four independently operated validators;
- peer discovery/bootnodes and validator membership are separate concerns and
  must be designed explicitly for the target network; and
- a beacon client is not part of a Besu QBFT topology.

Any non-local genesis, validator set, chain-identity migration, backup/restore
policy, archive retention policy, and RPC authentication/rate limiting belong
to the deployment repository. Do not copy the local fixture keys, static peer
identities, zero-fee policy, or destructive-reset workflow into cloud.

The genesis under `infra/besu/config/` includes a predeployed
`GlobalRegistry` at a stable local address. A non-local deployment may
or may not want that; the address has no meaning outside the local
fixture set.

## Components that are local-only and must not bleed into cloud

These exist for developer convenience and must not be reused or relied
on by ArgoCD:

- `sandbox.sh`, `infra/infra.sh`, and every per-service `<svc>.sh start`
  script.
- `Makefile` targets.
- `scripts/generate-local-sandbox-fixtures.mjs` and every key it
  generates. The keys are deterministic local fixtures and are
  documented as local-only.
- `services/nb-bond-api/helm/values.local.yaml` (gitignored) and the
  fixture-driven secret block in
  `services/nb-bond-api/helm/values.local.example.yaml`.
- `/etc/hosts` modifications and the `*.cbdc-sandbox.local` convention.
- The `localhost:5001/...` image refs and the kind-registry
  containerd-certs.d wiring.
- Local-only env defaults (e.g. `CORS_ALLOWED_ORIGINS=http://web.cbdc-sandbox.local`).

## The clean rule

Local scripts can be opinionated and convenient; chart values must stay
explicit and environment-owned. If a chart silently bakes in a
local-specific assumption (a hardcoded hostname, a `localhost:5001` ref,
a local fixture key, a value that only makes sense behind the local
gateway), that's a portability bug — surface it as a value with a
sensible local default, not as an embedded constant.

If you add a new chart-side value to support cloud usage, list it under
"Portability Flags" in the relevant per-service docs (see
`services/nb-ui/DEVELOPMENT.md` for the existing list) so reviewers
know which knobs the deployment repo is expected to set.

## See also

- `services/nb-ui/DEVELOPMENT.md` — Portability Flags section for the
  frontend.
- `services/nb-bond-api/DEVELOPMENT.md` §7.3 — Security posture
  (overridable hardening defaults).
- `docs/ARCHITECTURE.md` — Trust boundaries and the local-sandbox
  scope statement.
- `docs/KNOWN_ISSUES.md` — known follow-ups, including the open
  `nb-ui: reopenAuction` and operator-selectable winners items, both
  of which the deployment repo will want a decision on.
