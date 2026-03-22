#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
cd $SCRIPT_DIR

source ../common/helpers.sh

# print help message
function printHelp() {
    echo "Usage is: "
    echo "  $(basename "$0") <start|stop|verify|verify-latest>"
    echo
    echo "  verify:"
    echo "    --address <contract-address> (required)"
    echo "    --contract <path:ContractName> (required)"
    echo "    --constructor-args <abi-encoded-args> (optional)"
    echo "    --constructor-args-path <path> (optional)"
    echo "    --guess-constructor-args (optional, default)"
    echo "    --no-guess-constructor-args (optional)"
    echo "    --verifier <verifier> (optional, default blockscout)"
    echo "    --verifier-url <url> (optional, default BLOCKSCOUT_LOCAL_URL from .env)"
    echo "    --watch (optional)"
    echo
    echo "  verify-latest:"
    echo "    Verifies all CREATE deployments from broadcast/*/<chain-id>/run-latest.json"
    echo "    using known contract name -> source mappings."
    echo "    --chain-id <id> (optional, default 2018)"
    echo "    --broadcast-dir <dir> (optional, default broadcast)"
    echo "    --verifier <verifier> (optional, default blockscout)"
    echo "    --verifier-url <url> (optional, default BLOCKSCOUT_LOCAL_URL from .env)"
    echo "    --watch (optional)"
    echo "    --no-guess-constructor-args (optional)"
}

function resolveContractIdentifier() {
    contract_name="$1"
    # IMPORTANT: keep this mapping in sync with new deployable contract types.
    # If a new contract is created via scripts and should be auto-verified by
    # `verify-latest`, add its contract name and source identifier here.
    case "$contract_name" in
        GlobalRegistry)
            echo "src/common/GlobalRegistry.sol:GlobalRegistry"
            ;;
        DvP)
            echo "src/csd/DvP.sol:DvP"
            ;;
        Wnok)
            echo "src/norges-bank/Wnok.sol:Wnok"
            ;;
        Tbd)
            echo "src/private-bank/Tbd.sol:Tbd"
            ;;
        StockToken)
            echo "src/csd/StockToken.sol:StockToken"
            ;;
        StockTokenFactory)
            echo "src/csd/StockTokenFactory.sol:StockTokenFactory"
            ;;
        OrderBook)
            echo "src/csd/OrderBook.sol:OrderBook"
            ;;
        Broker)
            echo "src/broker/Broker.sol:Broker"
            ;;
        BondAuction)
            echo "src/norges-bank/BondAuction.sol:BondAuction"
            ;;
        BondToken)
            echo "src/norges-bank/BondToken.sol:BondToken"
            ;;
        BondDvP)
            echo "src/norges-bank/BondDvP.sol:BondDvP"
            ;;
        BondManager)
            echo "src/norges-bank/BondManager.sol:BondManager"
            ;;
        *)
            return 1
            ;;
    esac
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
VERIFY_CONTRACTS=""

# parse flags and options for start/stop only
if [ "$CMD" == "start" ] || [ "$CMD" == "stop" ]; then
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
            --verify )
                VERIFY_CONTRACTS="--verify"
                ;;
            * )
                echo "❌ Unknown flag: $key"
                exit 1
                ;;
        esac
        shift
    done
fi

if [ "$IS_SUBTASK" == "false" ]; then
    checkPrereqs
fi

if [ "$CMD" == "start" ] || [ "$CMD" == "verify" ] || [ "$CMD" == "verify-latest" ]; then
    requireContractsEnv
fi

if [[ $(clusterExists) == "false" ]]; then
    echo "Cluster '$CLUSTER_NAME' does not exists. Please start it first."
    exit 1
fi

NETWORK=besu-local
CHAIN_ID=2018

if [ "$CMD" == "start" ]; then
    if [ "$(contractsDeploymentExists)" == "true" ]; then
        deployed_chain_id="$(getContractsDeploymentChainId)"
        deployed_registry_address="$(getContractsDeploymentRegistryAddress)"
        if [ -n "$deployed_chain_id" ] && [ "$deployed_chain_id" == "$CHAIN_ID" ]; then
            if [ -n "$deployed_registry_address" ]; then
                echo "✅ Contracts already deployed (chain $deployed_chain_id, registry $deployed_registry_address). Skipping deploy."
                deployRegistryContractAddressToConfigmap "$deployed_registry_address"
                exit 0
            fi
            echo "ℹ️ Contracts marker found without registry address; proceeding with deploy."
        else
            echo "ℹ️ Contracts marker found for chain $deployed_chain_id (current $CHAIN_ID); proceeding with deploy."
        fi
    fi

    # remove build artifacts and cache directories
    forge clean

    # wait for besu to be ready
    waitForBesu
    waitForApiGateway
    sleep 5

    deployContracts $NETWORK $CHAIN_ID $VERIFY_CONTRACTS
elif [ "$CMD" == "stop" ]; then
    echo "deleting the contract registry from the cluster, but leaving contracts deployed and running in Besu"

    kubectl --context=kind-$CLUSTER_NAME -n $REGISTRY_CONTRACT_NAMESPACE delete configmap $REGISTRY_CONTRACT_CONFIGMAP || true
elif [ "$CMD" == "verify" ]; then
    source "$CONTRACTS_ENV_FILE"

    ADDRESS=""
    CONTRACT=""
    CONSTRUCTOR_ARGS=""
    CONSTRUCTOR_ARGS_PATH=""
    VERIFIER="blockscout"
    VERIFIER_URL="${BLOCKSCOUT_LOCAL_URL:-}"
    WATCH_FLAG="false"
    GUESS_ARGS="true"

    while [[ $# -ge 1 ]] ; do
        key="$1"
        case $key in
            -h )
                printHelp
                exit 1
                ;;
            --address )
                ADDRESS="$2"
                shift
                shift
                ;;
            --contract )
                CONTRACT="$2"
                shift
                shift
                ;;
            --constructor-args )
                CONSTRUCTOR_ARGS="$2"
                shift
                shift
                ;;
            --constructor-args-path )
                CONSTRUCTOR_ARGS_PATH="$2"
                shift
                shift
                ;;
            --guess-constructor-args )
                GUESS_ARGS="true"
                shift
                ;;
            --no-guess-constructor-args )
                GUESS_ARGS="false"
                shift
                ;;
            --verifier )
                VERIFIER="$2"
                shift
                shift
                ;;
            --verifier-url )
                VERIFIER_URL="$2"
                shift
                shift
                ;;
            --watch )
                WATCH_FLAG="true"
                shift
                ;;
            * )
                echo "❌ Unknown flag: $key"
                exit 1
                ;;
        esac
    done

    if [ -z "$ADDRESS" ] || [ -z "$CONTRACT" ]; then
        echo "❌ Missing required flags --address and/or --contract"
        printHelp
        exit 1
    fi

    if [ -z "$VERIFIER_URL" ]; then
        echo "❌ BLOCKSCOUT_LOCAL_URL is not set and no --verifier-url was provided."
        exit 1
    fi

    VERIFY_ARGS="--verifier $VERIFIER --verifier-url $VERIFIER_URL --rpc-url $BESU_LOCAL_RPC_URL --chain 2018"

    if [ "$WATCH_FLAG" == "true" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --watch"
    fi

    if [ -n "$CONSTRUCTOR_ARGS_PATH" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --constructor-args-path $CONSTRUCTOR_ARGS_PATH"
    elif [ -n "$CONSTRUCTOR_ARGS" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --constructor-args $CONSTRUCTOR_ARGS"
    elif [ "$GUESS_ARGS" == "true" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --guess-constructor-args"
    fi

    forge verify-contract $ADDRESS $CONTRACT $VERIFY_ARGS
elif [ "$CMD" == "verify-latest" ]; then
    source "$CONTRACTS_ENV_FILE"

    TARGET_CHAIN_ID="$CHAIN_ID"
    BROADCAST_DIR="broadcast"
    VERIFIER="blockscout"
    VERIFIER_URL="${BLOCKSCOUT_LOCAL_URL:-}"
    WATCH_FLAG="false"
    GUESS_ARGS="true"

    while [[ $# -ge 1 ]] ; do
        key="$1"
        case $key in
            -h )
                printHelp
                exit 1
                ;;
            --chain-id )
                TARGET_CHAIN_ID="$2"
                shift
                shift
                ;;
            --broadcast-dir )
                BROADCAST_DIR="$2"
                shift
                shift
                ;;
            --guess-constructor-args )
                GUESS_ARGS="true"
                shift
                ;;
            --no-guess-constructor-args )
                GUESS_ARGS="false"
                shift
                ;;
            --verifier )
                VERIFIER="$2"
                shift
                shift
                ;;
            --verifier-url )
                VERIFIER_URL="$2"
                shift
                shift
                ;;
            --watch )
                WATCH_FLAG="true"
                shift
                ;;
            * )
                echo "❌ Unknown flag: $key"
                exit 1
                ;;
        esac
    done

    if [ -z "$VERIFIER_URL" ]; then
        echo "❌ BLOCKSCOUT_LOCAL_URL is not set and no --verifier-url was provided."
        exit 1
    fi

    if [ ! -d "$BROADCAST_DIR" ]; then
        echo "❌ Broadcast directory not found: $BROADCAST_DIR"
        exit 1
    fi

    VERIFY_ARGS="--verifier $VERIFIER --verifier-url $VERIFIER_URL --rpc-url $BESU_LOCAL_RPC_URL --chain $TARGET_CHAIN_ID"
    if [ "$WATCH_FLAG" == "true" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --watch"
    fi
    if [ "$GUESS_ARGS" == "true" ]; then
        VERIFY_ARGS="$VERIFY_ARGS --guess-constructor-args"
    fi

    total=0
    success=0
    failed=0
    skipped=0

    while IFS=$'\t' read -r contract_name contract_address; do
        if [ -z "$contract_name" ] || [ -z "$contract_address" ]; then
            continue
        fi

        total=$((total + 1))
        if ! contract_identifier="$(resolveContractIdentifier "$contract_name")"; then
            echo "⚠️  Skipping $contract_name at $contract_address (no source mapping in contracts.sh)"
            skipped=$((skipped + 1))
            continue
        fi

        echo "🔎 Verifying $contract_name at $contract_address as $contract_identifier"
        if forge verify-contract "$contract_address" "$contract_identifier" $VERIFY_ARGS; then
            success=$((success + 1))
        else
            failed=$((failed + 1))
            echo "❌ Verification failed for $contract_name at $contract_address"
        fi
    done < <(
        find "$BROADCAST_DIR" -maxdepth 3 -type f -path "*/${TARGET_CHAIN_ID}/run-latest.json" | sort | while read -r runfile; do
            jq -r '.transactions[]? | select(.transactionType == "CREATE") | [.contractName, .contractAddress] | @tsv' "$runfile"
        done | sort -u
    )

    if [ "$total" -eq 0 ]; then
        echo "❌ No CREATE deployments found under ${BROADCAST_DIR}/*/${TARGET_CHAIN_ID}/run-latest.json"
        exit 1
    fi

    echo "Verification summary: total=$total success=$success skipped=$skipped failed=$failed"
    if [ "$failed" -gt 0 ]; then
        exit 1
    fi
else
    echo "❌ Unknown command: $CMD"
    printHelp
    exit 1
fi
