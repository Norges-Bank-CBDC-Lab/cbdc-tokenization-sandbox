#!/bin/bash

set -euo pipefail

IMAGE="trailofbits/eth-security-toolbox:latest"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST_ARCH="$(uname -m)"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run Slither locally." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available. Start Docker Desktop or the Docker service and retry." >&2
  exit 1
fi

docker pull "$IMAGE"

IMAGE_ARCH="$(docker image inspect --format '{{.Architecture}}' "$IMAGE")"

if [[ "$HOST_ARCH" =~ ^(arm64|aarch64)$ ]] && [[ "$IMAGE_ARCH" == "amd64" ]]; then
  cat >&2 <<EOF
Local Slither runs are not supported on this arm64 host because $IMAGE is amd64-only
and currently segfaults under Docker emulation when it invokes forge.

Use the GitHub contracts workflow for Slither, or run ./slither.sh from an amd64
environment with Docker.
EOF
  exit 1
fi

docker run -t --rm -v "$SCRIPT_DIR:/share" -w / "$IMAGE" sh -c "
  rm -rf /tmp/slither && mkdir -p /tmp/slither &&
  cp -r /share/. /tmp/slither &&
  cd /tmp/slither &&
  FOUNDRY_VIA_IR=true slither . --config-file slither.config.json
"
