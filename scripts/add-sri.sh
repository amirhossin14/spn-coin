#!/usr/bin/env bash
#
# © 2026 SPN Coin Project
# add-sri.sh — computes Subresource Integrity (SRI) hashes for the CDN
# scripts used in public/*.html and injects an integrity="..." attribute.
#
# Run this ONCE from a machine with internet access:
#   bash scripts/add-sri.sh
#
# It downloads each cdnjs script, computes its SHA-384 hash, and rewrites the
# <script> tags in-place. Safe to re-run; it replaces any existing integrity.
#
set -euo pipefail

# List every distinct cdnjs URL currently referenced in the HTML.
urls=$(grep -rhoE 'https://cdnjs\.cloudflare\.com/[^"]+' public/*.html | sort -u)

for url in $urls; do
  echo "→ $url"
  tmp=$(mktemp)
  if ! curl -fsSL "$url" -o "$tmp"; then
    echo "  ✗ download failed, skipping"; rm -f "$tmp"; continue
  fi
  hash="sha384-$(openssl dgst -sha384 -binary "$tmp" | openssl base64 -A)"
  rm -f "$tmp"
  echo "  integrity: $hash"

  # Escape URL for sed, then add/replace integrity on the matching script tag.
  esc=$(printf '%s' "$url" | sed 's/[\/&.]/\\&/g')
  for f in public/*.html; do
    grep -q "$url" "$f" || continue
    # remove any existing integrity for this tag, then add the fresh one
    sed -i -E "s#(<script src=\"$esc\"[^>]*) integrity=\"[^\"]*\"#\1#g" "$f"
    sed -i -E "s#(<script src=\"$esc\")#\1 integrity=\"$hash\"#g" "$f"
  done
done

echo "✓ SRI hashes injected. Verify pages load, then commit."
