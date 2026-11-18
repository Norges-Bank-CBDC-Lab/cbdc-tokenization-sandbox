#!/usr/bin/env python3
"""Report pinned container images that have gone stale. Never fails the build.

Dependabot cannot read common/images.yaml, common/node-version.env or the
Blockscout build script, so a pin can age without anyone noticing. For every
image pinned by tag and digest this lists:

  * MOVED - the tag now resolves to a different digest than the pin (the
    publisher re-pushed it, usually with a base-image or security rebuild);
  * newer tags in the same line (same major version, same suffix, same number
    of version parts) that sort above the pinned tag;
  * ERROR - the registry could not be queried (reported, never fatal).

It needs the network (anonymous reads from Docker Hub, GitHub Container
Registry) and the Python standard library only. Run it by hand, or let the
scheduled workflow run it and read the job summary. Exit status is always 0
unless the repository files cannot be read.

Usage: python3 scripts/verification/report-image-pin-updates.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20
MANIFEST_ACCEPT = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)
PINNED_REF = re.compile(
    r"^(?P<repo>[a-z0-9][a-z0-9._/-]*):(?P<tag>[A-Za-z0-9][A-Za-z0-9._-]*)"
    r"@sha256:(?P<digest>[0-9a-f]{64})$"
)
# Tags whose suffix is a compound of other versions (an Erlang release, an
# Alpine release): only the digest check is meaningful for them.
DIGEST_ONLY_REPOS = frozenset({"hexpm/elixir"})


def load_pin_checker():
    path = Path(__file__).with_name("check-image-pins.py")
    spec = importlib.util.spec_from_file_location("check_image_pins", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collect_pins() -> list[tuple[str, str]]:
    """Every pinned reference in the repository as (where, ref)."""
    checker = load_pin_checker()
    pins: list[tuple[str, str]] = []

    for key, ref in checker.parse_images_yaml().items():
        if key not in checker.SOURCE_BUILT_KEYS:
            pins.append((f"common/images.yaml {key}", ref))

    node_env = (REPO_ROOT / "common/node-version.env").read_text(encoding="utf-8")
    node = re.search(r"^SANDBOX_NODE_IMAGE=(\S+)$", node_env, flags=re.MULTILINE)
    if node:
        pins.append(("common/node-version.env SANDBOX_NODE_IMAGE", node.group(1)))

    kind = (REPO_ROOT / checker.KIND_CONFIG).read_text(encoding="utf-8")
    for ref in re.findall(r"^\s*image:\s*(\S+)\s*$", kind, flags=re.MULTILINE):
        pins.append((f"{checker.KIND_CONFIG} node image", ref))

    build = (REPO_ROOT / checker.BLOCKSCOUT_BUILD_SCRIPT).read_text(encoding="utf-8")
    tag = re.search(r'^backend_base_tag="([^"]+)"$', build, flags=re.MULTILINE)
    digest = re.search(
        r'^backend_base_pinned="\$\{backend_base_tag\}(@sha256:[0-9a-f]{64})"$',
        build,
        flags=re.MULTILINE,
    )
    if tag and digest:
        pins.append(("Blockscout backend build base", tag.group(1) + digest.group(1)))
    frontend = re.search(r'^frontend_node_to="([^"]+)"$', build, flags=re.MULTILINE)
    if frontend:
        pins.append(("Blockscout frontend build base", frontend.group(1)))
    return pins


def registry_for(repo: str) -> tuple[str, str, str]:
    """(registry host, repository name, token URL) for an image repository."""
    parts = repo.split("/")
    if parts[0] == "ghcr.io":
        name = "/".join(parts[1:])
        return "ghcr.io", name, f"https://ghcr.io/token?scope=repository:{name}:pull"
    name = repo if "/" in repo else f"library/{repo}"
    return (
        "registry-1.docker.io",
        name,
        "https://auth.docker.io/token?service=registry.docker.io"
        f"&scope=repository:{name}:pull",
    )


def http(url: str, headers: dict[str, str] | None = None, method: str = "GET"):
    request = urllib.request.Request(url, headers=headers or {}, method=method)
    return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)  # noqa: S310


def bearer(token_url: str) -> str:
    with http(token_url) as response:
        return json.load(response)["token"]


def current_digest(repo: str, tag: str) -> str:
    host, name, token_url = registry_for(repo)
    token = bearer(token_url)
    with http(
        f"https://{host}/v2/{name}/manifests/{tag}",
        {"Authorization": f"Bearer {token}", "Accept": MANIFEST_ACCEPT},
        method="HEAD",
    ) as response:
        return response.headers["Docker-Content-Digest"]


def version_key(tag: str) -> tuple[tuple[int, ...], str] | None:
    """('v1.30.6-alpine' -> ((1, 30, 6), '-alpine')); None when not a release tag."""
    match = re.fullmatch(r"v?(\d+(?:\.\d+)*)(.*)", tag)
    if not match:
        return None
    return tuple(int(part) for part in match.group(1).split(".")), match.group(2)


def list_tags(repo: str) -> list[str]:
    host, name, token_url = registry_for(repo)
    if host == "ghcr.io":
        token = bearer(token_url)
        with http(
            f"https://{host}/v2/{name}/tags/list?n=1000",
            {"Authorization": f"Bearer {token}"},
        ) as response:
            return json.load(response).get("tags", [])
    # Docker Hub: the hub API lists the most recently pushed tags first, which
    # is where newer releases are; the registry tag list is alphabetical and
    # thousands of entries long for the official images.
    namespace, _, short = name.partition("/")
    tags: list[str] = []
    url = (
        f"https://hub.docker.com/v2/repositories/{namespace}/{short}/tags"
        "?page_size=100&ordering=last_updated"
    )
    for _ in range(5):
        with http(url) as response:
            page = json.load(response)
        tags.extend(item["name"] for item in page.get("results", []))
        url = page.get("next")
        if not url:
            break
    return tags


def newer_tags(repo: str, tag: str) -> list[str]:
    current = version_key(tag)
    if current is None:
        return []
    numbers, suffix = current
    newer = []
    for candidate in list_tags(repo):
        key = version_key(candidate)
        if (
            key
            and key[1] == suffix
            and len(key[0]) == len(numbers)
            and key[0][0] == numbers[0]
            and key[0] > numbers
        ):
            newer.append(candidate)
    newer.sort(key=lambda value: version_key(value)[0], reverse=True)
    return newer[:5]


def inspect(where: str, ref: str) -> dict[str, str]:
    match = PINNED_REF.fullmatch(ref)
    if not match:
        return {"where": where, "ref": ref, "status": "ERROR", "detail": "not tag@digest"}
    repo, tag, pinned = match["repo"], match["tag"], f"sha256:{match['digest']}"
    row = {"where": where, "ref": f"{repo}:{tag}", "status": "ok", "detail": ""}
    try:
        live = current_digest(repo, tag)
        if live != pinned:
            row["status"] = "MOVED"
            row["detail"] = f"tag now resolves to {live} (pinned {pinned})"
        if repo not in DIGEST_ONLY_REPOS:
            newer = newer_tags(repo, tag)
            if newer:
                if row["status"] == "ok":
                    row["status"] = "NEWER"
                row["detail"] = (row["detail"] + "; " if row["detail"] else "") + (
                    "newer tags: " + ", ".join(newer)
                )
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as exc:
        row["status"] = "ERROR"
        row["detail"] = f"could not query the registry: {exc}"
    return row


def main() -> int:
    try:
        pins = collect_pins()
    except (OSError, ValueError) as exc:
        print(f"❌ cannot read the pins: {exc}", file=sys.stderr)
        return 1

    rows = [inspect(where, ref) for where, ref in pins]

    width = max(len(row["ref"]) for row in rows)
    for row in rows:
        print(f"{row['status']:<6} {row['ref']:<{width}}  {row['where']}")
        if row["detail"]:
            print(f"       {row['detail']}")
        if row["status"] == "MOVED" and os.environ.get("GITHUB_ACTIONS"):
            print(f"::warning title=Pinned tag moved::{row['ref']}: {row['detail']}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("| Status | Image | Pinned in | Detail |\n|---|---|---|---|\n")
            for row in rows:
                handle.write(
                    f"| {row['status']} | `{row['ref']}` | {row['where']} | {row['detail']} |\n"
                )

    stale = sum(row["status"] in ("MOVED", "NEWER") for row in rows)
    print(f"\n{len(rows)} pinned images checked, {stale} with news (report only, no changes made).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
