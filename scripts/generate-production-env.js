#!/usr/bin/env node
/*
 * scripts/generate-production-env.js
 *
 * Generates a ready-to-use production .env file with strong, random secrets.
 * Run this ONCE on your server (or locally) and keep the output file private.
 *
 *   node scripts/generate-production-env.js            # prints to screen
 *   node scripts/generate-production-env.js --write    # writes .env.production
 *
 * ⚠️  NEVER commit the generated file. NEVER share these secrets.
 *     Anyone with these values can compromise your node.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const hex   = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const pass  = (bytes = 18) => crypto.randomBytes(bytes).toString('base64').replace(/[+/=]/g, '').slice(0, 24);

const secrets = {
    JWT_SECRET:         hex(32),
    JWT_REFRESH_SECRET: hex(32),
    ACCESS_KEY:         hex(32),
    CSRF_SECRET:        hex(32),
    NODE_SECRET:        hex(32),
    DB_PASSWORD:        pass(18),
    ADMIN_PASS:         pass(18),
};

const template = `# ============================================================
#  SPN Coin — PRODUCTION environment
#  Generated: ${new Date().toISOString()}
#
#  ⚠️  KEEP THIS FILE SECRET. Never commit it. Never share it.
#      Anyone with these values can take control of your node.
# ============================================================

# ── Runtime ──
NODE_ENV=production
PORT=3000
CHAIN_ID=1                      # 1 = mainnet, 3 = testnet
STRATUM_PORT=3333

# ── Secrets (auto-generated — do not reuse elsewhere) ──
JWT_SECRET=${secrets.JWT_SECRET}
JWT_REFRESH_SECRET=${secrets.JWT_REFRESH_SECRET}
ACCESS_KEY=${secrets.ACCESS_KEY}
CSRF_SECRET=${secrets.CSRF_SECRET}
NODE_SECRET=${secrets.NODE_SECRET}

# ── Admin account (first login) ──
# Username is auto-generated on first run; this sets the password.
ADMIN_PASS=${secrets.ADMIN_PASS}

# ── Database (PostgreSQL) ──
DB_HOST=postgres
DB_PORT=5432
DB_NAME=spncoin
DB_USER=spncoin
DB_PASSWORD=${secrets.DB_PASSWORD}
DB_SSL=false                    # set true if your DB requires SSL
# Or use a single URL instead of the fields above:
# DATABASE_URL=postgresql://spncoin:${secrets.DB_PASSWORD}@postgres:5432/spncoin

# ── Optional: AI assistant (leave blank to disable) ──
# Get a key at https://console.anthropic.com
ANTHROPIC_API_KEY=

# ── Optional: TLS (for real HTTPS with a domain) ──
# TLS_CERT=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
# TLS_KEY=/etc/letsencrypt/live/yourdomain.com/privkey.pem

# ── Optional: P2P peers (comma-separated) ──
# PEERS=http://other-node-ip:8333

# ── Optional but recommended: restrict admin panel to your IP(s) ──
# Leave blank to allow admin from anywhere (still protected by login + 2FA).
# Find your public IP at https://whatismyipaddress.com
# ADMIN_ALLOWED_IPS=your.ip.here,partner.ip.here

# ── Your domain(s) — REQUIRED in production for cross-origin requests ──
# Add every origin the site is served from, comma-separated, with https://
# Without this, some browser requests can be blocked in production.
ALLOWED_ORIGINS=https://spnchain.com,https://www.spnchain.com

# ── Token creation revenue ──
# Users pay this fee (in satoshi) to the treasury to create a token/coin.
# 5000000000 = 50 SPN. Set to 0 to make creation free during early growth.
TOKEN_ISSUANCE_FEE=5000000000
# Treasury wallet that collects the fees (your project revenue).
# See TREASURY_WALLET.txt for the wallet + its private key.
# Leave BLANK to make token creation free (no fee enforced).
TREASURY_ADDRESS=SPN1BFpMzMgganewUmbanCC6WLv2kVZ5Aa9NLa
`;

if (process.argv.includes('--write')) {
    const out = path.join(__dirname, '..', '.env.production');
    if (fs.existsSync(out)) {
        console.error('\n⚠️  .env.production already exists. Delete it first if you want to regenerate.\n');
        process.exit(1);
    }
    fs.writeFileSync(out, template, { mode: 0o600 });
    console.log('\n✅ Wrote .env.production (permissions 600 — owner read/write only).');
    console.log('   Review it, then rename to .env to use it:  mv .env.production .env');
    console.log('   ⚠️  Keep it secret. Never commit it.\n');
} else {
    console.log(template);
    console.log('# ── To save this to a file, run: ──');
    console.log('#   node scripts/generate-production-env.js --write\n');
}
