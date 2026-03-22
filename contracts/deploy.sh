#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
cd $SCRIPT_DIR

source ../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <network> <contract> [<private-key-handle>] [<verification flags>] <constructor args>"
    echo
    echo "    Description:"
    echo "      Deploy a contract / script to the target network (besu or anvil)."
    echo
    echo "      network: a network defined in foundry.toml, or a url"
    echo "      contract: <path to file>:<contract name> or"
    echo "                <path to script>:<contract name> (script needs to end with \"s.sol\")"
    echo "      private-key-handle: Private key handle from .env file to use (e.g. PK_BOB_TBD)"
    echo "                          use this only with contracts, not with scripts"
    echo "      --verify: Flag to enable contract verification. If a network other than besu-local is used,"
    echo "                the --verifier-url argument must also be provided."
    echo "      --verifier VERIFIER: The verification provider, defaults to \"blockscout\"."
    echo "      --verifier-url VERIFIER_URL: The url to the verification provider's api."
    echo "      constructor args: the constructor arguments for the contract or arguments for the script"
    echo
    echo "   Examples:"
    echo "     $(basename "$0") besu-local src/norges-bank/03_Wnok.sol:Wnok PK_DEPLOYER 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    echo "     $(basename "$0") anvil script/norges-bank/03_Wnok.s.sol:WnokScript"
}


# parse args
if [[ $# -lt 2 ]] ; then
    printHelp
    exit 1
else
    NETWORK=$1
    shift
    # target is a contract or script
    TARGET=$1
    shift
fi

if [[ $TARGET =~ ^.*\.s\.sol:.*$ ]] ; then
    TARGET_TYPE="script"
else
    TARGET_TYPE="contract"
    if [[ $# -lt 1 ]] ; then
        printHelp
        exit 1
    else
        PK_ENV=$1
        shift
    fi
fi

VERIFY="false"
VERIFIER="blockscout"
VERIFIER_URL=""
for ((i = 0 ; i < 3 ; i++ )); do
    # we have up to three optional arguments
    # which are positional in the sense that they have to
    # be placed before the contract contructor arguments
    if [[ $# -gt 0 ]] ; then
        key="$1"
        case $key in
            --verify )
                VERIFY="true"
                shift
                ;;
            --verifier )
                echo "verifier"
                VERIFIER="$2"
                shift
                shift
                ;;
            --verifier-url )
                echo "verifier_url"
                VERIFIER_URL="$2"
                shift
                shift
                ;;
        esac
    fi
done

# this allows us to use an address other than that in the .env file
set +u
REGISTRY_ADDR_ENV=$REGISTRY_ADDR
set -u

requireContractsEnv
source "$CONTRACTS_ENV_FILE"

if [[ $TARGET_TYPE == "contract" ]] ; then
    # Initialise PRIVATE_KEY with the _value_ of the env variable whose name was
    # specified by the user
    set +u
    PRIVATE_KEY=${!PK_ENV}
    set -u
    if [[ "x$PRIVATE_KEY" == "x" ]]; then
        echo "Could not find private key for handle '$PK_ENV' in .env, aborting"
        exit 1
    fi
fi

if ! [[ "x$REGISTRY_ADDR_ENV" == "x" ]]; then
    REGISTRY_ADDR=$REGISTRY_ADDR_ENV
fi

ARGS=""

if [[ $VERIFY == "true" ]]; then
    if [[ $NETWORK == "besu-local" ]]; then
        VERIFIER_URL=$BLOCKSCOUT_LOCAL_URL
    elif [[ "x$VERIFIER_URL" == "x" ]]; then
        echo "❌ No default verifier-url for network \"$NETWORK\"."
        echo "Please pass it using --verifier-url VERIFIER_URL"
        exit 1
    fi
    ARGS="${ARGS} --verify --verifier $VERIFIER --verifier-url $VERIFIER_URL"
fi

if [[ $TARGET_TYPE == "script" ]] ; then
    CMD="forge script"
    ARGS="${ARGS} --priority-gas-price 0 --with-gas-price 0"
    if [ "${DEPLOY_SKIP_SIMULATION:-false}" == "true" ]; then
        ARGS="${ARGS} --skip-simulation"
    fi
    if [[ $# -ge 1 ]] ; then
        ARGS="${ARGS} ${@}"
    fi
else
    CMD="forge create"
    # Note: forge script's --with-gas-price corresponds to forge create's --gas-price
    ARGS="${ARGS} --priority-gas-price 0 --gas-price 0 --private-key $PRIVATE_KEY"
    if [[ $# -ge 1 ]] ; then
        ARGS="${ARGS} --constructor-args ${@}"
    fi
fi

$CMD --rpc-url $NETWORK $TARGET --broadcast $ARGS
