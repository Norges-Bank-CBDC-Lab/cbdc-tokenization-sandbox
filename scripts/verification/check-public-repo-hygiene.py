#!/usr/bin/env python3
"""Validate publication-safety guardrails for the public source repository."""

from __future__ import annotations

import sys
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN_TRACKED_PATHS = [
    Path("contracts/.env"),
    Path("services/nb-bond-api/helm/values.local.yaml"),
    Path("scripts/bid-submitter/examples/bids.keys.json"),
]

REQUIRED_EXAMPLES = {
    Path("contracts/.env.example"): [
        "Local sandbox example only.",
        "Never commit or reuse real private keys outside local development.",
        "<replace-with-local-sandbox-key>",
    ],
    Path("infra/besu/values.local.yaml"): [
        "set-from-contracts-env-at-deploy-time",
    ],
    Path("services/nb-bond-api/helm/values.local.example.yaml"): [
        "Local sandbox example only.",
        "Never commit or reuse real private keys outside local development.",
        "<base64-encoded-local-sandbox-private-key>",
        "<base64-encoded-local-seal-private-key>",
    ],
    Path("scripts/bid-submitter/examples/bids.keys.example.json"): [
        "<replace-with-local-bidder-private-key>",
        "<replace-with-local-bidder-seal-private-key>",
        "<replace-with-local-bidder-seal-public-key>",
    ],
    Path("scripts/bid-encryption/examples/basic/seal.example.json"): [
        "<replace-with-generated-local-bidder-private-key>",
    ],
    Path("scripts/bid-encryption/examples/basic/unseal.bidder.example.json"): [
        "<replace-with-generated-local-bidder-seal-private-key>",
    ],
    Path("scripts/bid-encryption/examples/basic/unseal.auctioneer.example.json"): [
        "<replace-with-generated-local-auction-seal-private-key>",
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.initial.json"): [
        "<replace-with-generated-local-bidder-private-key>",
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.extend.json"): [
        "<replace-with-generated-local-bidder-private-key>",
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.buyback.json"): [
        "<replace-with-generated-local-bidder-private-key>",
    ],
}

REQUIRED_GITIGNORE_ENTRIES = [
    "/contracts/.env",
    "/services/nb-bond-api/helm/values.local.yaml",
    "/scripts/bid-submitter/examples/bids.keys.json",
]

FORBIDDEN_TRACKED_PATTERNS = {
    Path("contracts/.env.example"): [
        (
            re.compile(r"(?m)^(?:BESU_SIGNER_KEY|PK_[A-Z0-9_]+)=0x[a-fA-F0-9]{64}$"),
            "raw private keys must not be committed to contracts/.env.example",
        ),
    ],
    Path("infra/besu/values.local.yaml"): [
        (
            re.compile(r'(?m)^\s*signerKey:\s*"(?!set-from-contracts-env-at-deploy-time")[^"]+"\s*$'),
            "tracked Besu values must not contain a concrete signer key",
        ),
    ],
    Path("services/nb-bond-api/helm/values.local.example.yaml"): [
        (
            re.compile(r'(?m)^\s+(?:BOND_ADMIN_PK|AUCTION_OWNER_SEAL_PK):\s+"(?!<)[^"]+"\s*$'),
            "NB Bond API example secrets must remain placeholders",
        ),
    ],
    Path("scripts/bid-submitter/examples/bids.keys.example.json"): [
        (
            re.compile(r'"(?:privateKey|sealPrivateKey)"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "bid submitter example keys must remain placeholders",
        ),
    ],
    Path("scripts/bid-encryption/examples/basic/seal.example.json"): [
        (
            re.compile(r'"bidderPrivateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked bid encryption examples must not contain bidder private keys",
        ),
    ],
    Path("scripts/bid-encryption/examples/basic/unseal.bidder.example.json"): [
        (
            re.compile(r'"privateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked bidder unseal examples must not contain bidder seal private keys",
        ),
    ],
    Path("scripts/bid-encryption/examples/basic/unseal.auctioneer.example.json"): [
        (
            re.compile(r'"privateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked auctioneer unseal examples must not contain auction seal private keys",
        ),
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.initial.json"): [
        (
            re.compile(r'"bidderPrivateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked auction bid examples must not contain bidder private keys",
        ),
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.extend.json"): [
        (
            re.compile(r'"bidderPrivateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked auction bid examples must not contain bidder private keys",
        ),
    ],
    Path("scripts/bid-encryption/examples/auctions/seal.buyback.json"): [
        (
            re.compile(r'"bidderPrivateKey"\s*:\s*"0x[a-fA-F0-9]{64}"'),
            "tracked auction bid examples must not contain bidder private keys",
        ),
    ],
}


def is_git_tracked(relative_path: Path) -> bool:
    result = subprocess.run(
        ["git", "ls-files", "--error-unmatch", str(relative_path)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def main() -> int:
    errors: list[str] = []

    for relative_path in FORBIDDEN_TRACKED_PATHS:
        if is_git_tracked(relative_path):
            errors.append(
                f"Local-only file must not be git-tracked in the public tree: {relative_path}"
            )

    for relative_path, required_snippets in REQUIRED_EXAMPLES.items():
        absolute_path = REPO_ROOT / relative_path
        if not absolute_path.exists():
            errors.append(f"Missing required example file: {relative_path}")
            continue

        text = absolute_path.read_text(encoding="utf-8")
        for snippet in required_snippets:
            if snippet not in text:
                errors.append(
                    f"Example file {relative_path} is missing required marker: {snippet}"
                )

    for relative_path, checks in FORBIDDEN_TRACKED_PATTERNS.items():
        absolute_path = REPO_ROOT / relative_path
        if not absolute_path.exists():
            errors.append(f"Missing required tracked file for hygiene validation: {relative_path}")
            continue

        text = absolute_path.read_text(encoding="utf-8")
        for pattern, message in checks:
            if pattern.search(text):
                errors.append(f"{relative_path}: {message}")

    gitignore_path = REPO_ROOT / ".gitignore"
    gitignore_text = gitignore_path.read_text(encoding="utf-8")
    for entry in REQUIRED_GITIGNORE_ENTRIES:
        if entry not in gitignore_text:
            errors.append(f".gitignore is missing required local-only entry: {entry}")

    if errors:
        print("Public repo hygiene check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Public repo hygiene guardrails look correct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
