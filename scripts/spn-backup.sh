#!/usr/bin/env bash
# spn-backup.sh — daily encrypted-at-rest-ready backup of SPN Coin critical state.
# Backs up the things you CANNOT regenerate: node identity, admin store, keys,
# env, TLS certs, and (if used) the Postgres DB. Excludes node_modules/build.
# Keeps the last N backups. Store these OFF the server too (they contain secrets).
set -euo pipefail

PROJ="${SPN_DIR:-/root/SPN_Coin}"
DEST="${SPN_BACKUP_DIR:-/root/SPN_Coin_backups}"
KEEP="${SPN_BACKUP_KEEP:-14}"
STAMP="$(date +%F_%H%M%S)"
mkdir -p "$DEST"; chmod 700 "$DEST"

TAR="$DEST/spn_backup_$STAMP.tar.gz"

# Critical files/dirs (only those that exist are included).
ITEMS=()
for p in access.lock .access-key .node-wallet.key .env .env.production config.js certs data; do
  [ -e "$PROJ/$p" ] && ITEMS+=("$p")
done

# Postgres dump if DATABASE_URL / pg is in use.
PGDUMP=""
if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  PGDUMP="$DEST/db_$STAMP.sql.gz"
  pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$PGDUMP" || { echo "[warn] pg_dump failed"; rm -f "$PGDUMP"; PGDUMP=""; }
fi

# Build the archive (relative to project dir so paths restore cleanly).
if [ "${#ITEMS[@]}" -gt 0 ]; then
  tar -czf "$TAR" -C "$PROJ" "${ITEMS[@]}"
else
  echo "[warn] no critical files found under $PROJ"; : > "$TAR"
fi
chmod 600 "$TAR" "${PGDUMP:-/dev/null}" 2>/dev/null || true

# Retention: keep the newest $KEEP of each kind.
ls -1t "$DEST"/spn_backup_*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
ls -1t "$DEST"/db_*.sql.gz        2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f

echo "[ok] backup: $TAR ${PGDUMP:+and $PGDUMP}  ($(du -h "$TAR" | cut -f1))"
