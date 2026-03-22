#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && pwd)"
cd $SCRIPT_DIR

source ../../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") [-u USER] [--to-lab]"
    echo
    echo "Flags:"
    echo "  -u USER:  By default, data is synced with the pod started by the `jupyterhub` user."
    echo "            Use this flag to sync with another user."
    echo "  --to-lab: By default, data is copied from the lab to the local host."
    echo "            Use this flag to sync to the lab instead."
}

LAB_USER=""
SYNC_DIRECTION="from-lab"

# parse flags and options
while [[ $# -ge 1 ]] ; do
    key="$1"
    case $key in
        -h )
            printHelp
            exit 1
            ;;
        -u )
            LAB_USER=$2
            shift
            ;;
        --to-lab )
            SYNC_DIRECTION="to-lab"
            ;;
        * )
            echo "❌ Unknown flag: $key"
            printHelp
            exit 1
            ;;
    esac
    shift
done

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

if [[ "x$LAB_USER" == "x" ]]; then
    pod_name=$(getComponentPodName jupyterhub jupyterhub singleuser-server)
    if [[ "x$pod_name" == "x" ]]; then
        echo "❌ Could not determine unique pod name of jupyter hub. "
        echo "Make sure exactly one instance is running or pass the user name with -u USER."
        exit
    fi
else
    pod_name="jupyter-$LAB_USER"
fi

DATA_DIR=./notebook
NOTEBOOKS_DIR=${DATA_DIR}/notebooks
SCRIPTS_DIR=${DATA_DIR}/scripts

SCRIPTRUNNER_TMPDIR=.tmp
TMPDIR_FLAGFILE=.isCbdcSandboxTmpdir

# in the tmpdir we will store backups of the files that will be overwritten, just in case..
if [ -d "${SCRIPTRUNNER_TMPDIR}" ] && [ ! -f "${SCRIPTRUNNER_TMPDIR}/${TMPDIR_FLAGFILE}" ]; then
    echo "❌ found an existing tmpdir that is not the cbdc sandbox tmpdir. aborting."
    exit 1
elif [ -d "${SCRIPTRUNNER_TMPDIR}" ]; then
    rm -r ${SCRIPTRUNNER_TMPDIR}
fi
mkdir ${SCRIPTRUNNER_TMPDIR} && touch ${SCRIPTRUNNER_TMPDIR}/${TMPDIR_FLAGFILE}

if [ "$SYNC_DIRECTION" == "from-lab" ]; then
    # backup
    cp -r $NOTEBOOKS_DIR $SCRIPTRUNNER_TMPDIR/
    cp -r $SCRIPTS_DIR $SCRIPTRUNNER_TMPDIR/

    # sync
    kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec $pod_name --container notebook -- bash -c 'tar -C /home/jovyan -cf - *.ipynb' | tar -C $NOTEBOOKS_DIR -xf -
    kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec $pod_name --container notebook -- tar -C /home/jovyan -cf - scripts | tar -C $SCRIPTS_DIR --strip-components=1 -xf -
else
    # backup
    mkdir -p $SCRIPTRUNNER_TMPDIR/notebooks
    kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec $pod_name --container notebook -- bash -c 'tar -C /home/jovyan -cf - *.ipynb' | tar -C $SCRIPTRUNNER_TMPDIR/notebooks -xf -
    kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec $pod_name --container notebook -- tar -C /home/jovyan -cf - scripts | tar -C $SCRIPTRUNNER_TMPDIR/ -xf -

    # sync
    tar -C $DATA_DIR -cf - notebooks | kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec -i $pod_name --container notebook -- tar -C /home/jovyan --strip-components=1 -xf -
    tar -C $DATA_DIR -cf - scripts | kubectl --context=kind-$CLUSTER_NAME -n jupyterhub exec -i $pod_name --container notebook -- tar -C /home/jovyan -xf -
fi
