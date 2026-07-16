set -Eeuo pipefail

CLUSTER_NAME="cluster-cbdc-monoledger"
DEPLOYMENT_CONFIG_FILE=".env.sandbox"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && cd .. && pwd)"
TMPDIR_FLAGFILE=.isCbdcSandboxTmpdir
IMAGES_CONFIG=$REPO_ROOT/common/images.yaml
VERSIONS_CONFIG=$REPO_ROOT/common/versions.yaml
NODE_VERSION_CONFIG=$REPO_ROOT/common/node-version.env

if [ ! -f "$NODE_VERSION_CONFIG" ]; then
    echo "❌ Missing Node version config: $NODE_VERSION_CONFIG" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "$NODE_VERSION_CONFIG"
: "${SANDBOX_NODE_VERSION:?Missing SANDBOX_NODE_VERSION in $NODE_VERSION_CONFIG}"
: "${SANDBOX_NODE_IMAGE:?Missing SANDBOX_NODE_IMAGE in $NODE_VERSION_CONFIG}"

REGISTRY_CONTRACT_NAMESPACE=contracts
REGISTRY_CONTRACT_CONFIGMAP=registry-contract

CONTRACTS_DEPLOYMENT_NAMESPACE=$REGISTRY_CONTRACT_NAMESPACE
CONTRACTS_DEPLOYMENT_CONFIGMAP=contracts-deployed

EVM_ENVIRONMENT_SECRET=environment

CONTRACTS_DIR=$REPO_ROOT/contracts
CONTRACTS_BUILD_DIR=$REPO_ROOT/contracts/out
CONTRACTS_ENV_FILE=$CONTRACTS_DIR/.env
CONTRACTS_ENV_EXAMPLE_FILE=$CONTRACTS_DIR/.env.example
LOCAL_SANDBOX_FIXTURE_GENERATOR=$REPO_ROOT/scripts/generate-local-sandbox-fixtures.mjs

BLOCKSCOUT_NAMESPACE=blockscout
BLOCKSCOUT_CHAIN_IDENTITY_CONFIGMAP=blockscout-chain-identity
BLOCKSCOUT_DIR=$REPO_ROOT/services/blockscout
BLOCKSCOUT_TMPDIR=$BLOCKSCOUT_DIR/.tmp
BLOCKSCOUT_CHART_VERSION=4.5.1
BLOCKSCOUT_BENS_DIR=$BLOCKSCOUT_DIR/bens-microservice
BENS_BASEIMAGE=python:3.14.5

NB_BOND_API_NAMESPACE=nb-bond-api
NB_BOND_API_DIR=$REPO_ROOT/services/nb-bond-api
NB_BOND_API_BUILDER_BASEIMAGE=$SANDBOX_NODE_IMAGE
NB_BOND_API_RUNTIME_BASEIMAGE=$SANDBOX_NODE_IMAGE
NB_BOND_API_HELM_VALUES_FILE=$REPO_ROOT/services/nb-bond-api/helm/values.local.yaml
NB_BOND_API_HELM_VALUES_EXAMPLE_FILE=$REPO_ROOT/services/nb-bond-api/helm/values.local.example.yaml
NB_UI_NAMESPACE=nb-ui
NB_UI_DIR=$REPO_ROOT/services/nb-ui
NB_UI_BUILDER_BASEIMAGE=$SANDBOX_NODE_IMAGE
NB_UI_NGINX_BASEIMAGE=nginxinc/nginx-unprivileged:1.30.3-alpine
# Backwards-compat alias; older code paths and external callers may still
# reference NB_UI_BASEIMAGE expecting the nginx runtime base.
NB_UI_BASEIMAGE=$NB_UI_NGINX_BASEIMAGE

KIND_REGISTRY_NAME=kind-registry
KIND_REGISTRY_PORT=5001
KIND_REGISTRY_IMAGE=registry:2.8.3
KIND_REGISTRY_ENDPOINT="http://localhost:${KIND_REGISTRY_PORT}"

OS_NAME=$(uname)

function checkPrereqs() {
    #Checking OS compatibility
    if [ "$OS_NAME" == "Linux" ]; then
        set +e
        hasWsl=$(uname -r | grep -i "microsoft")
        hasWsl2=$(uname -r | grep "WSL2")
        set -e
        if [ -n "$hasWsl" ]; then
            if [ -n "$hasWsl2" ]; then
                echo "✅ Running under WSL2 ($hasWsl2)"
            else
                echo "❌ This script needs to be run under Linux / WSL2."
                exit 1
            fi
        else
            echo "✅ Running on Linux ($(uname -r))"
        fi
    elif [ "$OS_NAME" == "Darwin" ]; then
        echo "✅ Running on MacOS"
    else
        echo "❌ Unsupported OS: $OS_NAME"
        exit 1
    fi

    #Checking if Docker is installed
    set +e
    hasDockerCompose=$(docker-compose --version 2>/dev/null | grep -i "docker compose version")
    hasDocker=$(docker info 2>/dev/null | grep -i "server version")
    set -e

    if [ -z "$hasDockerCompose" ] && [ -z "$hasDocker" ]; then
        echo "❌ Docker Engine is not running or not installed properly."
        echo "   Please start Docker Desktop or your Docker Engine."
        exit 1
    fi

    # check more installed packages
    for bin in jq yq node npm npx cast; do
        if ! command -v "$bin" >/dev/null 2>&1; then
            echo "❌ Missing required tool: $bin"
            case "$bin" in
                yq)
                    if [ "$OS_NAME" == "Darwin" ]; then
                        echo "   Hint: brew install yq"
                    else
                        echo "   Hint: sudo apt-get install yq  # or use your distro package manager"
                    fi
                    ;;
                jq)
                    if [ "$OS_NAME" == "Darwin" ]; then
                        echo "   Hint: brew install jq"
                    else
                        echo "   Hint: sudo apt-get install jq  # or use your distro package manager"
                    fi
                    ;;
                node|npm|npx)
                    if [ "$OS_NAME" == "Darwin" ]; then
                        echo "   Hint: brew install node"
                    else
                        echo "   Hint: sudo apt-get install nodejs npm  # or use nvm"
                    fi
                    ;;
                cast)
                    echo "   Hint: install Foundry and run foundryup"
                    ;;
                *)
                    echo "   Please install $bin and re-run."
                    ;;
            esac
            exit 1
        fi
    done

    kind version
    kubectl --context=kind-$CLUSTER_NAME version --client
    helm version
}

function pathRelativeToRepoRoot() {
    local path="$1"

    if [[ "$path" == "$REPO_ROOT/"* ]]; then
        echo "${path#$REPO_ROOT/}"
    else
        echo "$path"
    fi
}

function requireLocalFileFromExample() {
    local target_file="$1"
    local example_file="$2"
    local description="$3"
    local target_display
    local example_display

    if [ -f "$target_file" ]; then
        return 0
    fi

    target_display="$(pathRelativeToRepoRoot "$target_file")"
    example_display="$(pathRelativeToRepoRoot "$example_file")"

    echo "❌ Missing required local config: $target_display"
    echo

    if [ -f "$example_file" ]; then
        echo "Create the $description from the example file before continuing:"
        echo "  cp $example_display $target_display"
        echo
        echo "Then edit the placeholder values for your local sandbox."
    else
        echo "No example file was found for $description."
    fi

    echo "These values are local-only and must never be reused outside local development."
    exit 1
}

function generateLocalSandboxFixtures() {
    if [ ! -f "$LOCAL_SANDBOX_FIXTURE_GENERATOR" ]; then
        echo "❌ Missing local sandbox fixture generator: $(pathRelativeToRepoRoot "$LOCAL_SANDBOX_FIXTURE_GENERATOR")"
        exit 1
    fi

    if ! command -v node >/dev/null 2>&1; then
        echo "❌ node is required to generate local sandbox fixtures."
        exit 1
    fi

    if ! command -v cast >/dev/null 2>&1; then
        echo "❌ cast is required to generate local sandbox fixtures."
        echo "   Hint: install Foundry and run foundryup"
        exit 1
    fi

    node "$LOCAL_SANDBOX_FIXTURE_GENERATOR" "$@"
}

function ensureGeneratedLocalFile() {
    local target_file="$1"
    local description="$2"

    if [ -f "$target_file" ]; then
        return 0
    fi

    echo "🛠️ Missing $description. Generating local sandbox fixture files..."
    generateLocalSandboxFixtures
}

function requireContractsEnv() {
    ensureGeneratedLocalFile "$CONTRACTS_ENV_FILE" "contracts environment file"
    requireLocalFileFromExample "$CONTRACTS_ENV_FILE" "$CONTRACTS_ENV_EXAMPLE_FILE" "contracts environment file"
}

function requireNBBondApiHelmValues() {
    ensureGeneratedLocalFile "$NB_BOND_API_HELM_VALUES_FILE" "NB Bond API Helm values file"
    requireLocalFileFromExample "$NB_BOND_API_HELM_VALUES_FILE" "$NB_BOND_API_HELM_VALUES_EXAMPLE_FILE" "NB Bond API Helm values file"
}

# Ensure /etc/hosts contains required sandbox domain entries
function ensureLocalhostHostEntries() {
    local hostnames=(
        "besu.cbdc-sandbox.local"
        "blockscout.cbdc-sandbox.local"
        "bond-api.cbdc-sandbox.local"
        "web.cbdc-sandbox.local"
    )
    local missing_hosts=()

    for hostname in "${hostnames[@]}"; do
        if ! grep -q "$hostname" /etc/hosts; then
            missing_hosts+=("$hostname")
        fi
    done

    if [ "${#missing_hosts[@]}" -eq 0 ]; then
        echo "✅ /etc/hosts already contains sandbox domain entries."
        return
    fi

    local hosts_line="127.0.0.1 ${missing_hosts[*]}"
    echo "🔧 Adding missing entries to /etc/hosts for sandbox domains..."

    case "$OS_NAME" in
        Darwin|Linux)
            echo "$hosts_line" | sudo tee -a /etc/hosts > /dev/null
            ;;
        *)
            echo "⚠️ Unsupported OS: $OS_NAME. Please manually add this to your /etc/hosts:"
            echo "$hosts_line"
            ;;
    esac
}


function clusterExists() {
    set +e
    cluster_exists=$(kind get clusters 2>/dev/null | grep -w "$CLUSTER_NAME")
    set -e
    if [ -z "$cluster_exists" ]; then
        echo "false"
    else
        echo "true"
    fi
}

function getImageValue() {
    local key=$1
    local default=$2
    local value

    if [ ! -f "$IMAGES_CONFIG" ]; then
        echo "❌ Missing images config: $IMAGES_CONFIG" >&2
        exit 1
    fi

    value="$(yq -r ".${key} // \"\"" "$IMAGES_CONFIG")" || {
        echo "❌ Failed to read image key '$key' from $IMAGES_CONFIG (yq error)" >&2
        exit 1
    }

    if [ -z "$value" ] || [ "$value" == "null" ]; then
        echo "❌ Missing required image key '$key' in $IMAGES_CONFIG" >&2
        echo "   Refusing to fall back to default ('$default')." >&2
        exit 1
    fi

    echo "$value"
}

function getVersionValue() {
    local key=$1
    local default=$2
    local value

    if [ ! -f "$VERSIONS_CONFIG" ]; then
        echo "❌ Missing versions config: $VERSIONS_CONFIG" >&2
        exit 1
    fi

    value="$(yq -r ".${key} // \"\"" "$VERSIONS_CONFIG")" || {
        echo "❌ Failed to read version key '$key' from $VERSIONS_CONFIG (yq error)" >&2
        exit 1
    }

    if [ -z "$value" ] || [ "$value" == "null" ]; then
        echo "❌ Missing required version key '$key' in $VERSIONS_CONFIG" >&2
        echo "   Refusing to fall back to default ('$default')." >&2
        exit 1
    fi

    echo "$value"
}

function imageRepo() {
    image_ref=$1
    if [[ "$image_ref" == *@* ]]; then
        image_ref="${image_ref%@*}"
    fi
    if [[ "$image_ref" == *:* ]]; then
        echo "${image_ref%:*}"
    else
        echo "$image_ref"
    fi
}

function imageTag() {
    image_ref=$1
    if [[ "$image_ref" == *@* ]]; then
        image_ref="${image_ref%@*}"
    fi
    if [[ "$image_ref" == *:* ]]; then
        echo "${image_ref##*:}"
    else
        echo "latest"
    fi
}

function getKindTargetPlatform() {
    if [[ $(clusterExists) == "true" ]]; then
        node_name=$(kind get nodes --name "$CLUSTER_NAME" | head -n 1)
        if [ -n "$node_name" ]; then
            node_platform=$(docker inspect --format '{{.Os}}/{{.Architecture}}' "$node_name" 2>/dev/null || true)
            if [ -n "$node_platform" ]; then
                echo "$node_platform"
                return
            fi
        fi
    fi

    host_arch=$(uname -m)
    case "$host_arch" in
        arm64|aarch64)
            echo "linux/arm64"
            ;;
        x86_64|amd64)
            echo "linux/amd64"
            ;;
        *)
            echo "linux/amd64"
            ;;
    esac
}

function toKindImageTag() {
    image_ref=$1
    if [[ "$image_ref" == *@* ]]; then
        base="${image_ref%@*}"
        echo "${base}:kind"
        return
    fi

    if [[ "$image_ref" == *:* ]]; then
        base="${image_ref%:*}"
        tag="${image_ref##*:}"
        echo "${base}:${tag}-kind"
        return
    fi

    echo "${image_ref}:kind"
}

function ensureKindRegistry() {
    local registry_image
    registry_image="$(getLocalRegistryImage)"

    if ! docker ps --format '{{.Names}}' | grep -q "^${KIND_REGISTRY_NAME}$"; then
        if docker ps -a --format '{{.Names}}' | grep -q "^${KIND_REGISTRY_NAME}$"; then
            docker start "${KIND_REGISTRY_NAME}" >/dev/null
        else
            docker run -d \
                --restart=always \
                -p "127.0.0.1:${KIND_REGISTRY_PORT}:5000" \
                --name "${KIND_REGISTRY_NAME}" \
                "${registry_image}" >/dev/null
        fi
    fi

    if docker network inspect kind >/dev/null 2>&1; then
        if ! docker network inspect kind --format '{{json .Containers}}' | grep -q "\"${KIND_REGISTRY_NAME}\""; then
            docker network connect kind "${KIND_REGISTRY_NAME}" 2>/dev/null || true
        fi
    fi

    if [[ $(clusterExists) == "true" ]]; then
        kubectl --context=kind-$CLUSTER_NAME apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-system
data:
  localRegistryHosting.v1: |
    host: "localhost:${KIND_REGISTRY_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF
    fi

    echo "✅ Local registry is running: ${KIND_REGISTRY_NAME} (localhost:${KIND_REGISTRY_PORT})"
}

function isKindRegistryRunning() {
    docker ps --format '{{.Names}}' | grep -q "^${KIND_REGISTRY_NAME}$"
}

function requireKindRegistry() {
    if ! isKindRegistryRunning; then
        echo "❌ Local registry is not running."
        echo "   Start it with: ./infra/infra.sh registry-start"
        exit 1
    fi
}

function tagForKindRegistry() {
    image_ref=$1
    if [[ "$image_ref" == *@* ]]; then
        base="${image_ref%@*}"
        echo "localhost:${KIND_REGISTRY_PORT}/${base}"
        return
    fi
    echo "localhost:${KIND_REGISTRY_PORT}/${image_ref}"
}

function kindRegistryImageFor() {
    image_ref=$1
    kind_tag=$(toKindImageTag "$image_ref")
    tagForKindRegistry "$kind_tag"
}

function registryManifestDigest() {
    registry_image=$1
    registry_repo=$(imageRepo "$registry_image")
    registry_repo="${registry_repo#localhost:${KIND_REGISTRY_PORT}/}"
    registry_tag=$(imageTag "$registry_image")

    if ! command -v curl >/dev/null 2>&1; then
        echo ""
        return
    fi

    digest=$(curl -fsSI 2>/dev/null \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
        "${KIND_REGISTRY_ENDPOINT}/v2/${registry_repo}/manifests/${registry_tag}" \
        | awk -F': ' '/Docker-Content-Digest/ {print $2}' \
        | tr -d '\r')

    echo "$digest"
}

function kindRegistryHasImage() {
    image_ref=$1
    registry_image=$(tagForKindRegistry "$image_ref")
    registry_repo=$(imageRepo "$registry_image")
    registry_repo="${registry_repo#localhost:${KIND_REGISTRY_PORT}/}"
    registry_tag=$(imageTag "$registry_image")

    if ! command -v curl >/dev/null 2>&1; then
        echo "false"
        return
    fi

    if curl -fsSL -o /dev/null 2>/dev/null \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
        "${KIND_REGISTRY_ENDPOINT}/v2/${registry_repo}/manifests/${registry_tag}"; then
        echo "true"
    else
        echo "false"
    fi
}

function pushRegistryTag() {
    registry_image=$1
    docker push --quiet "$registry_image" >/dev/null
    digest=$(registryManifestDigest "$registry_image")
    if [ -n "$digest" ]; then
        echo "✅ Pushed $registry_image (digest: $digest)"
    else
        echo "✅ Pushed $registry_image to local registry"
    fi
}

function pushImageToKindRegistry() {
    image_ref=$1
    registry_image=$(tagForKindRegistry "$image_ref")
    docker tag "$image_ref" "$registry_image"
    pushRegistryTag "$registry_image"
}

function getRegistryContractAddressFromConfigmap() {
    set +e
    registry_contract_address=$(kubectl --context=kind-$CLUSTER_NAME -n $REGISTRY_CONTRACT_NAMESPACE get configmap $REGISTRY_CONTRACT_CONFIGMAP -o jsonpath='{.data.address}' 2> /dev/null)
    set -e
    echo $registry_contract_address
}

function contractsDeploymentExists() {
    if kubectl --context=kind-$CLUSTER_NAME -n $CONTRACTS_DEPLOYMENT_NAMESPACE get configmap $CONTRACTS_DEPLOYMENT_CONFIGMAP >/dev/null 2>&1; then
        echo "true"
    else
        echo "false"
    fi
}

function getContractsDeploymentChainId() {
    set +e
    chain_id=$(kubectl --context=kind-$CLUSTER_NAME -n $CONTRACTS_DEPLOYMENT_NAMESPACE get configmap $CONTRACTS_DEPLOYMENT_CONFIGMAP -o jsonpath='{.data.chainId}' 2> /dev/null)
    set -e
    echo $chain_id
}

function getContractsDeploymentRegistryAddress() {
    set +e
    registry_contract_address=$(kubectl --context=kind-$CLUSTER_NAME -n $CONTRACTS_DEPLOYMENT_NAMESPACE get configmap $CONTRACTS_DEPLOYMENT_CONFIGMAP -o jsonpath='{.data.registryAddress}' 2> /dev/null)
    set -e
    echo $registry_contract_address
}

function getContractsDeploymentGenesisHash() {
    set +e
    genesis_hash=$(kubectl --context=kind-$CLUSTER_NAME -n $CONTRACTS_DEPLOYMENT_NAMESPACE get configmap $CONTRACTS_DEPLOYMENT_CONFIGMAP -o jsonpath='{.data.genesisHash}' 2> /dev/null)
    set -e
    echo $genesis_hash
}

function getChainGenesisHash() {
    rpc_url=$1
    cast block 0 --rpc-url "$rpc_url" --field hash 2>/dev/null
}

function assertNoLegacyBesuStorage() {
    if kubectl --context=kind-$CLUSTER_NAME -n besu get pvc besu-pvc >/dev/null 2>&1; then
        echo "❌ Legacy single-node Besu storage was detected (besu/besu-pvc)."
        echo "   Clique data and the Blockscout/application databases cannot be reused by the QBFT genesis."
        echo "   Run ./sandbox.sh delete, then start the sandbox again for the required clean replacement."
        exit 1
    fi
}

function assertBlockscoutChainIdentity() {
    rpc_url=$1
    chain_id=$(cast chain-id --rpc-url "$rpc_url" 2>/dev/null)
    genesis_hash=$(getChainGenesisHash "$rpc_url")
    if [ -z "$chain_id" ] || [ -z "$genesis_hash" ]; then
        echo "❌ Could not read the Besu chain ID and genesis hash before starting Blockscout."
        exit 1
    fi

    recorded_chain_id=$(kubectl --context=kind-$CLUSTER_NAME -n $BLOCKSCOUT_NAMESPACE \
        get configmap $BLOCKSCOUT_CHAIN_IDENTITY_CONFIGMAP \
        -o jsonpath='{.data.chainId}' 2>/dev/null || true)
    recorded_genesis_hash=$(kubectl --context=kind-$CLUSTER_NAME -n $BLOCKSCOUT_NAMESPACE \
        get configmap $BLOCKSCOUT_CHAIN_IDENTITY_CONFIGMAP \
        -o jsonpath='{.data.genesisHash}' 2>/dev/null || true)

    if [ -n "$recorded_genesis_hash" ]; then
        if [ "$recorded_chain_id" != "$chain_id" ] || [ "$recorded_genesis_hash" != "$genesis_hash" ]; then
            echo "❌ Blockscout database marker belongs to a different chain identity."
            echo "   Recorded: ${recorded_chain_id:-missing} / $recorded_genesis_hash"
            echo "   Current:  $chain_id / $genesis_hash"
            echo "   Run ./sandbox.sh delete and recreate the sandbox; Blockscout cannot reuse the old database."
            exit 1
        fi
        return 0
    fi

    if kubectl --context=kind-$CLUSTER_NAME -n $BLOCKSCOUT_NAMESPACE \
        get pvc postgres-volume-claim >/dev/null 2>&1; then
        echo "❌ Existing Blockscout PostgreSQL storage has no genesis identity marker."
        echo "   Its contents cannot be trusted after a same-chain-ID genesis replacement."
        echo "   Run ./sandbox.sh delete and recreate the sandbox."
        exit 1
    fi

    kubectl --context=kind-$CLUSTER_NAME apply -n $BLOCKSCOUT_NAMESPACE -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: $BLOCKSCOUT_CHAIN_IDENTITY_CONFIGMAP
data:
  chainId: "$chain_id"
  genesisHash: "$genesis_hash"
EOF
}

function markContractsDeployed() {
    chain_id=$1
    registry_contract_address=$2
    genesis_hash=$3
    deployed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    kubectl --context=kind-$CLUSTER_NAME apply -n $CONTRACTS_DEPLOYMENT_NAMESPACE -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $CONTRACTS_DEPLOYMENT_NAMESPACE
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: $CONTRACTS_DEPLOYMENT_CONFIGMAP
data:
  chainId: "$chain_id"
  registryAddress: "$registry_contract_address"
  genesisHash: "$genesis_hash"
  deployedAt: "$deployed_at"
EOF
}

function clearContractsDeploymentMarker() {
    kubectl --context=kind-$CLUSTER_NAME -n $CONTRACTS_DEPLOYMENT_NAMESPACE delete configmap $CONTRACTS_DEPLOYMENT_CONFIGMAP >/dev/null 2>&1 || true
}

function deployRegistryContractAddressToConfigmap() {
    registry_contract_address=$1

    kubectl --context=kind-$CLUSTER_NAME apply -n $REGISTRY_CONTRACT_NAMESPACE -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $REGISTRY_CONTRACT_NAMESPACE
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: $REGISTRY_CONTRACT_CONFIGMAP
data:
  address: $registry_contract_address
EOF
}

function getDefaultRegistryContractAddress() {
    requireContractsEnv
    echo "$(awk -F'=' '/^REGISTRY_ADDR=/ {print $2}' "$CONTRACTS_ENV_FILE")"
}

function evmEnvironmentSecretExists() {
    namespace=$1

    if kubectl --context=kind-$CLUSTER_NAME -n $namespace get secret "$EVM_ENVIRONMENT_SECRET" >/dev/null 2>&1; then
        echo "true"
    else
        echo "false"
    fi
}

function deployEvmEnvironmentSecret() {
    namespace=$1

    requireContractsEnv

    kubectl --context=kind-$CLUSTER_NAME apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $namespace
EOF

    if [ "$(evmEnvironmentSecretExists $namespace)" == "false" ]; then
        echo "evm environment secret does not exist, deploying it..."
        kubectl --context=kind-$CLUSTER_NAME create secret generic $EVM_ENVIRONMENT_SECRET -n $namespace --from-env-file="$CONTRACTS_ENV_FILE"
    else
        echo "evm environment secret ${namespace}/${EVM_ENVIRONMENT_SECRET} already exists, not modifying"
    fi
}

function getContractAddressFromScriptRunfile() {
    chain_id=$1
    file_name=$2
    contract_name=$3
    contract_address=$(jq -r '.transactions[] | select((.transactionType == "CREATE") and (.contractName == "'$contract_name'")) | .contractAddress' broadcast/${file_name}/$chain_id/run-latest.json)
    echo $contract_address
}

function getComponentPodName() {
    namespace=$1
    app_label=$2
    component_label=$3

    separator=","

    pods_joint=$(kubectl --context=kind-$CLUSTER_NAME -n $namespace get pods -o json | jq -r '[.items[] | select((.metadata.labels.app == "'$app_label'") and (.metadata.labels."app.kubernetes.io/component" == "'$component_label'")) | .metadata.name] | join("'$separator'")')

    if [[ "x$pods_joint" == "x" ]]; then
        echo ""
        return
    fi

    IFS=$separator read -ra pods_split <<< "$pods_joint"
    num_pods="${#pods_split[@]}"

    if (( $num_pods > 1 )); then
        echo ""
    else
        echo $pods_split
    fi
}

function dumpAppDiagnostics() {
    namespace=$1
    app_label=$2
    label_key=$3

    echo ""
    echo "--- $app_label diagnostics (namespace=$namespace) ---"
    kubectl --context=kind-$CLUSTER_NAME -n $namespace get pods -l "${label_key}=${app_label}" -o wide || true
    kubectl --context=kind-$CLUSTER_NAME -n $namespace get events --sort-by=.lastTimestamp | tail -n 50 || true

    pods=$(kubectl --context=kind-$CLUSTER_NAME -n $namespace get pods -l "${label_key}=${app_label}" -o name 2>/dev/null || true)
    for pod in $pods; do
        ready=$(kubectl --context=kind-$CLUSTER_NAME -n $namespace get "$pod" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
        if [[ "$ready" != "True" ]]; then
            echo ""
            echo "--- describe $pod ---"
            kubectl --context=kind-$CLUSTER_NAME -n $namespace describe "$pod" || true
            echo ""
            echo "--- logs $pod (current) ---"
            kubectl --context=kind-$CLUSTER_NAME -n $namespace logs "$pod" --all-containers --tail=200 || true
            echo ""
            echo "--- logs $pod (previous) ---"
            kubectl --context=kind-$CLUSTER_NAME -n $namespace logs "$pod" --all-containers --previous --tail=200 || true
        fi
    done
}

function waitForApp() {
    namespace=$1
    app_label=$2

    separator="," 
    timeout_seconds="${WAIT_FOR_APP_TIMEOUT_SECONDS:-0}"
    if [[ "$timeout_seconds" -gt 0 && "$timeout_seconds" -lt 60 ]]; then
        timeout_seconds=60
    fi

    if [[ $app_label == "nginx-gateway-fabric" ]]; then
        label_key="app.kubernetes.io/name"
    else
        label_key="app"
    fi

    msg="Waiting for $app_label to be ready..."
    waitMsg "$msg" start
    i=0

    # an app can consist of several components, so we wait for all of them to be ready
    while true; do
        status_joint=$(kubectl --context=kind-$CLUSTER_NAME -n $namespace get pods -o json | jq -r '[.items[] | select((.metadata.labels["'$label_key'"] == "'$app_label'")) | .status.conditions[]? | select(.type=="Ready") | if .status == "True" then 1 else 0 end] | join("'$separator'")')
        pod_count=$(kubectl --context=kind-$CLUSTER_NAME -n $namespace get pods -o json | jq -r '[.items[] | select((.metadata.labels["'$label_key'"] == "'$app_label'"))] | length')

        all_running="true"
        if [[ "$pod_count" -eq 0 ]]; then
            all_running="false"
        else
            if [[ -z "$status_joint" ]]; then
                all_running="false"
            else
                while IFS=$separator read -ra status_split; do
                    for status in "${status_split[@]}"; do
                        if [ "$status" == "1" ]; then
                            continue
                        elif [ "$status" == "0" ]; then
                            all_running="false"
                            break
                        else
                            echo " an error occured ❌"
                            exit 1
                        fi
                    done
                done <<< "$status_joint"
            fi
        fi

        if [[ $all_running == "true" ]]; then
            break
        else
            waitMsg "$msg" $i
            sleep 1
            i=$(( i+1 ))
            if [[ "$timeout_seconds" -gt 0 && "$i" -ge "$timeout_seconds" ]]; then
                echo
                echo "⚠️ Timed out waiting for $app_label after ${timeout_seconds}s. Dumping diagnostics and continuing."
                dumpAppDiagnostics "$namespace" "$app_label" "$label_key"
                return 0
            fi
        fi
    done

    waitMsg "$msg" end
}

function waitMsg() {
    msg=$1
    i=$2

    if [ "$i" == "start" ]; then
        printf "$msg"
    elif [ "$i" == "end" ]; then
        printf "\r$msg ✔️\n"
    else
        clock="🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦"
        i=$(( i % 24 ))
        printf "\r$msg ${clock:$i:1}"
    fi
}

function waitForBesu() {
    waitForApp besu besu-validator
    waitForApp besu besu-archive
}

function waitForApiGateway() {
    waitForApp nginx-gateway nginx-gateway-fabric

    msg="Testing gateway..."
    waitMsg "$msg" start
    i=0
    timeout_seconds="${WAIT_FOR_APP_TIMEOUT_SECONDS:-0}"
    if [[ "$timeout_seconds" -gt 0 && "$timeout_seconds" -lt 60 ]]; then
        timeout_seconds=60
    fi

    # Probe the actual Besu JSON-RPC listener on the gateway: hostname +
    # port 8545 (the gateway has no listener on port 80 for this host),
    # with a real eth_blockNumber call. Treat anything except a successful
    # 2xx with a JSON-RPC result envelope as not-ready — Earlier code
    # checked only for "exact 502" on `http://besu.cbdc-sandbox.local/`
    # (no port), which returns 404 the moment the gateway pod is up but
    # before the Besu HTTPRoute has been programmed, so the loop exited
    # immediately and the readiness gate did nothing.
    local rpc_url="http://besu.cbdc-sandbox.local:8545/"
    local rpc_body='{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

    while true; do
        response=$(curl -fsS -X POST -H "Content-Type: application/json" \
            --max-time 5 \
            --data "$rpc_body" \
            "$rpc_url" 2>/dev/null || true)
        if [ -n "$response" ] && echo "$response" | jq -e '.result | startswith("0x")' >/dev/null 2>&1; then
            break
        fi
        waitMsg "$msg" $i
        sleep 1
        i=$(( i+1 ))
        if [[ "$timeout_seconds" -gt 0 && "$i" -ge "$timeout_seconds" ]]; then
            echo
            echo "⚠️ Timed out waiting for Besu JSON-RPC via the gateway after ${timeout_seconds}s."
            return 0
        fi
    done

    waitMsg "$msg" end
}

function waitForBlockscout() {
    waitForApp blockscout blockscout-blockscout-stack-blockscout
}

function waitForNBBondAPI() {
    waitForApp nb-bond-api nb-bond-api
}

function waitForNBUI() {
    waitForApp nb-ui nb-ui
}

function createKindCluster() {
    # NOTE: kind resolves `extraMounts[].hostPath` relative to the current working directory,
    # not relative to the config file path. Our kind config assumes it is invoked from `infra/`.
    # Keep this function robust even if callers are elsewhere.
    pushd "$REPO_ROOT/infra" >/dev/null
    if [[ $(clusterExists) == "false" ]]; then
        kind create cluster --config $REPO_ROOT/infra/cluster/cluster-config.yaml --name $CLUSTER_NAME
    else
        echo "Cluster '$CLUSTER_NAME' already exists. Skipping cluster creation."
    fi

    # Ensure kubeconfig has the expected kind context (and fail fast if the cluster is unhealthy).
    kind export kubeconfig --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
    if ! kubectl --context="kind-$CLUSTER_NAME" get nodes >/dev/null 2>&1; then
        echo "❌ Kind cluster '$CLUSTER_NAME' exists but is not reachable/healthy via kubectl context 'kind-$CLUSTER_NAME'."
        echo "   Try: ./sandbox.sh delete && ./sandbox.sh start"
        exit 1
    fi
    popd >/dev/null
}

function deployApiGateway() {
    # cf https://docs.nginx.com/nginx-gateway-fabric/get-started/
    NGINX_GATEWAY_FABRIC_VERSION="$(getNginxGatewayFabricVersion)"

    # add gateway api resources
    kubectl kustomize "https://github.com/nginx/nginx-gateway-fabric/config/crd/gateway-api/standard?ref=v${NGINX_GATEWAY_FABRIC_VERSION}" | kubectl --context=kind-$CLUSTER_NAME apply -f -

    # install api gateway
    # NOTE: no `--set service.create=false` here anymore — the value was
    # removed in the NGF 2.x chart (the data-plane Service is provisioned
    # per Gateway by the control plane; the local NodePort Service in
    # infra/gateway selects the provisioned data-plane pods directly).
    helm upgrade ngf oci://ghcr.io/nginx/charts/nginx-gateway-fabric \
         --install \
         --version ${NGINX_GATEWAY_FABRIC_VERSION} \
         --kube-context kind-$CLUSTER_NAME \
         --namespace nginx-gateway \
         --create-namespace

    helm upgrade gateway $REPO_ROOT/infra/gateway \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace nginx-gateway \
         --create-namespace \
         --values $REPO_ROOT/infra/gateway/values.local.yaml
}

function loadImageToKind() {
    image=$1
    kind_image=""

    target_platform=$(getKindTargetPlatform)
    kind_image=$(toKindImageTag "$image")
    registry_image=$(tagForKindRegistry "$kind_image")

    requireKindRegistry

    if [ "${FORCE_IMAGE_PULL:-false}" == "true" ] && [ -z "${_FORCE_IMAGE_PULL_WARNED:-}" ]; then
        echo "⚠️  FORCE_IMAGE_PULL=true — bypassing the registry/local cache for base & third-party images; these will be re-pulled from upstream (requires network). This does NOT rebuild the repo-owned images (nb-ui / nb-bond-api / bens-microservice); their content-hash skip ignores this flag." >&2
        export _FORCE_IMAGE_PULL_WARNED=1
    fi

    if [ "${FORCE_IMAGE_PULL:-false}" != "true" ]; then
        if [ "$(kindRegistryHasImage "$kind_image")" == "true" ]; then
            echo "✅ Using cached registry image $registry_image"
            return 0
        fi

        registry_local_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$registry_image" 2>/dev/null || true)
        if [ "$registry_local_platform" == "$target_platform" ]; then
            echo "✅ Using local registry tag $registry_image ($target_platform)"
            pushRegistryTag "$registry_image"
            return 0
        fi
    fi

    kind_image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$kind_image" 2>/dev/null || true)
    if [ "${FORCE_IMAGE_PULL:-false}" != "true" ] && [ "$kind_image_platform" == "$target_platform" ]; then
        echo "✅ Using cached Kind image $kind_image ($target_platform)"
    else
        image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)
        if [ "${FORCE_IMAGE_PULL:-false}" == "true" ] || [ -z "$image_platform" ] || [ "$image_platform" != "$target_platform" ]; then
            echo "🔄 Pulling $image for Kind platform ($target_platform)..."
            docker pull --platform "$target_platform" "$image"
        else
            echo "✅ Image $image already exists locally ($target_platform)"
        fi

        image_id=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)
        if [ -z "$image_id" ]; then
            echo "❌ Could not resolve image ID for $image"
            return 1
        fi

        docker tag "$image_id" "$kind_image"
        echo "✅ Tagged single-platform image as $kind_image"
    fi

    pushImageToKindRegistry "$kind_image"
}

function getBesuImage() {
    local local_image
    local default_image

    local_image=$(yq -r '.image // ""' $REPO_ROOT/infra/besu/values.local.yaml)
    if [ -n "$local_image" ] && [ "$local_image" != "null" ]; then
        default_image="$local_image"
    else
        default_image=$(yq -r '.image' $REPO_ROOT/infra/besu/values.yaml)
    fi

    getImageValue "besu" "$default_image"
}

function getBlockscoutChartVersion() {
    getVersionValue "charts.blockscout_stack" "$BLOCKSCOUT_CHART_VERSION"
}

function getNginxGatewayFabricVersion() {
    getVersionValue "charts.nginx_gateway_fabric" "2.6.6"
}

function getBlockscoutDbImage() {
    default_image=$(yq -r '.dbImage' $REPO_ROOT/services/blockscout/values.yaml)
    getImageValue "blockscout.db" "$default_image"
}

function getBlockscoutScVerifierImage() {
    # Blockscout's standalone smart-contract-verifier microservice. The v10
    # backend delegates Solidity source compilation / bytecode matching to
    # this service (it does not verify in-process). Pinned in
    # common/images.yaml, pre-pulled by `./infra/infra.sh registry-sync`, and
    # mirrored to the kind registry at deploy time (deployBlockscout).
    getImageValue "blockscout.smart_contract_verifier" ""
}

function getBensBaseImage() {
    # The python base used as both builder and runtime stages of the BENS
    # Dockerfile. Pinned in common/images.yaml under blockscout.bens and
    # pre-pulled by `./infra/infra.sh registry-sync`. The final BENS image
    # is built locally with a content-hash tag and pushed to
    # localhost:5001/bens-microservice:<hash> — see prepareBensImage.
    default_image=$(yq -r '.bensImage' $REPO_ROOT/services/blockscout/values.yaml)
    getImageValue "blockscout.bens" "$default_image"
}

function getBlockscoutFrontendImage() {
    local repository
    local tag
    local default_image

    repository=$(yq -r '.frontend.image.repository // ""' $REPO_ROOT/services/blockscout/values.yaml)
    tag=$(yq -r '.frontend.image.tag // ""' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -n "$repository" ] && [ "$repository" != "null" ] && [ -n "$tag" ] && [ "$tag" != "null" ]; then
        default_image="${repository}:${tag}"
    else
        default_image=""
    fi

    getImageValue "blockscout.frontend" "$default_image"
}

function getBlockscoutBackendImage() {
    local repository
    local tag
    local default_image

    repository=$(yq -r '.blockscout.image.repository // ""' $REPO_ROOT/services/blockscout/values.yaml)
    tag=$(yq -r '.blockscout.image.tag // ""' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -n "$repository" ] && [ "$repository" != "null" ] && [ -n "$tag" ] && [ "$tag" != "null" ]; then
        default_image="${repository}:${tag}"
    else
        default_image=""
    fi

    getImageValue "blockscout.backend" "$default_image"
}

function getNBBondApiBuilderImage() {
    echo "$NB_BOND_API_BUILDER_BASEIMAGE"
}

function getNBBondApiRuntimeImage() {
    echo "$NB_BOND_API_RUNTIME_BASEIMAGE"
}

function getNBUINginxImage() {
    getImageValue "nb_ui.nginx" "$NB_UI_NGINX_BASEIMAGE"
}

function getNBUIBuilderImage() {
    echo "$NB_UI_BUILDER_BASEIMAGE"
}

# Make sure the given upstream image ref is present in the host's local
# Docker image cache so `docker build` can resolve it as a FROM/ARG base.
# `loadImageToKind` pushes a `:kind`-tagged variant to the local Kind
# registry but short-circuits when that tag is already present, so a fresh
# checkout can have the registry copy without the bare upstream ref cached
# locally. Rather than pull from the internet, reuse the copy already in
# the local registry (offline) and retag it back to the upstream ref — the
# Dockerfile FROM stays an upstream ref, so the built image keeps its
# portable lineage. Only fall back to an upstream pull when the local
# registry doesn't have it either.
function ensureLocalDockerImage() {
    local image_ref=$1
    if docker image inspect "$image_ref" >/dev/null 2>&1; then
        return 0
    fi

    # Digest-pinned refs can't be a `docker tag` target, so skip the reuse
    # path for them. The repo-owned builds all use tag-based bases.
    if [[ "$image_ref" != *@* ]]; then
        local kind_ref
        kind_ref="$(kindRegistryImageFor "$image_ref")"
        if [ -n "$kind_ref" ] \
            && { docker image inspect "$kind_ref" >/dev/null 2>&1 \
                 || docker pull "$kind_ref" >/dev/null 2>&1; }; then
            echo "🔁 Reusing local registry image $kind_ref as $image_ref (no upstream pull)."
            docker tag "$kind_ref" "$image_ref"
            return 0
        fi
    fi

    echo "🔄 $image_ref not in host cache or local registry — pulling from upstream..."
    docker pull "$image_ref"
}

function getLocalRegistryImage() {
    if command -v yq >/dev/null 2>&1 && [ -f "$IMAGES_CONFIG" ]; then
        getImageValue "local_registry" "$KIND_REGISTRY_IMAGE"
    else
        echo "$KIND_REGISTRY_IMAGE"
    fi
}

# buildAndPushHashedImage REPO HASH CONTEXT DOCKERFILE PREP_FN [BUILD_ARG ...]
#
# Shared build/check/push for the repo-owned, content-hash-tagged images
# (nb-ui, nb-bond-api, bens-microservice). Behaviour:
#   - Skips the build when localhost:5001/<REPO>:<HASH> is already in the
#     local registry (the content hash is the cache key).
#   - On a miss, runs PREP_FN (a function name that ensures the Dockerfile
#     stage bases are in the host Docker cache for an offline build), then
#     docker build / tag / push.
#   - DOCKERFILE is a path, or "-" to use CONTEXT/Dockerfile (no -f).
#   - Each BUILD_ARG is passed verbatim as `--build-arg <BUILD_ARG>`.
#   - All progress logs go to STDERR; the ONLY thing written to STDOUT is
#     the localhost:5001/<REPO>:<HASH> pull tag, so callers can capture it
#     (`tag="$(buildAndPushHashedImage ...)"` or `--set bensImage=$(...)`).
function buildAndPushHashedImage() {
    local repo="$1" hash="$2" context="$3" dockerfile="$4" prep_fn="$5"
    shift 5
    local build_args=("$@")

    local local_tag="${repo}:${hash}"
    local push_tag="localhost:${KIND_REGISTRY_PORT}/${repo}:${hash}"

    # Skip rebuild if the image is already in the local registry. The
    # registry serves OCI manifests so we list tags rather than negotiate
    # media types.
    if curl -fsS "${KIND_REGISTRY_ENDPOINT}/v2/${repo}/tags/list" 2>/dev/null \
        | jq -e --arg t "$hash" '.tags // [] | index($t)' >/dev/null 2>&1; then
        echo "✅ ${repo} image ${push_tag} already in local registry — skipping build." >&2
    else
        # `docker build` resolves ARG/FROM defaults from the upstream
        # registry unless those images are already in the host's Docker
        # cache. PREP_FN guarantees they are before we build.
        "$prep_fn" >&2 || {
            echo "❌ Failed to prepare base images for ${repo}" >&2
            return 1
        }
        echo "🐳 Building ${repo} image ${local_tag}..." >&2
        local build_cmd=(docker build --tag "$local_tag")
        local arg
        for arg in "${build_args[@]}"; do
            build_cmd+=(--build-arg "$arg")
        done
        if [ "$dockerfile" != "-" ]; then
            build_cmd+=(-f "$dockerfile")
        fi
        build_cmd+=("$context")
        "${build_cmd[@]}" >&2 || {
            echo "❌ Failed to build ${repo} image" >&2
            return 1
        }
        echo "📦 Pushing ${push_tag}..." >&2
        docker tag "$local_tag" "$push_tag"
        docker push "$push_tag" >&2 || {
            echo "❌ Failed to push ${repo} image to local registry" >&2
            return 1
        }
    fi

    echo "$push_tag"
}

# Base-image prep callbacks for buildAndPushHashedImage. Each ensures the
# Dockerfile stage bases for one service are present in the host Docker
# cache. They read the *_RESOLVED globals set by the calling deploy
# function and run only on a build miss (the deploy function has already
# pushed the same bases to the kind registry via loadImageToKind).
function prepBensBases() {
    ensureLocalDockerImage "$BENS_BASE_RESOLVED"
}

function prepNBBondApiBases() {
    ensureLocalDockerImage "$NB_BOND_API_BUILDER_RESOLVED"
    if [ "$NB_BOND_API_RUNTIME_RESOLVED" != "$NB_BOND_API_BUILDER_RESOLVED" ]; then
        ensureLocalDockerImage "$NB_BOND_API_RUNTIME_RESOLVED"
    fi
}

function prepNBUIBases() {
    ensureLocalDockerImage "$NB_UI_BUILDER_RESOLVED"
    ensureLocalDockerImage "$NB_UI_NGINX_RESOLVED"
}

function syncImagesToRegistry() {
    images=()
    images+=("$(getBesuImage)")
    images+=("$(getBlockscoutFrontendImage)")
    images+=("$(getBlockscoutBackendImage)")
    images+=("$(getBlockscoutDbImage)")
    images+=("$(getBensBaseImage)")
    # nb-bond-api Dockerfile stages: builder + runtime (both node).
    # Pulled here so the local `docker build` works without internet.
    images+=("$(getNBBondApiBuilderImage)")
    images+=("$(getNBBondApiRuntimeImage)")
    # nb-ui Dockerfile stages: builder (node) + runtime (nginx-unprivileged).
    # Pulled here so the local `docker build` works without internet.
    images+=("$(getNBUIBuilderImage)")
    images+=("$(getNBUINginxImage)")

    for image in "${images[@]}"; do
        if [ -n "$image" ] && [ "$image" != "null" ]; then
            loadImageToKind "$image"
        fi
    done
}

# ── Local image lifecycle: report / cleanup / registry reset ──────────────
# These operate ONLY on the repo-owned, content-hash-tagged images
# (nb-ui, nb-bond-api, bens-microservice). Shared base / third-party images
# (node, nginx, python, besu, blockscout, postgres) are
# deliberately never pruned — they are reused across services and removing
# them would break offline builds.

# Echo the content-hash tag currently deployed for REPO (read from any
# running pod that pulls localhost:5001/<repo>:<tag>), or empty if none /
# no cluster. Always succeeds.
function currentDeployedTagFor() {
    local repo="$1"
    kubectl get pods --all-namespaces \
        -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' 2>/dev/null \
        | grep "/${repo}:" \
        | sed "s#.*/${repo}:##" \
        | head -1 || true
}

# Echo the content hash the current source tree WOULD build for REPO.
function computeCurrentHashFor() {
    case "$1" in
        nb-ui) nbUIBundleHash ;;
        nb-bond-api) nbBondApiBundleHash ;;
        bens-microservice) bensImageHash ;;
        *) echo "" ;;
    esac
}

# Read-only report: running sandbox pod images, the registry tags per repo,
# and which tag is the current build / currently deployed. Degrades
# gracefully when the cluster or registry is down. Mutates nothing.
function reportSandboxImages() {
    local repos=(nb-ui nb-bond-api bens-microservice)
    local repo tag current deployed tags

    echo "=== Running sandbox pod images ==="
    if [ "$(clusterExists)" == "true" ]; then
        kubectl get pods --all-namespaces \
            -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' 2>/dev/null \
            | grep -E "localhost:${KIND_REGISTRY_PORT}/(nb-ui|nb-bond-api|bens-microservice):" \
            | sort -u \
            | sed 's/^/  /' \
            || echo "  (no sandbox service pods found)"
    else
        echo "  (cluster not running — skipped)"
    fi

    echo
    echo "=== Local registry tags (localhost:${KIND_REGISTRY_PORT}) ==="
    for repo in "${repos[@]}"; do
        current="$(computeCurrentHashFor "$repo")"
        deployed="$(currentDeployedTagFor "$repo")"
        echo "── ${repo}  (current build hash: ${current:-unknown}${deployed:+; deployed: ${deployed}}) ──"
        tags="$(curl -fsS "${KIND_REGISTRY_ENDPOINT}/v2/${repo}/tags/list" 2>/dev/null | jq -r '.tags // [] | .[]' 2>/dev/null || true)"
        if [ -z "$tags" ]; then
            echo "   (no tags / registry unreachable)"
            continue
        fi
        while IFS= read -r tag; do
            [ -n "$tag" ] || continue
            local mark=""
            [ "$tag" == "$current" ] && mark="${mark}  <- current build"
            [ "$tag" == "$deployed" ] && mark="${mark}  <- deployed"
            echo "   ${tag}${mark}"
        done <<< "$tags"
    done

    echo
    echo "ℹ️  '<repo>:<tag>' and 'localhost:${KIND_REGISTRY_PORT}/<repo>:<tag>' are aliases of one image id (negligible disk cost)."
    echo "ℹ️  Reclaim host disk with: ./sandbox.sh cleanup-images   |   Wipe registry tags with: ./sandbox.sh registry-reset"
    echo "ℹ️  Registry deletes are disabled, so individual registry tags cannot be removed via the API — use registry-reset."
}

# Host-side prune of the repo-owned content-hash images: keep the KEEP
# newest tags per repo (default 3 = current + 2) plus the currently-deployed
# tag; remove the rest (both the bare and localhost:5001/ aliases). Shared
# base images are never touched. Optionally also prune the GLOBAL Docker
# build cache (opt-in; affects all projects on the host).
function cleanupSandboxImages() {
    local keep="${1:-3}"
    local prune_build_cache="${2:-false}"
    local repos=(nb-ui nb-bond-api bens-microservice)
    local repo deployed tag idx

    for repo in "${repos[@]}"; do
        deployed="$(currentDeployedTagFor "$repo")"
        echo "── ${repo}  (keeping ${keep} newest${deployed:+ + deployed ${deployed}}) ──"
        local tags=()
        while IFS= read -r tag; do
            [ -n "$tag" ] && [ "$tag" != "<none>" ] && tags+=("$tag")
        done < <(docker images "$repo" --format '{{.Tag}}' 2>/dev/null)

        if [ "${#tags[@]}" -eq 0 ]; then
            echo "   (no local images)"
            continue
        fi

        idx=0
        for tag in "${tags[@]}"; do
            idx=$((idx + 1))
            if [ "$idx" -le "$keep" ] || [ "$tag" == "$deployed" ]; then
                echo "   keep   ${repo}:${tag}"
                continue
            fi
            echo "   remove ${repo}:${tag}"
            docker rmi "${repo}:${tag}" >/dev/null 2>&1 || true
            docker rmi "localhost:${KIND_REGISTRY_PORT}/${repo}:${tag}" >/dev/null 2>&1 || true
        done
    done

    if [ "$prune_build_cache" == "true" ]; then
        echo "⚠️  Pruning the GLOBAL Docker build cache (docker builder prune -f) — this affects ALL Docker projects on this host, not just the sandbox."
        docker builder prune -f || true
    fi

    echo "✅ Cleanup complete. Shared base images and the deployed tags were left intact."
    echo "ℹ️  The kind-registry container still holds its pushed tags (registry deletes are disabled). Use ./sandbox.sh registry-reset to reclaim that space."
}

# Recreate the local registry container from scratch — the safe, disposable
# alternative to enabling registry delete + GC — and repopulate base images.
# Repo-owned images rebuild on the next service start because their hash
# tags will be absent. Requires network or a warm host cache to re-pull any
# base image not already cached.
function resetKindRegistry() {
    echo "🧹 Removing the local registry container '${KIND_REGISTRY_NAME}' (all cached tags will be lost)..."
    docker rm -f "${KIND_REGISTRY_NAME}" >/dev/null 2>&1 || true
    ensureKindRegistry
    echo "🔄 Repopulating base / third-party images into the fresh registry..."
    syncImagesToRegistry
    echo "✅ Registry reset complete. Repo-owned images (nb-ui / nb-bond-api / bens-microservice) will rebuild and re-push on the next service start."
}

function deployBesu() {
    requireContractsEnv
    assertNoLegacyBesuStorage

    # shellcheck source=/dev/null
    source "$CONTRACTS_ENV_FILE"
    if [ -z "${BESU_SIGNER_KEY:-}" ] || [[ "${BESU_SIGNER_KEY}" == "<"* ]]; then
        echo "❌ BESU_SIGNER_KEY is missing in $(pathRelativeToRepoRoot "$CONTRACTS_ENV_FILE")."
        echo "   Re-run node scripts/generate-local-sandbox-fixtures.mjs or update the local file."
        exit 1
    fi
    if [ -z "${BESU_ARCHIVE_KEY:-}" ] || [[ "${BESU_ARCHIVE_KEY}" == "<"* ]]; then
        echo "❌ BESU_ARCHIVE_KEY is missing in $(pathRelativeToRepoRoot "$CONTRACTS_ENV_FILE")."
        echo "   Re-run node scripts/generate-local-sandbox-fixtures.mjs or update the local file."
        exit 1
    fi
    BESU_SIGNER_KEY_HEX="${BESU_SIGNER_KEY#0x}"
    BESU_ARCHIVE_KEY_HEX="${BESU_ARCHIVE_KEY#0x}"

    BESU_VALIDATOR_ADDRESS=$(cast wallet address --private-key "$BESU_SIGNER_KEY" | tr '[:upper:]' '[:lower:]')
    BESU_ARCHIVE_ADDRESS=$(cast wallet address --private-key "$BESU_ARCHIVE_KEY" | tr '[:upper:]' '[:lower:]')
    BESU_VALIDATOR_PUBLIC_KEY=$(cast wallet public-key --private-key "$BESU_SIGNER_KEY")
    BESU_ARCHIVE_PUBLIC_KEY=$(cast wallet public-key --private-key "$BESU_ARCHIVE_KEY")
    BESU_VALIDATOR_PUBLIC_KEY="${BESU_VALIDATOR_PUBLIC_KEY#0x}"
    BESU_ARCHIVE_PUBLIC_KEY="${BESU_ARCHIVE_PUBLIC_KEY#0x}"

    if [ "$BESU_VALIDATOR_ADDRESS" == "$BESU_ARCHIVE_ADDRESS" ]; then
        echo "❌ Validator and archive keys resolve to the same node identity."
        exit 1
    fi

    QBFT_EXTRA_DATA=$(cast to-rlp \
        "[\"0x0000000000000000000000000000000000000000000000000000000000000000\",[\"$BESU_VALIDATOR_ADDRESS\"],[],\"0x\",[]]")

    if [[ ${#BESU_VALIDATOR_PUBLIC_KEY} -ne 128 || ${#BESU_ARCHIVE_PUBLIC_KEY} -ne 128 ]]; then
        echo "❌ Could not derive valid Besu node public keys from the local fixture keys."
        exit 1
    fi

    echo "🔐 QBFT validator address: $BESU_VALIDATOR_ADDRESS"
    echo "📚 Archive node address: $BESU_ARCHIVE_ADDRESS"

    # Extract Besu image name from values file
    BESU_IMAGE=$(getBesuImage)
    echo "🔍 Using Besu image: $BESU_IMAGE"

    loadImageToKind $BESU_IMAGE
    BESU_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BESU_IMAGE")
    echo "🔁 Using local registry image for Besu: $BESU_IMAGE_OVERRIDE"

    helm upgrade besu $REPO_ROOT/infra/besu \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace besu \
         --create-namespace \
         --values $REPO_ROOT/infra/besu/values.local.yaml \
         --set-string validator.key="$BESU_SIGNER_KEY_HEX" \
         --set-string validator.address="$BESU_VALIDATOR_ADDRESS" \
         --set-string validator.nodePublicKey="$BESU_VALIDATOR_PUBLIC_KEY" \
         --set-string archive.key="$BESU_ARCHIVE_KEY_HEX" \
         --set-string archive.address="$BESU_ARCHIVE_ADDRESS" \
         --set-string archive.nodePublicKey="$BESU_ARCHIVE_PUBLIC_KEY" \
         --set-string qbftExtraData="$QBFT_EXTRA_DATA" \
         ${BESU_IMAGE_OVERRIDE:+--set image=$BESU_IMAGE_OVERRIDE}
}

function createOrResetTmpdir() {
    path=$1

    if [ -d "$path" ] && [ ! -f "$path/${TMPDIR_FLAGFILE}" ]; then
        echo "❌ Found an existing dir at $path that is not a cbdc sandbox tmpdir. Aborting."
        exit 1
    elif [ -d "$path" ]; then
        rm -r "$path"
    fi
    mkdir "$path" && touch "$path/${TMPDIR_FLAGFILE}"
}

function base64NoWrap() {
    if [ "$OS_NAME" == "Darwin" ]; then
        base64 -b 0
    else
        base64 -w 0
    fi
}

function deployDirectoryToConfigmap() {
    path=$1
    dir=$2
    namespace=$3

    # store the target directory as a base64-encoded tar archive
    # note that it will be stored in a configmap, so its size cannot exceed 1MB
    kubectl --context=kind-$CLUSTER_NAME apply -n $namespace -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $namespace
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: $dir
binaryData:
  $dir.tar.gz: $(tar -C "$path" -czf - "$dir" | base64NoWrap)
EOF
}

# Compute a short content hash over the inputs that influence the built
# BENS image. Used as the image tag so a fresh image is built (and
# pushed) only when something that actually changes the runtime bundle
# changes.
function bensImageHash() {
    # Sources that affect the build output: generated server tree +
    # requirements.txt + Dockerfile. The swagger spec is the source for
    # the generator, but the generator output is what ships, so we hash
    # only the output.
    {
        find "$BLOCKSCOUT_BENS_DIR/src/openapi_server" -type f \
            -not -path '*/__pycache__/*' -not -name '*.pyc' \
            -print0 2>/dev/null | sort -z | xargs -0 shasum -a 256
        shasum -a 256 \
            "$BLOCKSCOUT_BENS_DIR/requirements.txt" \
            "$BLOCKSCOUT_BENS_DIR/Dockerfile" 2>/dev/null
    } | shasum -a 256 | cut -c1-12
}

# Build the BENS image locally and push to the kind registry. Echoes the
# in-kind pull tag (localhost:5001/bens-microservice:<hash>) on stdout
# so callers can pass it to helm as --set bensImage=...; everything
# else goes to stderr.
function prepareBensImage() {
    requireKindRegistry

    if [ ! -d "$BLOCKSCOUT_BENS_DIR/src/openapi_server" ]; then
        echo "❌ Missing generated BENS OpenAPI server at $BLOCKSCOUT_BENS_DIR/src/openapi_server." >&2
        echo "Run the generator before deploying:" >&2
        echo "  (cd $BLOCKSCOUT_BENS_DIR && ./regen-openapi.sh)" >&2
        return 1
    fi

    BENS_BASE_RESOLVED="$(getBensBaseImage)"
    loadImageToKind "$BENS_BASE_RESOLVED" >&2

    local bundle_hash
    bundle_hash="$(bensImageHash)"
    if [ -z "$bundle_hash" ]; then
        echo "❌ Could not compute BENS bundle hash." >&2
        return 1
    fi

    # Build context is the BENS dir with its default Dockerfile (no -f).
    # The helper echoes the localhost:5001 pull tag on stdout, preserving
    # the `--set bensImage=$(prepareBensImage)` contract.
    buildAndPushHashedImage \
        "bens-microservice" "$bundle_hash" "$BLOCKSCOUT_BENS_DIR" "-" prepBensBases \
        "BENS_BUILDER_IMAGE=${BENS_BASE_RESOLVED}" \
        "BENS_RUNTIME_IMAGE=${BENS_BASE_RESOLVED}"
}

function composeBlockscoutChart() {
    # add blockscout repository so that we can use its helm chart
    helm repo add blockscout https://blockscout.github.io/helm-charts
    helm repo update blockscout

    # pull the blockscout helm chart into a temporary directory
    createOrResetTmpdir ${BLOCKSCOUT_TMPDIR}
    BLOCKSCOUT_CHART_VERSION="$(getBlockscoutChartVersion)"
    helm pull blockscout/blockscout-stack --version ${BLOCKSCOUT_CHART_VERSION} -d ${BLOCKSCOUT_TMPDIR} --untar

    # add our httproute to the helm chart from the repo
    cp ${BLOCKSCOUT_DIR}/templates/* ${BLOCKSCOUT_TMPDIR}/blockscout-stack/templates/
}

function deployBlockscout() {
    BLOCKSCOUT_FRONTEND_IMAGE=$(getBlockscoutFrontendImage)
    echo "🔍 Using blockscout frontend image: $BLOCKSCOUT_FRONTEND_IMAGE"

    BLOCKSCOUT_BACKEND_IMAGE=$(getBlockscoutBackendImage)
    echo "🔍 Using blockscout backend image: $BLOCKSCOUT_BACKEND_IMAGE"

    POSTGRES_IMAGE=$(getBlockscoutDbImage)
    echo "🔍 Using postgres image: $POSTGRES_IMAGE"

    SC_VERIFIER_IMAGE=$(getBlockscoutScVerifierImage)
    echo "🔍 Using smart-contract-verifier image: $SC_VERIFIER_IMAGE"

    loadImageToKind $BLOCKSCOUT_FRONTEND_IMAGE
    loadImageToKind $BLOCKSCOUT_BACKEND_IMAGE
    loadImageToKind $POSTGRES_IMAGE
    loadImageToKind $SC_VERIFIER_IMAGE

    # BENS is a repo-owned service: build the image locally with a
    # content-hash tag, push to the kind registry, and pass that ref to
    # helm. prepareBensImage echoes the pull tag on stdout.
    BENS_IMAGE_OVERRIDE="$(prepareBensImage)"
    echo "🔁 Using locally-built BENS image: $BENS_IMAGE_OVERRIDE"

    BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BLOCKSCOUT_FRONTEND_IMAGE")
    BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BLOCKSCOUT_BACKEND_IMAGE")
    POSTGRES_IMAGE_OVERRIDE=$(kindRegistryImageFor "$POSTGRES_IMAGE")
    SC_VERIFIER_IMAGE_OVERRIDE=$(kindRegistryImageFor "$SC_VERIFIER_IMAGE")
    echo "🔁 Using local registry image for blockscout frontend: $BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE"
    echo "🔁 Using local registry image for blockscout backend: $BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE"
    echo "🔁 Using local registry image for postgres: $POSTGRES_IMAGE_OVERRIDE"
    echo "🔁 Using local registry image for smart-contract-verifier: $SC_VERIFIER_IMAGE_OVERRIDE"

    BLOCKSCOUT_FRONTEND_REPOSITORY_OVERRIDE=$(imageRepo "$BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE")
    BLOCKSCOUT_FRONTEND_TAG_OVERRIDE=$(imageTag "$BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE")
    BLOCKSCOUT_BACKEND_REPOSITORY_OVERRIDE=$(imageRepo "$BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE")
    BLOCKSCOUT_BACKEND_TAG_OVERRIDE=$(imageTag "$BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE")

    # deploy postgres db and blockscout
    helm upgrade blockscout $BLOCKSCOUT_TMPDIR/blockscout-stack \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace $BLOCKSCOUT_NAMESPACE \
         --create-namespace \
         --values $BLOCKSCOUT_DIR/values.yaml \
         --values $BLOCKSCOUT_DIR/values.local.yaml \
         --values $BLOCKSCOUT_DIR/values.backend.env.yaml \
         --values $BLOCKSCOUT_DIR/values.frontend.env.yaml \
         --version $BLOCKSCOUT_CHART_VERSION \
         ${BLOCKSCOUT_FRONTEND_REPOSITORY_OVERRIDE:+--set frontend.image.repository=$BLOCKSCOUT_FRONTEND_REPOSITORY_OVERRIDE} \
         ${BLOCKSCOUT_FRONTEND_TAG_OVERRIDE:+--set frontend.image.tag=$BLOCKSCOUT_FRONTEND_TAG_OVERRIDE} \
         ${BLOCKSCOUT_BACKEND_REPOSITORY_OVERRIDE:+--set blockscout.image.repository=$BLOCKSCOUT_BACKEND_REPOSITORY_OVERRIDE} \
         ${BLOCKSCOUT_BACKEND_TAG_OVERRIDE:+--set blockscout.image.tag=$BLOCKSCOUT_BACKEND_TAG_OVERRIDE} \
         ${POSTGRES_IMAGE_OVERRIDE:+--set dbImage=$POSTGRES_IMAGE_OVERRIDE} \
         ${BENS_IMAGE_OVERRIDE:+--set bensImage=$BENS_IMAGE_OVERRIDE} \
         ${SC_VERIFIER_IMAGE_OVERRIDE:+--set scVerifierImage=$SC_VERIFIER_IMAGE_OVERRIDE}

}

function deployContracts() {
    network=$1
    chain_id=$2
    verify_contracts=${3:-""}

    registry_contract_address="$(getDefaultRegistryContractAddress)"
    registry_predeploy="false"
    if [ -n "$registry_contract_address" ] && command -v cast >/dev/null 2>&1; then
        set +e
        registry_code=$(cast code --rpc-url "$network" "$registry_contract_address" 2>/dev/null)
        cast_status=$?
        set -e
        if [ "$cast_status" -eq 0 ] && [ -n "$registry_code" ] && [ "$registry_code" != "0x" ]; then
            registry_predeploy="true"
        fi
    fi

    if [ "$registry_predeploy" == "true" ]; then
        echo "using predeployed GlobalRegistry at $registry_contract_address"
    else
        echo "deploying contract registry..."
        $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/common/01_GlobalRegistry.s.sol:GlobalRegistryScript $verify_contracts
        registry_contract_address=$(getContractAddressFromScriptRunfile $chain_id 01_GlobalRegistry.s.sol GlobalRegistry)
    fi
    deployRegistryContractAddressToConfigmap $registry_contract_address

    echo "deploying DvP contract..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/csd/02_DvP.s.sol:DvPScript $verify_contracts

    echo "deploying Wnok contract..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/norges-bank/03_Wnok.s.sol:WnokScript $verify_contracts

    echo "deploying TBD contracts..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/private-bank/04_Tbd.s.sol:TbdScript $verify_contracts

    echo "deploying StockToken contract..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/csd/05_StockToken.s.sol:StockTokenScript $verify_contracts

    echo "deploying OrderBook contract..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/csd/06_OrderBook.s.sol:OrderBookScript $verify_contracts

    echo "setup Wnok contract..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/norges-bank/07_WnokSetup.s.sol:WnokSetupScript $verify_contracts

    echo "setup TBD contracts..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/private-bank/08_TbdSetup.s.sol:TbdSetupScript $verify_contracts

    echo "setup Broker contracts..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/broker/09_BrokersSetup.s.sol:BrokersSetupScript $verify_contracts

    echo "deploying Bond contracts..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/norges-bank/10_Bond.s.sol:BondScript $verify_contracts

    echo "setting up Bond contracts..."
    REGISTRY_ADDR="$registry_contract_address" $CONTRACTS_DIR/deploy.sh $network $CONTRACTS_DIR/script/norges-bank/11_BondSetup.s.sol:BondSetupScript $verify_contracts

    genesis_hash=$(getChainGenesisHash "$network")
    if [ -z "$genesis_hash" ]; then
        echo "❌ Could not read the genesis hash after contract deployment."
        exit 1
    fi
    markContractsDeployed "$chain_id" "$registry_contract_address" "$genesis_hash"
}


# Compute a short content hash over the inputs that influence the built
# nb-bond-api image. Used as the image tag so a fresh image is built (and
# pushed) only when something that actually changes the runtime bundle
# changes.
function nbBondApiBundleHash() {
    # Sources that affect the build output: workspace source + tsconfig +
    # Dockerfile + the root-level workspace metadata (package.json /
    # package-lock.json) since deps now resolve at the repo root.
    # Anything outside this list (tests, README, openapi.json snapshot,
    # dev-only configs) legitimately doesn't bust the cache.
    {
        find "$NB_BOND_API_DIR/src" -type f -print0 2>/dev/null | sort -z | xargs -0 shasum -a 256
        shasum -a 256 \
            "$REPO_ROOT/package.json" \
            "$REPO_ROOT/package-lock.json" \
            "$NB_BOND_API_DIR/package.json" \
            "$NB_BOND_API_DIR/tsconfig.json" \
            "$NB_BOND_API_DIR/Dockerfile" 2>/dev/null
    } | shasum -a 256 | cut -c1-12
}

function deployNBBondAPI() {
    requireNBBondApiHelmValues
    requireKindRegistry

    # Push both Dockerfile stage bases into the kind registry first so the
    # build works offline (matches the nb-ui pattern).
    NB_BOND_API_BUILDER_RESOLVED="$(getNBBondApiBuilderImage)"
    NB_BOND_API_RUNTIME_RESOLVED="$(getNBBondApiRuntimeImage)"
    loadImageToKind "$NB_BOND_API_BUILDER_RESOLVED"
    if [ "$NB_BOND_API_RUNTIME_RESOLVED" != "$NB_BOND_API_BUILDER_RESOLVED" ]; then
        loadImageToKind "$NB_BOND_API_RUNTIME_RESOLVED"
    fi

    local bundle_hash
    bundle_hash="$(nbBondApiBundleHash)"
    if [ -z "$bundle_hash" ]; then
        echo "❌ Could not compute nb-bond-api bundle hash."
        return 1
    fi

    # Build/check/push via the shared helper. Image refs follow the kind
    # registry convention: containerd in the Kind node maps localhost:5001
    # → the kind registry, so the pod-side pull tag equals the host push
    # tag. See infra/cluster/containerd-certs.d/. Build context is the repo
    # root so the Dockerfile can COPY the workspace-level package.json +
    # package-lock.json; the root .dockerignore controls the daemon upload.
    local pull_tag_in_kind
    pull_tag_in_kind="$(buildAndPushHashedImage \
        "nb-bond-api" "$bundle_hash" "$REPO_ROOT" "$NB_BOND_API_DIR/Dockerfile" prepNBBondApiBases \
        "NB_BOND_API_BUILDER_IMAGE=${NB_BOND_API_BUILDER_RESOLVED}" \
        "NB_BOND_API_RUNTIME_IMAGE=${NB_BOND_API_RUNTIME_RESOLVED}")" || return 1

    registry_contract_address="$(getRegistryContractAddressFromConfigmap)"
    if [ -z "$registry_contract_address" ]; then
        registry_contract_address="$(getDefaultRegistryContractAddress)"
    fi
    if [ -z "$registry_contract_address" ]; then
        echo "❌ Could not resolve GlobalRegistry address for NB Bond API."
        return 1
    fi

    helm upgrade nb-bond-api $REPO_ROOT/services/nb-bond-api/helm \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace $NB_BOND_API_NAMESPACE \
         --create-namespace \
         --values "$NB_BOND_API_HELM_VALUES_FILE" \
         --set "image=${pull_tag_in_kind}" \
         --set-string env.GLOBAL_REGISTRY_ADDRESS=$registry_contract_address
}

# Compute a short content hash over the inputs that influence the built
# bundle. Used as the nb-ui image tag so a fresh image is built (and pushed)
# only when something that actually changes the bundle changes.
function nbUIBundleHash() {
    # Sources that affect the build output: workspace source + build config
    # + Dockerfile + the root-level workspace metadata (package.json /
    # package-lock.json) since deps now resolve at the repo root.
    # Anything outside this list (tests, README, .dockerignore)
    # legitimately doesn't bust the cache.
    {
        find "$NB_UI_DIR/src" "$NB_UI_DIR/public" -type f -print0 2>/dev/null | sort -z | xargs -0 shasum -a 256
        shasum -a 256 \
            "$REPO_ROOT/package.json" \
            "$REPO_ROOT/package-lock.json" \
            "$NB_UI_DIR/package.json" \
            "$NB_UI_DIR/index.html" \
            "$NB_UI_DIR/vite.config.js" \
            "$NB_UI_DIR/Dockerfile" 2>/dev/null
    } | shasum -a 256 | cut -c1-12
}

function deployNBUI() {
    requireKindRegistry

    # Push both Dockerfile stage bases into the kind registry first so the
    # build works offline (matches the pattern other services use).
    NB_UI_BUILDER_RESOLVED="$(getNBUIBuilderImage)"
    NB_UI_NGINX_RESOLVED="$(getNBUINginxImage)"
    loadImageToKind "$NB_UI_BUILDER_RESOLVED"
    loadImageToKind "$NB_UI_NGINX_RESOLVED"

    local bundle_hash
    bundle_hash="$(nbUIBundleHash)"
    if [ -z "$bundle_hash" ]; then
        echo "❌ Could not compute nb-ui bundle hash."
        return 1
    fi

    # Build/check/push via the shared helper. Image refs follow the kind
    # registry convention: containerd in the Kind node maps localhost:5001
    # → the kind registry, so the pod-side pull tag equals the host push
    # tag. See infra/cluster/containerd-certs.d/. Build context is the repo
    # root so the Dockerfile can COPY the workspace-level package.json +
    # package-lock.json; the root .dockerignore controls the daemon upload.
    local pull_tag_in_kind
    pull_tag_in_kind="$(buildAndPushHashedImage \
        "nb-ui" "$bundle_hash" "$REPO_ROOT" "$NB_UI_DIR/Dockerfile" prepNBUIBases \
        "NB_UI_BUILDER_IMAGE=${NB_UI_BUILDER_RESOLVED}" \
        "NB_UI_NGINX_IMAGE=${NB_UI_NGINX_RESOLVED}")" || return 1

    helm upgrade nb-ui "$REPO_ROOT/services/nb-ui/helm" \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace $NB_UI_NAMESPACE \
         --create-namespace \
         --set "image=${pull_tag_in_kind}"
}
