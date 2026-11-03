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

backend_image="$(getBlockscoutBackendImage)"
frontend_image="$(getBlockscoutFrontendImage)"

backend_repo=$(imageRepo "$backend_image")
backend_tag=$(imageTag "$backend_image")
frontend_repo=$(imageRepo "$frontend_image")
frontend_tag=$(imageTag "$frontend_image")

if [[ -z "$backend_repo" || -z "$backend_tag" || "$backend_tag" == "latest" ]]; then
    echo "❌ blockscout.backend must be set to an explicit tag in common/images.yaml"
    exit 1
fi
if [[ -z "$frontend_repo" || -z "$frontend_tag" || "$frontend_tag" == "latest" ]]; then
    echo "❌ blockscout.frontend must be set to an explicit tag in common/images.yaml"
    exit 1
fi

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

# The upstream frontend tag locks Next.js at a version with published
# advisories; pin a fixed release on top of upstream's frozen install. The
# version must be at least a week old, because upstream's pnpm config sets
# minimumReleaseAge to one week. The Node heap is raised because re-resolving
# the workspace with `pnpm add` is memory-bound. See docs/KNOWN_ISSUES.md.
frontend_next_version="16.4.3"
frontend_install_line="RUN pnpm install --frozen-lockfile"
frontend_dockerfile="$frontend_tmp/Dockerfile"

if [[ "$(grep -cxF "$frontend_install_line" "$frontend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$frontend_install_line' line in the upstream frontend Dockerfile ($frontend_tag); review the Next.js pin in $(basename "$0")"
    exit 1
fi

awk -v install_line="$frontend_install_line" -v next_version="$frontend_next_version" '
    { print }
    $0 == install_line { print "RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm add -w next@" next_version " --save-exact" }
' "$frontend_dockerfile" > "$frontend_dockerfile.patched"
mv "$frontend_dockerfile.patched" "$frontend_dockerfile"
echo "🔧 Pinned Next.js $frontend_next_version in the frontend deps stage"

docker build \
    --platform "$platform" \
    -f "$frontend_tmp/Dockerfile" \
    -t "$frontend_image" \
    --build-arg GIT_TAG="$frontend_tag" \
    --build-arg GIT_COMMIT_SHA="$frontend_sha" \
    "$frontend_tmp"

ensureKindRegistry

loadImageToKind "$frontend_image"
loadImageToKind "$backend_image"

echo "✅ Blockscout images built and pushed to local registry."
