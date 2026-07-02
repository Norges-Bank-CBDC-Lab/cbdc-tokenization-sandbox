# Multi-stage build for services/nb-ui.
#
# This Dockerfile is invoked with the REPO ROOT as the build context so it
# can see the workspace-level package.json + package-lock.json. The root
# .dockerignore controls what actually gets sent to the daemon.
#
# Stage 1 (builder): installs deps with npm ci against the root lockfile
# and runs `npm run build` to produce dist/. Stage 2 (runtime): copies
# dist/ into an unprivileged nginx image. Runtime config
# (window.__APP_CONFIG__) is NOT baked in — the chart overlays config.js
# from a ConfigMap at install time, so the same image is re-pointable per
# deployment without rebuilding.
#
# Stage bases come from common/node-version.env + common/images.yaml and
# are pre-pulled by `./infra/infra.sh registry-sync` so an offline build
# works.

ARG NB_UI_BUILDER_IMAGE
ARG NB_UI_NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.3-alpine

FROM ${NB_UI_BUILDER_IMAGE} AS builder
WORKDIR /app

# Workspace metadata first so the dep-resolution layer is cacheable across
# source-only changes. npm needs the root lockfile + every workspace
# package.json to walk the symlink set.
COPY package.json package-lock.json ./
COPY services/nb-bond-api/package.json services/nb-bond-api/package.json
COPY services/nb-ui/package.json services/nb-ui/package.json
COPY scripts/bid-encryption/package.json scripts/bid-encryption/package.json
COPY scripts/bid-submitter/package.json scripts/bid-submitter/package.json
RUN npm ci

# Then everything the nb-ui build needs.
COPY services/nb-ui/index.html services/nb-ui/vite.config.js services/nb-ui/
COPY services/nb-ui/public services/nb-ui/public
COPY services/nb-ui/src services/nb-ui/src
RUN npm run build -w nb-ui

# Serve the bundle.
FROM ${NB_UI_NGINX_IMAGE}
COPY --from=builder /app/services/nb-ui/dist /usr/share/nginx/html
# config.js is overlaid from a ConfigMap mount at runtime — the chart
# points the configmap at /usr/share/nginx/html/config.js via subPath.
# Shipping a default config.js here would mask that overlay, so we don't.

# nginx-unprivileged listens on 8080 by default. Container readiness is
# probed by the chart.
EXPOSE 8080
