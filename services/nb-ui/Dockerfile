# Multi-stage build for services/nb-ui.
#
# Stage 1 (builder): installs deps with npm ci and runs `npm run build` to
# produce dist/. Stage 2 (runtime): copies dist/ into an unprivileged nginx
# image. Runtime config (window.__APP_CONFIG__) is NOT baked in — it is
# mounted at /usr/share/nginx/html/config.js from a ConfigMap at install
# time, so the same image is re-pointable per deployment without rebuilding.
#
# The Node.js builder base is passed from common/node-version.env by
# common/helpers.sh. The nginx runtime base is pinned in common/images.yaml.
# Both are pre-pulled by `./infra/infra.sh registry-sync` so an offline build
# works.

# Build the bundle.
ARG NB_UI_BUILDER_IMAGE
ARG NB_UI_NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM ${NB_UI_BUILDER_IMAGE} AS builder
WORKDIR /app
# Install deps from the lockfile first so the dep layer is cacheable across
# source-only changes.
COPY package.json package-lock.json ./
RUN npm ci
# Then copy everything the build needs.
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# Serve the bundle.
FROM ${NB_UI_NGINX_IMAGE}
COPY --from=builder /app/dist /usr/share/nginx/html
# config.js is overlaid from a ConfigMap mount at runtime — the chart points
# the configmap at /usr/share/nginx/html/config.js via subPath. Shipping a
# default config.js here would mask that overlay, so we don't.

# nginx-unprivileged listens on 8080 by default. Container readiness is
# probed by the chart.
EXPOSE 8080
