# Verification Scripts

This folder contains repository-level verification helpers used during local
review and in CI.

These scripts are maintenance utilities for the repository itself. They are not
runtime sandbox tooling and are not intended to be consumed by external
integrators.

## Scripts In This Folder

- `check-third-party-licenses.py`: validates the curated direct-dependency
  inventory in `THIRD_PARTY_LICENSES.md` against the current manifests
- `check-public-repo-hygiene.py`: validates the guardrails around local-only
  example files and required `.gitignore` entries
- `check-markdown-links.py`: validates local links inside tracked Markdown
  files

## Typical Usage

Run these from the repository root:

```console
python3 scripts/verification/check-third-party-licenses.py
python3 scripts/verification/check-public-repo-hygiene.py
python3 scripts/verification/check-markdown-links.py
```
