#!/usr/bin/env python3
"""Validate local markdown links in tracked documentation files."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LINK_PATTERN = re.compile(r"!?\[[^\]]+\]\(([^)]+)\)")
IGNORED_PREFIXES = ("http://", "https://", "mailto:", "tel:", "#")


def tracked_markdown_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "*.md"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    files = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        files.append(REPO_ROOT / line)
    return files


def strip_fragment(target: str) -> str:
    return target.split("#", 1)[0]


def check_file(path: Path) -> list[str]:
    errors: list[str] = []
    in_fenced_block = False

    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fenced_block = not in_fenced_block
            continue
        if in_fenced_block:
            continue

        for match in LINK_PATTERN.finditer(line):
            target = match.group(1).strip()
            if not target or target.startswith(IGNORED_PREFIXES):
                continue

            local_target = strip_fragment(target)
            if not local_target:
                continue

            resolved = (path.parent / local_target).resolve()
            if not resolved.exists():
                errors.append(
                    f"{path.relative_to(REPO_ROOT)}:{line_number} -> missing local link target {target}"
                )

    return errors


def main() -> int:
    errors: list[str] = []
    for path in tracked_markdown_files():
        errors.extend(check_file(path))

    if errors:
        print("Markdown link check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Tracked markdown links look correct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
