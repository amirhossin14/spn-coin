# Database Backup & Restore — Sepanta (SPN)

Automated, verified PostgreSQL backups. Even perfect uptime doesn't protect you
from accidental deletes, bad migrations, or disk failure — backups do. Set this
up on day one of running a real node.

## What's included

- `scripts/db-backup.sh` — creates a compressed, verified dump and rotates old ones
- `scripts/db-restore.sh` — restores a dump (with a confirmation guard)

Both read the database connection from the same environment variables the app
uses (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`), and the
password is passed via `PGPASSWORD` so it never appears in the process list or
shell history.

## One-off backup

```bash
# Load your secrets, then run
source .env            # or: export DB_PASSWORD=...
./scripts/db-backup.sh
```

You'll get `backups/spn-spncoin-<date>.dump`. Tune with env vars:

```bash
BACKUP_DIR=/var/backups/spn RETENTION_DAYS=30 ./scripts/db-backup.sh
```

The script verifies every dump with `pg_restore --list` before trusting it, and
deletes dumps older than `RETENTION_DAYS` (default 14).

## Automatic daily backups (cron)

Edit the crontab:

```bash
crontab -e
```

Add a line to run every day at 03:00 (adjust the path and env file):

```cron
0 3 * * * cd /opt/spn && set -a && . /opt/spn/.env && set +a && ./scripts/db-backup.sh >> /var/log/spn-backup.log 2>&1
```

- `set -a; . .env; set +a` loads your secrets into the environment for the job.
- Output goes to `/var/log/spn-backup.log` so you can check it succeeded.

For Docker/systemd deployments, run the same command from a systemd timer or a
sidecar container on a schedule.

## Restoring

```bash
source .env
./scripts/db-restore.sh backups/spn-spncoin-2026-01-15_030000.dump
```

It asks you to type the database name to confirm (a restore overwrites data).
For automated recovery, set `FORCE=1` to skip the prompt.

## Off-site copies (important)

A backup on the same server dies with the server. Periodically copy dumps
somewhere else — another host, object storage, or an encrypted external disk:

```bash
# Example: sync backups to a remote host over SSH
rsync -avz --delete /var/backups/spn/ backup-user@backup-host:/spn-backups/
```

For sensitive data, encrypt before shipping off-site:

```bash
gpg --symmetric --cipher-algo AES256 spn-spncoin-<date>.dump
```

## Test your restores

A backup you've never restored is a hope, not a backup. Once a month, restore
the latest dump into a scratch database and confirm it loads:

```bash
DB_NAME=spncoin_restore_test FORCE=1 ./scripts/db-restore.sh <latest.dump>
```

## Checklist

- [ ] `db-backup.sh` runs and produces a verified dump
- [ ] Daily cron job scheduled and logging to a file
- [ ] `RETENTION_DAYS` set to your policy (e.g. 14–30)
- [ ] Dumps copied off-site regularly
- [ ] Off-site copies encrypted if they contain user data
- [ ] Restore tested at least once into a scratch DB
