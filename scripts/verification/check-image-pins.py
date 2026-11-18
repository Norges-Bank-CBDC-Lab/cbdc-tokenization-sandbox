#!/usr/bin/env python3
"""Validate that third-party container images are pinned by tag and digest.

Convention (the same as SANDBOX_NODE_IMAGE in common/node-version.env): a pinned
image is written <repo>:<tag>@sha256:<64 hex digest>, where the digest is the
multi-arch index digest. This check enforces that, in one place per concern:

  * every image in common/images.yaml carries a digest, except the two
    source-built Blockscout refs, which name upstream release tags rather than
    pullable images;
  * every other file that repeats one of those references (Dockerfile ARG
    defaults, chart fallback values, shell defaults) carries exactly the same
    value, and the check names the file when it does not;
  * the Blockscout build script's base images carry a digest;
  * no Dockerfile in the repo names a literal base image without a digest.

It reads files only and never touches the network. `report-image-pin-updates.py`
is the network-side companion that looks for moved tags and newer releases.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
IMAGES_PATH = REPO_ROOT / "common/images.yaml"

PINNED_REF = re.compile(
    r"^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}$"
)

# Keys in common/images.yaml that name an upstream release tag for an image the
# sandbox builds from source, so there is no upstream image to pin by digest.
SOURCE_BUILT_KEYS = frozenset({"blockscout.backend", "blockscout.frontend"})

# Every other place that repeats a reference from common/images.yaml:
# (file, regex with one capture group for the value, images.yaml key).
DUPLICATE_SITES = (
    ("infra/besu/values.yaml", r"^image:\s*(\S+)\s*$", "besu"),
    ("services/blockscout/values.yaml", r"^dbImage:\s*(\S+)\s*$", "blockscout.db"),
    ("services/blockscout/values.yaml", r"^bensImage:\s*(\S+)\s*$", "blockscout.bens"),
    (
        "services/blockscout/bens-microservice/Dockerfile",
        r"^ARG BENS_BUILDER_IMAGE=(\S+)\s*$",
        "blockscout.bens",
    ),
    (
        "services/blockscout/bens-microservice/Dockerfile",
        r"^ARG BENS_RUNTIME_IMAGE=(\S+)\s*$",
        "blockscout.bens",
    ),
    (
        "services/nb-ui/Dockerfile",
        r"^ARG NB_UI_NGINX_IMAGE=(\S+)\s*$",
        "nb_ui.nginx",
    ),
    ("common/helpers.sh", r"^NB_UI_NGINX_BASEIMAGE=(\S+)\s*$", "nb_ui.nginx"),
    ("common/helpers.sh", r"^KIND_REGISTRY_IMAGE=(\S+)\s*$", "local_registry"),
)

# Files whose Docker base images are not in common/images.yaml.
KIND_CONFIG = "infra/cluster/cluster-config.yaml"
BLOCKSCOUT_BUILD_SCRIPT = "services/blockscout/build-images.sh"


def read_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def parse_images_yaml() -> dict[str, str]:
    """Read common/images.yaml into {"besu": ref, "blockscout.db": ref, ...}.

    The file has only top-level scalars and one nested level, so a line parser
    avoids a YAML dependency in CI.
    """
    images: dict[str, str] = {}
    parent = ""
    for raw_line in IMAGES_PATH.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        top = re.match(r"^([A-Za-z0-9_]+):\s*(\S.*?)?\s*$", raw_line)
        if top:
            if top.group(2):
                images[top.group(1)] = top.group(2)
                parent = ""
            else:
                parent = top.group(1)
            continue
        nested = re.match(r"^  ([A-Za-z0-9_]+):\s*(\S.*?)\s*$", raw_line)
        if nested and parent:
            images[f"{parent}.{nested.group(1)}"] = nested.group(2)
            continue
        raise ValueError(f"common/images.yaml: cannot parse line {raw_line!r}")
    return images


def check_images_yaml(images: dict[str, str]) -> list[str]:
    errors: list[str] = []
    if not images:
        return ["common/images.yaml: no images found"]
    for key, ref in images.items():
        if key in SOURCE_BUILT_KEYS:
            if "@" in ref:
                errors.append(
                    f"common/images.yaml: {key} names an upstream release tag "
                    f"built from source and must not carry a digest ({ref!r})"
                )
            continue
        if not PINNED_REF.fullmatch(ref):
            errors.append(
                f"common/images.yaml: {key} is {ref!r}, expected "
                "'<repo>:<tag>@sha256:<64 hex digest>' (the multi-arch index "
                "digest; see the Pinning notes at the top of the file)"
            )
    return errors


def check_duplicate_sites(images: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for relative_path, pattern, key in DUPLICATE_SITES:
        expected = images.get(key)
        if expected is None:
            errors.append(f"common/images.yaml: missing key {key}")
            continue
        matches = re.findall(pattern, read_text(relative_path), flags=re.MULTILINE)
        if len(matches) != 1:
            errors.append(
                f"{relative_path}: expected exactly one line matching {pattern!r}, "
                f"found {len(matches)}"
            )
            continue
        if matches[0] != expected:
            errors.append(
                f"{relative_path}: {matches[0]!r} differs from common/images.yaml "
                f"{key} {expected!r}; update it to the same value"
            )
    return errors


def check_kind_node_image() -> list[str]:
    text = read_text(KIND_CONFIG)
    refs = re.findall(r"^\s*image:\s*(\S+)\s*$", text, flags=re.MULTILINE)
    if not refs:
        return [f"{KIND_CONFIG}: no node image found"]
    return [
        f"{KIND_CONFIG}: node image {ref!r} needs a tag and sha256 digest"
        for ref in refs
        if not PINNED_REF.fullmatch(ref)
    ]


def check_blockscout_build_bases() -> list[str]:
    errors: list[str] = []
    text = read_text(BLOCKSCOUT_BUILD_SCRIPT)

    frontend = re.findall(r'^frontend_node_to="([^"]+)"$', text, flags=re.MULTILINE)
    if len(frontend) != 1:
        errors.append(f"{BLOCKSCOUT_BUILD_SCRIPT}: expected one frontend_node_to=")
    elif not PINNED_REF.fullmatch(frontend[0]):
        errors.append(
            f"{BLOCKSCOUT_BUILD_SCRIPT}: frontend_node_to is {frontend[0]!r}, "
            "expected '<repo>:<tag>@sha256:<64 hex digest>'"
        )

    tag = re.findall(r'^backend_base_tag="([^"]+)"$', text, flags=re.MULTILINE)
    pinned = re.findall(
        r'^backend_base_pinned="\$\{backend_base_tag\}(@sha256:[0-9a-f]{64})"$',
        text,
        flags=re.MULTILINE,
    )
    if len(tag) != 1 or len(pinned) != 1:
        errors.append(
            f"{BLOCKSCOUT_BUILD_SCRIPT}: expected one backend_base_tag= and one "
            'backend_base_pinned="${backend_base_tag}@sha256:<64 hex digest>"'
        )
    elif not PINNED_REF.fullmatch(tag[0] + pinned[0]):
        errors.append(
            f"{BLOCKSCOUT_BUILD_SCRIPT}: backend_base_tag {tag[0]!r} is not a "
            "'<repo>:<tag>' reference"
        )
    return errors


def tracked_dockerfiles() -> list[str]:
    output = subprocess.run(
        ["git", "ls-files", "*Dockerfile*"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [line for line in output.splitlines() if line]


def check_dockerfiles() -> list[str]:
    """No Dockerfile names a literal base image, or an image ARG default, without a digest."""
    errors: list[str] = []
    for relative_path in tracked_dockerfiles():
        stages: set[str] = set()
        for line_number, line in enumerate(read_text(relative_path).splitlines(), 1):
            from_line = re.match(
                r"^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$",
                line,
                flags=re.IGNORECASE,
            )
            if from_line:
                ref = from_line.group(1)
                literal = not ref.startswith("$") and ref not in stages
                if literal and ref != "scratch" and "@sha256:" not in ref:
                    errors.append(
                        f"{relative_path}:{line_number}: base image {ref!r} has no "
                        "sha256 digest"
                    )
                if from_line.group(2):
                    stages.add(from_line.group(2))
                continue
            arg_line = re.match(r"^ARG\s+\w*IMAGE\w*=(\S+)\s*$", line)
            if arg_line and not PINNED_REF.fullmatch(arg_line.group(1)):
                errors.append(
                    f"{relative_path}:{line_number}: image ARG default "
                    f"{arg_line.group(1)!r} needs a tag and sha256 digest"
                )
    return errors


def main() -> int:
    try:
        images = parse_images_yaml()
    except ValueError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1

    errors: list[str] = []
    errors.extend(check_images_yaml(images))
    errors.extend(check_duplicate_sites(images))
    errors.extend(check_kind_node_image())
    errors.extend(check_blockscout_build_bases())
    errors.extend(check_dockerfiles())

    if errors:
        for error in errors:
            print(f"❌ {error}", file=sys.stderr)
        return 1

    print("Image pins are consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
