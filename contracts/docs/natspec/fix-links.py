#!/usr/bin/env python3
"""Rewrite generated NatSpec links for repository-friendly browsing."""

from __future__ import annotations

import os
import re
from pathlib import Path

DOC_ROOT = Path(__file__).resolve().parent
GENERATED_ROOT = DOC_ROOT / "src"
LINK_PATTERN = re.compile(r"(!?\[([^\]]+)\]\()([^)]+)(\))")


def rewrite_target(source_file: Path, target: str, label: str) -> str:
    if target.startswith("/src/"):
        target_path, _, fragment = target.partition("#")
        destination = GENERATED_ROOT / target_path.lstrip("/")
        relative = Path(os.path.relpath(destination, source_file.parent)).as_posix()
        if fragment:
            relative = f"{relative}#{fragment}"
        return relative

    if target.startswith("/dependencies/"):
        return label

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
