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

#### Version-upgrade guardrails (from the local v10 → v11 upgrade)

Findings from moving the local sandbox to backend `v11.2.1` / frontend
`v2.9.0` / chart `4.5.1` that a non-local Blockscout deployment inherits:

- **No public upstream images exist for Blockscout v10+.** Upstream stopped
  publishing release-tagged images (`ghcr.io/blockscout/blockscout` ends at
  the v9.0.2 era, `ghcr.io/blockscout/frontend` at v2.3.5, Docker Hub in
  April 2025), and previously pullable tags were removed. The deployment
  repo must build the backend + frontend images from the upstream release
  tags itself (amd64 for AKS — the local build produces arm64) and host
  them in its own registry. `services/blockscout/build-images.sh` shows the
  exact clone + `docker build` recipe, including the build args each image
  needs. Re-check upstream before doing this; if a release channel is
  restored, pulling is preferable.
- **The v11 migration stepping stone applies to persistent databases.** The
  local sandbox installs Blockscout greenfield on every restart, so
  upstream's rule "v11.0.0 must be installed on top of v10.1" never bites
  here. A deployment with a persistent Blockscout database must either step
  `v10.0.8 → v10.1.1 → v11.2.x` (migrations complete at each hop) or drop
  the database and re-index from the chain.
- **Re-indexing needs the catchup indexer.** The local env sets
  `DISABLE_CATCHUP_INDEXER: "true"` (realtime-only). If the deployment
  reuses these env values and ever starts from an empty database against a
  chain with history, nothing backfills old blocks. Enable catchup for any
  re-index and budget for the extra RPC load on the node.
- **v11 defaults database SSL to `require`.** `ECTO_USE_SSL` is deprecated
  in favour of `ECTO_SSL_MODE` (v11.1.0+; values `disable`/`allow`/`prefer`/
  `require`/`verify-ca`/`verify-full`; resolution: `ECTO_SSL_MODE` →
  `sslmode` in `DATABASE_URL` → default `require`). The local sandbox must
  set `disable` for its plain-TCP Postgres — omitting it crash-loops
  migrations with `Postgrex.Error: ssl not available`. A deployment on TLS'd
  managed Postgres should set the mode explicitly (`require` at minimum,
  `verify-full` where the CA chain is provisioned) rather than inheriting
  defaults through an env-file copied from this repo.
- **Frontend and backend versions are coupled.** Frontend v2.9.0 requires
  backend API ≥ v11.2.0 and BENS ≥ v1.7.1. Roll backend and frontend
  together; frontend-first (or backend-only) rollouts have an unsupported
  intermediate state.
- **BENS expectations moved.** If the deployment runs the real BENS
  microservice, frontend v2.9.0's minimum is v1.7.1. If it mirrors this
  repo's local BENS stub, revalidate the stub (and the chain-id URL-rewrite
  in `services/blockscout/templates/httproute.yaml`) against the new
  frontend before promoting.

### Gateway and routes

`infra/gateway/` is shaped around `*.cbdc-sandbox.local` hostnames and
the Kind-specific NodePort + extraPortMappings model. A real cloud
ingress has its own Gateway/Ingress controller and its own hostnames.
Treat the local listener + route shape as a *reference* (what hostnames
exist, what ports they need, which sectionName each `HTTPRoute`
attaches to) rather than as a deployable input.

### Besu

`infra/besu/` ships a single-node Clique PoA Besu for the local
sandbox. If Azure runs a Besu node in cloud, expect to fork or wrap
this chart with Azure-specific storage classes, exposure (likely behind
Application Gateway, not a NodePort), and network policy.

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
