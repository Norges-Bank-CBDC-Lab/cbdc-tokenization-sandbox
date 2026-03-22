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
# - USE_KIND_REGISTRY: true pushes/pulls via local registry; false loads directly.
################################################################################
export USE_KIND_REGISTRY="${USE_KIND_REGISTRY:-true}"

if [ "$CMD" == "start" ]; then
    requireNBBondApiHelmValues
fi

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [ "$CMD" == "start" ]; then
    # ensure dist folder exists, if not build the project
    if [ ! -d "./dist" ]; then
        echo "♻️ NB Bond API 'dist' folder not found. Building..."
        # install deps and build with npm
        if [ -f "package-lock.json" ]; then
            npm ci || {
                echo "❌ Failed to install NB Bond API dependencies (npm ci)"
                exit 1
            }
        else
            npm install || {
                echo "❌ Failed to install NB Bond API dependencies (npm install)"
                exit 1
            }
        fi
        npm run build || {
            echo "❌ Failed to build NB Bond API"
            exit 1
        }
    fi
    deployNBBondAPI

    if [ "$IS_SUBTASK" == "false" ]; then
        waitForNBBondAPI
    fi

elif [ "$CMD" == "stop" ]; then
    helm uninstall nb-bond-api -n nb-bond-api || true
fi
