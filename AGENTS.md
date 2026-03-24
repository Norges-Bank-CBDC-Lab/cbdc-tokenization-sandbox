## Project Agent Guide (Root)

This file defines global guidance for all subfolders. Any `AGENTS.md` below this
inherits these rules and only adds what is specific to that folder.

### Operating principles (global)
- Prefer readability over micro-optimizations.
- Make small, file-by-file changes; ask before sweeping edits.
- Keep context minimal; edit only what is needed for the request.
- When in doubt, ask for clarification instead of guessing.
- Treat changes as a teaching moment: explain why a change is needed, its effects, and any trade-offs.
- Follow well known coding patterns and suggest them when relevant; avoid hot fixes or dirty workarounds unless there's no viable alternative, and call out when using them.
  Common patterns to prefer: DRY, SOLID, KISS, YAGNI, SRP, separation of concerns, dependency injection, and composition over inheritance.
- Before creating any post-mortem report, ask the user if the incident is "big enough" to warrant one.

### Change hygiene (global)
- Avoid large refactors unless explicitly requested.
- Preserve existing naming unless improving clarity.
- If a lint warning is a micro-optimization and harms readability, prefer suppressing it.
 
### Documentation expectations (global)
- Store post-mortem reports in `docs/post-mortems/` and add a link from the root README when created.
- Keep a `docs/KNOWN_ISSUES.md` file for tracking known issues and follow-ups (create/update only when requested).
- When making changes, check whether documentation needs an update and make it if required (see `docs/DOCUMENTATION_INDEX.md` for the key docs).
- If you change dependency manifests, copied third-party material, or runtime image pins, update `docs/THIRD_PARTY_NOTES.md` and `THIRD_PARTY_LICENSES.md` as needed and run `python3 scripts/verification/check-third-party-licenses.py`.
- If you change public-facing docs or repo metadata, run `python3 scripts/verification/check-public-repo-hygiene.py` and `python3 scripts/verification/check-markdown-links.py`.

### Flag documentation (global)
- For script environment flags (e.g., `USE_KIND_REGISTRY`, `DEPLOY_*`), keep a banner comment block directly above the exports.
- If the banner is missing, create it; if it exists, add/update the flag entry.
- Each banner line must describe what the flag does when set to `true` and when set to `false`.

### Command permissions (global)
- You may run read-only commands (inspect files, query logs, view cluster state) without asking.
- Ask before running commands that make changes, including edits, writes, installs, or deployments.

### Dependency changes (global)
- Do not introduce any new package or dependency unless the user explicitly approves that specific dependency first.
- Prefer completing the work with the existing toolchain, libraries, and repository setup.

### Licensing guardrails (global)
- If you notice a package or program with a license more restrictive than Apache-2.0, notify immediately.
- Ask for double confirmation before installing any software or packages with a license more restrictive than Apache-2.0.
- Prefer published, pinned third-party images in the default sandbox workflow. Keep any local source-build helpers clearly optional and avoid turning them into the default path without explicit user approval.

### Repo map (top level)
- `contracts/`: Solidity smart contracts, tests, and Foundry config.
- `scripts/`: Off-chain helpers and utilities.
- `scripts/verification/`: Repository-level compliance, hygiene, and link checks.
- `services/`: Service code (e.g., APIs).
- `infra/`: Infrastructure configs.
- `docs/`: Documentation, diagrams, and post-mortem reports.
- `common/images.yaml`: Shared base image versions for local deployments. Some services pin runtime images in their own values files, for example `services/blockscout/values.yaml`.
- `common/versions.yaml`: Central chart versions for local deployments.
- `services/blockscout/bens-microservice/regen-openapi.sh`: Manual BENS OpenAPI generation.

### Where to look next
- Each top-level folder has its own `AGENTS.md` with folder-specific guidance.
