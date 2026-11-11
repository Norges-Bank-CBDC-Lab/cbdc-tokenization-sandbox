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

# Upstream's runtime stage installs its packages without upgrading the ones the
# hexpm base image already carries, which leaves an Alpine ca-certificates
# bundle older than the one Alpine 3.22 now publishes. Upgrade the two CA
# packages in the same install step. See docs/KNOWN_ISSUES.md.
backend_apk_text="add jq curl ffmpeg"
backend_dockerfile="$backend_tmp/docker/Dockerfile"

if [[ "$(grep -cF -- "$backend_apk_text" "$backend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$backend_apk_text' in the upstream backend Dockerfile ($backend_tag); review the CA package upgrade in $(basename "$0")"
    exit 1
fi

sed "s|$backend_apk_text|add --upgrade jq curl ffmpeg ca-certificates ca-certificates-bundle|" "$backend_dockerfile" > "$backend_dockerfile.patched"
mv "$backend_dockerfile.patched" "$backend_dockerfile"
echo "🔧 Upgrading the Alpine CA packages in the backend runtime stage"

# Upstream's lockfile resolves certifi 2.17.0, whose bundled root list still
# carries the distrusted eMudhra root, and hackney 4.8.5 pins certifi to
# ~> 2.17.0. Re-resolve hackney and certifi in the deps stage; hackney's own
# dependencies move with them. The step then asserts the resulting lock
# entries, so the build fails if a newer release changes what gets resolved.
# See docs/KNOWN_ISSUES.md.
backend_hex_line="RUN mix local.hex --force"
backend_hackney_update="RUN mix deps.update hackney certifi"
backend_expected_locks=(
    '"certifi": {:hex, :certifi, "2.18.0"'
    '"h2": {:hex, :h2, "0.15.1"'
    '"hackney": {:hex, :hackney, "4.10.2"'
    '"quic": {:hex, :quic, "2.6.1"'
    '"ssl_verify_fun": {:hex, :ssl_verify_fun, "1.1.9"'
    '"webtransport": {:hex, :webtransport, "0.5.5"'
)

if [[ "$(grep -cxF "$backend_hex_line" "$backend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$backend_hex_line' line in the upstream backend Dockerfile ($backend_tag); review the hackney/certifi update in $(basename "$0")"
    exit 1
fi

backend_lock_checks=""
for lock_entry in "${backend_expected_locks[@]}"; do
    backend_lock_checks="$backend_lock_checks && grep -qF '$lock_entry' mix.lock"
done
backend_lock_message="hackney/certifi re-resolve did not produce the expected mix.lock entries; review the update in build-images.sh"

awk -v hex_line="$backend_hex_line" -v update_line="$backend_hackney_update" -v checks="$backend_lock_checks" -v message="$backend_lock_message" '
    { print }
    $0 == hex_line { print update_line " " checks " || { echo \"" message "\" >&2; exit 1; }" }
' "$backend_dockerfile" > "$backend_dockerfile.patched"
mv "$backend_dockerfile.patched" "$backend_dockerfile"
echo "🔧 Re-resolving hackney and certifi in the backend deps stage"

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
# Upstream's Node base (24.21.0) still ships the distrusted eMudhra root in its
# built-in list; 24.22.1 and later removed it. Move every stage to a newer
# Node 24 Alpine image. See docs/KNOWN_ISSUES.md.
frontend_node_from="node:24.21.0-alpine"
frontend_node_to="node:24.22.2-alpine"

if [[ "$(grep -cxF "$frontend_install_line" "$frontend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$frontend_install_line' line in the upstream frontend Dockerfile ($frontend_tag); review the Next.js pin in $(basename "$0")"
    exit 1
fi

if [[ "$(grep -cF -- "$frontend_node_from" "$frontend_dockerfile")" != "2" ]]; then
    echo "❌ Expected exactly two '$frontend_node_from' stages in the upstream frontend Dockerfile ($frontend_tag); review the Node base in $(basename "$0")"
    exit 1
fi

awk -v install_line="$frontend_install_line" -v next_version="$frontend_next_version" '
    { print }
    $0 == install_line { print "RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm add -w next@" next_version " --save-exact" }
' "$frontend_dockerfile" > "$frontend_dockerfile.patched"
mv "$frontend_dockerfile.patched" "$frontend_dockerfile"
echo "🔧 Pinned Next.js $frontend_next_version in the frontend deps stage"

sed "s|$frontend_node_from|$frontend_node_to|g" "$frontend_dockerfile" > "$frontend_dockerfile.patched"
mv "$frontend_dockerfile.patched" "$frontend_dockerfile"
echo "🔧 Moved the frontend stages to $frontend_node_to"

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
