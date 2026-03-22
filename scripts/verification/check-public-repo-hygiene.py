#!/usr/bin/env python3
"""Validate publication-safety guardrails for the public source repository."""

from __future__ import annotations

import sys
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
    Path("services/nb-bond-api/helm/values.local.example.yaml"): [
        "Local sandbox example only.",
        "Never commit or reuse real private keys outside local development.",
        "<base64-encoded-local-sandbox-private-key>",
    ],
    Path("scripts/bid-submitter/examples/bids.keys.example.json"): [
        "<replace-with-local-bidder-private-key>",
        "<replace-with-local-bidder-seal-private-key>",
        "<replace-with-local-bidder-seal-public-key>",
    ],
}

REQUIRED_GITIGNORE_ENTRIES = [
    "/contracts/.env",
    "/services/nb-bond-api/helm/values.local.yaml",
    "/scripts/bid-submitter/examples/bids.keys.json",
]


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
