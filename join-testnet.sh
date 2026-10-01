#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  SPN Coin Testnet — One-Command Node Setup
#  برای پیوستن به شبکه آزمایشی عمومی SPN Coin
# ═══════════════════════════════════════════════════════════
set -e

echo "🪙  SPN Coin Testnet Node Setup"
echo "════════════════════════════════"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js نصب نیست. اول نصب کن:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  exit 1
fi

echo "✅ Node.js: $(node --version)"

# Install deps
echo "📦 نصب وابستگی‌ها..."
npm install --production --silent

# Generate secrets if .env doesn't exist
if [ ! -f .env ]; then
  echo "🔐 ساخت فایل .env..."
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWTR=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << ENVEOF
NODE_ENV=production
PORT=3000
CHAIN_ID=3
JWT_SECRET=$JWT
JWT_REFRESH_SECRET=$JWTR
NODE_SECRET=${SPN_NODE_SECRET:-CHANGE_ME_shared_testnet_secret}
PEER_URLS=${1:-}
ENVEOF
  echo "✅ .env ساخته شد"
  if [ -z "$SPN_NODE_SECRET" ]; then
    echo "⚠️  NODE_SECRET روی یک مقدار پیش‌فرض است. برای یک testnet امن، همه‌ی نودها"
    echo "    باید یک NODE_SECRET مشترک و محرمانه داشته باشند. آن را این‌طور بده:"
    echo "    SPN_NODE_SECRET=your-shared-secret ./join-testnet.sh <peer-url>"
  fi
  if [ -n "$1" ]; then
    echo "🔗 به peer وصل می‌شوی: $1"
  else
    echo "⚠️  برای وصل‌شدن به seed، آدرس را بده:"
    echo "   ./join-testnet.sh https://seed1.spncoin-testnet.org"
  fi
fi

echo ""
echo "🚀 برای اجرا:"
echo "   node server.js"
echo "   یا با PM2:  pm2 start server.js --name spncoin-node"
