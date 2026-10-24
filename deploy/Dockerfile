# Two images from one build: `node` runs every Node process (and the one-off migrate/tools
# services); `web` is Caddy with both built SPAs. Build context is the repo root.

FROM node:24.21.0-bookworm-slim AS base
RUN npm i -g pnpm@12.11.2 \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backoffice-api/package.json apps/backoffice-api/
COPY apps/backoffice-web/package.json apps/backoffice-web/
COPY apps/chat-backend/package.json apps/chat-backend/
COPY apps/guest-web/package.json apps/guest-web/
COPY apps/jobs/package.json apps/jobs/
COPY apps/mcp-servers/package.json apps/mcp-servers/
COPY apps/sandbox-proxy/package.json apps/sandbox-proxy/
COPY packages/domain/package.json packages/domain/
COPY packages/egress/package.json packages/egress/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/ui/package.json packages/ui/
# Dev dependencies included: the apps run TypeScript through tsx, and the smoke check uses the
# MCP Inspector.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS spa
ARG VITE_SANDBOX_URL
RUN pnpm --filter @fetivi/guest-web build && pnpm --filter @fetivi/backoffice-web build

FROM source AS node
# A named volume mounted here inherits this ownership on first mount. /app stays root-owned and
# read-only to the apps (a recursive chown of node_modules adds minutes to every build).
RUN mkdir -p /data/media && chown node:node /data/media
USER node
ENV NODE_ENV=production HOST=0.0.0.0

FROM caddy:2.11.6 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=spa /app/apps/guest-web/dist /srv/guest
COPY --from=spa /app/apps/backoffice-web/dist /srv/host
