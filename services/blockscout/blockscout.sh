#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR
echo "Script Dir: $SCRIPT_DIR"

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
# OPTIONAL BLOCKSCOUT FLAGS (set before running this script)
# - USE_KIND_REGISTRY: true pushes/pulls via local registry; false loads directly.
################################################################################
export USE_KIND_REGISTRY="${USE_KIND_REGISTRY:-true}"

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [ "$CMD" == "start" ]; then
    deployEvmEnvironmentSecret $BLOCKSCOUT_NAMESPACE
    deployBensScriptsToConfigmap
    composeBlockscoutChart
    deployBlockscout
elif [ "$CMD" == "stop" ]; then
    echo "Deleting namespace..."
    kubectl --context=kind-$CLUSTER_NAME delete namespaces $BLOCKSCOUT_NAMESPACE
    echo "Shutdown completed successfully!"
fi
