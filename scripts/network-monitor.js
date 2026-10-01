#!/usr/bin/env node
/**
 * © 2026 SPN Coin Project
 * network-monitor.js — live health monitor for an SPN Coin network.
 *
 * Polls a list of node URLs, shows which are online, their chain height,
 * peer/miner counts, and flags nodes that have fallen out of sync. Useful for
 * the maintainer to watch network health, and for operators to see the network
 * growing.
 *
 * Usage:
 *   node scripts/network-monitor.js <node-url> [<node-url> ...]
 *   node scripts/network-monitor.js --file nodes.txt
 *   node scripts/network-monitor.js --watch <node-url> ...   # refresh loop
 *
 * Examples:
 *   node scripts/network-monitor.js http://localhost:3000
 *   node scripts/network-monitor.js --watch http://seed1:3000 http://seed2:3000
 *
 * nodes.txt: one URL per line (# comments allowed).
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');

// ── Parse args ───────────────────────────────────────────────
const args = process.argv.slice(2);
let watch = false;
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--watch' || a === '-w') watch = true;
  else if (a === '--file' || a === '-f') {
    const file = args[++i];
    const lines = fs.readFileSync(file, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    urls.push(...lines);
  } else urls.push(a);
}

if (urls.length === 0) {
  console.error('Usage: node scripts/network-monitor.js <node-url> [<node-url> ...]');
  console.error('       node scripts/network-monitor.js --file nodes.txt');
  console.error('       node scripts/network-monitor.js --watch <node-url> ...');
  process.exit(1);
}

// ── Fetch one node's /api/health (with timeout) ──────────────
function fetchHealth(baseUrl) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL('/api/health', baseUrl); } catch {
      return resolve({ url: baseUrl, online: false, error: 'bad url' });
    }
    const lib = u.protocol === 'https:' ? https : http;
    const started = Date.now();
    const req = lib.get(u, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          resolve({
            url: baseUrl, online: true, latency: Date.now() - started,
            height: d.height, peers: d.peers, miners: d.miners,
            mempool: d.mempool, network: d.network, uptime: d.uptime,
          });
        } catch {
          resolve({ url: baseUrl, online: false, error: 'bad response' });
        }
      });
    });
    req.on('error', () => resolve({ url: baseUrl, online: false, error: 'unreachable' }));
    req.on('timeout', () => { req.destroy(); resolve({ url: baseUrl, online: false, error: 'timeout' }); });
  });
}

function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Run one sweep ────────────────────────────────────────────
async function sweep() {
  const results = await Promise.all(urls.map(fetchHealth));
  const online = results.filter((r) => r.online);
  const heights = online.map((r) => r.height).filter((h) => typeof h === 'number');
  const maxHeight = heights.length ? Math.max(...heights) : null;

  // Header
  const now = new Date().toLocaleString();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  SPN Coin Network Monitor — ${now}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Table
  const pad = (s, n) => String(s ?? '—').padEnd(n);
  console.log(
    '  ' + pad('NODE', 34) + pad('STATUS', 10) + pad('HEIGHT', 9) +
    pad('PEERS', 7) + pad('MINERS', 8) + pad('SYNC', 8) + 'UPTIME',
  );
  console.log('  ' + '─'.repeat(76));

  for (const r of results) {
    const shortUrl = r.url.replace(/^https?:\/\//, '').slice(0, 32);
    if (!r.online) {
      console.log('  ' + pad(shortUrl, 34) + pad('🔴 DOWN', 10) +
        pad('—', 9) + pad('—', 7) + pad('—', 8) + pad('—', 8) + `(${r.error})`);
      continue;
    }
    // "sync" = how far behind the tallest node this one is
    const behind = maxHeight != null ? maxHeight - r.height : 0;
    const sync = behind === 0 ? '✓ tip' : `-${behind}`;
    console.log('  ' + pad(shortUrl, 34) + pad('🟢 UP', 10) +
      pad(r.height, 9) + pad(r.peers, 7) + pad(r.miners, 8) +
      pad(sync, 8) + fmtUptime(r.uptime));
  }

  // Summary
  console.log('  ' + '─'.repeat(76));
  const outOfSync = online.filter((r) => maxHeight != null && maxHeight - r.height > 2);
  console.log(
    `  Nodes: ${online.length}/${results.length} online` +
    (maxHeight != null ? ` · chain tip: #${maxHeight}` : '') +
    (online[0]?.network ? ` · ${online[0].network}` : '') +
    (outOfSync.length ? ` · ⚠️ ${outOfSync.length} out of sync` : ' · ✓ all in sync'),
  );

  // Health verdict
  if (online.length === 0) {
    console.log('  🔴 Network health: CRITICAL — no nodes reachable');
  } else if (online.length === 1) {
    console.log('  🟡 Network health: single node — not yet decentralized');
  } else if (outOfSync.length > 0) {
    console.log('  🟡 Network health: some nodes out of sync');
  } else {
    console.log(`  🟢 Network health: OK — ${online.length} independent nodes in sync`);
  }
  console.log('');
}

// ── Main ─────────────────────────────────────────────────────
(async () => {
  await sweep();
  if (watch) {
    console.log('  (watching — refresh every 15s, Ctrl+C to stop)');
    setInterval(sweep, 15000);
  }
})();
