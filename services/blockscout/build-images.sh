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

# The registry tags are <tag>-<hash>, with the hash over this script and the pinned
# refs (see blockscoutSourceBuildHash in common/helpers.sh). Any change to the
# recipe or a pin builds new images and moves the tags the deployment uses, so the
# node pulls them and the pods roll. When the registry already holds both tags for
# the current recipe, nothing is built, pushed or restarted. Base images named by
# tag inside the recipe are not part of the hash; pin a moved base by editing the
# recipe (for example to a digest).
backend_pull_ref="$(blockscoutSourceImageRef "$backend_image")"
frontend_pull_ref="$(blockscoutSourceImageRef "$frontend_image")"
if [[ "$(kindRegistryHasImage "${backend_pull_ref#localhost:${KIND_REGISTRY_PORT}/}")" == "true" ]] \
    && [[ "$(kindRegistryHasImage "${frontend_pull_ref#localhost:${KIND_REGISTRY_PORT}/}")" == "true" ]]; then
    echo "✅ ${backend_pull_ref} and ${frontend_pull_ref} are already in the local registry; nothing to build."
    exit 0
fi

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
# ~> 2.17.0. It also locks cowboy 2.20.0, cowlib 2.21.0 and jose 1.11.12, which
# have published advisories fixed in cowboy 2.21.0, cowlib 2.22.0 and jose
# 1.11.13 (minor releases inside upstream's own version constraints).
# Re-resolve those five packages in the deps stage (jose is only a transitive
# dependency, so mix can update it only after the dependencies are fetched,
# hence the preceding `mix deps.get`); hackney's own dependencies move with it.
# The step then asserts the resulting lock entries and that no other package
# changed, so the build fails if a newer release changes what gets resolved.
# See docs/KNOWN_ISSUES.md.
backend_hex_line="RUN mix local.hex --force"
backend_update_line="RUN cp mix.lock /tmp/mix.lock.upstream && mix deps.get && mix deps.update hackney certifi cowboy cowlib jose"
backend_expected_locks=(
    '"certifi": {:hex, :certifi, "2.18.0"'
    '"cowboy": {:hex, :cowboy, "2.21.0"'
    '"cowlib": {:hex, :cowlib, "2.22.0"'
    '"h2": {:hex, :h2, "0.15.1"'
    '"hackney": {:hex, :hackney, "4.10.2"'
    '"jose": {:hex, :jose, "1.11.13"'
    '"quic": {:hex, :quic, "2.6.1"'
    '"ssl_verify_fun": {:hex, :ssl_verify_fun, "1.1.9"'
    '"webtransport": {:hex, :webtransport, "0.5.5"'
)
# Every package whose lock line the step may add, change or remove.
backend_expected_changed="certifi cowboy cowlib h2 hackney jose quic ssl_verify_fun webtransport"

if [[ "$(grep -cxF "$backend_hex_line" "$backend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$backend_hex_line' line in the upstream backend Dockerfile ($backend_tag); review the dependency re-resolve in $(basename "$0")"
    exit 1
fi

backend_lock_checks=""
for lock_entry in "${backend_expected_locks[@]}"; do
    backend_lock_checks="$backend_lock_checks && grep -qF '$lock_entry' mix.lock"
done
backend_lock_checks="$backend_lock_checks && test \"\$(diff -u /tmp/mix.lock.upstream mix.lock | grep '^[-+] ' | cut -d'\"' -f2 | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = '$backend_expected_changed'"
backend_lock_message="dependency re-resolve did not produce the expected mix.lock changes; review the update in build-images.sh"

BACKEND_UPDATE_LINE="$backend_update_line" BACKEND_LOCK_CHECKS="$backend_lock_checks" BACKEND_LOCK_MESSAGE="$backend_lock_message" BACKEND_HEX_LINE="$backend_hex_line" awk '
    { print }
    $0 == ENVIRON["BACKEND_HEX_LINE"] { print ENVIRON["BACKEND_UPDATE_LINE"] ENVIRON["BACKEND_LOCK_CHECKS"] " || { echo \"" ENVIRON["BACKEND_LOCK_MESSAGE"] "\" >&2; exit 1; }" }
' "$backend_dockerfile" > "$backend_dockerfile.patched"
mv "$backend_dockerfile.patched" "$backend_dockerfile"
echo "🔧 Re-resolving hackney, certifi, cowboy, cowlib and jose in the backend deps stage"

docker build \
    --platform "$platform" \
    -f "$backend_tmp/docker/Dockerfile" \
    -t "$backend_image" \
    --build-arg BLOCKSCOUT_VERSION="$backend_tag" \
    --build-arg RELEASE_VERSION="$backend_release_version" \
    "$backend_tmp"

# List the advisories that remain in the resolved backend lock. This is
# informational only: it reuses the cached deps stage, needs network access to
# fetch Hex's advisory data, and never fails the build.
echo "🔎 Remaining Hex advisories in the backend lock (informational)"
if backend_deps_image=$(docker build -q --platform "$platform" --target builder-deps -f "$backend_tmp/docker/Dockerfile" "$backend_tmp"); then
    docker run --rm "$backend_deps_image" mix hex.audit || echo "ℹ️  Advisories were reported above, or the audit could not run; the build continues"
    docker rmi "$backend_deps_image" >/dev/null 2>&1 || true
else
    echo "ℹ️  Could not build the deps stage for the advisory listing; skipping"
fi

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
frontend_node_to="node:24.22.3-alpine"

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

pushBlockscoutSourceImage "$frontend_image"
pushBlockscoutSourceImage "$backend_image"

echo "✅ Blockscout images built and pushed to local registry."
