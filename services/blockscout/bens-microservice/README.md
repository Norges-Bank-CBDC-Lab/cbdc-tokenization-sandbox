# BENS Microservice Provenance

This directory contains the local Blockscout BENS API input and the generated FastAPI server used by the sandbox.

- `swagger/bens.swagger.yaml` is copied from `blockscout/blockscout-rs` and keeps its upstream `MIT` SPDX identifier.
- `src/openapi_server/` is generated from that local Swagger file via `./regen-openapi.sh` and is tracked as repository-generated code.
- `package.json` in this directory is local repository metadata for the generated directory, not an upstream file copied from Blockscout.

If the Swagger file or generator changes, regenerate the server and re-check the provenance notes in `docs/THIRD_PARTY_NOTES.md` before committing the updated output.
