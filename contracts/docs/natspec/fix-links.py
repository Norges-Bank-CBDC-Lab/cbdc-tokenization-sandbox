#!/usr/bin/env python3
"""Rewrite generated NatSpec links for repository-friendly browsing."""

from __future__ import annotations

import os
import re
from pathlib import Path

DOC_ROOT = Path(__file__).resolve().parent
GENERATED_ROOT = DOC_ROOT / "src"
CONTRACTS_ROOT = DOC_ROOT.parent.parent
HOMEPAGE = GENERATED_ROOT / "README.md"
LINK_PATTERN = re.compile(r"(!?\[([^\]]+)\]\()([^)]+)(\))")
# forge doc runs with contracts/ as the project root, so its Git Source links
# omit the contracts/ prefix and pin the commit the pages were generated at.
GIT_SOURCE_PATTERN = re.compile(r"^https://github\.com/[^/]+/[^/]+/blob/[^/]+/src/(.+)$")


def relative_to(source_file: Path, destination: Path) -> str:
    return Path(os.path.relpath(destination, source_file.parent)).as_posix()


def rewrite_homepage_target(target: str) -> str:
    # The homepage is a copy of contracts/README.md, whose relative links are
    # written against contracts/. Rewrite only links that do not resolve from
    # the homepage but do resolve from contracts/, so a second run is a no-op.
    if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith(("#", "/")):
        return target
    target_path, _, fragment = target.partition("#")
    if not target_path or (HOMEPAGE.parent / target_path).exists():
        return target
    destination = CONTRACTS_ROOT / target_path
    if not destination.exists():
        return target
    relative = relative_to(HOMEPAGE, destination)
    return f"{relative}#{fragment}" if fragment else relative


def rewrite_target(source_file: Path, target: str, label: str) -> str:
    if target.startswith("/src/"):
        target_path, _, fragment = target.partition("#")
        destination = GENERATED_ROOT / target_path.lstrip("/")
        relative = relative_to(source_file, destination)
        if fragment:
            relative = f"{relative}#{fragment}"
        return relative

    if target.startswith("/dependencies/"):
        return label

    git_source = GIT_SOURCE_PATTERN.match(target)
    if label == "Git Source" and git_source:
        return relative_to(source_file, CONTRACTS_ROOT / "src" / git_source.group(1))

    if source_file == HOMEPAGE:
        return rewrite_homepage_target(target)

    return target


def rewrite_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")

    def replacer(match: re.Match[str]) -> str:
        prefix, label, target, suffix = match.groups()
        new_target = rewrite_target(path, target, label)
        if new_target == label and target.startswith("/dependencies/"):
            return label
        return f"{prefix}{new_target}{suffix}"

    updated = LINK_PATTERN.sub(replacer, original)
    if updated == original:
        return False

    path.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    changed_files = 0
    for path in sorted(GENERATED_ROOT.rglob("*.md")):
        if rewrite_file(path):
            changed_files += 1

    print(f"Normalized NatSpec links in {changed_files} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
