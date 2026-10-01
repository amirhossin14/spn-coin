#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — Testnet Faucet
 *  A thin, rate-limited service that dispenses testnet SPN.
 *
 *  It does NOT hold or reconstruct keys itself — it authenticates to a
 *  running SPN Coin node and asks the node's funded wallet to send coins
 *  via the existing /api/transact endpoint. Run it ONLY against testnet.
 *
 *  Required env:
 *    NODE_URL        e.g. http://localhost:3000   (the SPN Coin node)
 *    FAUCET_USER     a node account with the 'transact:send' permission
 *    FAUCET_PASS     its password
 *  Optional env:
 *    FAUCET_PORT     default 3010
 *    FAUCET_AMOUNT   SPN per request, default 10
 *    COOLDOWN_MS     per-address & per-IP cooldown, default 24h
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const path = require('path');

const NODE_URL = (process.env.NODE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PORT = parseInt(process.env.FAUCET_PORT || '3010', 10);
const AMOUNT = parseFloat(process.env.FAUCET_AMOUNT || '10');
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || String(24 * 60 * 60 * 1000), 10);
const USER = process.env.FAUCET_USER;
const PASS = process.env.FAUCET_PASS;

if (!USER || !PASS) {
  console.error('❌ Set FAUCET_USER and FAUCET_PASS (a node account with transact:send).');
  process.exit(1);
}

// Simple in-memory cooldown tracking. For production use a shared store (Redis).
const lastClaim = new Map(); // key -> timestamp

let token = null;
let tokenExpiry = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiry) return token;
  const res = await fetch(`${NODE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`faucet login failed: HTTP ${res.status}`);
  const data = await res.json();
  token = data.accessToken || data.token;
  if (!token) throw new Error('faucet login: no access token returned');
  tokenExpiry = Date.now() + 10 * 60 * 1000; // refresh every 10 min
  return token;
}

function cooldownLeft(key) {
  const last = lastClaim.get(key);
  if (!last) return 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - last));
}

// Validate SPN testnet/mainnet address format.
function isValidSpnAddress(a) {
  return /^SPN[1t][A-Za-z0-9]{25,50}$/.test(a);
}

// Global daily dispense cap so the faucet wallet can't be fully drained.
const DAILY_CAP = parseFloat(process.env.FAUCET_DAILY_CAP || '10000'); // SPN/day
let dispensedToday = 0;
let dayStart = Date.now();
function rollDay() {
  if (Date.now() - dayStart > 24 * 60 * 60 * 1000) { dispensedToday = 0; dayStart = Date.now(); }
}

// Periodically prune expired cooldown entries to bound memory.
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastClaim) if (now - t > COOLDOWN_MS) lastClaim.delete(k);
}, 60 * 60 * 1000).unref?.();

// Public counters
let totalServed = 0;

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) =>
  res.json({ ok: true, node: NODE_URL, amount: AMOUNT, cooldownMs: COOLDOWN_MS }),
);

// Public faucet stats (for the UI).
app.get('/stats', (req, res) => {
  rollDay();
  res.json({
    amount: AMOUNT,
    cooldownHours: +(COOLDOWN_MS / 3.6e6).toFixed(1),
    totalServed,
    dispensedToday,
    dailyCap: DAILY_CAP,
    dailyRemaining: Math.max(0, DAILY_CAP - dispensedToday),
  });
});

app.post('/faucet', async (req, res) => {
  const address = String((req.body && req.body.address) || '').trim();
  const ip = req.ip || 'unknown';
  rollDay();

  if (!isValidSpnAddress(address)) {
    return res.status(400).json({ error: 'Invalid SPN address (expected SPN1… or SPNt…)' });
  }

  if (dispensedToday + AMOUNT > DAILY_CAP) {
    return res.status(503).json({ error: 'Daily faucet limit reached. Try again tomorrow.' });
  }

  const addrLeft = cooldownLeft(`addr:${address}`);
  const ipLeft = cooldownLeft(`ip:${ip}`);
  const left = Math.max(addrLeft, ipLeft);
  if (left > 0) {
    return res.status(429).json({
      error: 'Cooldown active',
      retryAfterMs: left,
      retryAfterHours: +(left / 3.6e6).toFixed(1),
    });
  }

  try {
    const jwt = await getToken();
    const r = await fetch(`${NODE_URL}/api/transact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ recipient: address, amount: AMOUNT }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ error: data.error || `node returned HTTP ${r.status}` });
    }
    // Record cooldown + counters only on success.
    lastClaim.set(`addr:${address}`, Date.now());
    lastClaim.set(`ip:${ip}`, Date.now());
    dispensedToday += AMOUNT;
    totalServed += 1;
    return res.json({ ok: true, amount: AMOUNT, txid: data.txid, address });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`💧 SPN Coin testnet faucet on http://localhost:${PORT}`);
  console.log(`   Node: ${NODE_URL} | ${AMOUNT} SPN / request | cooldown ${(COOLDOWN_MS / 3.6e6).toFixed(1)}h`);
});
