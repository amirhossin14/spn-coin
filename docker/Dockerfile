# ════════════════════════════════════════════════════════════
#  🐳 Dockerfile — SPN Coin Production (Multi-stage)
# ════════════════════════════════════════════════════════════

# ── مرحله ۱: نصب dependencies ───────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── مرحله ۲: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# در صورت نیاز به build step (TypeScript, webpack, ...)
# RUN npm run build

# ── مرحله ۳: Production Image ───────────────────────────────
FROM node:20-alpine AS production

# نصب ابزارهای ضروری
RUN apk add --no-cache curl dumb-init tzdata && \
    addgroup -g 1001 -S spncoin && \
    adduser  -u 1001 -S spncoin -G spncoin

ENV NODE_ENV=production \
    TZ=Asia/Tehran

WORKDIR /app

COPY --from=builder --chown=spncoin:spncoin /app/node_modules ./node_modules
COPY --from=builder --chown=spncoin:spncoin /app .

# حذف فایل‌های غیرضروری
RUN rm -rf test tests *.test.js .env* docker monitoring/grafana* docs/

# ایجاد پوشه داده
RUN mkdir -p /app/data /app/uploads && chown -R spncoin:spncoin /app/data /app/uploads

USER spncoin

EXPOSE 3000 3333

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# dumb-init برای مدیریت صحیح سیگنال‌ها
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
