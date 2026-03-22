#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
CONTRACTS_SH="$SCRIPT_DIR/contracts.sh"
BROADCAST_DIR="$SCRIPT_DIR/broadcast"

if [ ! -f "$CONTRACTS_SH" ]; then
    echo "❌ Could not find contracts.sh at $CONTRACTS_SH"
    exit 1
fi

if [ ! -d "$BROADCAST_DIR" ]; then
    echo "ℹ️ No broadcast directory found at $BROADCAST_DIR. Skipping check."
    exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "❌ Missing required tool: jq"
    exit 1
fi

MAPPED_NAMES="$(
    awk '
        /function resolveContractIdentifier\(\)/ { in_fn=1; next }
        in_fn && /^}/ { in_fn=0 }
        in_fn && /^[[:space:]]*[[:alnum:]_]+[[:space:]]*\)/ {
            name=$1
            sub(/\)/, "", name)
            if (name != "*") {
                print name
            }
        }
    ' "$CONTRACTS_SH" | sort -u
)"

if [ -z "$MAPPED_NAMES" ]; then
    echo "❌ No contract mappings found in resolveContractIdentifier() in $CONTRACTS_SH"
    exit 1
fi

DEPLOYED_NAMES="$(
    find "$BROADCAST_DIR" -maxdepth 3 -type f -path "*/run-latest.json" \
        -exec jq -r '.transactions[]? | select(.transactionType == "CREATE") | .contractName' {} \; \
        | sort -u
)"

if [ -z "$DEPLOYED_NAMES" ]; then
    echo "ℹ️ No CREATE deployments found in $BROADCAST_DIR/*/*/run-latest.json. Skipping check."
    exit 0
fi

MISSING=""
while IFS= read -r name; do
    if [ -z "$name" ]; then
        continue
    fi
    if ! grep -Fxq "$name" <<< "$MAPPED_NAMES"; then
        MISSING="${MISSING}${name}\n"
    fi
done <<< "$DEPLOYED_NAMES"

if [ -n "$MISSING" ]; then
    echo "❌ Missing verify-latest contract mappings in contracts.sh:"
    printf "%b" "$MISSING" | sed 's/^/  - /'
    echo "Update resolveContractIdentifier() in contracts/contracts.sh."
    exit 1
fi

DEPLOYED_COUNT=$(printf "%s\n" "$DEPLOYED_NAMES" | sed '/^$/d' | wc -l | tr -d ' ')
echo "✅ verify-latest mapping check passed (${DEPLOYED_COUNT} deployed contract types covered)."
