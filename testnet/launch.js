#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * ══════════════════════════════════════════════════════════════
 *  🧪 Testnet — startup network آزمایشی ۳ نودی
 *
 *  اجرا:
 *   node testnet/launch.js
 *
 *  ۳ نود روی پورت‌های مختلف با هم sync می‌کنند
 * ══════════════════════════════════════════════════════════════
 */
const { fork } = require('child_process');
const path     = require('path');
const http     = require('http');

// ── تنظیمات ۳ نود ────────────────────────────────────────────
const NODES = [
    { id: 'node1', http: 3100, stratum: 3133, p2p: 8433, peers: ['127.0.0.1:8434', '127.0.0.1:8435'] },
    { id: 'node2', http: 3200, stratum: 3233, p2p: 8434, peers: ['127.0.0.1:8433', '127.0.0.1:8435'] },
    { id: 'node3', http: 3300, stratum: 3333, p2p: 8435, peers: ['127.0.0.1:8433', '127.0.0.1:8434'] },
];

const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m' };

function log(prefix, color, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`${C.bold}[${ts}]${C.reset} ${color}[${prefix}]${C.reset} ${msg}`);
}

// ── startup نودها ─────────────────────────────────────────
const processes = [];

async function launchNode(cfg) {
    const env = {
        ...process.env,
        NODE_ENV:       'testnet',
        CHAIN_ID:       '3',           // testnet
        PORT:           String(cfg.http),
        STRATUM_PORT:   String(cfg.stratum),
        P2P_PORT:       String(cfg.p2p),
        NODE_ID:        cfg.id,
        PEERS:          cfg.peers.join(','),
        BLOCK_TIME:     '5000',        // 5 ثانیه برای testnet
        DIFF_WINDOW:    '10',          // پنجره کوچک‌تر برای testnet
        MIN_DIFFICULTY: '1',
        INITIAL_REWARD: '5000000000',
        HALVING_INTERVAL:'100',
        MEMPOOL_MAX_TXS:'1000',
        DB_HOST:        'localhost',   // یا از SQLite در testnet
        DATA_DIR:       `./testnet/data/${cfg.id}`,
        LOG_LEVEL:      'info',
    };

    const proc = fork(path.join(__dirname, '../server.js'), [], {
        env,
        silent: false,
        cwd: path.join(__dirname, '..'),
    });

    proc.on('exit', (code) => {
        log(cfg.id, C.red, `Logout  کد ${code}`);
        const idx = processes.indexOf(proc);
        if (idx !== -1) processes.splice(idx, 1);
    });

    processes.push(proc);
    log(cfg.id, C.green, `startup  — HTTP:${cfg.http} Stratum:${cfg.stratum} P2P:${cfg.p2p}`);
    return proc;
}

// ── Health Check ─────────────────────────────────────────────
function checkHealth(port) {
    return new Promise(resolve => {
        const req = http.get(`http://localhost:${port}/api/stats`, { timeout: 3000 }, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// ── مانیتورینگ testnet ────────────────────────────────────────
async function monitorTestnet() {
    console.log('\n' + '═'.repeat(60));
    for (const node of NODES) {
        const stats = await checkHealth(node.http);
        if (stats) {
            log(node.id, C.cyan,
                `height=${stats.height} diff=${stats.difficulty} mempool=${stats.pendingTx} utxo=${stats.utxoCount}`
            );
        } else {
            log(node.id, C.red, 'unavailable');
        }
    }
}

// ── startup ─────────────────────────────────────────────
async function main() {
    console.log(`\n${C.bold}${C.cyan}🧪 SPN Coin Testnet —  نودی${C.reset}\n`);

    // ساخت پوشه‌های داده
    const fs = require('fs');
    for (const n of NODES) {
        fs.mkdirSync(`./testnet/data/${n.id}`, { recursive: true });
    }

    // startup نودها
    for (const cfg of NODES) {
        await launchNode(cfg);
        await new Promise(r => setTimeout(r, 2000)); // فاصله بین startup
    }

    // منتظر بمانید تا نودها آماده شوند
    log('testnet', C.yellow, '...');
    await new Promise(r => setTimeout(r, 8000));

    // مانیتورینگ هر ۱۵ ثانیه
    await monitorTestnet();
    setInterval(monitorTestnet, 15_000);

    console.log(`\n${C.bold}📡 ‌های testnet:${C.reset}`);
    NODES.forEach(n => {
        console.log(`   ${n.id}: http://localhost:${n.http}`);
        console.log(`  Stratum ${n.id}: stratum+tcp://localhost:${n.stratum}`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        log('testnet', C.yellow, 'Loading ...');
        processes.forEach(p => p.kill('SIGTERM'));
        setTimeout(() => process.exit(0), 2000);
    });
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
