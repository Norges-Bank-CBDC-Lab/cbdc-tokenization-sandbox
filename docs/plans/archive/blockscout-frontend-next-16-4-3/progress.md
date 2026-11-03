# Blockscout frontend Next.js 16.4.3 pin — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Evidence | Done (2026-11-03) | Upstream `v2.12.1` Dockerfile and pnpm config, npm publish dates, GitHub advisory ranges, `build-images.sh` and the registry push path |
| 1 Build step | Done (2026-11-03) | One guarded insertion in `build-images.sh`; Known Issues item and frontend register row updated |
| 2 Build and rollout | Done (2026-11-03) | Every acceptance row has evidence below |
| 3 PR | In progress | Folder archived in the change commit; push, PR, and merge pending |

## Deviations From Plan

None.

## Verified Claims

- `build-images.sh` ran to completion. The build log shows the inserted step installing
  `next 16.4.3` in the deps stage with pnpm 12.4.1, under upstream's `minimumReleaseAge`.
- Both `next/package.json` files in the built image (`linux/arm64`) read 16.4.3: the app's copy
  under `/app/node_modules/.pnpm/next@16.4.3_.../` and the sitemap generator's copy under
  `/app/deploy/tools/sitemap-generator/node_modules/.pnpm/next@16.4.3_.../`. The image's
  `/app/package.json` declares `"next": "16.4.3"`.
- The guard was run against a Dockerfile whose install line differs (`--prod` appended): it exits 1
  with a message naming the step. Against the real line shape, it inserts the `pnpm add` line
  directly after the install line and nowhere else.
- Trust store unchanged by the step: Node 24.21.0 built-in roots still hold "emSign ECC Root CA -
  G3"; Alpine 3.24.2 `ca-certificates-bundle` 20261020-r0. The register row's last-checked date
  moved to this read.
- As expected, `build-images.sh` skipped the registry push because the `-kind` tag already
  existed. Rollout on the local sandbox: retagged the rebuilt image to the `-kind` tag and pushed
  it, removed the node's cached copy of that tag, and restarted the frontend Deployment. The new pod
  runs digest `sha256:5fc17236...`, matching the pushed image. Both `next/package.json` files in
  the running container read 16.4.3.
- The explorer serves through the local gateway: `/`, `/blocks`, and `/api/v2/stats` on the
  explorer host answer 200, and the pages reference `/_next/static/` chunks from the new build.
- The startup log shows the favicon generator skipping (no icon configured) and the sitemap generator
  failing to reach the explorer's public hostname from inside the pod. Both come from upstream's
  entrypoint scripts, which this step does not change. The previous pod's log was not kept, so the
  two runs were not compared line by line.

## Follow-ups

- `build-images` rebuilds under the upstream tag and does not replace an existing `-kind` registry
  tag, so existing sandboxes do not pick up a rebuilt Blockscout image without manual steps
  (recorded in `docs/KNOWN_ISSUES.md`). Existing behaviour, not changed here.
- Drop the step once a frontend release tag locks Next.js 16.4.1 or later.

## Session Handoff

Change committed on `feature/blockscout-frontend-next-16-4-3`. The local sandbox already runs the
rebuilt frontend. Next: operator review, PR against `development`, merge on go-ahead.
