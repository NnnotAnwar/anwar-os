# syntax=docker/dockerfile:1
# Expense bot image. Multi-arch: build with
#   docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/<owner>/anwar-os-bot-expenses:<sha> \
#     --build-arg BOT_VERSION=<sha> bots/expenses
# uv picks the right wheel for each target platform from uv.lock; nothing here is
# architecture specific.

ARG PYTHON_IMAGE=python:3.13-slim

FROM ghcr.io/astral-sh/uv:0.10.7 AS uv

FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

FROM ${PYTHON_IMAGE}
ARG BOT_VERSION=dev
LABEL os.managed="true" \
      os.kind="bot" \
      os.name="expenses" \
      org.opencontainers.image.title="anwar.os expenses bot" \
      org.opencontainers.image.version="${BOT_VERSION}"
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BOT_VERSION="${BOT_VERSION}"

RUN useradd --system --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin bot

COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY expenses_bot ./expenses_bot
COPY db ./db
COPY scripts ./scripts

USER 10001:10001

# Healthy while the heartbeat (written to Postgres every 60 s) succeeded in the last
# 180 s; see expenses_bot/healthcheck.py.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-m", "expenses_bot.healthcheck", "180"]

# python runs as PID 1 and installs its own SIGTERM handler (graceful shutdown).
STOPSIGNAL SIGTERM
CMD ["python", "-m", "expenses_bot"]
