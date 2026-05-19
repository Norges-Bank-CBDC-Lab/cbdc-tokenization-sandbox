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

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [ "$CMD" == "start" ]; then
    # deployNBUI builds services/nb-ui via Dockerfile, tags it with the
    # bundle content hash, pushes to the local kind registry, and installs
    # the chart pointing at that image. The image bundles dist/ at
    # /usr/share/nginx/html/; runtime config.js is overlaid from a chart
    # ConfigMap at install time.
    deployNBUI

    if [ "$IS_SUBTASK" == "false" ]; then
        waitForNBUI
    fi

elif [ "$CMD" == "stop" ]; then
    helm uninstall nb-ui -n nb-ui || true
fi
