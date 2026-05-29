#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR

source ../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <start|stop|delete|registry-start|registry-sync|registry-reset|cleanup-images|image-report> [--keep N] [--prune-build-cache]"
    echo
    echo "Notes:"
    echo "  stop keeps the kind cluster and its image cache; delete removes the cluster."
    echo "  registry-start starts the local registry container."
    echo "  registry-sync pushes configured images to the local registry."
    echo "  registry-reset recreates the registry container and re-syncs base images (reclaims registry disk)."
    echo "  cleanup-images prunes old nb-ui/nb-bond-api/bens-microservice tags (keep N newest, default 3)."
    echo "  image-report prints a read-only view of pod/registry image state."
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
KEEP_IMAGES=3
PRUNE_BUILD_CACHE="false"

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
        --keep )
            shift
            KEEP_IMAGES="$1"
            ;;
        --prune-build-cache )
            PRUNE_BUILD_CACHE="true"
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
    requireKindRegistry
    createKindCluster

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
    ensureKindRegistry
    syncImagesToRegistry
elif [ "$CMD" == "delete" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    kind delete cluster --name $CLUSTER_NAME
elif [ "$CMD" == "registry-reset" ]; then
    resetKindRegistry
elif [ "$CMD" == "cleanup-images" ]; then
    cleanupSandboxImages "$KEEP_IMAGES" "$PRUNE_BUILD_CACHE"
elif [ "$CMD" == "image-report" ]; then
    reportSandboxImages
fi
