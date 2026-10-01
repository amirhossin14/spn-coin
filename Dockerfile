# ─────────────────────────────────────────────────────────────
#  © 2026 SPN Coin Project — production container image.
#  Multi-stage, non-root, minimal surface.
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# install only production deps against the lockfile for reproducibility
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app

# security: run as an unprivileged user, not root
RUN addgroup -S spn && adduser -S spn -G spn

# tini for correct signal handling (graceful shutdown of SIGTERM/SIGINT)
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# drop write perms on the app tree; only data/log dirs are writable
RUN mkdir -p /app/data /app/logs \
 && chown -R spn:spn /app/data /app/logs \
 && chmod -R a-w /app \
 && chmod -R u+w /app/data /app/logs

USER spn

ENV NODE_ENV=production \
    HTTP_PORT=8080

EXPOSE 8080 8443

# container-level healthcheck hits the public coin-info endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${HTTP_PORT}/api/coin-info || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
