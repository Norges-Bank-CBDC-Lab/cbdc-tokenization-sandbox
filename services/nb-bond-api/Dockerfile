# Multi-stage build for services/nb-bond-api.
#
# This Dockerfile is invoked with the REPO ROOT as the build context so it
# can see the workspace-level package.json + package-lock.json. The root
# .dockerignore controls what actually gets sent to the daemon.
#
# Stage 1 (builder): installs deps with npm ci against the root lockfile
# (all workspaces, devDeps included). Compiles services/nb-bond-api/dist,
# then `npm prune --omit=dev` strips devDeps out of node_modules.
#
# Stage 2 (runtime): copies the pruned node_modules + built dist + package
# manifests into a clean Node image. Writable runtime data (the SQLite
# ingestion DB) lives under /app/data, mounted as an emptyDir by the chart.
#
# Stage bases come from common/node-version.env + common/images.yaml and
# are pre-pulled by `./infra/infra.sh registry-sync` so an offline build
# works.

ARG NB_BOND_API_BUILDER_IMAGE
ARG NB_BOND_API_RUNTIME_IMAGE

FROM ${NB_BOND_API_BUILDER_IMAGE} AS builder
WORKDIR /app

# Workspace metadata first so the dep-resolution layer is cacheable across
# source-only changes. npm needs the root lockfile + every workspace
# package.json to walk the symlink set; we don't list scripts/* sources
# because they aren't needed to build nb-bond-api.
COPY package.json package-lock.json ./
COPY services/nb-bond-api/package.json services/nb-bond-api/package.json
COPY services/nb-ui/package.json services/nb-ui/package.json
COPY scripts/bid-encryption/package.json scripts/bid-encryption/package.json
COPY scripts/bid-submitter/package.json scripts/bid-submitter/package.json
RUN npm ci

# Then everything the nb-bond-api build needs.
COPY services/nb-bond-api/tsconfig.json services/nb-bond-api/tsconfig.json
COPY services/nb-bond-api/src services/nb-bond-api/src
RUN npm run build -w nb-bond-api \
    && npm prune --omit=dev

FROM ${NB_BOND_API_RUNTIME_IMAGE}
WORKDIR /app
# Copy the pruned (production-only) workspace tree. The root node_modules
# contains the resolved deps for nb-bond-api (better-sqlite3 native binding,
# express, ethers, etc.). The workspace symlinks under node_modules point
# at services/nb-bond-api so we also copy the workspace's package.json into
# place, otherwise the symlink is a dangling ref.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/nb-bond-api/package.json services/nb-bond-api/package.json
COPY --from=builder /app/services/nb-bond-api/dist services/nb-bond-api/dist

# /app/data is the SQLite ingestion DB path (DB_PATH defaults to
# data/ingestion.sqlite, resolved relative to WORKDIR). The chart mounts
# an emptyDir over it so the dir is writable at runtime; pod-level
# fsGroup makes it group-writable for the runtime uid.
RUN mkdir -p /app/data \
    && chown -R node:node /app

# Run as the unprivileged `node` user (uid 1000) that the upstream node
# image ships with. USER must be numeric — kubelet's runAsNonRoot check
# refuses non-numeric image users.
USER 1000:1000

# WORKDIR stays at /app (not the workspace dir). The default DB_PATH is
# `data/ingestion.sqlite`, resolved via path.resolve from process.cwd(),
# so it lands at /app/data/ingestion.sqlite — which is where the chart
# mounts the writable emptyDir.

EXPOSE 8080
# The read-side DB connection is opened in readonly mode at module load,
# which will fail with SQLITE_CANTOPEN if the file doesn't exist yet. The
# chart mounts an emptyDir at /app/data; touch the DB before handing off
# to node so the readonly open succeeds. The ingestion writer creates the
# schema.
CMD ["sh", "-c", "mkdir -p /app/data && touch /app/data/ingestion.sqlite && exec node /app/services/nb-bond-api/dist/index.js"]
