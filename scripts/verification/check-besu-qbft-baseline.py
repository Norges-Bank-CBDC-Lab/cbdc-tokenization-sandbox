#!/usr/bin/env python3
"""Validate the tracked Besu/QBFT/Osaka topology without a running cluster."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def value(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text, re.MULTILINE)
    if not match:
        raise ValueError(f"could not find {label}")
    return match.group(1)


def decode_rlp(data: bytes, offset: int = 0) -> tuple[bytes | list[object], int]:
    prefix = data[offset]
    if prefix <= 0x7F:
        return bytes([prefix]), offset + 1
    if prefix <= 0xB7:
        length = prefix - 0x80
        start = offset + 1
        return data[start : start + length], start + length
    if prefix <= 0xBF:
        length_of_length = prefix - 0xB7
        start = offset + 1
        length = int.from_bytes(data[start : start + length_of_length])
        payload = start + length_of_length
        return data[payload : payload + length], payload + length
    if prefix <= 0xF7:
        length = prefix - 0xC0
        start = offset + 1
    else:
        length_of_length = prefix - 0xF7
        start = offset + 1
        length = int.from_bytes(data[start : start + length_of_length])
        start += length_of_length
    end = start + length
    items: list[object] = []
    while start < end:
        item, start = decode_rlp(data, start)
        items.append(item)
    if start != end:
        raise ValueError("RLP list length is inconsistent")
    return items, end


def render_toml(template: str, role: str, p2p_host: str) -> dict[str, object]:
    rendered = (
        template.replace('{{ .Values.dataPath | quote }}', '"/var/lib/besu"')
        .replace('{{ .Values.logging | quote }}', '"INFO"')
        .replace("{{ .Values.networkId }}", "2018")
        .replace(f'{{{{ .Values.{role}.p2pHost | quote }}}}', json.dumps(p2p_host))
    )
    if "{{" in rendered:
        raise ValueError(f"unrendered Helm expression remains in {role} TOML")
    return tomllib.loads(rendered)


def main() -> int:
    errors: list[str] = []
    images = read("common/images.yaml")
    values = read("infra/besu/values.yaml")
    genesis_template = read("infra/besu/config/genesis.json")
    validator = read("infra/besu/config/validator.toml")
    archive = read("infra/besu/config/archive.toml")
    statefulsets = read("infra/besu/templates/besu.yaml")
    services = read("infra/besu/templates/service.yaml")
    signers = read("infra/besu/templates/signers.yaml")
    blockscout = read("services/blockscout/values.backend.env.yaml")
    nb_api = read("services/nb-bond-api/helm/values.local.example.yaml")
    foundry = read("contracts/foundry.toml")
    helpers = read("common/helpers.sh")

    common_image = value(r"^besu:\s*(\S+)$", images, "common Besu image")
    chart_image = value(r"^image:\s*(\S+)$", values, "chart Besu image")
    require(common_image == chart_image, "Besu image pins differ", errors)
    require(common_image == "hyperledger/besu:26.7.0", "unexpected Besu version", errors)

    extra_data = value(r'^qbftExtraData:\s*"(0x[0-9a-f]+)"$', values, "QBFT extraData")
    decoded_extra, decoded_end = decode_rlp(bytes.fromhex(extra_data[2:]))
    rendered_genesis = genesis_template.replace("{{ .Values.qbftExtraData }}", extra_data)
    try:
        genesis = json.loads(rendered_genesis)
    except json.JSONDecodeError as exc:
        errors.append(f"genesis template is not valid after default rendering: {exc}")
        genesis = {}

    config = genesis.get("config", {})
    require("clique" not in config, "Clique remains in genesis", errors)
    require("qbft" in config, "QBFT is missing from genesis", errors)
    qbft = config.get("qbft", {})
    require(qbft.get("blockperiodseconds") == 1,
            "QBFT transaction block period is not 1 second", errors)
    require(qbft.get("emptyblockperiodseconds") == 300,
            "QBFT empty-block period is not 300 seconds", errors)
    require(config.get("chainId") == 2018, "genesis chain ID is not 2018", errors)
    for milestone in ("shanghaiTime", "cancunTime", "pragueTime", "osakaTime"):
        require(config.get(milestone) == 0, f"{milestone} is not active from genesis", errors)
    require(config.get("zeroBaseFee") is True, "zeroBaseFee is not enabled", errors)
    require(genesis.get("gasLimit") == "0x3938700", "block gas limit is not 60,000,000", errors)

    validator_address = value(
        r'validator:\n\s+address:\s*"(0x[0-9a-f]+)"', values, "validator address"
    )
    archive_address = value(
        r'archive:\n\s+address:\s*"(0x[0-9a-f]+)"', values, "archive address"
    )
    validator_bytes = bytes.fromhex(validator_address[2:])
    require(decoded_end == len(bytes.fromhex(extra_data[2:])), "QBFT extraData has trailing data", errors)
    require(
        isinstance(decoded_extra, list)
        and len(decoded_extra) == 5
        and decoded_extra[1] == [validator_bytes],
        "QBFT extraData does not decode to exactly the expected validator",
        errors,
    )
    require(archive_address[2:] not in extra_data, "archive node is present in QBFT validators", errors)

    try:
        validator_config = render_toml(
            validator, "validator", "besu-validator-0.besu-validator-p2p.besu.svc.cluster.local"
        )
        archive_config = render_toml(
            archive, "archive", "besu-archive-0.besu-archive-p2p.besu.svc.cluster.local"
        )
        require(validator_config.get("network-id") == 2018, "validator network ID differs", errors)
        require(archive_config.get("network-id") == 2018, "archive network ID differs", errors)
    except (tomllib.TOMLDecodeError, ValueError) as exc:
        errors.append(f"Besu TOML template is invalid after rendering: {exc}")

    require('rpc-http-api=["ETH","NET","WEB3","ADMIN","QBFT"]' in validator,
            "validator exposes an unexpected RPC API set", errors)
    require('data-storage-format="BONSAI"' in validator, "validator is not Bonsai", errors)
    require('data-storage-format="FOREST"' in archive, "archive is not Forest", errors)
    require('sync-mode="FULL"' in archive, "archive is not FULL sync", errors)
    require('tx-pool="SEQUENCED"' in validator and 'tx-pool="SEQUENCED"' in archive,
            "both nodes must use the sequenced transaction pool", errors)
    require("CLIQUE" not in validator + archive, "Clique RPC namespace remains", errors)

    for expected in ("besu-validator", "besu-archive", "besu-validator-pvc", "besu-archive-pvc"):
        require(expected in statefulsets, f"missing distinct runtime identity {expected}", errors)
    require("kind: Secret" in signers and "besu-validator-key" in signers and "besu-archive-key" in signers,
            "validator/archive key Secrets are not distinct", errors)
    require("besu-validator-p2p" in services and "besu-archive-p2p" in services,
            "stable P2P services are missing", errors)
    require(
        statefulsets.count("--p2p-host=$(POD_IP)") == 2
        and statefulsets.count("fieldPath: status.podIP") == 2,
        "Besu nodes do not advertise their Kubernetes pod IPs",
        errors,
    )
    require(
        statefulsets.count("name: resolve-static-peer") == 2
        and statefulsets.count("getent ahostsv4") == 2
        and statefulsets.count("/etc/besu-static/static-nodes.json") == 2,
        "static peer enodes are not resolved to pod IPs before Besu starts",
        errors,
    )

    archive_endpoint = "besu-archive.besu"
    require(blockscout.count(archive_endpoint) == 3, "Blockscout is not archive-only", errors)
    require(f"http://{archive_endpoint}:8545" in nb_api, "NB Bond API is not archive-only", errors)
    require("besu-validator" not in blockscout + nb_api, "a consumer points at the validator", errors)
    require(
        "assertBlockscoutChainIdentity" in helpers
        and "blockscout-chain-identity" in helpers,
        "Blockscout database is not bound to the chain genesis",
        errors,
    )
    require(
        "getContractsDeploymentGenesisHash" in helpers,
        "contract deployment marker is not bound to the chain genesis",
        errors,
    )

    require('solc = "0.8.36"' in foundry, "Foundry Solidity version is not 0.8.36", errors)
    require('evm_version = "osaka"' in foundry, "Foundry EVM target is not Osaka", errors)
    require(foundry.count('= "5.6.1"') == 2, "OpenZeppelin packages are not both 5.6.1", errors)

    artifact_path = ROOT / "contracts/out/GlobalRegistry.sol/GlobalRegistry.json"
    if artifact_path.exists() and genesis:
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        runtime = artifact["deployedBytecode"]["object"]
        alloc = genesis.get("alloc", {})
        registry = alloc.get("0x700b6A60ce7EaaEA56F065753d8dcB9653dbAD35", {})
        require(registry.get("code") == runtime,
                "genesis GlobalRegistry bytecode differs from the Foundry build", errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Besu QBFT/Osaka baseline is internally consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
