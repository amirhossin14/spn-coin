#!/usr/bin/env bash
#=============================================================================
#  scripts/db-restore.sh — restore a Sepanta (SPN) PostgreSQL backup
#
#  Restores a dump created by db-backup.sh (pg_dump -Fc). Because a restore
#  OVERWRITES data, this script requires an explicit confirmation.
#
#  Usage:
#    ./scripts/db-restore.sh backups/spn-spncoin-2026-01-15_030000.dump
#    FORCE=1 ./scripts/db-restore.sh <file>     # skip the prompt (automation)
#
#  Required env (same as the app):
#    DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
#=============================================================================
set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-spncoin}"
DB_USER="${DB_USER:-spncoin}"

FILE="${1:-}"
if [ -z "$FILE" ]; then
    echo "Usage: $0 <backup-file.dump>" >&2
    exit 1
fi
if [ ! -f "$FILE" ]; then
    echo "❌ Backup file not found: $FILE" >&2
    exit 1
fi
if [ -z "${DB_PASSWORD:-}" ]; then
    echo "❌ DB_PASSWORD is not set. Export it (or source your .env) first." >&2
    exit 1
fi

# Verify the dump before touching the database
export PGPASSWORD="$DB_PASSWORD"
if ! pg_restore --list "$FILE" >/dev/null 2>&1; then
    echo "❌ '$FILE' is not a valid pg_dump archive." >&2
    exit 1
fi

echo "⚠️  About to RESTORE into database '$DB_NAME' on $DB_HOST:$DB_PORT"
echo "    from: $FILE"
echo "    This will OVERWRITE existing data in matching tables."
if [ "${FORCE:-0}" != "1" ]; then
    read -r -p "Type the database name ('$DB_NAME') to confirm: " CONFIRM
    if [ "$CONFIRM" != "$DB_NAME" ]; then
        echo "Aborted." >&2
        exit 1
    fi
fi

echo "♻️  Restoring…"
# --clean drops objects before recreating; --if-exists avoids errors on first run.
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --no-owner --no-privileges "$FILE"

echo "✅ Restore complete into '$DB_NAME'."
unset PGPASSWORD
