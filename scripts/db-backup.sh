#!/usr/bin/env bash
#=============================================================================
#  scripts/db-backup.sh — automated, safe PostgreSQL backups for Sepanta (SPN)
#
#  • Creates a compressed custom-format dump (pg_dump -Fc) — the format that
#    supports parallel, selective restore.
#  • Verifies the dump is readable before trusting it.
#  • Rotates old backups (keeps the last N days).
#  • Reads the password from the environment (PGPASSWORD), never from the
#    command line, so it can't leak into the process list or shell history.
#
#  Usage:
#    ./scripts/db-backup.sh                 # back up using env / defaults
#    BACKUP_DIR=/backups RETENTION_DAYS=30 ./scripts/db-backup.sh
#
#  Required env (same names the app uses):
#    DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
#  Optional:
#    BACKUP_DIR       (default: ./backups)
#    RETENTION_DAYS   (default: 14)
#=============================================================================
set -euo pipefail

# ── Config (fall back to the app's defaults) ────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-spncoin}"
DB_USER="${DB_USER:-spncoin}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -z "${DB_PASSWORD:-}" ]; then
    echo "❌ DB_PASSWORD is not set. Export it (or source your .env) first." >&2
    exit 1
fi

# pg_dump reads the password from PGPASSWORD (never passed on the CLI).
export PGPASSWORD="$DB_PASSWORD"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/spn-${DB_NAME}-${STAMP}.dump"

echo "🗄️  Backing up $DB_NAME from $DB_HOST:$DB_PORT → $OUT"

# ── Create the dump (custom format, compressed) ─────────────
if ! pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -Fc --no-owner --no-privileges -f "$OUT"; then
    echo "❌ pg_dump failed — no backup written." >&2
    rm -f "$OUT"
    exit 1
fi

# ── Verify the dump is readable (list its contents) ─────────
if ! pg_restore --list "$OUT" >/dev/null 2>&1; then
    echo "❌ Backup verification failed — dump is unreadable, deleting." >&2
    rm -f "$OUT"
    exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✅ Backup OK: $OUT ($SIZE)"

# ── Rotate: delete backups older than RETENTION_DAYS ────────
DELETED="$(find "$BACKUP_DIR" -name "spn-${DB_NAME}-*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
if [ "$DELETED" != "0" ]; then
    echo "🧹 Removed $DELETED backup(s) older than ${RETENTION_DAYS} days."
fi

# ── Summary ─────────────────────────────────────────────────
COUNT="$(find "$BACKUP_DIR" -name "spn-${DB_NAME}-*.dump" -type f | wc -l | tr -d ' ')"
echo "📦 $COUNT backup(s) now in $BACKUP_DIR"
unset PGPASSWORD
