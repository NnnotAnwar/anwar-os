# syntax=docker/dockerfile:1
#
# anwar.os web image. Two targets:
#   runner   (default) Next.js standalone server, ~what `next start` serves
#   migrator one-shot job that runs `pnpm db:migrate` (needs drizzle-kit, a dev
#            dependency, so it can't live in the pruned standalone image). Also
#            the place to run `pnpm owner:create` on the server.
#
#   docker build -t anwar-os-web .
#   docker build --target migrator -t anwar-os-migrate .
#
# Both are built for linux/amd64 and linux/arm64 in .github/workflows/deploy.yml.
# No build args: the app reads its configuration at runtime (DATABASE_URL,
# BETTER_AUTH_*, S3_*). If a NEXT_PUBLIC_* variable is ever added, it is inlined
# at build time and needs an ARG + ENV in the builder stage.

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PATH=$PNPM_HOME:$PATH
# Install the pnpm version pinned in package.json#packageManager into a shared,
# world-readable COREPACK_HOME, so the non-root migrator can run it offline.
COPY package.json ./
RUN corepack enable && corepack install && pnpm --version

# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders (same as ci.yml): modules that read these at import
# time must load while Next collects page data, but nothing connects to a
# database during the build. Real values arrive at runtime; this stage's ENV
# is not inherited by the runner image.
ENV DATABASE_URL=postgres://os_app:build@127.0.0.1:5432/anwar_os \
    BETTER_AUTH_SECRET=build-placeholder-secret-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000
# Lay the output out for the runner: /out/app is the server (read-only at
# runtime), /out/next is its .next dir (writable: ISR + image cache live there).
# Static assets and public/ aren't part of standalone and are copied in by hand.
RUN pnpm build \
 && mkdir -p public /out \
 && mv .next/standalone /out/app \
 && mv /out/app/.next /out/next \
 && cp -r .next/static /out/next/static \
 && cp -r public /out/app/public

# ---------------------------------------------------------------------------
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Server code stays root-owned (read-only for the app user); only .next is
# writable, because the server keeps its ISR / image cache there.
COPY --from=builder /out/app ./
COPY --from=builder --chown=node:node /out/next ./.next

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "server.js"]
