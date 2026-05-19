#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR

source ../../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <start|stop>"
}


# parse command
if [[ $# -lt 1 ]] ; then
    printHelp
    exit 1
else
    CMD=$1
    shift
fi

IS_SUBTASK="false"

# parse flags and options
while [[ $# -ge 1 ]] ; do
    key="$1"
    case $key in
        -h )
            printHelp
            exit 1
            ;;
        --as-subtask )
            IS_SUBTASK="true"
            ;;
        * )
            echo "❌ Unknown flag: $key"
            exit 1
            ;;
    esac
    shift
done

if [ "$IS_SUBTASK" == "false" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
fi

################################################################################
# OPTIONAL NB BOND API FLAGS (set before running this script)
# - USE_KIND_REGISTRY: must be true; the chart pulls the locally-built image
#                      from the kind registry. Set to false only if you're
#                      replacing the build/push flow with something else.
################################################################################
export USE_KIND_REGISTRY="${USE_KIND_REGISTRY:-true}"

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [ "$CMD" == "start" ]; then
    # deployNBBondAPI builds services/nb-bond-api via Dockerfile, tags it with
    # the bundle content hash, pushes to the local kind registry, and installs
    # the chart pointing at that image. The image bundles dist/ + production
    # node_modules; the SQLite ingestion DB lives on an emptyDir at /app/data.
    deployNBBondAPI

    if [ "$IS_SUBTASK" == "false" ]; then
        waitForNBBondAPI
    fi

elif [ "$CMD" == "stop" ]; then
    helm uninstall nb-bond-api -n nb-bond-api || true
fi
