#!/usr/bin/env bash
#
# © 2026 SPN Coin Project
# prepublish-check.sh — safety checks to run BEFORE pushing to a public repo.
#
# It verifies that no secrets will be committed and flags placeholders that
# should be replaced. It does NOT modify anything — it only reports.
#
# Usage:
#   bash scripts/prepublish-check.sh
#
set -uo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
issues=0
warnings=0

echo "═══════════════════════════════════════════════"
echo "   SPN Coin — Pre-Publish Safety Check"
echo "═══════════════════════════════════════════════"
echo

# 1. Secrets that must never be committed
echo "▶ Checking for secrets that would be tracked by git…"
SECRET_PATHS=("access.lock" ".env" "certs/dev-key.pem" "certs/dev-cert.pem")
for p in "${SECRET_PATHS[@]}"; do
  if [ -e "$p" ]; then
    if git check-ignore -q "$p" 2>/dev/null; then
      echo "  ${GRN}✓${RST} $p exists but is git-ignored (safe)"
    else
      echo "  ${RED}✗ $p exists and is NOT ignored — it would be committed!${RST}"
      issues=$((issues+1))
    fi
  fi
done

# 2. Scan tracked-ish files for obvious secret patterns
echo
echo "▶ Scanning for hard-coded secrets in source…"
if grep -rIlE "(BEGIN (RSA |EC )?PRIVATE KEY|password\s*[:=]\s*['\"][^'\"]{8,})" \
     --include="*.js" --include="*.json" --include="*.env" \
     --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | grep -qv "example"; then
  echo "  ${YEL}⚠ Files contain credential-like strings — confirm these are safe:${RST}"
  grep -rIlE "(BEGIN (RSA |EC )?PRIVATE KEY|password\s*[:=]\s*['\"][^'\"]{8,})" \
     --include="*.js" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null \
     | grep -v "example" | sed 's/^/      /'
  echo "      ${YEL}(Default demo credentials are expected here — just make sure${RST}"
  echo "      ${YEL} they are rotated in production and no REAL secrets are hard-coded.)${RST}"
  warnings=$((warnings+1))
else
  echo "  ${GRN}✓${RST} No obvious hard-coded secrets"
fi

# 3. Placeholders that should be replaced
echo
echo "▶ Checking for placeholders to replace…"
if grep -rn "OWNER/REPO" README.md >/dev/null 2>&1; then
  echo "  ${YEL}⚠ README.md still contains 'OWNER/REPO' — replace with your GitHub user/repo${RST}"
  warnings=$((warnings+1))
else
  echo "  ${GRN}✓${RST} No OWNER/REPO placeholder in README"
fi
if grep -rn "spncoin.example\|yourdomain" p2p/dnsseed.js docs/*.md >/dev/null 2>&1; then
  echo "  ${YEL}⚠ Example hostnames still present (fine until you run real seed nodes)${RST}"
  warnings=$((warnings+1))
fi

# 4. .gitignore sanity
echo
echo "▶ Checking .gitignore covers the essentials…"
for pat in "node_modules" ".env" "access.lock" "certs/*.pem" "data/"; do
  if grep -qF "$pat" .gitignore 2>/dev/null; then
    echo "  ${GRN}✓${RST} $pat"
  else
    echo "  ${RED}✗ $pat missing from .gitignore${RST}"
    issues=$((issues+1))
  fi
done

# 5. Default credentials reminder
echo
echo "▶ Reminder:"
echo "  • Rotate the default admin/miner/viewer credentials before going public."
echo "  • Generate fresh JWT secrets on each server (never reuse dev values)."

echo
echo "═══════════════════════════════════════════════"
if [ "$issues" -gt 0 ]; then
  echo "${RED}✗ $issues blocking issue(s) found. Fix these before publishing.${RST}"
  exit 1
elif [ "$warnings" -gt 0 ]; then
  echo "${YEL}⚠ $warnings warning(s). Review them, then you're good to publish.${RST}"
  exit 0
else
  echo "${GRN}✓ All checks passed. Safe to publish.${RST}"
  exit 0
fi
