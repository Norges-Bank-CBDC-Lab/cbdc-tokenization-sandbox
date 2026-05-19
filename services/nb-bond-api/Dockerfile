# Multi-stage build for services/nb-bond-api.
#
# Stage 1 (builder): installs all deps with npm ci (incl. devDeps for TypeScript
# + native build tools for better-sqlite3), then runs `npm run build` to emit
# dist/ and prunes back to runtime-only deps so the production node_modules
# tree is copied into the runtime stage with the compiled native bindings
# intact.
#
# Stage 2 (runtime): clean Node image that runs the compiled server with
# `node dist/index.js`. Writable runtime data (the SQLite ingestion DB) lives
# under /app/data, which the Helm chart mounts as an emptyDir so it stays
# writable without touching the image layer.
#
# Stage bases are pinned in common/images.yaml under nb_bond_api.{builder,runtime}
# and pre-pulled by `./infra/infra.sh registry-sync` so an offline build works.

ARG NB_BOND_API_BUILDER_IMAGE=node:24.15.0
ARG NB_BOND_API_RUNTIME_IMAGE=node:24.15.0

FROM ${NB_BOND_API_BUILDER_IMAGE} AS builder
WORKDIR /app
# Install deps from the lockfile first so the dep layer is cacheable across
# source-only changes. devDeps are needed here for `tsc` and to compile the
# better-sqlite3 native binding.
COPY package.json package-lock.json ./
RUN npm ci
# Then copy everything the build needs.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

FROM ${NB_BOND_API_RUNTIME_IMAGE}
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# /app/data is the SQLite ingestion DB path (DB_PATH defaults to
# data/ingestion.sqlite). The chart mounts an emptyDir over it so the dir is
# writable at runtime without touching the image layer.
RUN mkdir -p /app/data

EXPOSE 8080
# The read-side DB connection is opened in readonly mode at module load, which
# will fail with SQLITE_CANTOPEN if the file doesn't exist yet. The chart
# mounts an emptyDir at /app/data, so on a fresh pod the file is missing.
# Touch it before handing off to node so the readonly open succeeds; the
# ingestion writer will create the actual schema.
CMD ["sh", "-c", "mkdir -p /app/data && touch /app/data/ingestion.sqlite && exec node /app/dist/index.js"]
