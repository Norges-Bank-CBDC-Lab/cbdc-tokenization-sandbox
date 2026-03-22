#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR

source ../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <start|stop|delete|registry-start|registry-sync>"
    echo
    echo "Notes:"
    echo "  stop keeps the kind cluster and its image cache; delete removes the cluster."
    echo "  registry-start starts the local registry container."
    echo "  registry-sync pushes configured images to the local registry."
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

if [ "$CMD" == "start" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        requireKindRegistry
    fi
    createKindCluster
    export USE_KIND_REGISTRY="${USE_KIND_REGISTRY:-true}"

    deployApiGateway

    deployBesu

    if [ "$IS_SUBTASK" == "false" ]; then
        waitForBesu
    fi

elif [ "$CMD" == "stop" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    helm uninstall gateway -n nginx-gateway || true
    helm uninstall ngf -n nginx-gateway || true
    helm uninstall besu -n besu || true
elif [ "$CMD" == "registry-start" ]; then
    ensureKindRegistry
elif [ "$CMD" == "registry-sync" ]; then
    checkPrereqs
    export USE_KIND_REGISTRY="true"
    ensureKindRegistry
    syncImagesToRegistry
elif [ "$CMD" == "delete" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    kind delete cluster --name $CLUSTER_NAME
fi
