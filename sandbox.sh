#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR

if [ ! -f "$SCRIPT_DIR/common/helpers.sh" ]; then
  echo "❌ Cannot find $SCRIPT_DIR/common/helpers.sh. Aborting."
  exit 1
fi

source ./common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <start|stop|delete|generate-config|registry-start|registry-sync|build-images> [Flags]"
    echo
    echo "    Flags:"
    echo "      -h - Print this message"
    echo
    echo "    Description:"
    echo "      start: Start the cluster and components of the cbdc sandbox"
    echo "      stop: Stop components of the cbdc sandbox (keeps cluster)"
    echo "      delete: Delete the kind cluster (full teardown)"
    echo "      generate-config: Create $DEPLOYMENT_CONFIG_FILE config file with flags to control"
    echo "                       which components to deploy."
    echo "      registry-start: Start the local registry container"
    echo "      registry-sync: Push configured images to the local registry"
    echo "      build-images: Optional local override: build Blockscout backend/frontend from upstream source tags"
}

################################################################################
# OPTIONAL SANDBOX FLAGS (set before running this script)
# - DEPLOY_INFRA: true deploys Kind + Besu; false skips infra setup entirely.
# - DEPLOY_CONTRACTS: true deploys contracts; false leaves contracts untouched.
# - DEPLOY_VERIFY_CONTRACTS: true verifies on Blockscout; false skips verification.
# - DEPLOY_SKIP_SIMULATION: true skips forge script simulation; false runs simulation.
# - DEPLOY_SCRIPTRUNNER: true deploys JupyterHub; false skips script runner.
# - DEPLOY_BLOCKSCOUT: true deploys Blockscout; false skips the explorer stack.
# - DEPLOY_NB_BOND_API: true deploys NB Bond API; false skips the API service.
# - WAIT_FOR_APP_TIMEOUT_SECONDS: max seconds to wait; lower fails faster.
# - USE_KIND_REGISTRY: true pushes/pulls via local registry; false loads directly.
################################################################################
export DEPLOY_INFRA="true"
export DEPLOY_CONTRACTS="true"
export DEPLOY_VERIFY_CONTRACTS="true"
export DEPLOY_SKIP_SIMULATION="${DEPLOY_SKIP_SIMULATION:-false}"
export DEPLOY_SCRIPTRUNNER="false"
export DEPLOY_BLOCKSCOUT="true"
export DEPLOY_NB_BOND_API="true"
export WAIT_FOR_APP_TIMEOUT_SECONDS="${WAIT_FOR_APP_TIMEOUT_SECONDS:-60}"
export USE_KIND_REGISTRY="${USE_KIND_REGISTRY:-true}"

function printServiceUrls() {
    title="SERVICE URLS (READY)"
    border="************************************************************"
    bold_on=$'\033[1m'
    bold_off=$'\033[0m'

    echo
    echo "${bold_on}${border}${bold_off}"
    echo "${bold_on}* ${title}${bold_off}"

    if [ "$DEPLOY_INFRA" == "true" ]; then
        echo "${bold_on}* Besu RPC:      http://besu.cbdc-sandbox.local:8545${bold_off}"
        echo "${bold_on}* Besu WS:       ws://besu.cbdc-sandbox.local:8546${bold_off}"
    fi

    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        echo "${bold_on}* Blockscout:    http://blockscout.cbdc-sandbox.local${bold_off}"
    fi

    echo "${bold_on}${border}${bold_off}"
    echo
}

function printPostContractsUrls() {
    title="SERVICE URLS (POST-CONTRACTS)"
    border="************************************************************"
    bold_on=$'\033[1m'
    bold_off=$'\033[0m'

    echo
    echo "${bold_on}${border}${bold_off}"
    echo "${bold_on}* ${title}${bold_off}"

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        echo "${bold_on}* NB Bond API:   http://bond-api.cbdc-sandbox.local${bold_off}"
    fi

    echo "${bold_on}${border}${bold_off}"
    echo
}

# generate deployment config
function generateConfig() {
    prefix="DEPLOY_"

    # write all environment variables with the given prefix to file
    env | grep "^${prefix}" > "$DEPLOYMENT_CONFIG_FILE"

    echo "wrote config to $DEPLOYMENT_CONFIG_FILE"
}

# parse command
if [[ $# -lt 1 ]] ; then
    printHelp
    exit 1
else
    CMD=$1
    shift
fi

# parse flags and options
while [[ $# -ge 1 ]] ; do
    key="$1"
    case $key in
        -h )
            printHelp
            exit 1
            ;;
        * )
            echo "❌ Unknown flag: $key"
            exit 1
            ;;
    esac
    shift
done

if [ "$CMD" == "start" ]; then
    checkPrereqs
    if [ -f "$DEPLOYMENT_CONFIG_FILE" ]; then
        source "$DEPLOYMENT_CONFIG_FILE"
    fi

    if [ "$DEPLOY_CONTRACTS" == "true" ] || [ "$DEPLOY_SCRIPTRUNNER" == "true" ]; then
        requireContractsEnv
    fi

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        requireNBBondApiHelmValues
    fi

    ensureLocalhostHostEntries
    deployedSomething="false"

    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        requireKindRegistry
    fi

    # deploy infra
    if [ "$DEPLOY_INFRA" == "true" ]; then
        echo "Deploying cluster and besu network..."
        cd $SCRIPT_DIR/infra
        ./infra.sh start --as-subtask
        deployedSomething="true"
    fi

    # deploy blockscout
    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        echo "Deploying Blockscout..."
        cd $SCRIPT_DIR/services/blockscout
        ./blockscout.sh start --as-subtask
        deployedSomething="true"
    fi

    # ensure endpoints are reachable before we deploy contracts
    if [ "$DEPLOY_INFRA" == "true" ]; then
        waitForBesu
        waitForApiGateway
    fi

    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        waitForBlockscout
    fi

    if [ "$DEPLOY_INFRA" == "true" ] || [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        printServiceUrls
    fi

    # deploy contracts
    if [ "$DEPLOY_CONTRACTS" == "true" ]; then
        VERIFY_CONTRACTS=""
        if [ "$DEPLOY_VERIFY_CONTRACTS" == "true" ]; then
            VERIFY_CONTRACTS="--verify"

            if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
                waitForBlockscout
            fi
        fi

        echo "Deploying contracts..."
        cd $SCRIPT_DIR/contracts
        ./contracts.sh start --as-subtask $VERIFY_CONTRACTS
        deployedSomething="true"
    fi

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        echo "Deploying NB Bond API..."
        cd $SCRIPT_DIR/services/nb-bond-api
        ./nb-bond-api.sh start --as-subtask
        deployedSomething="true"
    fi

    if [ "$DEPLOY_SCRIPTRUNNER" == "true" ]; then
        echo "Deploying script runner..."
        cd $SCRIPT_DIR/services/script-runner
        ./script-runner.sh start --as-subtask
        deployedSomething="true"
    fi

    if [ "$DEPLOY_INFRA" == "true" ]; then
        waitForBesu
        waitForApiGateway
    fi

    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        waitForBlockscout
    fi

    if [ "$DEPLOY_SCRIPTRUNNER" == "true" ]; then
        waitForScriptRunner
    fi

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        waitForNBBondAPI
        printPostContractsUrls
    fi

    if [ "$deployedSomething" == "true" ]; then
        echo
        echo "✔️ Finished deploying the cbdc sandbox."
        echo "The following infra and services can now be accessed:"
    else
        echo "All deployment flags are set to false (cf $DEPLOYMENT_CONFIG_FILE). Nothing to do."
    fi

    if [ "$DEPLOY_INFRA" == "true" ]; then
        echo
        echo " - besu rpc node, via"
        echo "   http://besu.cbdc-sandbox.local:8545"
        echo "   ws://besu.cbdc-sandbox.local:8546"
    fi

    if [ "$DEPLOY_CONTRACTS" == "true" ]; then
        echo
        echo " - contracts, via the registry contract at"
        echo "   $(getRegistryContractAddressFromConfigmap)"
    fi

    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        echo
        echo " - Blockscout, via"
        echo "   http://blockscout.cbdc-sandbox.local"
    fi

    if [ "$DEPLOY_SCRIPTRUNNER" == "true" ]; then
        echo
        echo " - script runner, via"
        echo "   http://jupyterhub.cbdc-sandbox.local"
    fi

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        echo
        echo " - NB Bond API, via"
        echo "   http://bond-api.cbdc-sandbox.local"
    fi

elif [ "$CMD" == "stop" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    if [[ $(clusterExists) == "false" ]]; then
        echo "Cluster '$CLUSTER_NAME' does not exist. Nothing to stop."
        exit 0
    fi

    if [ "$DEPLOY_NB_BOND_API" == "true" ]; then
        cd $SCRIPT_DIR/services/nb-bond-api
        ./nb-bond-api.sh stop --as-subtask || true
    fi

    if [ "$DEPLOY_SCRIPTRUNNER" == "true" ]; then
        cd $SCRIPT_DIR/services/script-runner
        ./script-runner.sh stop --as-subtask || true
    fi

    if [ "$DEPLOY_CONTRACTS" == "true" ]; then
        cd $SCRIPT_DIR/contracts
        ./contracts.sh stop --as-subtask || true
    fi

    if [ "$DEPLOY_BLOCKSCOUT" == "true" ]; then
        cd $SCRIPT_DIR/services/blockscout
        ./blockscout.sh stop --as-subtask || true
    fi

    if [ "$DEPLOY_INFRA" == "true" ]; then
        cd $SCRIPT_DIR/infra
        ./infra.sh stop --as-subtask || true
        clearContractsDeploymentMarker
    fi
elif [ "$CMD" == "delete" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    if [[ $(clusterExists) == "false" ]]; then
        echo "Cluster '$CLUSTER_NAME' does not exist. Nothing to delete."
        exit 0
    fi
    cd $SCRIPT_DIR/infra
    ./infra.sh delete --as-subtask
elif [ "$CMD" == "registry-start" ]; then
    cd $SCRIPT_DIR/infra
    ./infra.sh registry-start --as-subtask
elif [ "$CMD" == "registry-sync" ]; then
    checkPrereqs
    cd $SCRIPT_DIR/infra
    ./infra.sh registry-sync --as-subtask
elif [ "$CMD" == "build-images" ]; then
    checkPrereqs
    echo "ℹ️ Default sandbox deploys use published Blockscout images pinned in services/blockscout/values.yaml."
    echo "ℹ️ build-images is an optional local override for testing upstream Blockscout source changes."
    cd $SCRIPT_DIR/services/blockscout
    ./build-images.sh
elif [ "$CMD" == "generate-config" ]; then
    checkPrereqs
    ensureLocalhostHostEntries
    if [ -f "$DEPLOYMENT_CONFIG_FILE" ]; then
        echo "❌ '$DEPLOYMENT_CONFIG_FILE' already exists."
        echo "Please delete or rename it if you want to generate a new config file."
    else
        generateConfig
    fi
else
    echo "❌ Unknown command \"$CMD\". Aborting."
    exit 1
fi
