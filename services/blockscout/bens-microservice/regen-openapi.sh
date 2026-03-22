#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR"

# Use the Dockerized generator to avoid local Java installs.
docker run --rm \
  -v "$SCRIPT_DIR:/local" \
  -w /local \
  openapitools/openapi-generator-cli generate \
  -i /local/swagger/bens.swagger.yaml \
  -g python-fastapi \
  -o /local \
  --skip-overwrite
