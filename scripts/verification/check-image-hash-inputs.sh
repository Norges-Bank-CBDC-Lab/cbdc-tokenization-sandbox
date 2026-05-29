#!/usr/bin/env bash
#
# check-image-hash-inputs.sh — guard the content-hash cache keys for the
# repo-owned images (nb-ui, nb-bond-api, bens-microservice).
#
# A stale image ships when a source file silently falls out of a
# *BundleHash input list: the hash would not change, so the build is skipped
# even though the runtime bundle changed. This asserts each hash is:
#   - sensitive   to files under its hashed input dir, and
#   - insensitive to files outside its input set.
#
# Pure/offline: sources common/helpers.sh and exercises the hash functions
# by creating and removing throwaway files. No docker, cluster, or network.
# Tracked files are never modified.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=/dev/null
source "$REPO_ROOT_DIR/common/helpers.sh" >/dev/null 2>&1

FAILURES=0
TMP_FILES=()

cleanup() {
    local f
    for f in "${TMP_FILES[@]:-}"; do
        [ -n "$f" ] && rm -f "$f"
    done
}
trap cleanup EXIT

rel()  { echo "${1#"$REPO_ROOT_DIR"/}"; }
pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; FAILURES=$((FAILURES + 1)); }

# assert_hash_sensitivity NAME HASH_FN HASHED_DIR NONHASHED_DIR
#
# Asserts HASH_FN changes when a new file appears under HASHED_DIR and does
# NOT change when a new file appears at NONHASHED_DIR (a location outside the
# hash's declared input set).
assert_hash_sensitivity() {
    local name="$1" hash_fn="$2" hashed_dir="$3" nonhashed_dir="$4"

    if [ ! -d "$hashed_dir" ]; then
        fail "$name: hashed input dir not found: $(rel "$hashed_dir")"
        return
    fi

    local baseline
    baseline="$("$hash_fn")"
    if [ -z "$baseline" ]; then
        fail "$name: baseline hash is empty"
        return
    fi
    if [ "$("$hash_fn")" != "$baseline" ]; then
        fail "$name: hash is not deterministic"
        return
    fi

    # A new file inside the hashed dir MUST change the hash.
    local hashed_tmp="$hashed_dir/__hashcheck_$$.tmp"
    TMP_FILES+=("$hashed_tmp")
    printf 'hashcheck %s\n' "$$" >"$hashed_tmp" 2>/dev/null || true
    local after_hashed
    after_hashed="$("$hash_fn")"
    rm -f "$hashed_tmp"
    if [ "$after_hashed" == "$baseline" ]; then
        fail "$name: a new file under $(rel "$hashed_dir") did NOT change the hash — hashed inputs are under-covered"
    else
        pass "$name: hash reacts to files under $(rel "$hashed_dir")"
    fi

    # A new file outside the input set MUST NOT change the hash.
    local nonhashed_tmp="$nonhashed_dir/__hashcheck_nothashed_$$.tmp"
    TMP_FILES+=("$nonhashed_tmp")
    printf 'not hashed %s\n' "$$" >"$nonhashed_tmp" 2>/dev/null || true
    local after_nonhashed
    after_nonhashed="$("$hash_fn")"
    rm -f "$nonhashed_tmp"
    if [ "$after_nonhashed" != "$baseline" ]; then
        fail "$name: a new file at $(rel "$nonhashed_dir") DID change the hash — hash is over-broad"
    else
        pass "$name: hash ignores non-input files at $(rel "$nonhashed_dir")"
    fi
}

main() {
    echo "Checking image content-hash inputs..."
    assert_hash_sensitivity "nb-ui"             nbUIBundleHash      "$NB_UI_DIR/src"                          "$NB_UI_DIR"
    assert_hash_sensitivity "nb-bond-api"       nbBondApiBundleHash "$NB_BOND_API_DIR/src"                    "$NB_BOND_API_DIR"
    assert_hash_sensitivity "bens-microservice" bensImageHash       "$BLOCKSCOUT_BENS_DIR/src/openapi_server" "$BLOCKSCOUT_BENS_DIR"

    echo
    if [ "$FAILURES" -gt 0 ]; then
        echo "❌ image hash-input check failed ($FAILURES failure(s))."
        return 1
    fi
    echo "✅ image hash-input check passed."
    return 0
}

# Only run main when executed directly, so the assertions can be unit-tested
# by sourcing this file.
if [ "${BASH_SOURCE[0]:-$0}" == "${0}" ]; then
    main
    exit $?
fi
