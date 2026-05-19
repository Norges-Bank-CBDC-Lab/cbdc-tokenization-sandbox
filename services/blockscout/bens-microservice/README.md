# BENS Microservice Provenance

This directory contains the local Blockscout BENS API input and the generated FastAPI server used by the sandbox.

- `swagger/bens.swagger.yaml` is copied from `blockscout/blockscout-rs` and keeps its upstream `MIT` SPDX identifier.
- `src/openapi_server/` is generated from that local Swagger file via `./regen-openapi.sh` and is tracked as repository-generated code.
- `Dockerfile` is a multi-stage build that installs the pinned `requirements.txt` into an isolated prefix and copies the generated server into a clean runtime stage. The runtime container runs `uvicorn openapi_server.main:app` as `nobody` (uid 65534).
- `package.json` in this directory is local repository metadata for the generated directory, not an upstream file copied from Blockscout.

## Local deployment model

`./services/blockscout/blockscout.sh start` builds BENS as a
self-contained image from this directory's `Dockerfile`. The image is
tagged with a content hash over `src/openapi_server/`, `requirements.txt`,
and the `Dockerfile`, pushed to the local Kind registry at
`localhost:5001/bens-microservice:<hash>`, and the Blockscout Helm
install is given `--set bensImage=<that tag>`. Re-runs skip the build
when the hash matches an existing registry tag.

The pod is hardened: runs as `nobody`, drops `["ALL"]` capabilities,
`runAsNonRoot: true`, `allowPrivilegeEscalation: false`,
`seccompProfile.type: RuntimeDefault`, and
`readOnlyRootFilesystem: true`. BENS does not write to disk at runtime
(only stdout logs and stateless DB queries), so no writable mounts are
needed.

The Kubernetes readiness and liveness probes call `/health` on the
container port 8050.

If the Swagger file or generator changes, regenerate the server with
`./regen-openapi.sh` and re-check the provenance notes in
`docs/THIRD_PARTY_NOTES.md` before committing the updated output.
