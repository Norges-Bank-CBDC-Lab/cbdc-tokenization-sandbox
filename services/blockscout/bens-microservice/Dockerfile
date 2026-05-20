# Multi-stage build for services/blockscout/bens-microservice.
#
# Stage 1 (builder): installs Python dependencies into an isolated prefix so
# the runtime stage can copy only the resolved site-packages without pip or
# any build toolchain. Wheels for asyncpg and pydantic-core are available on
# PyPI for cpython 3.14 on glibc Linux, so this resolves offline once the
# host docker cache has the upstream python image.
#
# Stage 2 (runtime): same Python base, no pip cache or sources, runs
# uvicorn directly as a non-root user.
#
# Both stage bases are pinned in common/images.yaml under blockscout.bens
# and pre-pulled by `./infra/infra.sh registry-sync` so an offline build
# works.

ARG BENS_BUILDER_IMAGE=python:3.14.5
ARG BENS_RUNTIME_IMAGE=python:3.14.5

FROM ${BENS_BUILDER_IMAGE} AS builder
WORKDIR /build
# Install deps from requirements.txt first so the dep layer is cacheable
# across source-only changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM ${BENS_RUNTIME_IMAGE}
# /usr/local is the cpython prefix in the upstream python image, which is
# where the builder stage installed packages.
COPY --from=builder /install /usr/local

# Application code. The generated server lives under src/openapi_server and
# imports `from openapi_server.X` — set PYTHONPATH so uvicorn resolves it.
WORKDIR /app
COPY src/openapi_server ./openapi_server
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Run as the unprivileged `nobody` user (uid 65534) — the runtime image's
# kubelet runAsNonRoot check requires a numeric uid, and BENS does not
# need any host or volume writes beyond its read-only stdout logging.
USER 65534:65534

EXPOSE 8050
CMD ["uvicorn", "openapi_server.main:app", "--host", "0.0.0.0", "--port", "8050"]
