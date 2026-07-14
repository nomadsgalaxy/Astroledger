# =============================================================================
# Astroledger — production Dockerfile (multi-stage, ~180 MB final image)
# =============================================================================

# ----- 1. deps ---------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY patches ./patches
RUN npm ci --no-audit --no-fund

# ----- 2. build --------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# Prisma's CLI is used only for a one-time schema reconciliation when a legacy
# plaintext deployment predates versioned migrations. Install it with its full
# dependency graph in an isolated global prefix.
FROM node:24-bookworm-slim AS prisma-cli
RUN npm install -g prisma@6.19.3 --no-audit --no-fund

# ----- 3. runtime ------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl wget \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5050

RUN groupadd --gid 1001 astroledger && useradd --uid 1001 --gid 1001 --create-home astroledger

# Copy standalone build (includes minimal node_modules)
COPY --from=builder --chown=astroledger:astroledger /app/.next/standalone ./
COPY --from=builder --chown=astroledger:astroledger /app/.next/static ./.next/static
COPY --from=builder --chown=astroledger:astroledger /app/public ./public

# Prisma client + schema (needed for runtime migrate-on-boot)
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/prisma ./node_modules/prisma
COPY --from=prisma-cli --chown=astroledger:astroledger /usr/local/lib/node_modules/prisma /usr/local/lib/node_modules/prisma
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/better-sqlite3-multiple-ciphers ./node_modules/better-sqlite3-multiple-ciphers
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=astroledger:astroledger /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder --chown=astroledger:astroledger /app/prisma ./prisma
COPY --from=builder --chown=astroledger:astroledger /app/scripts/db-encryption-admin.mjs ./scripts/db-encryption-admin.mjs

# Entrypoint verifies encryption, applies versioned migrations through the
# keyed driver, and only then starts the server.
COPY --chown=astroledger:astroledger docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Data directory (mounted as a volume in compose)
RUN mkdir -p /data /run/astroledger-backup && chown astroledger:astroledger /data /run/astroledger-backup
ENV DATABASE_URL="file:/data/astroledger.db"

USER astroledger
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:5050/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
