#!/usr/bin/env python3
"""Validate the curated third-party license inventory against repo manifests."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = REPO_ROOT / "THIRD_PARTY_LICENSES.md"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_lines(path: Path) -> list[str]:
    return read_text(path).splitlines()


def normalize_markdown_value(value: str) -> str:
    return value.strip().strip("`")


def parse_markdown_row(line: str) -> list[str]:
    stripped = line.strip()
    if not (stripped.startswith("|") and stripped.endswith("|")):
        raise ValueError(f"Invalid markdown table row: {line}")
    return [normalize_markdown_value(cell) for cell in stripped.strip("|").split("|")]


def heading_level(line: str) -> int:
    stripped = line.lstrip()
    if not stripped.startswith("#"):
        return 0
    return len(stripped) - len(stripped.lstrip("#"))


def slice_section(
    lines: list[str], parent_heading: str | None
) -> tuple[list[str], int]:
    if parent_heading is None:
        return lines, 0

    parent_index = next(
        (index for index, line in enumerate(lines) if line.strip() == parent_heading),
        None,
    )
    if parent_index is None:
        raise ValueError(f"Missing heading: {parent_heading}")

    parent_level = heading_level(lines[parent_index])
    section_end = len(lines)
    for index in range(parent_index + 1, len(lines)):
        line = lines[index].lstrip()
        if line.startswith("#") and heading_level(lines[index]) <= parent_level:
            section_end = index
            break

    return lines[parent_index + 1 : section_end], parent_index + 1


def parse_markdown_table_after_heading(
    lines: list[str], heading: str, parent_heading: str | None = None
) -> list[dict[str, str]]:
    search_lines, line_offset = slice_section(lines, parent_heading)
    heading_index = next(
        (index for index, line in enumerate(search_lines) if line.strip() == heading),
        None,
    )
    if heading_index is None:
        raise ValueError(f"Missing heading: {heading}")

    table_start = heading_index + 1
    while table_start < len(search_lines) and not search_lines[table_start].lstrip().startswith("|"):
        if search_lines[table_start].lstrip().startswith("#"):
            raise ValueError(f"Heading {heading} does not have a markdown table")
        table_start += 1

    if table_start + 1 >= len(search_lines):
        raise ValueError(f"Incomplete markdown table after heading: {heading}")

    headers = parse_markdown_row(search_lines[table_start])
    separator = search_lines[table_start + 1].strip()
    if not separator.startswith("|"):
        raise ValueError(f"Missing markdown table separator after heading: {heading}")

    rows: list[dict[str, str]] = []
    row_index = table_start + 2
    while row_index < len(search_lines) and search_lines[row_index].lstrip().startswith("|"):
        cells = parse_markdown_row(search_lines[row_index])
        if len(cells) != len(headers):
            raise ValueError(
                f"Row length mismatch in table for {heading} at line {line_offset + row_index + 1}: "
                f"expected {len(headers)}, got {len(cells)}"
            )
        rows.append(dict(zip(headers, cells)))
        row_index += 1

    return rows


def parse_requirements(path: Path) -> dict[str, str]:
    packages: dict[str, str] = {}
    for raw_line in read_lines(path):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if "==" not in line:
            raise ValueError(f"Unsupported requirement format in {path}: {raw_line}")
        package, version = line.split("==", 1)
        packages[package.strip()] = version.strip()
    return packages


def parse_optional_requirements(path: Path) -> dict[str, str] | None:
    if not path.exists():
        return None
    return parse_requirements(path)


def parse_foundry_dependencies(path: Path) -> dict[str, str]:
    dependencies: dict[str, str] = {}
    in_dependencies_block = False

    for raw_line in read_lines(path):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            in_dependencies_block = line == "[dependencies]"
            continue
        if not in_dependencies_block:
            continue
        if "=" not in line:
            raise ValueError(f"Unsupported dependency format in {path}: {raw_line}")
        package, version = line.split("=", 1)
        dependencies[package.strip().strip('"').strip("'")] = version.strip().strip('"').strip("'")

    if not dependencies:
        raise ValueError(f"No dependencies found in {path}")

    return dependencies


def parse_node_inventory_section(
    lines: list[str], heading: str, parent_heading: str
) -> dict[str, dict[str, str]]:
    rows = parse_markdown_table_after_heading(lines, heading, parent_heading=parent_heading)
    return {row["Package"]: row for row in rows}


def parse_simple_inventory_section(
    lines: list[str], heading: str, parent_heading: str | None = None
) -> dict[str, dict[str, str]]:
    rows = parse_markdown_table_after_heading(
        lines, heading, parent_heading=parent_heading
    )
    return {row["Package"]: row for row in rows}


def build_expected_node_section(package_json_path: Path, lockfile_path: Path) -> dict[str, dict[str, str]]:
    package_json = json.loads(read_text(package_json_path))
    lockfile = json.loads(read_text(lockfile_path))
    lock_packages = lockfile.get("packages", {})

    expected: dict[str, dict[str, str]] = {}
    for field_name in ("dependencies", "devDependencies"):
        for package_name, version in package_json.get(field_name, {}).items():
            lock_entry = lock_packages.get(f"node_modules/{package_name}")
            if lock_entry is None:
                raise ValueError(
                    f"Direct dependency {package_name} is missing from {lockfile_path}"
                )

            lock_version = lock_entry.get("version")
            if lock_version != version:
                raise ValueError(
                    f"Lockfile version mismatch for {package_name}: "
                    f"package.json has {version}, lockfile has {lock_version}"
                )

            license_name = lock_entry.get("license")
            if not license_name:
                raise ValueError(
                    f"Missing license metadata for {package_name} in {lockfile_path}"
                )

            expected[package_name] = {
                "Version": version,
                "License": license_name,
            }

    return expected


def assert_rows_match(
    section_name: str,
    actual_rows: dict[str, dict[str, str]],
    expected_rows: dict[str, dict[str, str]],
    fields: tuple[str, ...],
) -> list[str]:
    errors: list[str] = []

    actual_packages = set(actual_rows)
    expected_packages = set(expected_rows)

    missing = sorted(expected_packages - actual_packages)
    extra = sorted(actual_packages - expected_packages)

    for package_name in missing:
        errors.append(f"{section_name}: missing row for {package_name}")
    for package_name in extra:
        errors.append(f"{section_name}: unexpected row for {package_name}")

    for package_name in sorted(actual_packages & expected_packages):
        for field_name in fields:
            actual_value = actual_rows[package_name].get(field_name, "").strip()
            expected_value = expected_rows[package_name][field_name]
            if actual_value != expected_value:
                errors.append(
                    f"{section_name}: {package_name} {field_name.lower()} "
                    f"expected {expected_value}, found {actual_value or '<blank>'}"
                )

    return errors


def assert_non_empty_licenses(
    section_name: str, rows: dict[str, dict[str, str]]
) -> list[str]:
    errors: list[str] = []
    for package_name, row in sorted(rows.items()):
        if not row.get("License", "").strip():
            errors.append(f"{section_name}: blank license field for {package_name}")
    return errors


def validate_bens_node_metadata() -> list[str]:
    package_json_path = REPO_ROOT / "services/blockscout/bens-microservice/package.json"
    package_json = json.loads(read_text(package_json_path))
    errors: list[str] = []

    if package_json.get("dependencies"):
        errors.append(
            "services/blockscout/bens-microservice: package.json now declares dependencies; "
            "update THIRD_PARTY_LICENSES.md npm note"
        )
    if package_json.get("devDependencies"):
        errors.append(
            "services/blockscout/bens-microservice: package.json now declares devDependencies; "
            "update THIRD_PARTY_LICENSES.md npm note"
        )

    return errors


def main() -> int:
    inventory_lines = read_lines(INVENTORY_PATH)
    errors: list[str] = []

    node_sections = [
        (
            "services/nb-bond-api",
            REPO_ROOT / "services/nb-bond-api/package.json",
            REPO_ROOT / "services/nb-bond-api/package-lock.json",
        ),
        (
            "scripts/bid-encryption",
            REPO_ROOT / "scripts/bid-encryption/package.json",
            REPO_ROOT / "scripts/bid-encryption/package-lock.json",
        ),
        (
            "scripts/bid-submitter",
            REPO_ROOT / "scripts/bid-submitter/package.json",
            REPO_ROOT / "scripts/bid-submitter/package-lock.json",
        ),
    ]

    for section_name, package_json_path, lockfile_path in node_sections:
        actual_rows = parse_node_inventory_section(
            inventory_lines,
            f"### `{section_name}`",
            parent_heading="## Direct Node.js Dependencies",
        )
        expected_rows = build_expected_node_section(package_json_path, lockfile_path)
        errors.extend(
            assert_rows_match(
                section_name,
                actual_rows,
                expected_rows,
                ("Version", "License"),
            )
        )

    errors.extend(validate_bens_node_metadata())

    bens_requirements = parse_requirements(
        REPO_ROOT / "services/blockscout/bens-microservice/requirements.txt"
    )
    bens_src_requirements = parse_optional_requirements(
        REPO_ROOT / "services/blockscout/bens-microservice/src/requirements.txt"
    )
    if bens_src_requirements is not None and bens_requirements != bens_src_requirements:
        errors.append(
            "services/blockscout/bens-microservice: requirements.txt and src/requirements.txt differ"
        )

    python_sections = [
        (
            "services/blockscout/bens-microservice",
            bens_requirements,
        ),
        (
            "services/script-runner/notebook",
            parse_requirements(REPO_ROOT / "services/script-runner/notebook/requirements.txt"),
        ),
    ]

    for section_name, expected_versions in python_sections:
        actual_rows = parse_simple_inventory_section(
            inventory_lines,
            f"### `{section_name}`",
            parent_heading="## Direct Python Dependencies",
        )
        expected_rows = {
            package_name: {"Version": version}
            for package_name, version in expected_versions.items()
        }
        errors.extend(
            assert_rows_match(
                section_name,
                actual_rows,
                expected_rows,
                ("Version",),
            )
        )
        errors.extend(assert_non_empty_licenses(section_name, actual_rows))

    solidity_rows = parse_simple_inventory_section(
        inventory_lines, "## Direct Solidity Dependencies"
    )
    expected_solidity_rows = {
        package_name: {"Version": version}
        for package_name, version in parse_foundry_dependencies(
            REPO_ROOT / "contracts/foundry.toml"
        ).items()
    }
    errors.extend(
        assert_rows_match(
            "contracts/foundry.toml",
            solidity_rows,
            expected_solidity_rows,
            ("Version",),
        )
    )
    errors.extend(assert_non_empty_licenses("contracts/foundry.toml", solidity_rows))

    if errors:
        print("Third-party license inventory check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Third-party license inventory matches current manifests.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
