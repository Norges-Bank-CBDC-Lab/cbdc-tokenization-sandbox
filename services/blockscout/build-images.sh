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

# Upstream names its Elixir/Alpine base by tag only (both stages, builder-deps
# and runtime), and a tag can be re-pushed. Pin the index digest of the image
# the released builds were made from, so the build base cannot move without a
# visible edit here. The digest is the multi-arch index digest, as for
# SANDBOX_NODE_IMAGE in common/node-version.env. The step stops if upstream's
# FROM lines are not exactly these two. To bump (a new upstream tag names a new
# base): set the tag, read `docker buildx imagetools inspect <tag>` for the
# index digest, edit both lines below, and run scripts/verification/
# check-image-pins.py. See docs/KNOWN_ISSUES.md.
backend_base_tag="hexpm/elixir:1.20.4-erlang-28.5.0.7-alpine-3.22.6"
backend_base_pinned="${backend_base_tag}@sha256:2dde7b063115d2d91fdb7d070cd3d5c97572a0119167f3327741a88096276b1a"

if [[ "$(awk -v ref="$backend_base_tag" '$1 == "FROM" && $2 == ref { n++ } END { print n + 0 }' "$backend_dockerfile")" != "2" ]]; then
    echo "❌ Expected exactly two 'FROM $backend_base_tag' stages in the upstream backend Dockerfile ($backend_tag); review the base pin in $(basename "$0")"
    exit 1
fi

awk -v ref="$backend_base_tag" -v pinned="$backend_base_pinned" '$1 == "FROM" && $2 == ref { $2 = pinned } { print }' "$backend_dockerfile" > "$backend_dockerfile.patched"
mv "$backend_dockerfile.patched" "$backend_dockerfile"
echo "🔧 Pinned the backend stages to ${backend_base_pinned}"

# Upstream's lockfile resolves certifi 2.17.0, whose bundled root list still
# carries the distrusted eMudhra root, and hackney 4.8.5 pins certifi to
# ~> 2.17.0. It also locks cowboy 2.20.0, cowlib 2.21.0 and jose 1.11.12, which
# have published advisories fixed in cowboy 2.21.0, cowlib 2.22.0 and jose
# 1.11.13. The deps stage therefore swaps the mix.lock entries below,
# checksums included, into upstream's lock by package name and then runs
# `mix deps.get`, which fetches exactly those releases. Nothing floats to the
# newest release at build time, so the same recipe always builds the same
# dependency set; a plain `mix deps.update` moved hackney, certifi, h2, quic,
# idna and webtransport between 2026-11-10 and 2026-11-15 and broke fresh builds.
# The step fails closed if upstream's lock no longer has exactly one entry for a
# pinned package, if the lock after `mix deps.get` differs from the pins, if
# anything other than the pinned packages changed, or if Hex has retired a
# pinned release with the reason security or invalid (or a reason this script
# does not recognise). A release retired as deprecated, renamed or other, and an
# audit service that gives no report, print a loud warning and the build
# continues; the summary after the build repeats the check.
#
# To re-pin (an advisory on a pinned package, a certifi root-list change, a new
# upstream Blockscout tag): in a throwaway container from the deps stage, add
# `{:name, "== x.y.z", override: true}` entries for the packages to mix.exs, run
# `mix deps.get` against upstream's lock, copy the changed lock lines here, and
# soak the resulting image before releasing it. certifi and the others do not
# update by themselves. See docs/KNOWN_ISSUES.md.
backend_lock_pins=(
    '  "certifi": {:hex, :certifi, "2.18.0", "bd5f34eb8fe7c3eee3c705c1f9472174e8d4c353fc9c09a4cb937b891e80e329", [:rebar3], [], "hexpm", "a8b61115e393a2298b20451a36beffdabe08e61bc16cc1926d7991f6721103bf"},'
    '  "cowboy": {:hex, :cowboy, "2.21.0", "16befcb9b60e81119c2aa5864d33b1494855138c71a2d0c95e4d878d850fde71", [:make, :rebar3], [{:cowlib, ">= 2.22.0 and < 3.0.0", [hex: :cowlib, repo: "hexpm", optional: false]}, {:ranch, ">= 1.8.0 and < 3.0.0", [hex: :ranch, repo: "hexpm", optional: false]}], "hexpm", "90b4d6fe91806054538349dbeabcac86315a3fdaec4eb491f5445259668398f6"},'
    '  "cowlib": {:hex, :cowlib, "2.22.0", "ed32663b11e0b96c4fc2e7d42cf627cd095f006e78a24d0c6b98a91f2e532cd3", [:make, :rebar3], [], "hexpm", "b1ea5995d8f1ab5086ae7afe710c2075c7872c7e1acaf45dd0db7595e900c0fc"},'
    '  "h2": {:hex, :h2, "0.15.1", "471e3e2db4d7edae8c8263c402f5f6f126a5a8bf6adc9d6b2a0c74942ff488d9", [:rebar3], [], "hexpm", "47863ce75a6c7eb81a677dd527f5eeaa0c1fb3bcdc575864fd61e77bee2c9857"},'
    '  "hackney": {:hex, :hackney, "4.10.2", "ea3514d4c8a591a228e30e67d89cbf59288fe11e34fafd3206e9694f08ff2804", [:rebar3], [{:certifi, "~> 2.18.0", [hex: :certifi, repo: "hexpm", optional: false]}, {:h2, "~> 0.15.0", [hex: :h2, repo: "hexpm", optional: false]}, {:idna, "~> 7.1.0", [hex: :idna, repo: "hexpm", optional: false]}, {:mimerl, "~> 1.5", [hex: :mimerl, repo: "hexpm", optional: false]}, {:parse_trans, "3.4.2", [hex: :parse_trans, repo: "hexpm", optional: false]}, {:quic, "~> 2.6.1", [hex: :quic, repo: "hexpm", optional: false]}, {:ssl_verify_fun, "~> 1.1.0", [hex: :ssl_verify_fun, repo: "hexpm", optional: false]}, {:webtransport, "~> 0.5.3", [hex: :webtransport, repo: "hexpm", optional: false]}], "hexpm", "1225636fa9ea37c2996312ff1b80e88c0d1176d1c094a59984d2e16a8a108583"},'
    '  "jose": {:hex, :jose, "1.11.13", "94abcd8bf98eb9f007272918bd3f5ffb613e8d250567de233e6c2b2456319005", [:mix, :rebar3], [], "hexpm", "15d8bd0f01ab29d1771e8da1f60f9c98725b23a17f7312cdd40e8e2757bd98c7"},'
    '  "quic": {:hex, :quic, "2.6.1", "ba18b003f58f538a67fd4fab6566dc05e483dd3a21fccadaf1ae4b5b9cbdc8c0", [:rebar3], [], "hexpm", "6657e3fd6ac1720b243402421a9ea1b7293a98dbd1e58374f57c72a4dcbe7a9c"},'
    '  "ssl_verify_fun": {:hex, :ssl_verify_fun, "1.1.9", "4ff292dc16e728fde1235cf5fa6bcd3ca01864004526f71a4a70935509d1a7f1", [:make, :mix, :rebar3], [], "hexpm", "19f24ad715ef6255d530b2f0db8b2d2191ae435b6527234e943f523e84ed0895"},'
    '  "webtransport": {:hex, :webtransport, "0.5.5", "fdc0f5ddf004465caea8370fc4af1d955ad9f3f545ac91131fa20cb02d6f196e", [:rebar3], [{:h2, "~> 0.15.1", [hex: :h2, repo: "hexpm", optional: false]}, {:quic, "~> 2.6.1", [hex: :quic, repo: "hexpm", optional: false]}], "hexpm", "6825b53829c122f34a14e099384f860fa625de1d825dfd17c2fa67e8cfbc4080"},'
)
backend_pinned_names="$(printf '%s\n' "${backend_lock_pins[@]}" | cut -d'"' -f2 | tr '\n' ' ' | sed 's/ $//')"

backend_hex_line="RUN mix local.hex --force"

if [[ "$(grep -cxF "$backend_hex_line" "$backend_dockerfile")" != "1" ]]; then
    echo "❌ Expected exactly one '$backend_hex_line' line in the upstream backend Dockerfile ($backend_tag); review the dependency pins in $(basename "$0")"
    exit 1
fi

printf '%s\n' "${backend_lock_pins[@]}" > "$backend_tmp/blockscout-lock-pins.txt"
cat > "$backend_tmp/blockscout-pin-lock.sh" <<'PINSCRIPT'
#!/bin/sh
# Runs in the backend deps stage, in the umbrella root.
#   no argument  swap the pins in, verify the result, check for retired releases;
#                fails closed
#   report       only repeat the retirement check and never fail; used by the
#                summary that build-images.sh prints after the build
set -eu
fail() { echo "❌ $1" >&2; exit 1; }

# Retirement check for the pinned packages. Hex lets a release stay fetchable
# after its maintainers retire it, with a reason. security and invalid fail the
# build, and so does a reason this script does not recognise; deprecated,
# renamed and other print a loud warning and the build continues. If
# `mix hex.audit` gives no report, that is a loud warning too: the pins are
# checksum-verified by `mix deps.get` either way.
check_retired() {
    mode=$1
    names=$(cut -d'"' -f2 /tmp/blockscout-lock-pins.txt | sort -u | tr '\n' ' ' | sed 's/ $//')
    audit=$(mix hex.audit 2>&1 || true)
    if ! printf '%s\n' "$audit" | grep -qE '^(No retired or security advisory packages found|Found retired packages|Found packages with security advisories)'; then
        echo "⚠️  WARNING ⚠️  mix hex.audit gave no report, so retired releases of the pinned packages could not be checked."
        echo "    The build continues; mix deps.get still verifies every pinned checksum."
        return 0
    fi
    retired=$(printf '%s\n' "$audit" | awk '/^Retired:/ { f = 1; next } f && /^$/ { exit } f')
    found=0
    blocked=0
    for name in $names; do
        line=$(printf '%s\n' "$retired" | grep -E "^  $name " || true)
        [ -n "$line" ] || continue
        found=1
        version=$(printf '%s\n' "$line" | awk '{ print $2 }')
        reason=$(printf '%s\n' "$line" | sed -n 's/^[^(]*- (\([^)]*\)).*/\1/p')
        message=$(printf '%s\n' "$line" | sed 's/^[^)]*) *//')
        case "$reason" in
            deprecated|renamed|other)
                echo "⚠️  WARNING ⚠️  Hex has retired the pinned $name $version (reason: $reason): $message"
                echo "    The build continues. Decide whether to re-pin; see docs/KNOWN_ISSUES.md." ;;
            security|invalid)
                echo "❌ Hex has retired the pinned $name $version (reason: $reason): $message"
                blocked=1 ;;
            *)
                echo "❌ Hex has retired the pinned $name $version with a reason this script does not recognise ('$reason'): $message"
                blocked=1 ;;
        esac
    done
    if [ "$blocked" = "1" ]; then
        echo "   A pinned release retired as security or invalid, or for an unrecognised reason, fails the build." >&2
        [ "$mode" = "report" ] || exit 1
    fi
    if [ "$mode" = "report" ] && [ "$found" = "0" ]; then
        echo "   none of the pinned packages is retired"
    fi
}

if [ "${1:-}" = "report" ]; then
    check_retired report
    exit 0
fi

cp mix.lock /tmp/mix.lock.upstream

while IFS= read -r pin; do
    name=$(printf '%s\n' "$pin" | cut -d'"' -f2)
    count=$(grep -c "^  \"$name\": {:hex, :$name, " mix.lock || true)
    [ "$count" = "1" ] || fail "upstream's mix.lock has $count entries for $name (expected 1): its lock format or package set changed; review the pins in build-images.sh"
done < /tmp/blockscout-lock-pins.txt

awk 'NR == FNR { pin[$1] = $0; next } ($1 in pin) && /^  "[^"]+": \{:hex, / { print pin[$1]; next } { print }' \
    /tmp/blockscout-lock-pins.txt mix.lock > mix.lock.pinned
mv mix.lock.pinned mix.lock

mix deps.get

while IFS= read -r pin; do
    name=$(printf '%s\n' "$pin" | cut -d'"' -f2)
    [ "$(grep -cxF -- "$pin" mix.lock)" = "1" ] || fail "after mix deps.get the lock no longer holds the pinned entry for $name; review the pins in build-images.sh"
done < /tmp/blockscout-lock-pins.txt

expected=$(cut -d'"' -f2 /tmp/blockscout-lock-pins.txt | sort -u | tr '\n' ' ' | sed 's/ $//')
changed=$(diff -u /tmp/mix.lock.upstream mix.lock | grep '^[-+] ' | cut -d'"' -f2 | sort -u | tr '\n' ' ' | sed 's/ $//')
[ "$changed" = "$expected" ] || fail "the lock changed for [$changed], expected exactly [$expected]; review the pins in build-images.sh"

check_retired build
echo "✅ The pinned mix.lock entries are in place and verified"
PINSCRIPT

BACKEND_PIN_COPY='COPY blockscout-lock-pins.txt blockscout-pin-lock.sh /tmp/' BACKEND_PIN_RUN='RUN sh /tmp/blockscout-pin-lock.sh' BACKEND_HEX_LINE="$backend_hex_line" awk '
    { print }
    $0 == ENVIRON["BACKEND_HEX_LINE"] { print ENVIRON["BACKEND_PIN_COPY"]; print ENVIRON["BACKEND_PIN_RUN"] }
' "$backend_dockerfile" > "$backend_dockerfile.patched"
mv "$backend_dockerfile.patched" "$backend_dockerfile"
echo "🔧 Pinning the backend lock entries (${backend_pinned_names}) in the deps stage"

docker build \
    --platform "$platform" \
    -f "$backend_tmp/docker/Dockerfile" \
    -t "$backend_image" \
    --build-arg BLOCKSCOUT_VERSION="$backend_tag" \
    --build-arg RELEASE_VERSION="$backend_release_version" \
    "$backend_tmp"

# List the advisories that remain in the resolved backend lock, and the newer
# releases of the pinned packages. This is informational only: it reuses the
# cached deps stage, needs network access to fetch Hex's data, and never fails
# the build.
echo "🔎 Remaining Hex advisories in the backend lock (informational)"
if backend_deps_image=$(docker build -q --platform "$platform" --target builder-deps -f "$backend_tmp/docker/Dockerfile" "$backend_tmp"); then
    docker run --rm "$backend_deps_image" mix hex.audit || echo "ℹ️  Advisories were reported above, or the audit could not run; the build continues"
    echo "🔎 Newer Hex releases than the pinned backend set (informational; pins only move when edited here)"
    echo "   Dependency  Environments  Pinned  Latest  Status"
    docker run --rm "$backend_deps_image" sh -c "mix hex.outdated --all 2>&1 | grep -E '^($(printf '%s' "$backend_pinned_names" | tr ' ' '|')) ' | sed 's/^/   /'" || true
    echo "🔎 Retired releases among the pinned backend packages (informational; repeats the build-time check)"
    docker run --rm "$backend_deps_image" sh /tmp/blockscout-pin-lock.sh report || true
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
# Node 24 Alpine image, pinned by tag and multi-arch index digest like the
# other bases (see the backend base above for how to bump).
# See docs/KNOWN_ISSUES.md.
frontend_node_from="node:24.21.0-alpine"
frontend_node_to="node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5"

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
