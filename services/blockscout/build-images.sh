#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/common/helpers.sh"

function requireBin() {
    bin=$1
    if ! command -v "$bin" >/dev/null 2>&1; then
        echo "❌ Missing required tool: $bin"
        exit 1
    fi
}

requireBin docker
requireBin git
requireBin yq

backend_repo=$(yq -r '.blockscout.image.repository // ""' "$REPO_ROOT/services/blockscout/values.yaml")
backend_tag=$(yq -r '.blockscout.image.tag // ""' "$REPO_ROOT/services/blockscout/values.yaml")
frontend_repo=$(yq -r '.frontend.image.repository // ""' "$REPO_ROOT/services/blockscout/values.yaml")
frontend_tag=$(yq -r '.frontend.image.tag // ""' "$REPO_ROOT/services/blockscout/values.yaml")

if [[ -z "$backend_repo" || -z "$backend_tag" ]]; then
    echo "❌ blockscout.image.repository/tag must be set in services/blockscout/values.yaml"
    exit 1
fi
if [[ -z "$frontend_repo" || -z "$frontend_tag" ]]; then
    echo "❌ frontend.image.repository/tag must be set in services/blockscout/values.yaml"
    exit 1
fi

backend_image="${backend_repo}:${backend_tag}"
frontend_image="${frontend_repo}:${frontend_tag}"

platform=$(getKindTargetPlatform)

backend_tmp=$(mktemp -d /tmp/blockscout-build.XXXXXX)
frontend_tmp=$(mktemp -d /tmp/blockscout-frontend-build.XXXXXX)

cleanup() {
    rm -rf "$backend_tmp" "$frontend_tmp"
}
trap cleanup EXIT

echo "🔧 Building Blockscout backend ($backend_tag)"

git clone --depth 1 --branch "$backend_tag" https://github.com/blockscout/blockscout.git "$backend_tmp"
backend_release_version="${backend_tag#v}"

docker build \
    --platform "$platform" \
    -f "$backend_tmp/docker/Dockerfile" \
    -t "$backend_image" \
    --build-arg BLOCKSCOUT_VERSION="$backend_tag" \
    --build-arg RELEASE_VERSION="$backend_release_version" \
    "$backend_tmp"

echo "🔧 Building Blockscout frontend ($frontend_tag)"

git clone --depth 1 --branch "$frontend_tag" https://github.com/blockscout/frontend.git "$frontend_tmp"
frontend_sha=$(git -C "$frontend_tmp" rev-parse HEAD)

docker build \
    --platform "$platform" \
    -f "$frontend_tmp/Dockerfile" \
    -t "$frontend_image" \
    --build-arg GIT_TAG="$frontend_tag" \
    --build-arg GIT_COMMIT_SHA="$frontend_sha" \
    "$frontend_tmp"

export USE_KIND_REGISTRY="true"
ensureKindRegistry

loadImageToKind "$frontend_image"
loadImageToKind "$backend_image"

echo "✅ Blockscout images built and pushed to local registry."
