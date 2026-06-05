# Enable Blockscout Smart-Contract Verification (ArgoCD / Cloud) — Handoff

> **Audience:** the implementation agent working in the ArgoCD / Azure deployment repo.
> **Purpose:** replicate, in the cloud deployment, the contract-verification fix that was done in the local `cbdc-tokenization-sandbox` (PR #141). This document is self-contained — you do not need the sandbox conversation history.
> **This is a deployment-side change.** No Solidity or backend application code changes are required.

---

## 1. The problem (why verification silently doesn't work)

Modern Blockscout (v6+, and specifically the **v10.x** backend) **does not verify contracts in-process**. It delegates Solidity source compilation and bytecode matching to a **standalone `smart-contract-verifier` microservice**.

If that microservice is **not deployed and wired**, the Blockscout backend still:
- shows the "Verify & publish contract" UI, and
- **accepts** verification submissions over its API (returns `Response: OK` + a `GUID`),

…but it has nothing to actually do the work, so **no contract ever becomes verified**. Tools like `forge verify-contract` will report success on *submission* (especially without `--watch`), making it look like it worked when it didn't.

**Symptom to recognise:** verification "succeeds," but `GET /api/v2/smart-contracts/<addr>` returns only bytecode keys (no `name` / `source_code` / `is_verified: true`), and the legacy `GET /api?module=contract&action=getsourcecode&address=<addr>` returns `ContractName: null`.

---

## 2. What "verification works" requires — three pieces

1. **Deploy** the `smart-contract-verifier` microservice (internal/ClusterIP, port 8050).
2. **Wire** the Blockscout backend to it via three env vars (`MICROSERVICE_SC_VERIFIER_*`).
3. **Verify** by running `forge verify-contract … --verifier blockscout --verifier-url https://<blockscout-host>/api/ --watch`, then confirming `is_verified: true` via the API.

---

## 3. Version compatibility

Pin the verifier to a release compatible with your Blockscout backend.

| Component | Version used / validated |
|---|---|
| Blockscout backend | `ghcr.io/blockscout/blockscout:v10.0.8` |
| smart-contract-verifier | `ghcr.io/blockscout/smart-contract-verifier:v1.10.3` |

If you bump the backend, bump the verifier to the matching `v1.x` line (check Blockscout's `docker-compose` for the pairing they ship). **License: GPL-3.0**, same as the rest of the Blockscout stack — record it in your repo's third-party inventory as you do for the Blockscout backend/frontend.

---

## 4. Deploy the microservice

Choose the mechanism that fits your repo:
- **(a)** If your `blockscout-stack` Helm chart / ArgoCD app exposes a verifier sub-component or a values switch, enable it there and skip to §4.2 for the env config.
- **(b)** Otherwise add a `Deployment` + `Service` (Helm sub-chart / Kustomize / plain manifests). Reference specs below — adapt names, labels, registry, and conventions to your repo.

### 4.1 Reference `Deployment` + `Service`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sc-verifier
  # namespace: <your-blockscout-namespace>
spec:
  replicas: 1
  selector:
    matchLabels: { app: sc-verifier }
  template:
    metadata:
      labels: { app: sc-verifier }
    spec:
      securityContext:
        fsGroup: 1000          # makes the writable compiler-cache volume group-writable
      containers:
        - name: sc-verifier
          # GPL-3.0. Mirror to your own registry (e.g. <acr>.azurecr.io/...) if you
          # don't pull from ghcr directly.
          image: ghcr.io/blockscout/smart-contract-verifier:v1.10.3
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            seccompProfile: { type: RuntimeDefault }
            readOnlyRootFilesystem: true   # only the mounted compiler cache is writable
          ports:
            - { name: http, containerPort: 8050, protocol: TCP }
          env:
            - { name: SMART_CONTRACT_VERIFIER__SERVER__HTTP__ENABLED, value: "true" }
            - { name: SMART_CONTRACT_VERIFIER__SERVER__HTTP__ADDR, value: "0.0.0.0:8050" }
            - { name: SMART_CONTRACT_VERIFIER__SERVER__GRPC__ENABLED, value: "false" }
            - { name: SMART_CONTRACT_VERIFIER__SOLIDITY__ENABLED, value: "true" }
            - { name: SMART_CONTRACT_VERIFIER__SOLIDITY__COMPILERS_DIR, value: "/tmp/solidity-compilers" }
            - { name: SMART_CONTRACT_VERIFIER__SOLIDITY__FETCHER__LIST__LIST_URL, value: "https://binaries.soliditylang.org/linux-amd64/list.json" }
            # Solidity-only (Foundry). Enable these only if you actually need them:
            - { name: SMART_CONTRACT_VERIFIER__VYPER__ENABLED, value: "false" }
            - { name: SMART_CONTRACT_VERIFIER__SOURCIFY__ENABLED, value: "false" }
            - { name: SMART_CONTRACT_VERIFIER__METRICS__ENABLED, value: "false" }
          volumeMounts:
            - { name: compiler-cache, mountPath: /tmp }
          readinessProbe:
            tcpSocket: { port: 8050 }
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            tcpSocket: { port: 8050 }
            initialDelaySeconds: 15
            periodSeconds: 20
          # resources: compilation is CPU/memory-bound. Set requests/limits per your
          # cluster policy, e.g. requests cpu 250m / mem 256Mi, limits cpu 1 / mem 1Gi.
      volumes:
        # Ephemeral cache: solc compilers are re-fetched on pod restart. For a
        # long-lived deployment, consider a small PVC instead (see §6) so the pod
        # doesn't re-download solc every restart.
        - name: compiler-cache
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: sc-verifier
  # namespace: <your-blockscout-namespace>
spec:
  selector: { app: sc-verifier }
  type: ClusterIP            # internal only — do NOT expose via ingress
  ports:
    - { protocol: TCP, port: 80, targetPort: 8050 }
```

### 4.2 Notes that matter in cloud

- **Internal only.** ClusterIP, no ingress/route. Only the Blockscout backend talks to it.
- **Egress.** The verifier downloads solc compilers from `https://binaries.soliditylang.org` on first use. Your egress firewall / `NetworkPolicy` **must allow** that host. (Disabling Sourcify as above also avoids egress to `sourcify.dev`.) For an air-gapped environment, pre-bake the compilers into a PVC or a derived image instead — see §6.
- **Writable filesystem.** The process writes compilers under `COMPILERS_DIR`. Keep `readOnlyRootFilesystem: true` and give it a writable volume mounted at `/tmp` (or wherever `COMPILERS_DIR` points). `fsGroup` keeps that volume writable regardless of the image's runtime user.
- **No secrets.** The verifier is stateless config — nothing sensitive to mount.

---

## 5. Wire the Blockscout backend

Add these to the **Blockscout backend** env (e.g. its Helm values `blockscout.env`, ConfigMap, or however your chart sets backend env), then roll the backend so it picks them up:

```yaml
MICROSERVICE_SC_VERIFIER_ENABLED: "true"
MICROSERVICE_SC_VERIFIER_URL: "http://sc-verifier.<namespace>.svc.cluster.local"   # service from §4 (port 80 → 8050)
MICROSERVICE_SC_VERIFIER_TYPE: "sc_verifier"
```

- `…_URL` is the in-cluster Service DNS of the verifier. If your Service exposes 8050 directly, append `:8050`; with the reference Service (port 80 → 8050) no port is needed.
- `…_TYPE: sc_verifier` selects the standalone microservice (not the `eth_bytecode_db` path).

---

## 6. Cloud decisions to make (call these out in your PR)

| Decision | Local sandbox choice | Recommended for cloud |
|---|---|---|
| Image source | pull `ghcr.io/...` | Mirror to ACR (or your registry) and pin by digest |
| Compiler cache | `emptyDir` (re-fetch on restart) | Small **PVC** mounted at `COMPILERS_DIR` so solc isn't re-downloaded on every restart |
| solc fetch egress | open (local has internet) | Allow `binaries.soliditylang.org` in `NetworkPolicy`; or pre-bake compilers for air-gapped |
| Vyper / Sourcify | disabled (Solidity-only) | Keep disabled unless you verify Vyper or want Sourcify lookups (Sourcify adds external egress) |
| Resources | none set | Set requests/limits (compilation is bursty) |
| License | GPL-3.0, inventoried | Record GPL-3.0 in your third-party inventory |

---

## 7. Validation checklist

1. `kubectl get pods -n <ns> | grep sc-verifier` → `Running 1/1`.
2. `kubectl logs deploy/sc-verifier -n <ns>` → `starting http server on addr 0.0.0.0:8050`, no errors.
3. Backend env shows `MICROSERVICE_SC_VERIFIER_ENABLED/URL/TYPE`.
4. Verify a deployed contract:
   ```bash
   forge verify-contract <addr> <path:Contract> \
     --verifier blockscout \
     --verifier-url https://<blockscout-host>/api/ \
     --rpc-url <chain-rpc> --chain <chain-id> \
     --watch                      # IMPORTANT: --watch polls for the REAL result
   ```
5. Confirm it stuck:
   ```bash
   curl -s https://<blockscout-host>/api/v2/smart-contracts/<addr> | jq '{is_verified, name, language}'
   # expect: { "is_verified": true, "name": "<ContractName>", "language": "solidity" }
   ```
   First verification of a new solc version is slower (it downloads that compiler); subsequent ones reuse the cache.

> **Always use `--watch` (or poll the API).** Without it, a missing/broken verifier looks like success because the backend accepts the submission. The local sandbox's `verify` script was hardened to default to `--watch` for exactly this reason — do the same in your CI/verification tooling.

---

## 8. Reference: how it was done in the local sandbox

For cross-reference (the mechanism differs — the local repo composes the upstream `blockscout-stack` chart and injects extra templates, which is a local-build pattern, **not** an ArgoCD input contract):

- **PR:** `cbdc-tokenization-sandbox` #141 — "Blockscout: deploy smart-contract-verifier so verification works".
- Local files changed (for reference only; do not copy verbatim into ArgoCD):
  - `common/images.yaml` — pinned `blockscout.smart_contract_verifier`.
  - `services/blockscout/templates/sc-verifier-deployment.yaml` + `sc-verifier-service.yaml` — the manifests above.
  - `services/blockscout/values.backend.env.yaml` — the `MICROSERVICE_SC_VERIFIER_*` wiring.
  - `common/helpers.sh` — local image load/mirror/`--set` plumbing (local-only; the cloud equivalent is your registry + ArgoCD image management).
  - `contracts/contracts.sh` — defaulted verification to `--watch`.
- The local stack is fully **Solidity-only** and was validated end-to-end: `total=13 success=13 failed=0`, with the Blockscout API returning `is_verified: true` and real `ContractName` / compiler version (e.g. `BondAuction`, solc `v0.8.35`).
