#!/usr/bin/env python3
"""Validate the curated third-party license inventory against repo manifests.

The inventory lists which direct dependencies exist and under which license;
versions live only in the manifests and the lockfile. The check enforces:

- every direct dependency has exactly one inventory row, and npm rows carry the
  license recorded in the lockfile;
- direct npm dependencies are exact versions (no range operators);
- every license in the lockfile and in the inventory is on the permissive
  allowlist, or the package is listed under "Approved License Exceptions".
"""

from __future__ import annotations

import fnmatch
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = REPO_ROOT / "THIRD_PARTY_LICENSES.md"

# SPDX identifiers that need no review. Anything else must be recorded in the
# inventory's "Approved License Exceptions" table, which requires the operator's
# explicit double confirmation (root AGENTS.md, "Licensing guardrails").
ALLOWED_LICENSES = frozenset(
    {
        "0BSD",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "BlueOak-1.0.0",
        "CC0-1.0",
        "ISC",
        "MIT",
        "MIT-0",
        "PSF-2.0",
        "Unlicense",
        "Zlib",
    }
)

EXACT_VERSION = re.compile(
    r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
MISSING_LICENSE = "<missing>"


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


def build_expected_node_section(
    package_json_path: Path,
    lockfile_path: Path,
    workspace_relpath: str | None = None,
) -> dict[str, dict[str, str]]:
    """Resolve a workspace's direct deps against a (root) lockfile.

    With npm workspaces, the lockfile lives at the repo root and entries are
    keyed by their position in the dep tree: hoisted shared deps land at
    `node_modules/<name>`, but a workspace-pinned override lives at
    `<workspace-path>/node_modules/<name>`. Pass `workspace_relpath` to
    consult the workspace-scoped key first and fall back to the hoisted one.
    """
    package_json = json.loads(read_text(package_json_path))
    lockfile = json.loads(read_text(lockfile_path))
    lock_packages = lockfile.get("packages", {})

    def resolve_lock_entry(name: str) -> dict | None:
        if workspace_relpath:
            scoped = lock_packages.get(f"{workspace_relpath}/node_modules/{name}")
            if scoped is not None:
                return scoped
        return lock_packages.get(f"node_modules/{name}")

    expected: dict[str, dict[str, str]] = {}
    for field_name in ("dependencies", "devDependencies"):
        for package_name in package_json.get(field_name, {}):
            lock_entry = resolve_lock_entry(package_name)
            if lock_entry is None:
                raise ValueError(
                    f"Direct dependency {package_name} is missing from {lockfile_path}"
                )

            license_name = lock_entry.get("license")
            if not license_name:
                raise ValueError(
                    f"Missing license metadata for {package_name} in {lockfile_path}"
                )

            expected[package_name] = {"License": license_name}

    return expected


def check_exact_pins(section_name: str, package_json_path: Path) -> list[str]:
    """Direct dependencies are exact versions; `npm ci` keeps the lockfile in step."""
    package_json = json.loads(read_text(package_json_path))
    errors: list[str] = []
    for field_name in ("dependencies", "devDependencies"):
        for package_name, spec in package_json.get(field_name, {}).items():
            if not EXACT_VERSION.match(spec):
                errors.append(
                    f"{section_name}: {package_name} is declared as '{spec}'; "
                    "direct dependencies must be exact versions"
                )
    return errors


def license_allowed(expression: str) -> bool:
    """Evaluate a simple SPDX expression; anything not understood fails closed."""
    expression = expression.strip()
    if expression.startswith("(") and expression.endswith(")"):
        inner = expression[1:-1]
        if "(" not in inner and ")" not in inner:
            expression = inner.strip()
    if "(" in expression or ")" in expression:
        return False
    return any(
        all(term.strip() in ALLOWED_LICENSES for term in alternative.split(" AND "))
        for alternative in expression.split(" OR ")
    )


def find_exception(
    exceptions: list[dict[str, str]], package_name: str, license_name: str
) -> dict[str, str] | None:
    return next(
        (
            row
            for row in exceptions
            if row["License"] == license_name
            and fnmatch.fnmatchcase(package_name, row["Package"])
        ),
        None,
    )


def lockfile_package_name(key: str, entry: dict) -> str:
    if "node_modules/" in key:
        return key.rsplit("node_modules/", 1)[1]
    return entry.get("name", key)


def check_lockfile_licenses(
    lockfile_path: Path,
    exceptions: list[dict[str, str]],
    used_exceptions: set[str],
) -> list[str]:
    """Every lockfile entry is on the allowlist or covered by an approved exception."""
    lock_packages = json.loads(read_text(lockfile_path)).get("packages", {})
    errors: list[str] = []
    reported: set[tuple[str, str]] = set()

    for key, entry in lock_packages.items():
        if not key or entry.get("link"):
            continue
        name = lockfile_package_name(key, entry)
        license_name = entry.get("license") or MISSING_LICENSE
        if license_name != MISSING_LICENSE and license_allowed(license_name):
            continue

        exception = find_exception(exceptions, name, license_name)
        if exception is None:
            if (name, license_name) not in reported:
                reported.add((name, license_name))
                errors.append(
                    f"package-lock.json: {name} is licensed {license_name}, which is not on "
                    "the permissive allowlist; needs an operator-approved row under "
                    "'Approved License Exceptions' in THIRD_PARTY_LICENSES.md"
                )
            continue

        used_exceptions.add(exception["Package"])
        is_dev = bool(entry.get("dev") or entry.get("devOptional"))
        if exception["Scope"] == "dev" and not is_dev:
            errors.append(
                f"package-lock.json: {name} ({license_name}) is approved for dev use only "
                "but is now a runtime dependency"
            )

    return errors


def check_inventory_licenses(
    section_name: str,
    rows: dict[str, dict[str, str]],
    exceptions: list[dict[str, str]],
    used_exceptions: set[str],
) -> list[str]:
    """Hand-maintained rows (Python, Solidity) get the same allowlist treatment."""
    errors: list[str] = []
    for package_name, row in sorted(rows.items()):
        license_name = row.get("License", "").strip()
        if license_name and license_allowed(license_name):
            continue
        exception = find_exception(exceptions, package_name, license_name)
        if exception is None or exception["Scope"] != "any":
            errors.append(
                f"{section_name}: {package_name} is licensed {license_name or '<blank>'}, "
                "which is not on the permissive allowlist; needs an operator-approved "
                "row with scope 'any' under 'Approved License Exceptions'"
            )
        else:
            used_exceptions.add(exception["Package"])
    return errors


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
    exceptions = parse_markdown_table_after_heading(
        inventory_lines, "## Approved License Exceptions"
    )
    used_exceptions: set[str] = set()

    # All four npm packages are workspaces of the repo-root package.json,
    # so deps resolve against the single root lockfile. Each tuple is
    # (display section name, workspace package.json, workspace relpath).
    root_lockfile = REPO_ROOT / "package-lock.json"
    node_sections = [
        (
            "services/nb-bond-api",
            REPO_ROOT / "services/nb-bond-api/package.json",
            "services/nb-bond-api",
        ),
        (
            "scripts/bid-encryption",
            REPO_ROOT / "scripts/bid-encryption/package.json",
            "scripts/bid-encryption",
        ),
        (
            "scripts/bid-submitter",
            REPO_ROOT / "scripts/bid-submitter/package.json",
            "scripts/bid-submitter",
        ),
        (
            "services/nb-ui",
            REPO_ROOT / "services/nb-ui/package.json",
            "services/nb-ui",
        ),
    ]

    for section_name, package_json_path, workspace_relpath in node_sections:
        actual_rows = parse_node_inventory_section(
            inventory_lines,
            f"### `{section_name}`",
            parent_heading="## Direct Node.js Dependencies",
        )
        expected_rows = build_expected_node_section(
            package_json_path, root_lockfile, workspace_relpath=workspace_relpath
        )
        errors.extend(
            assert_rows_match(
                section_name,
                actual_rows,
                expected_rows,
                ("License",),
            )
        )
        errors.extend(check_exact_pins(section_name, package_json_path))

    errors.extend(
        check_lockfile_licenses(root_lockfile, exceptions, used_exceptions)
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
    ]

    for section_name, expected_versions in python_sections:
        actual_rows = parse_simple_inventory_section(
            inventory_lines,
            f"### `{section_name}`",
            parent_heading="## Direct Python Dependencies",
        )
        expected_rows = {package_name: {} for package_name in expected_versions}
        errors.extend(assert_rows_match(section_name, actual_rows, expected_rows, ()))
        errors.extend(assert_non_empty_licenses(section_name, actual_rows))
        errors.extend(
            check_inventory_licenses(
                section_name, actual_rows, exceptions, used_exceptions
            )
        )

    solidity_rows = parse_simple_inventory_section(
        inventory_lines, "## Direct Solidity Dependencies"
    )
    expected_solidity_rows = {
        package_name: {}
        for package_name in parse_foundry_dependencies(
            REPO_ROOT / "contracts/foundry.toml"
        )
    }
    errors.extend(
        assert_rows_match(
            "contracts/foundry.toml", solidity_rows, expected_solidity_rows, ()
        )
    )
    errors.extend(assert_non_empty_licenses("contracts/foundry.toml", solidity_rows))
    errors.extend(
        check_inventory_licenses(
            "contracts/foundry.toml", solidity_rows, exceptions, used_exceptions
        )
    )

    for row in exceptions:
        if row["Package"] not in used_exceptions:
            errors.append(
                f"Approved License Exceptions: {row['Package']} ({row['License']}) "
                "matches nothing in the lockfile or inventory; remove the stale row"
            )
        if row["Scope"] not in ("dev", "any"):
            errors.append(
                f"Approved License Exceptions: {row['Package']} has scope "
                f"'{row['Scope']}'; use 'dev' or 'any'"
            )

    if errors:
        print("Third-party license inventory check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Third-party license inventory matches current manifests.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
