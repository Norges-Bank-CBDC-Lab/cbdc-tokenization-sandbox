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

if [ "$CMD" == "start" ]; then
    requireContractsEnv
fi

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [ "$CMD" == "start" ]; then
    # deploy the environment secret if it does not exist, as it is required for the spawn of notebook server
    deployEvmEnvironmentSecret $SCRIPTRUNNER_NAMESPACE

    # try to get the registry contract address from the configmap
    registry_contract_address=$(getRegistryContractAddressFromConfigmap)
    if [ "x$registry_contract_address" == "x" ]; then
        echo "⚠️ could not get registry contract address from configmap, using default..."
        registry_contract_address="$(getDefaultRegistryContractAddress)"

        deployRegistryContractAddressToConfigmap $registry_contract_address
    fi

    deployScriptRunnerScriptsToConfigmap
    deployScriptRunnerNotebooksToConfigmap
    deployScriptRunnerContractAbisToConfigmap

    composeScriptRunnerChart
    deployScriptRunner

    if [ "$IS_SUBTASK" == "false" ]; then
        waitForScriptRunner
    fi

elif [ "$CMD" == "stop" ]; then
    helm uninstall jupyterhub -n jupyterhub || true
fi
