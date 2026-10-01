#!/usr/bin/env node
/**
 *  © 2026 SPN Coin Project — Network Monitor
 *  Live multi-node dashboard for the CLI.
 *  Usage:
 *    node tools/monitor.js
 *    node tools/monitor.js http://a:3000 http://b:3000
 */
'use strict';
const http = require('http'), https = require('https');
const NODES = process.argv.slice(2).length ? process.argv.slice(2)
  : [process.env.NODE_URL || 'http://localhost:3000'];
const INTERVAL = parseInt(process.env.MONITOR_INTERVAL || '5000', 10);
const C = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', yellow:'\x1b[33m',
  red:'\x1b[31m', cyan:'\x1b[36m', gray:'\x1b[90m' };

function fetchJSON(url, p) {
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url + p, { timeout: 4000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };

async function poll() {
  const rows = await Promise.all(NODES.map(async url => ({ url, stats: await fetchJSON(url, '/api/stats') })));
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`${C.bold}${C.cyan}🪙  SPN Coin Network Monitor${C.reset}  ${C.gray}${new Date().toLocaleTimeString()}${C.reset}`);
  console.log(C.gray + '─'.repeat(72) + C.reset);
  console.log(C.bold + pad('NODE',28)+pad('HEIGHT',9)+pad('DIFF',8)+pad('PEERS',7)+pad('MEMPOOL',9)+pad('STATUS',11) + C.reset);
  console.log(C.gray + '─'.repeat(72) + C.reset);
  const heights = {};
  for (const { url, stats } of rows) {
    const short = url.replace(/^https?:\/\//, '');
    if (!stats) { console.log(pad(short,28)+C.red+pad('—',9)+pad('—',8)+pad('—',7)+pad('—',9)+pad('● OFFLINE',11)+C.reset); continue; }
    const h = stats.height ?? 0; heights[h] = (heights[h]||0)+1;
    console.log(pad(short,28)+C.cyan+pad(h,9)+C.reset+pad(stats.difficulty??'—',8)+pad(stats.peers??0,7)+pad(stats.mempoolSize??0,9)+C.green+pad('● ONLINE',11)+C.reset);
  }
  console.log(C.gray + '─'.repeat(72) + C.reset);
  const online = rows.filter(r => r.stats);
  if (online.length > 1) {
    const uh = Object.keys(heights);
    if (uh.length === 1) console.log(`${C.green}✓ All ${online.length} nodes in sync at height ${uh[0]}${C.reset}`);
    else console.log(`${C.yellow}⟳ Syncing — heights ${Math.min(...uh.map(Number))}–${Math.max(...uh.map(Number))}${C.reset}`);
  }
  console.log(`${C.gray}refresh ${INTERVAL/1000}s · Ctrl-C to quit${C.reset}`);
}
console.log(`Monitoring ${NODES.length} node(s)...`);
poll();
const t = setInterval(poll, INTERVAL);
process.on('SIGINT', () => { clearInterval(t); console.log('\n👋 stopped'); process.exit(0); });
