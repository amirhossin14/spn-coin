#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  © 2026 SPN Coin Project — generate a DEV self-signed TLS cert.
#  NOT for production. For real deployments use a CA (Let's Encrypt)
#  or terminate TLS at a reverse proxy.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

CERT="$CERT_DIR/dev-cert.pem"
KEY="$CERT_DIR/dev-key.pem"
DAYS="${1:-825}"
CN="${2:-localhost}"

echo "🔐 Generating self-signed certificate for CN=$CN (valid $DAYS days)…"

openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -keyout "$KEY" -out "$CERT" -days "$DAYS" \
  -subj "/C=US/ST=Dev/L=Dev/O=SPN Coin Dev/CN=$CN" \
  -addext "subjectAltName=DNS:localhost,DNS:$CN,IP:127.0.0.1,IP:::1"

chmod 600 "$KEY"
echo "✅ Wrote:"
echo "   cert: $CERT"
echo "   key : $KEY"
echo ""
echo "Enable it with:"
echo "   TLS_SELF_SIGNED=1 HTTPS_REDIRECT=1 node server.js"
echo ""
echo "⚠️  Browsers will warn about self-signed certs — that's expected in dev."
