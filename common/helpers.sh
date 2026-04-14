set -Eeuo pipefail

CLUSTER_NAME="cluster-cbdc-monoledger"
DEPLOYMENT_CONFIG_FILE=".env.sandbox"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}" )" && cd .. && pwd)"
TMPDIR_FLAGFILE=.isCbdcSandboxTmpdir
IMAGES_CONFIG=$REPO_ROOT/common/images.yaml
VERSIONS_CONFIG=$REPO_ROOT/common/versions.yaml

REGISTRY_CONTRACT_NAMESPACE=jupyterhub
REGISTRY_CONTRACT_CONFIGMAP=registry-contract

CONTRACTS_DEPLOYMENT_NAMESPACE=$REGISTRY_CONTRACT_NAMESPACE
CONTRACTS_DEPLOYMENT_CONFIGMAP=contracts-deployed

EVM_ENVIRONMENT_SECRET=environment

SCRIPTRUNNER_NAMESPACE=jupyterhub
SCRIPTRUNNER_DIR=$REPO_ROOT/services/script-runner
SCRIPTRUNNER_TMPDIR=$SCRIPTRUNNER_DIR/.tmp
SCRIPTRUNNER_BASEIMAGE_NAME=quay.io/jupyter/base-notebook
SCRIPTRUNNER_BASEIMAGE_TAG=notebook-7.5.3
SCRIPTRUNNER_CHART_VERSION="4.3.2"

CONTRACTS_DIR=$REPO_ROOT/contracts
CONTRACTS_BUILD_DIR=$REPO_ROOT/contracts/out
CONTRACTS_ENV_FILE=$CONTRACTS_DIR/.env
CONTRACTS_ENV_EXAMPLE_FILE=$CONTRACTS_DIR/.env.example
LOCAL_SANDBOX_FIXTURE_GENERATOR=$REPO_ROOT/scripts/generate-local-sandbox-fixtures.mjs

BLOCKSCOUT_NAMESPACE=blockscout
BLOCKSCOUT_DIR=$REPO_ROOT/services/blockscout
BLOCKSCOUT_TMPDIR=$BLOCKSCOUT_DIR/.tmp
BLOCKSCOUT_CHART_VERSION=4.3.1
BLOCKSCOUT_BENS_DIR=$BLOCKSCOUT_DIR/bens-microservice
BENS_IMAGE=bens-microservice
BENS_TAG=v1.0.0

NB_BOND_API_NAMESPACE=nb-bond-api
NB_BOND_API_BASEIMAGE=node:25.6.0
NB_BOND_API_HELM_VALUES_FILE=$REPO_ROOT/services/nb-bond-api/helm/values.local.yaml
NB_BOND_API_HELM_VALUES_EXAMPLE_FILE=$REPO_ROOT/services/nb-bond-api/helm/values.local.example.yaml

KIND_REGISTRY_NAME=kind-registry
KIND_REGISTRY_PORT=5001
KIND_REGISTRY_IMAGE=registry:2
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
        "jupyterhub.cbdc-sandbox.local"
        "bond-api.cbdc-sandbox.local"
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
    if ! docker ps --format '{{.Names}}' | grep -q "^${KIND_REGISTRY_NAME}$"; then
        if docker ps -a --format '{{.Names}}' | grep -q "^${KIND_REGISTRY_NAME}$"; then
            docker start "${KIND_REGISTRY_NAME}" >/dev/null
        else
            docker run -d \
                --restart=always \
                -p "127.0.0.1:${KIND_REGISTRY_PORT}:5000" \
                --name "${KIND_REGISTRY_NAME}" \
                "${KIND_REGISTRY_IMAGE}" >/dev/null
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

function markContractsDeployed() {
    chain_id=$1
    registry_contract_address=$2
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
    waitForApp besu besu
}

function waitForApiGateway() {
    waitForApp nginx-gateway nginx-gateway-fabric

    msg="Testing gateway..."
    waitMsg "$msg" start
    i=0

    while [ "$(curl -o /dev/null -s -w "%{http_code}\n" http://besu.cbdc-sandbox.local)" == "502" ]; do
        waitMsg "$msg" $i
        sleep 1
        i=$(( i+1 ))
    done

    waitMsg "$msg" end
}

function waitForScriptRunner() {
    waitForApp jupyterhub jupyterhub
}

function waitForBlockscout() {
    waitForApp blockscout blockscout-blockscout-stack-blockscout
}

function waitForNBBondAPI() {
    waitForApp nb-bond-api nb-bond-api
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
    helm upgrade ngf oci://ghcr.io/nginx/charts/nginx-gateway-fabric \
         --install \
         --version ${NGINX_GATEWAY_FABRIC_VERSION} \
         --kube-context kind-$CLUSTER_NAME \
         --namespace nginx-gateway \
         --create-namespace \
         --set service.create=false

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

    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        requireKindRegistry
    fi

    if [ "${USE_KIND_REGISTRY:-false}" == "true" ] && [ "${FORCE_IMAGE_PULL:-false}" != "true" ]; then
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

    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        pushImageToKindRegistry "$kind_image"
        return 0
    fi

    # Load the image into Kind cluster with retries
    echo "📦 Loading image $kind_image into Kind cluster..."
    for i in {1..3}; do
        if kind load docker-image "$kind_image" --name "$CLUSTER_NAME"; then
            echo "✅ Successfully loaded image into cluster"
            break
        else
            if [ $i -eq 3 ]; then
                echo "⚠️ Failed to load image after 3 attempts. Will rely on cluster pull."
            else
                echo "⚠️ Attempt $i failed, retrying..."
                sleep 2
            fi
        fi
    done

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

function getScriptRunnerChartVersion() {
    getVersionValue "charts.script_runner" "$SCRIPTRUNNER_CHART_VERSION"
}

function getNginxGatewayFabricVersion() {
    getVersionValue "charts.nginx_gateway_fabric" "2.4.1"
}

function getBlockscoutDbImage() {
    default_image=$(yq -r '.dbImage' $REPO_ROOT/services/blockscout/values.yaml)
    getImageValue "blockscout.db" "$default_image"
}

function getBlockscoutBensImage() {
    default_image=$(yq -r '.bensImage' $REPO_ROOT/services/blockscout/values.yaml)
    getImageValue "blockscout.bens" "$default_image"
}

function getBlockscoutFrontendImage() {
    repository=$(yq -r '.frontend.image.repository // ""' $REPO_ROOT/services/blockscout/values.yaml)
    tag=$(yq -r '.frontend.image.tag // ""' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -n "$repository" ] && [ "$repository" != "null" ] && [ -n "$tag" ] && [ "$tag" != "null" ]; then
        echo "${repository}:${tag}"
    fi
}

function getBlockscoutBackendImage() {
    repository=$(yq -r '.blockscout.image.repository // ""' $REPO_ROOT/services/blockscout/values.yaml)
    tag=$(yq -r '.blockscout.image.tag // ""' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -n "$repository" ] && [ "$repository" != "null" ] && [ -n "$tag" ] && [ "$tag" != "null" ]; then
        echo "${repository}:${tag}"
    fi
}

function getScriptRunnerImage() {
    default_image="${SCRIPTRUNNER_BASEIMAGE_NAME}:${SCRIPTRUNNER_BASEIMAGE_TAG}"
    getImageValue "script_runner.base" "$default_image"
}

function getNBBondApiImage() {
    getImageValue "nb_bond_api.base" "$NB_BOND_API_BASEIMAGE"
}

function syncImagesToRegistry() {
    images=()
    images+=("$(getBesuImage)")
    images+=("$(getBlockscoutFrontendImage)")
    images+=("$(getBlockscoutBackendImage)")
    images+=("$(getBlockscoutDbImage)")
    images+=("$(getBlockscoutBensImage)")
    images+=("$(getScriptRunnerImage)")
    images+=("$(getNBBondApiImage)")

    for image in "${images[@]}"; do
        if [ -n "$image" ] && [ "$image" != "null" ]; then
            loadImageToKind "$image"
        fi
    done
}
function deployBesu() {
    requireContractsEnv

    # shellcheck source=/dev/null
    source "$CONTRACTS_ENV_FILE"
    if [ -z "${BESU_SIGNER_KEY:-}" ] || [[ "${BESU_SIGNER_KEY}" == "<"* ]]; then
        echo "❌ BESU_SIGNER_KEY is missing in $(pathRelativeToRepoRoot "$CONTRACTS_ENV_FILE")."
        echo "   Re-run node scripts/generate-local-sandbox-fixtures.mjs or update the local file."
        exit 1
    fi
    BESU_SIGNER_KEY_HEX="${BESU_SIGNER_KEY#0x}"

    # Extract Besu image name from values file
    BESU_IMAGE=$(getBesuImage)
    echo "🔍 Using Besu image: $BESU_IMAGE"

    loadImageToKind $BESU_IMAGE
    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        BESU_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BESU_IMAGE")
        echo "🔁 Using local registry image for Besu: $BESU_IMAGE_OVERRIDE"
    else
        BESU_IMAGE_OVERRIDE="$BESU_IMAGE"
    fi

    helm upgrade besu $REPO_ROOT/infra/besu \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace besu \
         --create-namespace \
         --values $REPO_ROOT/infra/besu/values.local.yaml \
         --set-string signerKey="$BESU_SIGNER_KEY_HEX" \
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

function deployBensScriptsToConfigmap() {
    cd $BLOCKSCOUT_BENS_DIR
    if [ -d "$BLOCKSCOUT_BENS_DIR/src/openapi_server" ]; then
        echo "Skipping BENS OpenAPI generation during deploy."
        echo "If you changed the spec, run:"
        echo "  (cd $BLOCKSCOUT_BENS_DIR && ./regen-openapi.sh)"
    else
        echo "❌ Missing generated BENS OpenAPI server at $BLOCKSCOUT_BENS_DIR/src/openapi_server."
        echo "Run the generator manually before deploying:"
        echo "  (cd $BLOCKSCOUT_BENS_DIR && ./regen-openapi.sh)"
        exit 1
    fi
    cp "$BLOCKSCOUT_BENS_DIR/requirements.txt" "$BLOCKSCOUT_BENS_DIR/src/"
    deployDirectoryToConfigmap ${BLOCKSCOUT_BENS_DIR} src $BLOCKSCOUT_NAMESPACE
}

function deployScriptRunnerScriptsToConfigmap() {
    deployDirectoryToConfigmap ${SCRIPTRUNNER_DIR}/notebook scripts $SCRIPTRUNNER_NAMESPACE
}

function deployScriptRunnerNotebooksToConfigmap() {
    deployDirectoryToConfigmap ${SCRIPTRUNNER_DIR}/notebook notebooks $SCRIPTRUNNER_NAMESPACE
}

function deployScriptRunnerContractAbisToConfigmap() {
    # extract the contract abis from the built contract jsons
    # then store the contract abis as a base64-encoded tar archive
    createOrResetTmpdir ${SCRIPTRUNNER_TMPDIR}
    contract_abis_tmpdir=${SCRIPTRUNNER_TMPDIR}/contracts
    mkdir $contract_abis_tmpdir

    if [ -d $CONTRACTS_BUILD_DIR ]; then
        for dot_sol_dir in $(ls $CONTRACTS_BUILD_DIR); do
            # matches directories ending in .sol but not those ending in .t.sol or .s.sol
            if [[ $dot_sol_dir =~ ^.*\.sol$ ]] && ! [[ $dot_sol_dir =~ ^.*\.[st]\.sol$ ]]; then
                mkdir -p $contract_abis_tmpdir/$dot_sol_dir

                for contract_json in $(ls $CONTRACTS_BUILD_DIR/$dot_sol_dir); do
                    # for each json file in that directory, extract the abi and store it
                    # with a .abi instead of .json file ending
                    if [[ $contract_json =~ ^.*\.json$ ]]; then
                        jq '.abi' $CONTRACTS_BUILD_DIR/$dot_sol_dir/$contract_json > $contract_abis_tmpdir/$dot_sol_dir/${contract_json%.json}.abi
                    fi
                done
            fi
        done
    else
        echo "⚠️ no directory with contract abis found at $CONTRACTS_BUILD_DIR"
    fi

    deployDirectoryToConfigmap ${SCRIPTRUNNER_TMPDIR} contracts $SCRIPTRUNNER_NAMESPACE
}


function composeScriptRunnerChart() {
    # add jupyterhub repository so that we can use its helm chart
    helm repo add jupyterhub https://jupyterhub.github.io/helm-chart/
    helm repo update jupyterhub

    # pull the jupyterhub helm chart into a temporary directory
    createOrResetTmpdir ${SCRIPTRUNNER_TMPDIR}
    SCRIPTRUNNER_CHART_VERSION="$(getScriptRunnerChartVersion)"
    helm pull jupyterhub/jupyterhub --version $SCRIPTRUNNER_CHART_VERSION -d ${SCRIPTRUNNER_TMPDIR} --untar

    # add our httproute to the helm chart from the repo
    # and replace the NOTES.txt, which shows deployment info, with a custom version
    cp ${SCRIPTRUNNER_DIR}/templates/* ${SCRIPTRUNNER_TMPDIR}/jupyterhub/templates/
}

function deployScriptRunner() {
    SCRIPTRUNNER_IMAGE="$(getScriptRunnerImage)"
    echo "🔍 Using Script Runner image: $SCRIPTRUNNER_IMAGE"

    loadImageToKind $SCRIPTRUNNER_IMAGE
    SCRIPTRUNNER_IMAGE_OVERRIDE="$SCRIPTRUNNER_IMAGE"
    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        SCRIPTRUNNER_IMAGE_OVERRIDE=$(kindRegistryImageFor "$SCRIPTRUNNER_IMAGE")
        echo "🔁 Using local registry image for Script Runner: $SCRIPTRUNNER_IMAGE_OVERRIDE"
    fi
    SCRIPTRUNNER_BASEIMAGE_NAME="$(imageRepo "$SCRIPTRUNNER_IMAGE_OVERRIDE")"
    SCRIPTRUNNER_BASEIMAGE_TAG="$(imageTag "$SCRIPTRUNNER_IMAGE_OVERRIDE")"

    helm upgrade jupyterhub $SCRIPTRUNNER_TMPDIR/jupyterhub \
         --install \
         --kube-context kind-$CLUSTER_NAME \
         --namespace $SCRIPTRUNNER_NAMESPACE \
         --values $SCRIPTRUNNER_DIR/values.yaml \
         --values $SCRIPTRUNNER_DIR/values.local.yaml \
         --version ${SCRIPTRUNNER_CHART_VERSION} \
         --set singleuser.image.name=${SCRIPTRUNNER_BASEIMAGE_NAME} \
         --set singleuser.image.tag=${SCRIPTRUNNER_BASEIMAGE_TAG} \
         --set-file singleuser.extraFiles.requirements.stringData=$SCRIPTRUNNER_DIR/notebook/requirements.txt
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
    # Extract blockscout image name from values file
    BLOCKSCOUT_FRONTEND_REPOSITORY=$(yq -r '.frontend.image.repository' $REPO_ROOT/services/blockscout/values.yaml)
    BLOCKSCOUT_FRONTEND_TAG=$(yq -r '.frontend.image.tag' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -z "$BLOCKSCOUT_FRONTEND_REPOSITORY" ] || [ "$BLOCKSCOUT_FRONTEND_REPOSITORY" == "null" ] || \
       [ -z "$BLOCKSCOUT_FRONTEND_TAG" ] || [ "$BLOCKSCOUT_FRONTEND_TAG" == "null" ]; then
        echo "ℹ️ Blockscout frontend image not pinned; skipping pre-load and relying on chart defaults."
        BLOCKSCOUT_FRONTEND_IMAGE=""
    else
        BLOCKSCOUT_FRONTEND_IMAGE="${BLOCKSCOUT_FRONTEND_REPOSITORY}:${BLOCKSCOUT_FRONTEND_TAG}"
        echo "🔍 Using blockscout frontend image: $BLOCKSCOUT_FRONTEND_IMAGE"
    fi

    BLOCKSCOUT_BACKEND_REPOSITORY=$(yq -r '.blockscout.image.repository' $REPO_ROOT/services/blockscout/values.yaml)
    BLOCKSCOUT_BACKEND_TAG=$(yq -r '.blockscout.image.tag' $REPO_ROOT/services/blockscout/values.yaml)
    if [ -z "$BLOCKSCOUT_BACKEND_REPOSITORY" ] || [ "$BLOCKSCOUT_BACKEND_REPOSITORY" == "null" ] || \
       [ -z "$BLOCKSCOUT_BACKEND_TAG" ] || [ "$BLOCKSCOUT_BACKEND_TAG" == "null" ]; then
        echo "ℹ️ Blockscout backend image not pinned; skipping pre-load and relying on chart defaults."
        BLOCKSCOUT_BACKEND_IMAGE=""
    else
        BLOCKSCOUT_BACKEND_IMAGE="${BLOCKSCOUT_BACKEND_REPOSITORY}:${BLOCKSCOUT_BACKEND_TAG}"
        echo "🔍 Using blockscout backend image: $BLOCKSCOUT_BACKEND_IMAGE"
    fi

    POSTGRES_IMAGE=$(getBlockscoutDbImage)
    echo "🔍 Using postgres image: $POSTGRES_IMAGE"

    BENS_IMAGE=$(getBlockscoutBensImage)
    echo "🔍 Using python image: $BENS_IMAGE"

    if [ -n "$BLOCKSCOUT_FRONTEND_IMAGE" ]; then
        loadImageToKind $BLOCKSCOUT_FRONTEND_IMAGE
    fi
    if [ -n "$BLOCKSCOUT_BACKEND_IMAGE" ]; then
        loadImageToKind $BLOCKSCOUT_BACKEND_IMAGE
    fi
    loadImageToKind $POSTGRES_IMAGE
    loadImageToKind $BENS_IMAGE

    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        if [ -n "$BLOCKSCOUT_FRONTEND_IMAGE" ]; then
            BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BLOCKSCOUT_FRONTEND_IMAGE")
            BLOCKSCOUT_FRONTEND_REPOSITORY_OVERRIDE=$(imageRepo "$BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE")
            BLOCKSCOUT_FRONTEND_TAG_OVERRIDE=$(imageTag "$BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE")
            echo "🔁 Using local registry image for blockscout frontend: $BLOCKSCOUT_FRONTEND_IMAGE_OVERRIDE"
        fi
        if [ -n "$BLOCKSCOUT_BACKEND_IMAGE" ]; then
            BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BLOCKSCOUT_BACKEND_IMAGE")
            BLOCKSCOUT_BACKEND_REPOSITORY_OVERRIDE=$(imageRepo "$BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE")
            BLOCKSCOUT_BACKEND_TAG_OVERRIDE=$(imageTag "$BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE")
            echo "🔁 Using local registry image for blockscout backend: $BLOCKSCOUT_BACKEND_IMAGE_OVERRIDE"
        fi
        POSTGRES_IMAGE_OVERRIDE=$(kindRegistryImageFor "$POSTGRES_IMAGE")
        BENS_IMAGE_OVERRIDE=$(kindRegistryImageFor "$BENS_IMAGE")
        echo "🔁 Using local registry image for postgres: $POSTGRES_IMAGE_OVERRIDE"
        echo "🔁 Using local registry image for python: $BENS_IMAGE_OVERRIDE"
    else
        POSTGRES_IMAGE_OVERRIDE="$POSTGRES_IMAGE"
        BENS_IMAGE_OVERRIDE="$BENS_IMAGE"
    fi

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
         ${BENS_IMAGE_OVERRIDE:+--set bensImage=$BENS_IMAGE_OVERRIDE}

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

    markContractsDeployed "$chain_id" "$registry_contract_address"
}


function deployNBBondAPI() {
    requireNBBondApiHelmValues

    NB_BOND_API_BASEIMAGE="$(getNBBondApiImage)"
    loadImageToKind $NB_BOND_API_BASEIMAGE
    NB_BOND_API_IMAGE_OVERRIDE="$NB_BOND_API_BASEIMAGE"
    if [ "${USE_KIND_REGISTRY:-false}" == "true" ]; then
        NB_BOND_API_IMAGE_OVERRIDE=$(kindRegistryImageFor "$NB_BOND_API_BASEIMAGE")
        echo "🔁 Using local registry image for NB Bond API: $NB_BOND_API_IMAGE_OVERRIDE"
    fi

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
         --set nodeImage=$NB_BOND_API_IMAGE_OVERRIDE \
         --set-string env.GLOBAL_REGISTRY_ADDRESS=$registry_contract_address
}
