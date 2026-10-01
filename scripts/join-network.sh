#!/usr/bin/env bash
#
# © 2026 SPN Coin Project
# join-network.sh — run a node that connects to an existing SPN Coin network.
#
# This is for people who want to help run the network (not a seed node).
# They point it at one or more seed nodes and start syncing the chain.
#
# Usage:
#   bash scripts/join-network.sh http://SEED_IP:3000
#
set -euo pipefail

SEED="${1:-}"
if [ -z "$SEED" ]; then
  echo "Usage: bash scripts/join-network.sh http://SEED_IP:3000 [http://SEED2:3000 ...]"
  echo
  echo "Ask the network operator for a seed node URL, then pass it here."
  exit 1
fi

# Join all provided seeds (comma-separate them for PEER_URLS).
PEERS=$(printf "%s," "$@" | sed 's/,$//')

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install Node.js >= 20: https://nodejs.org"
  exit 1
fi

echo "→ Installing dependencies..."
npm install --production --no-audit --no-fund

if [ ! -f .env ]; then
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWTR=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << ENV
NODE_ENV=production
PORT=3000
CHAIN_ID=3
JWT_SECRET=$JWT
JWT_REFRESH_SECRET=$JWTR
PEER_URLS=$PEERS
LOG_FORMAT=json
LOG_LEVEL=info
ENV
  echo "✓ .env created, will connect to: $PEERS"
else
  echo "✓ .env exists. Make sure PEER_URLS includes: $PEERS"
fi

echo
echo "→ Starting node and syncing from the network..."
echo "  (Use PM2 to keep it running: pm2 start server.js --name spn-node)"
echo
CHAIN_ID=3 node server.js
