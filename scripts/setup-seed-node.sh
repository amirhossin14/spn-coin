#!/usr/bin/env bash
#
# © 2026 SPN Coin Project
# setup-seed-node.sh — one-command setup for a public SPN Coin seed node.
#
# A seed node is the stable entry point new peers connect to when joining the
# network. Run this on a server with a static public IP (a $5/month VPS works).
#
# Usage:
#   bash scripts/setup-seed-node.sh
#
set -euo pipefail

echo "═══════════════════════════════════════════════"
echo "   SPN Coin — Seed Node Setup"
echo "═══════════════════════════════════════════════"
echo

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install Node.js >= 20 first: https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node.js >= 20 required (found $(node -v))."
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 2. Install production dependencies
echo "→ Installing dependencies..."
npm install --production --no-audit --no-fund
echo "✓ Dependencies installed"

# 3. Generate secrets and .env if missing
if [ ! -f .env ]; then
  echo "→ Generating .env with fresh secrets..."
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWTR=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << ENV
NODE_ENV=production
PORT=3000
CHAIN_ID=3
JWT_SECRET=$JWT
JWT_REFRESH_SECRET=$JWTR
# Comma-separated peer URLs to connect to on boot (add other seeds here):
PEER_URLS=
# DNS seeds for automatic peer discovery (optional):
DNS_SEEDS=
# Enable structured JSON logs for production:
LOG_FORMAT=json
LOG_LEVEL=info
ENV
  echo "✓ .env created (secrets generated)"
else
  echo "✓ .env already exists (leaving it untouched)"
fi

# 4. Detect public IP (best effort)
PUBIP=$(node -e "require('https').get('https://api.ipify.org',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))}).on('error',()=>console.log(''))" 2>/dev/null || echo "")

echo
echo "═══════════════════════════════════════════════"
echo "   Setup complete!"
echo "═══════════════════════════════════════════════"
echo
echo "Next steps:"
echo
echo "  1. Start the node with a process manager (survives reboots):"
echo "       npm install -g pm2"
echo "       pm2 start server.js --name spn-seed"
echo "       pm2 startup && pm2 save"
echo
echo "  2. Open port 3000 in your firewall:"
echo "       sudo ufw allow 3000/tcp"
echo
if [ -n "$PUBIP" ]; then
  echo "  3. Your seed node URL (share this so others can connect):"
  echo "       http://$PUBIP:3000"
  echo
  echo "     Others join by adding it to their PEER_URLS:"
  echo "       PEER_URLS=http://$PUBIP:3000"
else
  echo "  3. Find your public IP and share http://<your-ip>:3000 so others"
  echo "     can add it to their PEER_URLS."
fi
echo
echo "  4. (Recommended) Put it behind a domain + HTTPS with a reverse proxy"
echo "     like Caddy or nginx. See docs/SEED_NODE.md."
echo
