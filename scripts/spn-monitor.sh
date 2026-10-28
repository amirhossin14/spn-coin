#!/usr/bin/env bash
# spn-monitor.sh — health check for SPN Coin. Alerts (Telegram, optional) when:
#   • the systemd service is not active
#   • /api/health does not respond
#   • block height has NOT advanced for too long (possible stall/fork)
#   • process memory or disk usage crosses a threshold
# Set TG_BOT_TOKEN + TG_CHAT_ID to get Telegram alerts; otherwise it logs to stderr
# and syslog. Run from cron every 5 minutes.
set -uo pipefail

SVC="${SPN_SERVICE:-spncoin}"
URL="${SPN_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
STATE="${SPN_MON_STATE:-/run/spn-monitor.state}"
STALL_MIN="${SPN_STALL_MIN:-60}"        # alert if height stuck this many minutes
MEM_PCT_MAX="${SPN_MEM_MAX:-85}"        # alert if system mem use over this %
DISK_PCT_MAX="${SPN_DISK_MAX:-90}"      # alert if / disk use over this %

alert(){
  local msg="[SPN] $1"
  logger -t spn-monitor "$msg" 2>/dev/null || true
  echo "$(date '+%F %T') $msg" >&2
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
    curl -s --max-time 10 "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TG_CHAT_ID}" --data-urlencode text="$msg" >/dev/null 2>&1 || true
  fi
}

# 1) service up?
if ! systemctl is-active --quiet "$SVC"; then
  alert "service '$SVC' is NOT active"; exit 0
fi

# 2) health endpoint + height
BODY="$(curl -s --max-time 10 "$URL" || true)"
if [ -z "$BODY" ]; then alert "health endpoint not responding ($URL)"; exit 0; fi
HEIGHT="$(printf '%s' "$BODY" | grep -o '"height":[0-9]*' | head -1 | grep -o '[0-9]*')"
[ -z "$HEIGHT" ] && { alert "health responded but no height field"; exit 0; }

# 3) height-advance / stall check (state = "lastHeight lastChangeEpoch")
NOW=$(date +%s); LASTH=""; LASTT=""
[ -f "$STATE" ] && read -r LASTH LASTT < "$STATE" 2>/dev/null || true
if [ "$HEIGHT" != "${LASTH:-}" ]; then
  echo "$HEIGHT $NOW" > "$STATE"
else
  if [ -n "${LASTT:-}" ]; then
    MINS=$(( (NOW - LASTT) / 60 ))
    if [ "$MINS" -ge "$STALL_MIN" ]; then
      alert "block height stuck at $HEIGHT for ${MINS}min (possible stall/fork)"
    fi
  fi
fi

# 4) system memory %
MEM_PCT=$(free | awk '/^Mem:/{printf "%d", $3*100/$2}')
[ "${MEM_PCT:-0}" -ge "$MEM_PCT_MAX" ] && alert "memory usage ${MEM_PCT}% (>= ${MEM_PCT_MAX}%)"

# 5) disk %
DISK_PCT=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
[ "${DISK_PCT:-0}" -ge "$DISK_PCT_MAX" ] && alert "disk usage ${DISK_PCT}% (>= ${DISK_PCT_MAX}%)"

exit 0
