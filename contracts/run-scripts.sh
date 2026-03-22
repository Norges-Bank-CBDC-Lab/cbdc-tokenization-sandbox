#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
cd $SCRIPT_DIR

source ../common/helpers.sh

function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <network|rpc-url> <chain-id> [--verify] [--verifier VERIFIER] [--verifier-url VERIFIER_URL]"
    echo
    echo "    Description:"
    echo "      Run all contract scripts against the target RPC or network via deployContracts() helper."
    echo "      network: a network defined in foundry.toml, or a url"
    echo "      chain-id: chain id of the target network (used to locate broadcast artifacts)"
    echo "      --verify/--verifier/--verifier-url are forwarded to deployContracts()/deploy.sh"
    echo
    echo "    Examples:"
    echo "      $(basename "$0") anvil 31337"
    echo "      $(basename "$0") https://rpc.example 1 --verify --verifier blockscout --verifier-url https://blockscout.example/api"
}

if [[ $# -lt 2 ]] ; then
    printHelp
    exit 1
else
    NETWORK=$1
    CHAIN_ID=$2
    shift
    shift
fi

VERIFY_FLAGS=""
PUBLISH_CONFIGMAP="false"
while [[ $# -ge 1 ]] ; do
    key="$1"
    case $key in
        -h|--help )
            printHelp
            exit 0
            ;;
        --verify )
            VERIFY_FLAGS="$VERIFY_FLAGS --verify"
            ;;
        --verifier )
            VERIFY_FLAGS="$VERIFY_FLAGS --verifier $2"
            shift
            ;;
        --verifier-url )
            VERIFY_FLAGS="$VERIFY_FLAGS --verifier-url $2"
            shift
            ;;
        --publish-configmap )
            PUBLISH_CONFIGMAP="true"
            ;;
        * )
            echo "ERROR: Unknown flag: $key"
            exit 1
            ;;
    esac
    shift
done

# When running against generic RPC (e.g., anvil), we typically don't have a kind cluster.
# Override the helper to avoid kubectl calls unless explicitly requested.
if [ "$PUBLISH_CONFIGMAP" != "true" ]; then
    function deployRegistryContractAddressToConfigmap() {
        echo "Skipping registry address publication (use --publish-configmap to enable)."
    }
fi

echo "Running deployContracts via helpers.sh..."
deployContracts "$NETWORK" "$CHAIN_ID" "$VERIFY_FLAGS"
