#!/usr/bin/env python3
"""Validate the shared Node.js version pin against manifests and CI."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
NODE_VERSION_PATH = REPO_ROOT / "common/node-version.env"

ROOT_LOCKFILE_PATH = REPO_ROOT / "package-lock.json"

# Each entry: (workspace package.json, workspace relative path in the
# root lockfile's `packages` map).
NODE_TYPE_MANIFESTS = (
    (REPO_ROOT / "services/nb-bond-api/package.json", "services/nb-bond-api"),
    (REPO_ROOT / "scripts/bid-encryption/package.json", "scripts/bid-encryption"),
    (REPO_ROOT / "scripts/bid-submitter/package.json", "scripts/bid-submitter"),
)

NODE_IMAGE_FILES = (
    REPO_ROOT / "common/helpers.sh",
    REPO_ROOT / "common/images.yaml",
    REPO_ROOT / "services/nb-bond-api/Dockerfile",
    REPO_ROOT / "services/nb-ui/Dockerfile",
)

NODE_WORKFLOWS = (
    REPO_ROOT / ".github/workflows/nb-bond-api.yml",
    REPO_ROOT / ".github/workflows/nb-ui.yml",
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(read_text(path).splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not re.fullmatch(r"[A-Z0-9_]+", key):
            raise ValueError(f"{path}:{line_number}: invalid key {key!r}")
        values[key] = value
    return values


def load_json(path: Path) -> dict:
    return json.loads(read_text(path))


def assert_at_types_node_versions(expected_version: str) -> list[str]:
    errors: list[str] = []
    lockfile = load_json(ROOT_LOCKFILE_PATH)
    lock_packages = lockfile.get("packages", {})

    for package_json_path, workspace_relpath in NODE_TYPE_MANIFESTS:
        package_json = load_json(package_json_path)

        actual = package_json.get("devDependencies", {}).get("@types/node")
        if actual != expected_version:
            errors.append(
                f"{package_json_path.relative_to(REPO_ROOT)}: @types/node is "
                f"{actual!r}, expected {expected_version!r}"
            )

        # Each workspace's entry in the root lockfile is keyed by its
        # relative path and replicates the workspace's devDependencies.
        workspace_dev_deps = lock_packages.get(workspace_relpath, {}).get(
            "devDependencies", {}
        )
        lock_workspace_actual = workspace_dev_deps.get("@types/node")
        if lock_workspace_actual != expected_version:
            errors.append(
                f"{ROOT_LOCKFILE_PATH.relative_to(REPO_ROOT)} workspace "
                f"{workspace_relpath!r}: @types/node is "
                f"{lock_workspace_actual!r}, expected {expected_version!r}"
            )

    # The hoisted (deduped) copy of @types/node only lives under one
    # node_modules/@types/node entry at the root, so check it once outside
    # the per-workspace loop.
    hoisted = lock_packages.get("node_modules/@types/node")
    hoisted_version = None if hoisted is None else hoisted.get("version")
    if hoisted_version != expected_version:
        errors.append(
            f"{ROOT_LOCKFILE_PATH.relative_to(REPO_ROOT)} "
            f"node_modules/@types/node: version is {hoisted_version!r}, "
            f"expected {expected_version!r}"
        )

    return errors


def assert_node_image_references(node_image: str) -> list[str]:
    errors: list[str] = []
    stale_node_ref = re.compile(r"node:(?!\$\{SANDBOX_NODE_VERSION\})[0-9]")

    helpers_text = read_text(REPO_ROOT / "common/helpers.sh")
    if "source \"$NODE_VERSION_CONFIG\"" not in helpers_text:
        errors.append("common/helpers.sh must source common/node-version.env")
    if "NB_BOND_API_BUILDER_BASEIMAGE=$SANDBOX_NODE_IMAGE" not in helpers_text:
        errors.append(
            "common/helpers.sh must derive NB Bond API builder image from "
            "SANDBOX_NODE_IMAGE"
        )
    if "NB_BOND_API_RUNTIME_BASEIMAGE=$SANDBOX_NODE_IMAGE" not in helpers_text:
        errors.append(
            "common/helpers.sh must derive NB Bond API runtime image from "
            "SANDBOX_NODE_IMAGE"
        )
    if "NB_UI_BUILDER_BASEIMAGE=$SANDBOX_NODE_IMAGE" not in helpers_text:
        errors.append(
            "common/helpers.sh must derive NB UI builder image from "
            "SANDBOX_NODE_IMAGE"
        )

    for path in NODE_IMAGE_FILES:
        text = read_text(path)
        for match in stale_node_ref.finditer(text):
            errors.append(
                f"{path.relative_to(REPO_ROOT)} contains hard-coded Node image "
                f"{match.group(0)!r}; expected the shared {node_image!r} pin"
            )

    return errors


def assert_workflows_load_node_version(expected_version: str) -> list[str]:
    errors: list[str] = []

    for workflow_path in NODE_WORKFLOWS:
        text = read_text(workflow_path)
        rel = workflow_path.relative_to(REPO_ROOT)
        if ". common/node-version.env" not in text:
            errors.append(f"{rel}: workflow must load common/node-version.env")
        # The previous version of this check required an explicit
        # `working-directory: .` on the Node-version-loader step because
        # the job had a `defaults.run.working-directory: services/<svc>`
        # block that needed to be overridden. With the workspace-aware
        # workflows, `npm ci` runs from the repository root and there is
        # no job-level default to override, so the explicit override is
        # gone.
        if "echo \"version=${SANDBOX_NODE_VERSION}\" >> \"$GITHUB_OUTPUT\"" not in text:
            errors.append(
                f"{rel}: workflow must expose SANDBOX_NODE_VERSION as a step output"
            )
        if 'node-version: "${{ steps.node-version.outputs.version }}"' not in text:
            errors.append(f"{rel}: setup-node must use the loaded Node version output")
        if re.search(r'node-version:\s*["\']?[0-9]+', text):
            errors.append(
                f"{rel}: setup-node contains a hard-coded Node version instead "
                f"of {expected_version}"
            )

    return errors


def main() -> int:
    errors: list[str] = []

    try:
        node_versions = parse_env_file(NODE_VERSION_PATH)
    except Exception as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1

    node_version = node_versions.get("SANDBOX_NODE_VERSION")
    node_image = node_versions.get("SANDBOX_NODE_IMAGE")
    types_node_version = node_versions.get("SANDBOX_TYPES_NODE_VERSION")
    node_major = node_versions.get("SANDBOX_NODE_MAJOR")

    if not node_version:
        errors.append("common/node-version.env: missing SANDBOX_NODE_VERSION")
    if not node_image:
        errors.append("common/node-version.env: missing SANDBOX_NODE_IMAGE")
    if not types_node_version:
        errors.append("common/node-version.env: missing SANDBOX_TYPES_NODE_VERSION")
    if not node_major:
        errors.append("common/node-version.env: missing SANDBOX_NODE_MAJOR")

    if node_version and node_image and node_image != f"node:{node_version}":
        errors.append(
            f"common/node-version.env: SANDBOX_NODE_IMAGE is {node_image!r}, "
            f"expected 'node:{node_version}'"
        )
    if node_version and types_node_version and (
        types_node_version.split(".")[:2] != node_version.split(".")[:2]
    ):
        errors.append(
            "common/node-version.env: SANDBOX_TYPES_NODE_VERSION must stay on "
            "the same Node major/minor line as SANDBOX_NODE_VERSION"
        )
    if node_version and node_major and node_major != node_version.split(".", 1)[0]:
        errors.append(
            f"common/node-version.env: SANDBOX_NODE_MAJOR is {node_major!r}, "
            f"expected {node_version.split('.', 1)[0]!r}"
        )

    if types_node_version:
        errors.extend(assert_at_types_node_versions(types_node_version))
    if node_image:
        errors.extend(assert_node_image_references(node_image))
    if node_version:
        errors.extend(assert_workflows_load_node_version(node_version))

    if errors:
        for error in errors:
            print(f"❌ {error}", file=sys.stderr)
        return 1

    print("Node.js version pins are consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
