/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

// Load environment variables from a .env file if present (optional).
// This lets you keep JWT_SECRET, ADMIN_USER/PASS, DB creds, etc. in one place.
try {
    const dotenv = require('dotenv');
    dotenv.config();                                        // .env  (shared defaults)
    dotenv.config({ path: '.env.local', override: true });  // .env.local (real secrets, git-ignored)
} catch (e) { /* dotenv optional */ }

const express = require('express');
const http    = require('http');
const path    = require('path');

// ── Core modules ───────────────────────────────────────────────
const { Blockchain, CHAIN_ID, HALVING_INTERVAL, INITIAL_REWARD } = require('./blockchain/blockchain');
const { Transaction }                  = require('./utxo/utxo');
const { Mempool }                                                  = require('./mempool/mempool');
const { P2PHttpServer: P2PServer }                                 = require('./p2p/p2p-http');
const { StratumWSServer: StratumServer }                          = require('./mining-pool/stratum-ws');
const { StratumBtcServer }                                        = require('./mining-pool/stratum-btc');
const { Wallet }                                                   = require('./wallet/wallet');

// ── Security ───────────────────────────────────────────────────
const { ac, verifyAuditLog }                                         = require('./app/access-control');
const { jwtMiddleware, createTokens, verifyRefresh, revokeToken } = require('./middleware/jwt');
const { ddos, limiters }                   = require('./middleware/ratelimit');
const {
    buildHoneypot, licenseHeaders, aiRateLimit,
    threatScorer, sessionBinder, anomalyDetect,
} = require('./middleware/security');
const { IdsIps } = require('./middleware/ids-ips');

// Unified IDS/IPS engine (shares the threat scorer, logs to console).
const idsIps = new IdsIps({ scorer: threatScorer });

// ── Monitoring ─────────────────────────────────────────────────
const { metrics, httpMetricsMiddleware, metricsHandler, bindBlockchain } = require('./monitoring/metrics');

// ── Database ───────────────────────────────────────────────────
const { initDB, LogRepo, KYC, FeeRepo, pool: dbPool, bindBlockchain: bindDB } = require('./db/state');

// ── Config ─────────────────────────────────────────────────────
const { COIN, NETWORK } = require('./config');

// ══════════════════════════════════════════════════════════════
//  INPUT VALIDATION SCHEMA
// ══════════════════════════════════════════════════════════════
const V = {
    address:  a => typeof a === 'string' && (a.startsWith('SPN1') || a.startsWith('SPNt')) && /^SPN[1t][A-Za-z0-9]{25,50}$/.test(a),
    amount:   n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 21_000_000,
    txid:     s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s),
    hash:     s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s),
    username: s => typeof s === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(s),
    password: s => typeof s === 'string' && s.length >= 8 && s.length <= 128,
    ip:       s => typeof s === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(s),
};

function body(schema) {
    return (req, res, next) => {
        for (const [field, validate] of Object.entries(schema)) {
            if (req.body?.[field] === undefined)
                return res.status(400).json({ error: `Missing required field: ${field}` });
            if (!validate(req.body[field]))
                return res.status(400).json({ error: `Invalid value for field: ${field}` });
        }
        next();
    };
}

// ══════════════════════════════════════════════════════════════
//  CORE INITIALIZATION
// ══════════════════════════════════════════════════════════════
const blockchain = new Blockchain();

// 🔎 Transaction anomaly detector — learns normal patterns, flags suspicious txs
const { AnomalyDetector } = require('./app/anomaly-detector');
const txAnomaly = new AnomalyDetector();
// Learn baseline from existing chain on startup
for (const b of blockchain.chain) txAnomaly.observeBlock(b);
const mempool    = new Mempool();

// Persistent node wallet — so the node's SPN address stays CONSTANT across
// restarts instead of regenerating every time. Priority:
//   1. NODE_WALLET_KEY env var (a 64-hex/DER private key) — use it to pin a
//      specific address (e.g. one you control).
//   2. a persisted key file (.node-wallet.key) — generated once, then reused.
//   3. only if a file can't be written, fall back to an ephemeral wallet.
const NODE_WALLET_KEY_SET = !!process.env.NODE_WALLET_KEY;
const wallet = (function loadNodeWallet() {
    const fs = require('fs');
    const KEY_FILE = path.join(__dirname, '.node-wallet.key');
    try {
        // 1) Explicit key from the environment — lets you pin (and SPEND from) a
        //    specific address such as the project's main wallet.
        if (process.env.NODE_WALLET_KEY) return new Wallet(process.env.NODE_WALLET_KEY.trim());
        // 2) A key persisted to a file (also works: drop the private key of your
        //    main address into .node-wallet.key). Reused across restarts.
        if (fs.existsSync(KEY_FILE)) {
            const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
            if (k) return new Wallet(k);
        }
        const w = new Wallet();
        fs.writeFileSync(KEY_FILE, w.privateKey, { mode: 0o600 });
        return w;
    } catch (e) {
        console.warn('[Wallet] Could not load/persist node wallet key. Set NODE_WALLET_KEY to pin a spendable address.');
        return new Wallet();
    }
})();

// Token-issuance treasury: collects the fee others pay to create tokens.
// Defaults to the node operator's wallet when not set in config/env.
const { TOKEN } = require('./config');
// The project's single canonical SPN address — used for the wallet/send display
// address and as the treasury that collects coin/token issuance fees. Override
// with MAIN_ADDRESS (and NODE_WALLET_KEY, if you also want the node to sign from
// it) in your .env.
const MAIN_ADDRESS = process.env.MAIN_ADDRESS || 'SPN1BG84zA2hVKPUaFPNMZ1cvUpn91UkZun9MF';
// Coin/token issuance-fee treasury — FIXED to the project's fee-collection
// address, independent of the wallet/display MAIN_ADDRESS. All issuance fees
// (create coin / create token) are paid here.
const TREASURY  = 'SPN1BG84zA2hVKPUaFPNMZ1cvUpn91UkZun9MF';
blockchain.tokens.setTreasury(TREASURY);
// Persist each issuance-fee payment to the DB (durable across restarts).
// Idempotent by txid, so chain replay after a restart never double-counts.
blockchain.tokens.onFee = (rec) => { FeeRepo.add(rec).catch(() => {}); };

// Is the node actually able to SPEND from the address shown in Wallet/Send?
// Only when the node holds the private key whose address == MAIN_ADDRESS.
const WALLET_SPENDABLE = (wallet.address === MAIN_ADDRESS);
if (NODE_WALLET_KEY_SET && !WALLET_SPENDABLE) {
    console.warn('[Wallet] NODE_WALLET_KEY was set but its address (' + wallet.address +
        ') does not match MAIN_ADDRESS (' + MAIN_ADDRESS + '). Sending will fail — use the private key of MAIN_ADDRESS.');
} else if (!NODE_WALLET_KEY_SET) {
    console.warn('[Wallet] MAIN_ADDRESS is display/receive-only until you set NODE_WALLET_KEY to its private key (then the node can spend from it).');
} else {
    console.log('[Wallet] Node wallet is spendable and matches MAIN_ADDRESS.');
}
// Install extended token capabilities (burn, freeze, transfer-owner, set-meta)
const { extendTokenLayer } = require('./tokens/token-extensions');
extendTokenLayer(blockchain.tokens);
const p2p        = new P2PServer({ blockchain, mempool });

// ── Advanced networking (opt-in): peer discovery, DoS protection,
//    headers-first sync, and optional pruning. Safe no-op if the
//    active P2P transport doesn't expose a given hook.
try {
    const { enhanceNode } = require('./p2p/net-enhance');
    enhanceNode(p2p, {
        minPeers:  parseInt(process.env.MIN_PEERS, 10) || 4,
        maxPeers:  parseInt(process.env.MAX_PEERS, 10) || 8,
        prune:     process.env.PRUNE === '1',
        keepDepth: parseInt(process.env.PRUNE_KEEP, 10) || 288,
    });
    console.log('🛡️  [P2P] advanced networking enabled (discovery · guard · fast-sync' +
        (process.env.PRUNE === '1' ? ' · pruning' : '') + ')');
} catch (e) {
    console.warn('[P2P] advanced networking not loaded:', e.message);
}
const stratum    = new StratumServer({ blockchain, mempool, wallet });

// Stratum → found block
stratum.on('block:found', ({ block, workerName }) => {
    const r = blockchain.addBlock(block);
    if (r && r.ok) txAnomaly.observeBlock(block);
    if (r.ok) {
        metrics.blockMined?.inc({ miner: workerName });
        p2p.broadcastBlock?.(block);
        stratum.broadcastNewJob(true);
        emitBlockWebhook(block, 'mined');
    }
});

// P2P → received block from peer
p2p.on('block:received', ({ block }) => {
    const r = blockchain.addBlock(block);
    if (r && r.ok) txAnomaly.observeBlock(block);
    if (r.ok) { stratum.broadcastNewJob(false); emitBlockWebhook(block, 'received'); }
});

// Fire webhook subscribers (if the user-features webhook registry is up)
function emitBlockWebhook(block, source) {
    const payload = {
        source,
        height: blockchain.height,
        hash: block?.hash,
        txCount: block?.transactions?.length ?? 0,
        timestamp: block?.timestamp,
    };
    try { global.__spnRTBus?.emit('block', payload); } catch { /* best-effort */ }
    try { global.__spnWebhooks?.emit('block', payload); } catch { /* best-effort */ }
}

// P2P → received transaction from peer
p2p.on('tx:received', ({ tx }) => mempool.add(tx, blockchain.utxoSet, blockchain.height + 1));

// ══════════════════════════════════════════════════════════════
//  EXPRESS APP
// ══════════════════════════════════════════════════════════════
const app = express();

// Dedicated, stable event bus for the real-time WS feed. Kept separate from
// __spnWebhooks (which the features module reassigns to a WebhookRegistry that
// has emit() but no on()). Both are notified on block events.
global.__spnRTBus = global.__spnRTBus || new (require('events').EventEmitter)();
global.__spnRTBus.setMaxListeners(50);
global.__spnWebhooks = global.__spnWebhooks || new (require('events').EventEmitter)();
global.__spnWebhooks.setMaxListeners(50);

// Deep-convert BigInt values to strings so responses can be JSON-serialized.
// UTXO amounts and fees are stored as BigInt; JSON.stringify throws on them.
function jsonSafe(value) {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) out[k] = jsonSafe(value[k]);
        return out;
    }
    return value;
}

// Structured JSON request logging (set LOG_FORMAT=json in production).
const logger = require('./logging/logger');
app.use(logger.httpMiddleware());
// SECURITY: never trust every proxy hop — that lets a client spoof X-Forwarded-For
// and defeat the admin IP allowlist, rate limits and IP bans. Trust exactly the
// number of reverse proxies in front of this node (TRUST_PROXY_HOPS, default 1;
// set 0 if the node is exposed directly with no proxy).
const TRUST_PROXY_HOPS = Number.isFinite(+process.env.TRUST_PROXY_HOPS) ? +process.env.TRUST_PROXY_HOPS : 1;
app.set('trust proxy', TRUST_PROXY_HOPS);
// Single source of truth: is there a trusted reverse proxy in front of us?
// Used consistently for XFF/XFP-dependent middleware (DDoS guard, HTTPS enforce).
const TRUST_PROXY = TRUST_PROXY_HOPS > 0;
app.disable('x-powered-by');

// ── IPS: reject already-banned IPs before anything else ──
app.use(idsIps.blockGate());

// ── DDoS resistance: concurrent-conn cap, adaptive global shedding,
//    burst auto-ban, Slowloris defense, reputation with decay. Runs
//    right after the ban gate so floods are dropped early. Fail-open.
const { DDoSGuard } = require('./middleware/ddos-guard');
const ddosGuard = new DDoSGuard({ trustProxy: TRUST_PROXY });
global.__ddosGuard = ddosGuard;
if (process.env.DDOS_GUARD !== '0') app.use(ddosGuard.middleware());

// ── HTTPS enforcement: HSTS on secure requests + optional http→https
//    redirect. Works whether TLS is terminated here or at a proxy
//    (honors X-Forwarded-Proto). Controlled by HTTPS_REDIRECT / TLS_*.
const { enforceHttps } = require('./middleware/tls');
app.use(enforceHttps({
    httpsPort: process.env.HTTPS_PORT || NETWORK.HTTP_PORT,
    trustProxy: TRUST_PROXY,
}));

// CORS — restrict to known origins. NEVER reflect an arbitrary Origin together
// with Allow-Credentials (that lets any site make credentialed cross-origin
// requests). Only an explicit allowlist is echoed; localhost is allowed to keep
// local development working. Same-origin requests carry no Origin header and are
// unaffected.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (ALLOWED_ORIGINS.includes(origin) || (process.env.NODE_ENV !== 'production' && isLocalOrigin(origin)))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ── Security headers ───────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options',  'nosniff');
    res.setHeader('X-Frame-Options',         'DENY');
    res.setHeader('X-XSS-Protection',        '1; mode=block');
    res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy',      'geolocation=(), microphone=(), camera=(self)');
    // Generate per-request nonce for CSP (kept for potential future use)
    const cspNonce = require('crypto').randomBytes(16).toString('base64');
    res.locals.cspNonce = cspNonce;
    // NOTE: We intentionally do NOT put the nonce in script-src. Per the CSP
    // spec, when a nonce (or hash) is present, browsers IGNORE 'unsafe-inline'.
    // The app relies on inline event handlers (onclick=...) throughout the UI,
    // which need 'unsafe-inline' to run. So we keep 'unsafe-inline' and omit the
    // nonce from script-src to keep those handlers working.
    res.setHeader('Content-Security-Policy',
        `default-src 'self'; ` +
        `script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; ` +
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; ` +
        `font-src 'self' https://fonts.gstatic.com; ` +
        `img-src 'self' data: https:; ` +
        `connect-src 'self' https://api.anthropic.com https://fonts.googleapis.com https://fonts.gstatic.com; ` +
        `frame-ancestors 'none'; ` +
        `base-uri 'self'; ` +
        `form-action 'self'`
    );
    if (process.env.NODE_ENV === 'production')
        res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
});

app.use(buildHoneypot(threatScorer));   // Extended honeypot (30+ bot traps)
app.use(ddos.middleware());
app.use(licenseHeaders());              // Inject copyright headers on all responses

// Anomaly detection — score suspicious IPs automatically
app.use((req, res, next) => {
    const ip = (req.ip || '').trim();
    anomalyDetect.analyze(req);
    if (threatScorer.isDangerous(ip)) {
        console.warn(`🚨 [Security] Dangerous IP blocked: ${ip} (score ${threatScorer.get(ip)})`);
        return res.status(403).json({ error: 'Access denied', code: 'THREAT_DETECTED' });
    }
    next();
});

app.use(express.json({ limit: '100kb' }));

// Return a clean 400 for malformed JSON instead of a 500 that could leak
// internal error details.
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }
    next(err);
});

// ── Admin IP allowlist ───────────────────────────────────────────────
// If ADMIN_ALLOWED_IPS is set (comma-separated), the admin panel and all
// /api/admin/* routes are only reachable from those IPs. This is a strong
// extra layer: even with a valid password + 2FA, requests from other IPs are
// rejected before authentication. Leave it UNSET to allow admin from anywhere
// (protected by login + 2FA only).
//
//   Example:  ADMIN_ALLOWED_IPS=203.0.113.5,198.51.100.20
//
// Behind Cloudflare / a reverse proxy, the real client IP comes from
// x-forwarded-for, so make sure your proxy passes it through.
const ADMIN_ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

function clientIp(req) {
    return (req.ip || '').trim();
}
function isAdminPath(p) {
    return p === '/admin.html' || p === '/admin' || p.startsWith('/api/admin/');
}

if (ADMIN_ALLOWED_IPS.length > 0) {
    app.use((req, res, next) => {
        if (!isAdminPath(req.path)) return next();
        let ip = clientIp(req);
        // normalise IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4)
        if (ip.startsWith('::ffff:')) ip = ip.slice(7);
        if (ADMIN_ALLOWED_IPS.includes(ip)) return next();
        console.warn(`🔒 [Admin] Blocked admin access from non-allowlisted IP: ${ip} (${req.path})`);
        return res.status(403).json({ error: 'Admin access is restricted to authorised IP addresses.', code: 'ADMIN_IP_BLOCKED' });
    });
    console.log(`🔒 [Admin] IP allowlist active — admin limited to: ${ADMIN_ALLOWED_IPS.join(', ')}`);
}

// ── Content-level hardening: prototype-pollution guard, JSON depth/size
//    limits, and per-request correlation ids. Runs right after parsing.
const { bodyGuard, requestId } = require('./middleware/hardening');
app.use(requestId());
app.use(bodyGuard());

// CSRF protection (double-submit cookie). Bearer-token API calls are exempt.
// Enabled by default; set CSRF_PROTECTION=0 to disable (e.g. pure-API deployments).
if (process.env.CSRF_PROTECTION !== '0') {
    const csrf = require('./middleware/csrf');
    app.use(csrf.middleware({ secure: process.env.NODE_ENV === 'production' }));
}

// ── Activate Bitcoin feature modules in the live core (opt-out via
//    BITCOIN_INTEGRATE=0): fee-rate/RBF/CPFP mempool selection, SegWit
//    witness commitments in mining + validation, headers-first locator,
//    compact-block relay, and SPV endpoints. Fully defensive — any hook
//    that can't attach is skipped, never breaking the core.
if (process.env.BITCOIN_INTEGRATE !== '0') {
    try {
        const { integrateBitcoin } = require('./bitcoin/integrate');
        integrateBitcoin({ blockchain, mempool, p2p, app });
    } catch (e) {
        console.warn('[bitcoin] integration not loaded:', e.message);
    }
}


// ── IDS/IPS: deep-inspect the full request (path, query, body, headers) ──
app.use(idsIps.inspector());

// ── Protect all server-side source files ──────────────────────
const BLOCKED_PATHS = /^\/(server|config|app_stratum|package|package-lock)(\.js|\.json)?$/i;
// NOTE: require a trailing "/" so this blocks source-DIRECTORY access
// (e.g. /wallet/wallet.js) without shadowing clean page routes like /wallet.
const BLOCKED_DIRS  = /^\/(app|blockchain|db|mempool|middleware|mining-pool|monitoring|p2p|utxo|wallet|cli|testnet|ha|docker|docs)\/.+$/i;

app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (BLOCKED_PATHS.test(p) || BLOCKED_DIRS.test(p))
        return res.status(403).json({ error: 'Access denied' });
    next();
});

// Admin & dashboard panels: no caching (always get fresh)
app.use(['/admin.html', '/dashboard.html', '/admin', '/dashboard'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
});

// ── Clean URLs: canonicalise /page.html → /page (301), keep query string ──
// Placed BEFORE express.static so the .html form never serves a 200 directly.
app.get(/\.html$/i, (req, res, next) => {
    // never touch dot-directories or nested asset paths that must stay literal
    if (req.path.startsWith('/.well-known')) return next();
    const clean = req.path.replace(/\.html$/i, '');
    const qs = req.originalUrl.slice(req.path.length); // preserve ?query
    return res.redirect(301, (clean || '/') + qs);
});

// RFC 9116 — security.txt (served explicitly since static skips dotfiles).
const SECURITY_TXT = (() => {
    try { return require('fs').readFileSync(path.join(__dirname, 'public', '.well-known', 'security.txt'), 'utf8'); }
    catch (e) { return 'Contact: mailto:security@spncoin.example\n'; }
})();
app.get(['/.well-known/security.txt', '/security.txt'], (req, res) => {
    res.type('text/plain').send(SECURITY_TXT);
});

// ── Favicon: serve the Sepanta coin logo with NO caching ─────────────
// Browsers cache favicons very aggressively (often ignoring Ctrl+Shift+R).
// Serving them with no-cache headers, and mapping the automatic /favicon.ico
// request to the coin logo, guarantees the current logo shows up.
app.get(['/favicon.ico', '/sepanta-coin.ico'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('image/x-icon');
    res.sendFile(path.join(__dirname, 'public', 'sepanta-coin.ico'));
});
app.get(['/favicon.png', '/sepanta-coin.png', '/favicon-32.png', '/sepanta-coin-32.png'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('image/png');
    const file = req.path.includes('-32') ? 'sepanta-coin-32.png' : 'sepanta-coin.png';
    res.sendFile(path.join(__dirname, 'public', file));
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ════════════════════════════════════════════════════════════════════
//  ✉️  Contact form → Web3Forms (server-side proxy)
//  The Web3Forms access key is read from the environment (WEB3FORMS_ACCESS_KEY
//  in .env.local) and NEVER exposed to the browser. The client posts the
//  message to this route; the server forwards it to Web3Forms.
// ════════════════════════════════════════════════════════════════════
const _contactHits = new Map(); // ip -> [timestamps] (simple in-memory rate limit)
app.post('/api/contact', async (req, res) => {
    try {
        const KEY = process.env.WEB3FORMS_ACCESS_KEY;
        if (!KEY) {
            return res.status(503).json({ success: false, code: 'NOT_CONFIGURED',
                message: 'Contact form is not configured on the server.' });
        }

        // Basic per-IP rate limit: max 5 messages / 10 minutes.
        const ip = req.ip || 'unknown';
        const now = Date.now();
        const win = 10 * 60 * 1000;
        const hits = (_contactHits.get(ip) || []).filter(t => now - t < win);
        if (hits.length >= 5) {
            return res.status(429).json({ success: false, code: 'RATE_LIMITED',
                message: 'Too many messages. Please try again later.' });
        }

        const b = req.body || {};
        const name    = String(b.name    || '').trim().slice(0, 120);
        const email   = String(b.email   || '').trim().slice(0, 160);
        const subject = String(b.subject || '').trim().slice(0, 200);
        const message = String(b.message || '').trim().slice(0, 5000);
        const botcheck = b.botcheck; // honeypot — must be empty

        if (botcheck) return res.json({ success: true }); // silently drop bots
        if (!name || !email || !message)
            return res.status(400).json({ success: false, code: 'MISSING_FIELDS',
                message: 'Please fill in your name, email and message.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ success: false, code: 'BAD_EMAIL',
                message: 'Please enter a valid email address.' });

        const payload = {
            access_key: KEY,
            name, email,
            subject: subject || ('SPN Coin — message from ' + name),
            message,
            from_name: 'SPN Coin Contact Form',
        };

        // Count this attempt BEFORE forwarding upstream — otherwise failed/abusive
        // requests never increment the window and could hammer Web3Forms (and burn
        // the access key's quota) without limit.
        hits.push(now); _contactHits.set(ip, hits);

        const r = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
        });
        const out = await r.json().catch(() => ({}));

        if (r.ok && out && out.success) {
            return res.json({ success: true });
        }
        return res.status(502).json({ success: false, code: 'UPSTREAM',
            message: (out && out.message) || 'Message could not be sent. Please try again later.' });
    } catch (e) {
        return res.status(500).json({ success: false, code: 'ERROR',
            message: 'Message could not be sent. Please try again later.' });
    }
});

// Root → explorer (clean URL)
app.get('/', (req, res) => res.redirect(302, '/explorer'));
app.get('/mining', (req, res) => res.redirect(301, '/miner'));

// Named aliases where the clean URL differs from the file name.
app.get('/faucet', (req, res) => res.sendFile(path.join(__dirname, 'testnet', 'faucet.html')));
app.get('/ai',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'ai-widget.html')));
app.get('/tokens', (req, res) => res.sendFile(path.join(__dirname, 'public', 'token-factory.html')));
app.get('/manage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'token-manage.html')));

// Generic clean URL: /page → public/page.html when that file exists.
// Covers explorer, dashboard, admin, block, tx, wallet, send, miner, network,
// analytics, radar, monitor, airdrop, claim, token, about, contact, terms, etc.
// The admin-IP gate and the no-cache gate above already run before this.
const _PUBLIC_DIR = path.join(__dirname, 'public');
app.get(/^\/[A-Za-z0-9][A-Za-z0-9_-]*$/, (req, res, next) => {
    const name = req.path.slice(1);
    const file = path.join(_PUBLIC_DIR, name + '.html');
    if (!file.startsWith(_PUBLIC_DIR + path.sep)) return next(); // path-traversal guard
    require('fs').access(file, require('fs').constants.F_OK, (err) => {
        if (err) return next();
        // Revalidate the HTML shell every load so a new deploy's asset versions
        // (nav.js?v=…, etc.) take effect immediately instead of being masked by a
        // browser-cached old shell. Static assets keep their normal 1h cache.
        res.sendFile(file, { headers: { 'Cache-Control': 'no-cache, must-revalidate' } });
    });
});

// LICENSE — viewable by anyone (proof of ownership)
app.get('/LICENSE', (req, res) => {
    const fs   = require('fs');
    const path = require('path');
    const file = path.join(__dirname, 'LICENSE');
    if (!fs.existsSync(file)) return res.status(404).send('LICENSE file not found');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(fs.readFileSync(file, 'utf8'));
});
app.use(httpMetricsMiddleware);
app.use('/api/', limiters.global.middleware());

// ── Auth middleware factory ────────────────────────────────────
function auth(perm) {
    return [
        jwtMiddleware(false),
        (req, res, next) => {
            if (req.user) {
                if (perm && !ac.hasPerm(req.user, perm))
                    return res.status(403).json({ error: 'Permission denied', required: perm });
                return next();
            }
            return ac.middleware(perm)(req, res, next);
        },
    ];
}

// ── Audit log helper ───────────────────────────────────────────
async function log(req, action, details = {}) {
    await LogRepo.add({
        userId:    req.user?.id,
        username:  req.user?.username,
        role:      req.user?.role,
        action,
        ip:        req.ip,
        path:      req.path,
        userAgent: (req.headers && req.headers['user-agent']) || '',
        details,
    }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS (no authentication required)
// ══════════════════════════════════════════════════════════════

// ── OpenAPI spec + interactive Swagger UI docs ──
const { buildSpec } = require('./docs-api/openapi');
app.get('/api/openapi.json', (req, res) => {
    res.json(buildSpec({ version: '1.0.0', baseUrl: `${req.protocol}://${req.get('host')}` }));
});
// Interactive API docs (Swagger UI loaded from cdnjs — allowed by CSP).
app.get('/apidocs', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPN Coin API — Docs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css">
<style>
:root{--bg:#0d0f18;--bg2:#141726;--card:#12141f;--bd:rgba(255,255,255,.08);--txt:#dce1f2;--sub:#8a94b4;--gold:#f0a500;--grn:#00e676}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:'Sora',sans-serif}
.swagger-ui .topbar{display:none}
.spn-head{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:14px;padding:15px 24px;
  background:rgba(13,15,24,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--bd)}
.spn-head .logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--gold),#ffd060);
  display:flex;align-items:center;justify-content:center;font-weight:900;color:#000;font-size:18px;box-shadow:0 0 20px rgba(240,165,0,.3)}
.spn-head .t b{font-size:17px;font-weight:900;color:var(--txt)}
.spn-head .t span{display:block;font-size:11px;color:var(--sub)}
.spn-head .sp{flex:1}
.spn-head a.home{color:var(--gold);font-size:13px;font-weight:700;text-decoration:none;border:1px solid var(--bd);padding:8px 16px;border-radius:8px}
.spn-head a.home:hover{background:rgba(240,165,0,.08)}
#swagger-ui{max-width:1100px;margin:0 auto;padding:0 16px}
/* dark theme overrides */
.swagger-ui,.swagger-ui .info .title,.swagger-ui .info li,.swagger-ui .info p,.swagger-ui .info table,
.swagger-ui .opblock-tag,.swagger-ui .opblock .opblock-summary-operation-id,.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-path__deprecated,.swagger-ui .opblock .opblock-summary-description,
.swagger-ui table thead tr td,.swagger-ui table thead tr th,.swagger-ui .parameter__name,.swagger-ui .parameter__type,
.swagger-ui .response-col_status,.swagger-ui .response-col_description,.swagger-ui label,.swagger-ui .tab li,
.swagger-ui .opblock-description-wrapper p,.swagger-ui .opblock-external-docs-wrapper p,.swagger-ui .model,
.swagger-ui .model-title,.swagger-ui .parameter__in,.swagger-ui .opblock-title_normal{color:var(--txt) !important}
.swagger-ui .info a,.swagger-ui a.nostyle,.swagger-ui a{color:var(--gold) !important}
.swagger-ui .opblock-tag small,.swagger-ui .parameter__in,.swagger-ui .response-col_links{color:var(--sub) !important}
.swagger-ui .scheme-container{background:var(--card) !important;box-shadow:none;border:1px solid var(--bd);border-radius:12px;margin:20px 0;padding:18px 22px}
.swagger-ui select,.swagger-ui input[type=text],.swagger-ui textarea,.swagger-ui input[type=email],.swagger-ui input[type=password],.swagger-ui input[type=search]{
  background:var(--bg2) !important;color:var(--txt) !important;border:1px solid var(--bd) !important}
.swagger-ui .opblock-tag{border-bottom:1px solid var(--bd)}
.swagger-ui .opblock{background:var(--card);border:1px solid var(--bd);box-shadow:none;border-radius:10px;margin:0 0 12px}
.swagger-ui .opblock .opblock-section-header{background:var(--bg2);box-shadow:none}
.swagger-ui .opblock .opblock-section-header h4,.swagger-ui .opblock .opblock-section-header label,.swagger-ui .opblock .opblock-section-header>label>span{color:var(--txt)}
.swagger-ui .opblock .opblock-summary{border-color:var(--bd)}
.swagger-ui table tbody tr td{border-color:var(--bd);color:var(--sub)}
.swagger-ui .btn{color:var(--txt);border-color:var(--bd)}
.swagger-ui .btn.authorize{color:var(--grn);border-color:var(--grn)}
.swagger-ui .btn.authorize svg{fill:var(--grn)}
.swagger-ui .btn.execute{background:var(--gold);border-color:var(--gold);color:#000}
.swagger-ui .model-box,.swagger-ui section.models,.swagger-ui section.models.is-open h4{background:var(--card);border-color:var(--bd);color:var(--txt)}
.swagger-ui section.models .model-container{background:var(--bg2)}
.swagger-ui .highlight-code,.swagger-ui .microlight,.swagger-ui .responses-inner pre{background:#0a0c14 !important}
.swagger-ui .markdown code,.swagger-ui .renderedMarkdown code{background:var(--bg2);color:var(--gold)}
.swagger-ui .response-col_status{color:var(--txt) !important}
.swagger-ui svg:not(:root){fill:var(--sub)}
.swagger-ui .opblock.opblock-post .opblock-summary-method{background:var(--grn);color:#000}
</style>
</head><body>
<div class="spn-head">
  <div class="logo">S</div>
  <div class="t"><b>SPN Coin API</b><span>Interactive documentation · v6.0</span></div>
  <div class="sp"></div>
  <a class="home" href="/">← Back to site</a>
</div>
<div id="swagger-ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.min.js"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout',
  });
};
</script>
</body></html>`);
});

app.get('/api/health', (req, res) => res.json({
    status:  'ok',
    version: COIN.VERSION,
    height:  blockchain.height,
    peers:   p2p.peerCount(),
    miners:  stratum.getStats().authorized,
    mempool: mempool.size(),
    chainId: CHAIN_ID,
    network: CHAIN_ID === 1 ? 'mainnet' : 'testnet',
    uptime:  Math.floor(process.uptime()),
}));

// Richer system metrics for the admin System Monitor (admin-only).
// ── Public monitoring endpoints (used by monitor.html) ──
// These expose node health/metrics without login so the monitoring page works
// for anyone. They contain only status data, nothing sensitive.
// The response shapes match exactly what public/monitor.html reads.
const _monSeries = { cpu: [], memory: [], height: [], peers: [], mempool: [], blockInterval: [] };
function _pushSeries(name, v) {
    const arr = _monSeries[name];
    arr.push({ t: Date.now(), v });
    if (arr.length > 60) arr.shift();   // keep last ~60 samples
}
app.get('/api/monitor/health', (req, res) => {
    const os = require('os');
    const mem = process.memoryUsage();
    const totalMem = os.totalmem(), freeMem = os.freemem();
    const load = os.loadavg();
    const cpus = os.cpus() || [];
    const cpuPct = cpus.length ? Math.min(100, Math.round((load[0] / cpus.length) * 100)) : 0;
    const memPct = Math.round((1 - freeMem / totalMem) * 100);
    // record series for the chart
    _pushSeries('cpu', cpuPct);
    _pushSeries('memory', memPct);
    _pushSeries('height', blockchain.height);
    _pushSeries('peers', p2p.peerCount());
    _pushSeries('mempool', mempool.size());
    _pushSeries('blockInterval', (require('./config').BLOCKCHAIN.BLOCK_TIME_TARGET || 600000) / 1000);
    res.json({
        cpu:      { percent: cpuPct, count: cpus.length, model: cpus[0] ? cpus[0].model : 'unknown' },
        memory:   { systemUsedPct: memPct, heapUsedMB: Math.round(mem.heapUsed / 1048576),
                    heapTotalMB: Math.round(mem.heapTotal / 1048576), processRssMB: Math.round(mem.rss / 1048576) },
        uptime:   { processSec: Math.floor(process.uptime()) },
        platform: { type: process.platform, node: process.version },
    });
});
app.get('/api/monitor/metrics', (req, res) => {
    res.json({ series: _monSeries });
});
app.get('/api/monitor/alerts', (req, res) => {
    // No alerting backend yet — return an empty active list so the UI renders cleanly.
    res.json({ active: [] });
});

app.get('/api/admin/system-metrics', auth('view:dashboard'), (req, res) => {
    const os = require('os');
    const mem = process.memoryUsage();
    const totalMem = os.totalmem(), freeMem = os.freemem();
    const load = os.loadavg();           // [1m, 5m, 15m] — 0 on Windows
    const cpus = os.cpus() || [];
    res.json({
        status:       'online',
        version:      COIN.VERSION,
        node:         process.version,
        platform:     process.platform,
        uptime:       Math.floor(process.uptime()),
        // memory
        rssMB:        Math.round(mem.rss / 1048576),
        heapUsedMB:   Math.round(mem.heapUsed / 1048576),
        heapTotalMB:  Math.round(mem.heapTotal / 1048576),
        sysTotalMB:   Math.round(totalMem / 1048576),
        sysFreeMB:    Math.round(freeMem / 1048576),
        sysUsedPct:   Math.round((1 - freeMem / totalMem) * 100),
        // cpu
        cpuCount:     cpus.length,
        cpuModel:     cpus[0] ? cpus[0].model : 'unknown',
        load1:        load[0] || 0,
        // chain
        height:       blockchain.height,
        peers:        p2p.peerCount(),
        miners:       stratum.getStats().authorized,
        mempool:      mempool.size(),
        difficulty:   blockchain.difficulty !== undefined ? blockchain.difficulty : 0,
        network:      CHAIN_ID === 1 ? 'mainnet' : 'testnet',
    });
});

app.get('/api/coin-info', (req, res) => res.json({
    name:            COIN.NAME,
    symbol:          COIN.SYMBOL,
    decimals:        8,
    maxSupply:       '21000000',
    miningReward:    (Number(INITIAL_REWARD) / 1e8).toString(),
    halvingInterval: HALVING_INTERVAL,
    chainId:         CHAIN_ID,
    network:         CHAIN_ID === 1 ? 'mainnet' : 'testnet',
    version:         COIN.VERSION,
}));

// Prometheus metrics (internal network only in production)
app.get('/metrics', (req, res) => {
    const ip = req.ip || '';
    const allowed = ip.startsWith('172.') || ip.startsWith('10.') ||
                    ip === '127.0.0.1' || ip === '::1';
    if (!allowed && process.env.NODE_ENV === 'production')
        return res.status(403).end();
    metricsHandler(req, res);
});

// ── Public blockchain explorer endpoints ──────────────────────

app.get('/api/stats', (req, res) => {
    const s = blockchain.getStats();
    res.json({
        ...s,
        powAlgorithm: (require('./config').BLOCKCHAIN.POW_ALGORITHM || 'sha256d'),
        mempoolSize: mempool.size(),
        mempoolFees: mempool.totalFees ? mempool.totalFees().toString() : '0',
        peers:       p2p.peerCount(),
        nodeAddress: wallet.address || wallet.publicKey,
        coin:        { name: COIN.NAME, symbol: COIN.SYMBOL },
    });
});

// ── Analytics: time-series data derived from the chain ────────
// Returns per-block metrics for charting (no extra storage needed).
app.get('/api/analytics', (req, res) => {
    const window = Math.min(200, Math.max(10, parseInt(req.query.window) || 50));
    const chain  = blockchain.chain;
    const start  = Math.max(1, chain.length - window); // skip genesis
    const series = [];
    let totalTx = 0, totalFees = 0n, totalSize = 0;

    for (let i = start; i < chain.length; i++) {
        const b    = chain[i];
        const prev = chain[i - 1];
        const txs  = (b.transactions || []).length;
        // Only compute block time when the previous block has a real timestamp
        // (genesis uses a sentinel timestamp of 1, which would skew the average).
        const prevReal = prev && prev.timestamp > 1000000000000;
        const blockTime = prevReal ? (b.timestamp - prev.timestamp) / 1000 : 0; // seconds
        // sum non-coinbase output value as "volume"
        let vol = 0n;
        for (const tx of (b.transactions || [])) {
            if (tx.isCoinbase) continue;
            for (const o of (tx.outputs || [])) vol += BigInt(o.amount || 0);
        }
        totalTx  += txs;
        totalSize += (b.size || 0);
        series.push({
            height:     b.height,
            timestamp:  b.timestamp,
            difficulty: b.difficulty,
            txCount:    txs,
            blockTime:  Math.max(0, Math.round(blockTime)),
            size:       b.size || 0,
            volume:     (Number(vol) / 1e8),
        });
    }

    // Aggregate summary
    const blockTimes = series.filter(s => s.blockTime > 0).map(s => s.blockTime);
    const avgBlockTime = blockTimes.length
        ? Math.round(blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length) : 0;
    const avgDifficulty = series.length
        ? (series.reduce((a, s) => a + s.difficulty, 0) / series.length) : 0;

    // circulating supply estimate: sum of all UTXO values
    let supply = 0n;
    try {
        const utxoMap = blockchain.utxoSet.utxos;
        if (utxoMap && typeof utxoMap.values === 'function')
            for (const u of utxoMap.values()) supply += BigInt(u.amount || 0);
    } catch {}

    res.json({
        window:        series.length,
        height:        blockchain.height,
        series,
        summary: {
            avgBlockTime,
            avgDifficulty:  +avgDifficulty.toFixed(2),
            totalTxInWindow: totalTx,
            avgTxPerBlock:  series.length ? +(totalTx / series.length).toFixed(2) : 0,
            avgBlockSize:   series.length ? Math.round(totalSize / series.length) : 0,
            targetBlockTime: (require('./config').BLOCKCHAIN.BLOCK_TIME_TARGET || 600000) / 1000,
            circulatingSupply: supply > 0n ? (Number(supply) / 1e8) : null,
            maxSupply:      require('./config').BLOCKCHAIN.MAX_SUPPLY || 21000000,
        },
    });
});

app.get('/api/blocks', (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const all   = [...blockchain.chain].reverse();
    res.json({
        blocks: all.slice((page - 1) * limit, page * limit),
        total:  blockchain.chain.length,
        page,
        pages:  Math.ceil(blockchain.chain.length / limit),
    });
});

app.get('/api/block/:ref', (req, res) => {
    const ref = req.params.ref;
    if (!ref || ref.length > 80) return res.status(400).json({ error: 'Invalid block reference' });
    const block = /^\d{1,10}$/.test(ref)
        ? blockchain.getBlockByHeight(parseInt(ref, 10))
        : /^[a-f0-9]{64}$/i.test(ref) ? blockchain.getBlock(ref) : null;
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
});

app.get('/api/tx/:txid', (req, res) => {
    if (!V.txid(req.params.txid))
        return res.status(400).json({ error: 'Invalid transaction ID format' });
    const r = blockchain.getTransaction(req.params.txid);
    if (!r) {
        const pending = mempool.get?.(req.params.txid);
        if (pending) return res.json(jsonSafe({ ...pending, status: 'pending', confirmations: 0 }));
        return res.status(404).json({ error: 'Transaction not found' });
    }
    // Serialize safely: outputs/inputs may carry BigInt amounts that JSON
    // can't handle. jsonSafe() deep-converts any BigInt to a string.
    res.json(jsonSafe({
        ...r.tx,
        blockHash:     r.block.hash,
        blockHeight:   r.block.height,
        confirmations: blockchain.height - r.block.height + 1,
        status:        'confirmed',
    }));
});

// ── Utility: convert a public key (DER-SPKI hex) → SPN address ──
// Used by client-side signing / vanity generation. No private key involved.
app.post('/api/util/pubkey-to-address', (req, res) => {
    try {
        const { publicKey, testnet } = req.body || {};
        if (!publicKey || typeof publicKey !== 'string') return res.status(400).json({ error: 'publicKey required' });
        const { publicKeyToAddress } = require('./blockchain/crypto');
        const address = publicKeyToAddress(publicKey, !!testnet);
        res.json({ address });
    } catch (e) {
        res.status(400).json({ error: 'invalid public key' });
    }
});

// ── Wallet generate/restore are now FULLY CLIENT-SIDE (public/hd-wallet.js) ──
// SECURITY: a private key / recovery phrase must never travel to or through the
// node. Key generation and mnemonic restore happen entirely in the browser; only
// the PUBLIC key is sent to /api/util/pubkey-to-address. These legacy endpoints
// are therefore retired — they are kept as explicit 410s so any old client fails
// loudly and safely instead of silently sending a phrase to the server.
function walletKeygenGone(req, res) {
    res.status(410).json({
        error: 'This endpoint has been removed. Wallet keys are now generated in your browser and never sent to the server.',
        code: 'CLIENT_SIDE_ONLY',
    });
}
app.post('/api/wallet/generate', walletKeygenGone);
app.post('/api/wallet/restore',  walletKeygenGone);


app.get('/api/address/:addr', (req, res) => {
    if (!V.address(req.params.addr) && !/^SPN[1t][A-Za-z0-9]{25,50}$/.test(req.params.addr))
        return res.status(400).json({ error: 'Invalid SPN address format (expected SPN1... or SPNt...)' });
    const addr    = req.params.addr;
    const balance = blockchain.utxoSet.getBalance(addr);
    const utxos   = blockchain.utxoSet.getUTXOs(addr);
    res.json({
        address:    addr,
        balance:    balance.toString(),
        balanceMYC: (Number(balance) / 1e8).toFixed(8),
        utxoCount:  utxos.length,
        utxos,
    });
});

// Real circulating supply = sum of EVERY unspent output in the UTXO set.
// Computed with BigInt so it stays exact regardless of chain size, and it
// naturally excludes burned/spent coins (unlike a height-based estimate).
app.get('/api/supply', (req, res) => {
    try {
        let totalSat = 0n;
        for (const u of blockchain.utxoSet.utxos.values()) totalSat += BigInt(u.amount);
        const DEC = 100000000n;
        const whole = (totalSat / DEC).toString();
        const frac  = (totalSat % DEC).toString().padStart(8, '0').replace(/0+$/, '');
        const maxSupply = require('./config').BLOCKCHAIN.MAX_SUPPLY || 21000000;
        res.json({
            circulatingSat: totalSat.toString(),          // exact, in satoshis
            circulating:    Number(totalSat) / 1e8,       // safe for the 21M cap
            circulatingStr: frac ? `${whole}.${frac}` : whole,
            maxSupply,
            utxoCount:      blockchain.utxoSet.utxos.size,
            symbol:         COIN.SYMBOL,
        });
    } catch (e) {
        res.status(500).json({ error: 'Could not compute supply' });
    }
});

// Compatibility: legacy wallet lookup (used by dashboard)
app.get('/api/wallet/:addr', (req, res) => {
    const addr    = req.params.addr;
    const balance = blockchain.utxoSet.getBalance(addr);
    const utxos   = blockchain.utxoSet.getUTXOs(addr);
    const txList  = [];
    for (const block of blockchain.chain) {
        for (const tx of block.transactions || []) {
            const involves = (tx.outputs||[]).some(o=>o.address===addr)
                          || (tx.inputs ||[]).some(i=>i.address===addr);
            if (involves) txList.push({ ...tx, blockHash: block.hash, blockTime: block.timestamp });
        }
    }
    res.json({
        address: addr,
        balance: balance.toString(),
        balanceMYC: (Number(balance)/1e8).toFixed(8),
        symbol: COIN.SYMBOL,
        utxoCount: utxos.length,
        utxos,
        transactions: txList.slice(-50),
    });
});

app.get('/api/search/:q', (req, res) => {
    const q = req.params.q.trim();
    if (V.hash(q)) {
        const block = blockchain.getBlock(q);
        if (block) return res.json({ type: 'block', data: block });
        const tx = blockchain.getTransaction(q);
        if (tx) return res.json({ type: 'transaction', data: { ...tx.tx, blockHash: tx.block.hash } });
    }
    if (/^\d{1,10}$/.test(q)) {
        const h = parseInt(q, 10);
        const block = isNaN(h) ? null : blockchain.getBlockByHeight(h);
        if (block) return res.json({ type: 'block', data: block });
    }
    if (V.address(q)) {
        const balance = blockchain.utxoSet.getBalance(q);
        return res.json({ type: 'address', data: { address: q, balance: balance.toString() } });
    }
    // Token lookup — by exact tokenId, or by symbol/name (case-insensitive)
    try {
        const byId = blockchain.tokens.getToken(q);
        if (byId) return res.json({ type: 'token', data: { ...byId, tokenId: q } });
        const all = blockchain.tokens.list();
        const ql = q.toLowerCase();
        const hit = all.find(t => (t.symbol || '').toLowerCase() === ql)
                 || all.find(t => (t.name || '').toLowerCase() === ql)
                 || all.find(t => (t.symbol || '').toLowerCase().includes(ql) || (t.name || '').toLowerCase().includes(ql));
        if (hit) return res.json({ type: 'token', data: hit });
    } catch (e) {}
    res.status(404).json({ error: 'Not found' });
});

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
const authRouter = express.Router();
authRouter.use(limiters.auth.middleware());

// Roles that MUST enroll in two-factor auth. Until they do, login yields only a
// restricted "pending-2FA" token (see middleware/jwt.js) that can reach nothing
// but the 2FA-setup endpoints.
const TWO_FA_REQUIRED_ROLES = ['admin', 'miner', 'viewer', 'trader', 'developer'];

authRouter.post('/login', limiters.login.middleware(), body({ username: V.username, password: V.password }), async (req, res) => {
    const { username, password, totp } = req.body;
    const result = ac.login({ username, password, totp: totp || null, ip: req.ip });
    if (!result.ok) {
        metrics.loginTotal?.inc({ result: 'failed' });
        await log(req, 'login:failed', { reason: result.error });
        const status = result.require2fa ? 200 : 401;
        return res.status(status).json({ error: result.error, require2fa: result.require2fa || false });
    }
    // Admins MUST have 2FA. If an admin has not enrolled yet, issue a token that
    // is restricted to the 2FA-setup endpoints only (no access to admin data)
    // until they finish enabling two-factor authentication.
    const totpOn = ac.getTotpStatus(result.user.id).enabled;
    const pending2fa = TWO_FA_REQUIRED_ROLES.includes(result.user.role) && !totpOn;
    const tokens = createTokens(result.user, { pending2fa });
    metrics.loginTotal?.inc({ result: 'success' });
    await log(Object.assign(Object.create(req), { user: result.user }), 'login');
    res.json({ ...tokens, pending2fa, user: { username: result.user.username, role: result.user.role } });
});

authRouter.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token not provided' });
    try {
        const payload = verifyRefresh(refreshToken);
        const user    = ac.getUserById(payload.sub);
        if (!user) return res.status(401).json({ error: 'User not found' });
        revokeToken(refreshToken);
        // Keep the 2FA gate on refresh: an admin without 2FA still only gets a
        // pending token, so refreshing can't be used to bypass enrollment.
        const totpOn = ac.getTotpStatus(user.id).enabled;
        const pending2fa = TWO_FA_REQUIRED_ROLES.includes(user.role) && !totpOn;
        res.json(createTokens(user, { pending2fa }));
    } catch {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

authRouter.post('/logout', jwtMiddleware(false), async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) { revokeToken(token); ac.logout(token, req.ip); }
    if (req.user) await log(req, 'logout');
    res.json({ ok: true });
});

authRouter.get('/me', jwtMiddleware(), (req, res) => {
    const u = ac.getUserById(req.user.id);
    if (!u) return res.status(401).json({ error: 'User not found' });
    const totp = ac.getTotpStatus(req.user.id);
    res.json({ id: u.id, username: u.username, role: u.role, permissions: u.permissions, totpEnabled: totp.enabled });
});

// ── TOTP / 2FA routes ──────────────────────────────────────────

authRouter.post('/2fa/setup', jwtMiddleware(), (req, res) => {
    const result = ac.setupTotp(req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
});

authRouter.post('/2fa/confirm', jwtMiddleware(), (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'TOTP code is required' });
    const result = ac.confirmTotp(req.user.id, token.toString());
    if (!result.ok) return res.status(400).json(result);
    // 2FA is now enabled — if the caller was on a pending-2FA token, hand back a
    // fresh FULL token so they can access the panel without logging in again.
    let fresh = {};
    if (req.pending2fa) {
        const u = ac.getUserById(req.user.id);
        if (u) fresh = createTokens({ id: u.id, username: u.username, role: u.role });
    }
    res.json({ ...result, ...fresh });
});

authRouter.post('/2fa/disable', jwtMiddleware(), (req, res) => {
    const { token } = req.body;
    const result = ac.disableTotp(req.user.id, (token || '').toString());
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
});

// Regenerate recovery codes (requires a valid current TOTP code).
authRouter.post('/2fa/recovery/regenerate', jwtMiddleware(), (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'TOTP code is required' });
    const result = ac.regenerateRecoveryCodes(req.user.id, token.toString());
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
});

// How many recovery codes remain unused.
authRouter.get('/2fa/recovery/status', jwtMiddleware(), (req, res) => {
    res.json({ remaining: ac.recoveryCodesRemaining(req.user.id) });
});

authRouter.get('/2fa/status', jwtMiddleware(), (req, res) => {
    res.json(ac.getTotpStatus(req.user.id));
});

// ── Change password ────────────────────────────────────────────
authRouter.post('/change-password', jwtMiddleware(), async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
        return res.status(400).json({ error: 'Both oldPassword and newPassword are required' });
    if (newPassword.length < 12)
        return res.status(400).json({ error: 'New password must be at least 12 characters' });
    const u = ac.getUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const test = ac.login({ username: u.username, password: oldPassword, ip: req.ip });
    if (!test.ok) return res.status(400).json({ error: 'Current password is incorrect' });
    const r = ac.updateUser(req.user.id, { password: newPassword });
    if (!r.ok) return res.status(400).json(r);
    await log(req, 'password:changed');
    res.json({ ok: true });
});

app.use('/api/auth', authRouter);

// ══════════════════════════════════════════════════════════════
//  MEMPOOL
// ══════════════════════════════════════════════════════════════
app.get('/api/mempool', auth('view:transactions'), (req, res) => {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    res.json({
        count: mempool.size(),
        bytes: mempool.byteSize?.() || 0,
        txs:   mempool.getTopN(limit),
        stats: mempool.getStats?.(),
    });
});

// ══════════════════════════════════════════════════════════════
//  WALLET & TRANSACTIONS
// ══════════════════════════════════════════════════════════════
app.get('/api/wallet-info', auth('view:wallet'), (req, res) => {
    // Always present the project's canonical address in the Wallet/Send pages.
    const addr = MAIN_ADDRESS || wallet.address || wallet.publicKey;
    const bal  = blockchain.utxoSet.getBalance(addr);
    res.json({
        address:    addr,
        publicKey:  wallet.publicKey,
        balance:    bal.toString(),
        balanceMYC: (Number(bal) / 1e8).toFixed(8),
        symbol:     COIN.SYMBOL,
        spendable:  WALLET_SPENDABLE,   // true only when the node holds MAIN_ADDRESS's key
    });
});

app.post('/api/transact',
    auth('transact:send'),
    limiters.api.middleware(),
    body({ recipient: V.address, amount: V.amount }),
    async (req, res) => {
        const { recipient, amount } = req.body;
        // Refuse to "send" from the displayed address unless the node actually
        // holds its key — otherwise the tx would be signed by a different key.
        if (!WALLET_SPENDABLE) {
            return res.status(409).json({ error: 'This wallet is receive-only on this node. Set NODE_WALLET_KEY to the private key of ' + MAIN_ADDRESS + ' to enable sending.' });
        }
        try {
            const satoshis = BigInt(Math.round(amount * 1e8));
            const tx = wallet.buildTransaction
                ? wallet.buildTransaction({ to: recipient, amount: satoshis, utxoSet: blockchain.utxoSet, feeRate: 10 })
                : wallet.createTransaction({ recipient, amount, chain: blockchain.chain });
            const r = mempool.add(tx, blockchain.utxoSet, blockchain.height + 1);
            if (!r.ok) return res.status(400).json({ error: r.error });
            p2p.broadcastTx?.(tx);
            await log(req, 'transaction:sent', { recipient: recipient.slice(0, 20), amount, txid: tx.id });
            res.json({ ok: true, txid: tx.id, transaction: tx });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    }
);

app.post('/api/broadcast', auth('transact:send'), async (req, res) => {
    try {
        const { tx } = req.body;
        if (!tx || typeof tx !== 'object')
            return res.status(400).json({ error: 'Invalid transaction object' });
        const txObj = Object.assign(new Transaction({}), tx);
        // SECURITY: call the prototype method explicitly so an untrusted `validate`
        // property on the request body cannot shadow the real validator.
        const { valid, errors } = Transaction.prototype.validate.call(
            txObj, blockchain.utxoSet, blockchain.height, {});
        if (!valid) return res.status(400).json({ error: (errors || ['invalid transaction']).join('; ') });
        const r = mempool.add(txObj, blockchain.utxoSet, blockchain.height + 1);
        if (!r.ok) return res.status(400).json({ error: r.error });
        p2p.broadcastTx?.(txObj);
        global.__spnRealtime?.publishTx?.(txObj);
        res.json({ ok: true, txid: txObj.id });
    } catch (e) {
        console.error('[broadcast] error:', e.message);
        return res.status(400).json({ error: 'Invalid transaction' });
    }
});

// ── Submit a locally-signed regular (coin) transaction, no login required ──
// Security here comes from the cryptographic signatures on the tx inputs (like
// Bitcoin), NOT from an account login. The tx is validated against the UTXO set
// and mempool rules; a bad/forged signature fails validation and is rejected.
// Private keys are refused on this path — signing must happen in the browser.
app.post('/api/tx/submit-signed', limiters.api.middleware(), async (req, res) => {
    const { tx } = req.body || {};
    if (!tx || !tx.id || !Array.isArray(tx.inputs) || !Array.isArray(tx.outputs))
        return res.status(400).json({ error: 'a signed tx is required' });
    // hard refusal: never accept a private key on this path
    if (JSON.stringify(req.body).match(/privateKey|private_key|privKey/i))
        return res.status(400).json({ error: 'do not send private keys; sign locally' });
    try {
        const txObj = Object.assign(new Transaction({}), tx);
        const { valid, errors } = txObj.validate
            ? txObj.validate(blockchain.utxoSet, blockchain.height, {})
            : { valid: true, errors: [] };
        if (!valid) return res.status(400).json({ error: (errors || ['invalid signature']).join('; ') });
        const r = mempool.add(txObj, blockchain.utxoSet, blockchain.height + 1);
        if (!r.ok) return res.status(400).json({ error: r.error });
        p2p.broadcastTx?.(txObj);
        global.__spnRealtime?.publishTx?.(txObj);
        await log(req, 'tx:submit-signed', { txid: txObj.id });
        res.json({ ok: true, txid: txObj.id, note: 'pending — confirmed once mined' });
    } catch (e) {
        console.error('[tx submit-signed]', e.message);
        res.status(400).json({ error: 'submit failed' });
    }
});

// ══════════════════════════════════════════════════════════════
//  MINING
// ══════════════════════════════════════════════════════════════
// Global guard: at most ONE server-side (CPU) mining operation at a time. This
// caps the CPU an authenticated miner (or a leaked miner account) can consume —
// concurrent /api/mine calls are rejected instead of each burning a core.
let _mineInProgress = false;
// Bootstrap-mine gate: during the network's bootstrap phase (ALLOW_CPU_MINE=1),
// allow un-authenticated CPU mining ONLY from the local machine (127.0.0.1/::1),
// so the operator can mine the first blocks with a simple local `curl` before
// external miners join. Every remote request still goes through full auth.
function mineGate(req, res, next) {
    const ip    = String(req.ip || '').replace('::ffff:', '');
    const local = ip === '127.0.0.1' || ip === '::1';
    if (process.env.ALLOW_CPU_MINE === '1' && local) return next();
    const mws = auth('mine:blocks');
    let i = 0;
    const run = (err) => { if (err) return next(err); const mw = mws[i++]; return mw ? mw(req, res, run) : next(); };
    run();
}
app.post('/api/mine',
    mineGate,
    limiters.mining.middleware(),
    async (req, res) => {
        // Operators can fully disable API/CPU mining (force Stratum) via env.
        if (process.env.DISABLE_CPU_MINE === '1')
            return res.status(403).json({ error: 'Server-side CPU mining is disabled. Use the Stratum protocol.' });
        // CPU mining is normally refused on a production mainnet (mining should go
        // through Stratum so it isn't centralized on the node). During the network's
        // testing/bootstrap phase an operator can explicitly opt back in by setting
        // ALLOW_CPU_MINE=1 — used to mine the first blocks before miners join.
        if (CHAIN_ID === 1 && process.env.NODE_ENV === 'production' && process.env.ALLOW_CPU_MINE !== '1')
            return res.status(403).json({ error: 'Use Stratum protocol for mainnet mining (set ALLOW_CPU_MINE=1 to bootstrap-mine during testing)' });
        // Reject if a mine is already running — protects the node from CPU exhaustion.
        if (_mineInProgress)
            return res.status(429).json({ error: 'A mining operation is already in progress. Try again shortly.' });
        _mineInProgress = true;
        try {
            const txs = mempool.getTopN(500);
            const r   = blockchain.mineBlock
                ? blockchain.mineBlock({ miner: (req.body && req.body.address) ? String(req.body.address) : (wallet.address || wallet.publicKey), transactions: txs })
                : { ok: false, error: 'mineBlock not available' };
            if (r && r.ok && r.block) txAnomaly.observeBlock(r.block);
            if (!r.ok) return res.status(400).json({ error: r.error });
            mempool.removeConfirmed?.(r.block.transactions);
            p2p.broadcastBlock?.(r.block);
            stratum.broadcastNewJob(true);
            await log(req, 'block:mined', { height: r.block.height, txCount: r.block.transactions.length });
            res.json({ ok: true, block: r.block });
        } catch (e) {
            console.error('[mine] error:', e.message);
            res.status(500).json({ error: 'Internal error while mining' });
        } finally {
            _mineInProgress = false;
        }
    }
);

// ══════════════════════════════════════════════════════════════
//  STRATUM & P2P
// ══════════════════════════════════════════════════════════════
app.get('/api/stratum/stats',     auth('view:miners'), (req, res) => res.json(stratum.getStats()));

// ── IDS/IPS admin API ──────────────────────────────────────────
app.get('/api/security/stats',     auth('view:miners'), (req, res) => res.json(idsIps.stats()));
// ── Transaction anomaly detection (suspicious pattern analysis) ──
app.get('/api/security/anomalies', auth('view:miners'), (req, res) => {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    // Scan current mempool live + return recent recorded events
    let mempoolFlags = [];
    try { mempoolFlags = txAnomaly.scanMempool(mempool); } catch {}
    res.json({
        mempoolFlags,
        recentEvents: txAnomaly.getEvents(limit),
        stats: txAnomaly.getStats(),
    });
});

app.get('/api/security/anomaly-stats', auth('view:miners'), (req, res) =>
    res.json(txAnomaly.getStats()));

app.get('/api/security/events',    auth('view:miners'), (req, res) =>
    res.json({ events: idsIps.getEvents(parseInt(req.query.limit, 10) || 100) }));
app.get('/api/security/blocklist', auth('view:miners'), (req, res) =>
    res.json({ blocked: idsIps.getBlocklist() }));
app.get('/api/security/audit-verify', auth('admin:users'), (req, res) =>
    res.json(verifyAuditLog()));
app.get('/api/security/peers', auth('view:miners'), (req, res) =>
    res.json(p2p && p2p.reputation ? { ...p2p.reputation.stats(), bans: p2p.reputation.getBans() } : { error: 'p2p unavailable' }));

// ── Tokens / assets (issue & transfer your own coins on SPN) ──
const { TokenLayer } = require('./tokens/tokens');

app.get('/api/tokens', (req, res) => res.json({ tokens: blockchain.tokens.list() }));

// Admin: issuance-fee income — who paid the coin/token creation fee, and totals.
app.get('/api/admin/fees', auth('view:logs'), async (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const sym = require('./config').COIN.SYMBOL;
    // Prefer the durable DB ledger (survives restarts); fall back to in-memory.
    try {
        const db = FeeRepo.summary ? await FeeRepo.summary(limit) : null;
        if (db) return res.json({ ...db, treasury: blockchain.tokens.treasury, symbol: sym, source: 'db' });
    } catch (e) { /* fall through to in-memory */ }

    const log = blockchain.tokens.getFeeLog ? blockchain.tokens.getFeeLog(limit) : [];
    let totalSat = 0n;
    for (const r of (blockchain.tokens.feeLog || [])) { try { totalSat += BigInt(r.feeSat); } catch {} }
    res.json({
        payments: log,
        count: (blockchain.tokens.feeLog || []).length,
        totalSat: totalSat.toString(),
        totalSPN: Number(totalSat) / 1e8,
        treasury: blockchain.tokens.treasury,
        symbol: sym,
        source: 'memory',
    });
});
app.get('/api/tokens/fee-info', (req, res) => res.json({
    issuanceFee: blockchain.tokens.issuanceFee.toString(),
    issuanceFeeSPN: Number(blockchain.tokens.issuanceFee) / 1e8,
    coinFee: blockchain.tokens.coinFee.toString(),
    coinFeeSPN: Number(blockchain.tokens.coinFee) / 1e8,
    treasury: blockchain.tokens.treasury,
    burnAddress: blockchain.tokens.burnAddress || '',
    burnBps: Number(blockchain.tokens.burnBps || 0n),
    burnPercent: Number(blockchain.tokens.burnBps || 0n) / 100,
    symbol: (require('./config').COIN.SYMBOL),
}));
// Search must come BEFORE /api/tokens/:id so "search" isn't treated as an id.
app.get('/api/tokens/search', (req, res) => {
    if (!blockchain.tokens.search) return res.json({ tokens: blockchain.tokens.list() });
    res.json({ tokens: blockchain.tokens.search({
        q: req.query.q || '', kind: req.query.kind || 'all',
        sort: req.query.sort || 'holders', limit: Math.min(100, parseInt(req.query.limit) || 50),
    }) });
});
app.get('/api/tokens/:id', (req, res) => {
    // Prefer the rich detail (includes contract identity) when available.
    const t = blockchain.tokens.tokenDetail
        ? blockchain.tokens.tokenDetail(req.params.id)
        : blockchain.tokens.getToken(req.params.id);
    return t ? res.json(jsonSafe(t)) : res.status(404).json({ error: 'token not found' });
});
app.get('/api/tokens/:id/balance/:addr', (req, res) => res.json({
    tokenId: req.params.id, address: req.params.addr,
    balance: blockchain.tokens.balanceOf(req.params.id, req.params.addr),
}));
app.get('/api/tokens/:id/holders', (req, res) => res.json({ holders: blockchain.tokens.holders(req.params.id) }));

// ── Extended token read endpoints (metadata, distribution, search, frozen) ──
app.get('/api/tokens/:id/meta', (req, res) => {
    const m = blockchain.tokens.getMeta ? blockchain.tokens.getMeta(req.params.id) : blockchain.tokens.getToken(req.params.id);
    if (!m) return res.status(404).json({ error: 'no such token' });
    res.json(m);
});
app.get('/api/tokens/:id/distribution', (req, res) => {
    if (!blockchain.tokens.distribution) return res.json({ error: 'unavailable' });
    const d = blockchain.tokens.distribution(req.params.id, Math.min(20, parseInt(req.query.buckets) || 5));
    if (!d) return res.status(404).json({ error: 'no such token' });
    res.json(d);
});
app.get('/api/tokens/:id/frozen/:addr', (req, res) =>
    res.json({ frozen: blockchain.tokens.isFrozen ? blockchain.tokens.isFrozen(req.params.id, req.params.addr) : false }));
app.get('/api/address/:addr/tokens', (req, res) => res.json({ tokens: blockchain.tokens.balancesOf(req.params.addr) }));

// Helper: build + submit a token-carrying tx that pays the issuance fee to the
// treasury, funded from `issuerWallet`.
function submitTokenTx(issuerWallet, op, payFee) {
    const fullFee = (op && op.kind === 'coin') ? blockchain.tokens.coinFee : blockchain.tokens.issuanceFee;
    const feeOut = payFee ? fullFee : 1000n;
    const tx = issuerWallet.createTransaction({
        recipient: blockchain.tokens.treasury || issuerWallet.address,
        amount: feeOut, utxoSet: blockchain.utxoSet, feeRate: 10,
        data: { tokenOps: [op] },
    });
    const r = mempool.add(tx, blockchain.utxoSet, blockchain.height + 1);
    if (!r.ok) throw new Error(r.error);
    p2p.broadcastTx?.(tx);
    return tx;
}

// Public paid creation: ANYONE can create their own token by paying the fee.
// They provide their private key so the node can sign the issue op (issuer =
// ══════════════════════════════════════════════════════════════
//  SECURE (keyless) token endpoints — the private key NEVER leaves
//  the browser. The client signs the op + carrier tx locally
//  (public/token-sign.js) and submits a fully-signed transaction;
//  the server only verifies and relays. These supersede the
//  key-in-body endpoints below, which are now deprecated.
// ══════════════════════════════════════════════════════════════

// 1) Prepare: give the client the coins + fee info needed to build a
//    carrier tx for a token op. No key involved — address only.
app.post('/api/tokens/prepare', limiters.api.middleware(), (req, res) => {
    const { address, payIssuanceFee = false, kind = 'token' } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address is required' });
    try {
        // Coins (fixed supply) cost more than tokens.
        const fullFee = (kind === 'coin') ? blockchain.tokens.coinFee : blockchain.tokens.issuanceFee;
        const feeOut = payIssuanceFee ? fullFee : 1000n;
        const feeRate = 10;
        // Fee split: part BURNED, part to treasury. The client must create BOTH
        // outputs (from feeOutputs) so the token layer accepts the issuance.
        const split = blockchain.tokens.feeSplit(feeOut);
        const feeOutputs = [];
        if (split.treasury > 0n && blockchain.tokens.treasury)
            feeOutputs.push({ address: blockchain.tokens.treasury, amount: split.treasury.toString() });
        if (split.burn > 0n && blockchain.tokens.burnAddress)
            feeOutputs.push({ address: blockchain.tokens.burnAddress, amount: split.burn.toString() });
        if (feeOutputs.length === 0)
            feeOutputs.push({ address: blockchain.tokens.treasury || address, amount: feeOut.toString() });
        // rough coin selection preview for the client (it re-signs locally)
        const balance = BigInt(blockchain.utxoSet.getBalance(address));
        const need = feeOut + 100000n;
        if (balance < need)
            return res.status(400).json({ error: 'insufficient balance for fee' });
        const utxos = (blockchain.utxoSet.getUTXOsForAddress?.(address)
            || blockchain.utxoSet.byAddress?.get?.(address) || []);
        res.json({
            ok: true,
            chainId: CHAIN_ID,
            treasury: blockchain.tokens.treasury || address,
            burnAddress: blockchain.tokens.burnAddress || '',
            feeOut: feeOut.toString(),
            feeOutputs,
            feeRate,
            utxos: [...utxos].map(u => (typeof u === 'string' ? blockchain.utxoSet.utxos.get(u) : u))
                .filter(Boolean)
                .map(u => ({ txid: u.txid, vout: u.vout, amount: String(u.amount) })),
        });
    } catch (e) { res.status(400).json({ error: 'prepare failed' }); }
});

// Anti-spam: per-issuer-address daily issuance limit (rolling 24h, in-memory).
const ISSUE_DAILY_LIMIT = (() => { try { return require('./config').TOKEN.ISSUE_DAILY_LIMIT || 0; } catch { return 0; } })();
const _issueTimes = new Map();   // issuerAddress → [timestamps within 24h]
function _issueRateOk(issuer) {
    if (!ISSUE_DAILY_LIMIT || !issuer) return true;
    const now = Date.now(), DAY = 86400000;
    const arr = (_issueTimes.get(issuer) || []).filter(t => now - t < DAY);
    if (arr.length >= ISSUE_DAILY_LIMIT) { _issueTimes.set(issuer, arr); return false; }
    arr.push(now); _issueTimes.set(issuer, arr);
    return true;
}

// 2) Submit a fully-signed carrier transaction (with the signed token
//    op inside tx.data.tokenOps). Server verifies signatures + relays.
app.post('/api/tokens/submit-signed', limiters.api.middleware(), async (req, res) => {
    const { tx } = req.body || {};
    if (!tx || !tx.id || !Array.isArray(tx.inputs))
        return res.status(400).json({ error: 'a signed tx is required' });
    // hard refusal: never accept a private key on this path
    if (JSON.stringify(req.body).match(/privateKey|private_key|privKey/i))
        return res.status(400).json({ error: 'do not send private keys; sign locally' });
    // Anti-spam: cap how many NEW coins/tokens one address can issue per day.
    const issueOps = (tx.data && Array.isArray(tx.data.tokenOps) ? tx.data.tokenOps : [])
        .filter(o => o && o.type === 'issue');
    for (const op of issueOps) {
        if (!_issueRateOk(op.issuer))
            return res.status(429).json({ error: `daily issuance limit reached (${ISSUE_DAILY_LIMIT} per address per day). Try again later.` });
    }
    try {
        const txObj = Object.assign(new Transaction({}), tx);
        const r = mempool.add(txObj, blockchain.utxoSet, blockchain.height + 1);
        if (!r.ok) return res.status(400).json({ error: r.error });
        p2p.broadcastTx?.(txObj);
        await log(req, 'token:submit-signed', { txid: tx.id, ops: tx.data?.tokenOps?.length || 0 });
        res.json({ ok: true, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token submit-signed]', e.message); res.status(400).json({ error: 'submit failed' }); }
});

// their address) and fund the fee from their coins.
// ⚠️ Send keys only to a node you trust (ideally your own).
app.post('/api/tokens/create', limiters.api.middleware(), async (req, res) => {
    // SECURITY: this legacy path accepts a private key in the body. It is
    // DISABLED by default. Use /api/tokens/prepare + /api/tokens/submit-signed
    // (client-side signing) instead. Set ALLOW_KEY_IN_BODY=1 only for local dev.
    if (process.env.ALLOW_KEY_IN_BODY !== '1' || process.env.NODE_ENV === 'production')
        return res.status(410).json({ error: 'disabled for security — sign locally and use /api/tokens/submit-signed' });
    const { name, symbol, decimals = 0, supply, privateKey, type = 'token', mintable = false } = req.body || {};
    if (!name || !symbol || !supply || !privateKey)
        return res.status(400).json({ error: 'name, symbol, supply and privateKey are required' });
    try {
        const issuer = new Wallet(privateKey);
        const need = blockchain.tokens.issuanceFee + 100000n; // fee + a little for tx fee
        if (BigInt(blockchain.utxoSet.getBalance(issuer.address)) < need)
            return res.status(400).json({ error: `insufficient balance for the ${Number(blockchain.tokens.issuanceFee) / 1e8} SPN issuance fee` });

        const op = TokenLayer.buildIssue({
            name, symbol, decimals, supply: String(supply),
            issuer: issuer.address, issuerPubKey: issuer.publicKey, privateKey: issuer.privateKey,
            type, mintable,
        });
        const tx = submitTokenTx(issuer, op, true);
        await log(req, 'token:create', { symbol, kind: op.kind, tokenId: op.tokenId, issuer: issuer.address.slice(0, 16) });
        res.json({ ok: true, tokenId: op.tokenId, kind: op.kind, mintable: op.mintable, issuer: issuer.address, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token create]', e.message); res.status(400).json({ error: 'creation failed: ' + (e.message === 'insufficient funds' ? 'insufficient funds' : 'invalid request') }); }
});

// Transfer tokens using the owner's own key (for the self-service manage page).
// name/symbol/supply are never touched here — only balances move.
app.post('/api/tokens/send', limiters.api.middleware(), async (req, res) => {
    if (process.env.ALLOW_KEY_IN_BODY !== '1' || process.env.NODE_ENV === 'production')
        return res.status(410).json({ error: 'disabled for security — sign locally and use /api/tokens/submit-signed' });
    const { tokenId, to, amount, privateKey } = req.body || {};
    if (!tokenId || !to || !amount || !privateKey)
        return res.status(400).json({ error: 'tokenId, to, amount and privateKey are required' });
    try {
        const owner = new Wallet(privateKey);
        const bal = BigInt(blockchain.tokens.balanceOf(tokenId, owner.address));
        if (bal < BigInt(amount)) return res.status(400).json({ error: 'insufficient token balance' });
        const op = TokenLayer.buildTransfer({
            tokenId, from: owner.address, to, amount: String(amount),
            fromPubKey: owner.publicKey, privateKey: owner.privateKey,
        });
        const tx = submitTokenTx(owner, op, false);
        await log(req, 'token:send', { tokenId, to: to.slice(0, 20), amount });
        res.json({ ok: true, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token send]', e.message); res.status(400).json({ error: 'transfer failed' }); }
});

// Mint additional supply of a mintable token (issuer only, funded by their key).
app.post('/api/tokens/mint', limiters.api.middleware(), async (req, res) => {
    if (process.env.ALLOW_KEY_IN_BODY !== '1' || process.env.NODE_ENV === 'production')
        return res.status(410).json({ error: 'disabled for security — sign locally and use /api/tokens/submit-signed' });
    const { tokenId, amount, privateKey } = req.body || {};
    if (!tokenId || !amount || !privateKey)
        return res.status(400).json({ error: 'tokenId, amount and privateKey are required' });
    try {
        const issuer = new Wallet(privateKey);
        const token = blockchain.tokens.getToken(tokenId);
        if (!token) return res.status(404).json({ error: 'no such token' });
        if (!token.mintable) return res.status(400).json({ error: 'this asset is a coin / fixed supply and cannot be minted' });
        if (token.issuer !== issuer.address) return res.status(403).json({ error: 'only the issuer can mint' });
        const op = TokenLayer.buildMint({ tokenId, amount: String(amount), issuer: issuer.address, issuerPubKey: issuer.publicKey, privateKey: issuer.privateKey });
        const tx = submitTokenTx(issuer, op, false);
        await log(req, 'token:mint', { tokenId, amount });
        res.json({ ok: true, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token mint]', e.message); res.status(400).json({ error: 'mint failed' }); }
});

// Issue with the node wallet (operator convenience, still pays the fee to treasury).
app.post('/api/tokens/issue', auth('transact:send'), limiters.api.middleware(), async (req, res) => {
    const { name, symbol, decimals = 0, supply } = req.body || {};
    if (!name || !symbol || !supply) return res.status(400).json({ error: 'name, symbol and supply are required' });
    try {
        const op = TokenLayer.buildIssue({
            name, symbol, decimals, supply: String(supply),
            issuer: wallet.address, issuerPubKey: wallet.publicKey, privateKey: wallet.privateKey,
        });
        const tx = submitTokenTx(wallet, op, true);
        await log(req, 'token:issue', { symbol, tokenId: op.tokenId });
        res.json({ ok: true, tokenId: op.tokenId, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token issue]', e.message); res.status(400).json({ error: 'issue failed' }); }
});

// Transfer tokens from the node wallet to another address.
app.post('/api/tokens/transfer', auth('transact:send'), limiters.api.middleware(), async (req, res) => {
    const { tokenId, to, amount } = req.body || {};
    if (!tokenId || !to || !amount) return res.status(400).json({ error: 'tokenId, to and amount are required' });
    try {
        const op = TokenLayer.buildTransfer({
            tokenId, from: wallet.address, to, amount: String(amount),
            fromPubKey: wallet.publicKey, privateKey: wallet.privateKey,
        });
        const tx = submitTokenTx(wallet, op, false);
        await log(req, 'token:transfer', { tokenId, to: to.slice(0, 20), amount });
        res.json({ ok: true, txid: tx.id, note: 'pending — confirmed once mined' });
    } catch (e) { console.error('[token transfer]', e.message); res.status(400).json({ error: 'transfer failed' }); }
});
app.post('/api/security/block',    auth('admin:users'), async (req, res) => {
    const { ip, minutes, reason } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required' });
    const r = idsIps.ban(ip, reason || 'manual', minutes ? minutes * 60 * 1000 : null);
    if (!r) return res.status(400).json({ error: 'IP is whitelisted' });
    await log(req, 'security:block', { ip, reason });
    res.json({ ok: true, ...r });
});
app.delete('/api/security/block/:ip', auth('admin:users'), async (req, res) => {
    const removed = idsIps.unban(req.params.ip);
    await log(req, 'security:unblock', { ip: req.params.ip });
    res.json({ ok: true, removed });
});
app.get('/api/stratum/banlist',   auth('mine:blocks'), (req, res) => res.json(stratum.getBanList()));
app.delete('/api/stratum/ban/:ip', auth('admin:users'), (req, res) => {
    stratum.unban(req.params.ip); res.json({ ok: true });
});
app.post('/api/stratum/new-job',  auth('mine:blocks'), (req, res) => {
    stratum.broadcastNewJob(true); res.json({ ok: true });
});

app.get('/api/peers', auth('view:dashboard'), (req, res) =>
    res.json({ count: p2p.peerCount(), peers: p2p.getPeers?.() || [] })
);
app.post('/api/peers/connect', auth('admin:users'), (req, res) => {
    const { host, port } = req.body;
    if (!host || !port) return res.status(400).json({ error: 'host and port are required' });
    // SECURITY: validate host/port to avoid pointing the node at arbitrary
    // internal services (SSRF/pivot) via a crafted connect request.
    const hostOk = typeof host === 'string' && /^[A-Za-z0-9.\-]{1,253}$/.test(host);
    const p = parseInt(port, 10);
    if (!hostOk || !(p > 0 && p < 65536))
        return res.status(400).json({ error: 'invalid host or port' });
    p2p.connectToPeer?.(`ws://${host}:${p}`);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  KYC
// ══════════════════════════════════════════════════════════════
app.get('/api/kyc/status', auth('view:wallet'), async (req, res) => {
    try {
        res.json({ status: await KYC.getStatus(req.user.id), limits: await KYC.getLimits(req.user.id) });
    } catch { res.json({ status: null, limits: null }); }
});
app.post('/api/kyc/submit', auth('view:wallet'), async (req, res) => {
    try {
        const r = await KYC.submit(req.user.id, req.body);
        res.json({ ok: true, id: r.id });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/users',        auth('admin:users'), (req, res) => res.json(ac.getUsers()));

app.post('/api/admin/users',       auth('admin:users'),
    body({ username: V.username, password: V.password }),
    async (req, res) => {
        const r = ac.createUser(req.body, req.user.username);
        if (!r.ok) return res.status(400).json({ error: r.error });
        await log(req, 'user:created', { target: req.body.username });
        res.json(r);
    }
);

app.put('/api/admin/users/:id',    auth('admin:users'), (req, res) =>
    res.json(ac.updateUser(req.params.id, req.body, req.user.username))
);

app.delete('/api/admin/users/:id', auth('admin:users'), async (req, res) => {
    const r = ac.deleteUser(req.params.id, req.user.username);
    if (r.ok) await log(req, 'user:deleted', { targetId: req.params.id });
    res.json(r);
});

app.get('/api/admin/apikeys',          auth('admin:apikeys'), (req, res) => res.json(ac.getApiKeys()));
app.post('/api/admin/apikeys', auth('admin:apikeys'), (req, res) => {
    const keyName = String(req.body.name || '').trim().slice(0, 64).replace(/[<>"'&]/g, '');
    const keyRole = ['viewer','miner','apikey'].includes(req.body.role) ? req.body.role : 'apikey';
    res.json(ac.createApiKey({ name: keyName, role: keyRole }, req.user.username));
});
app.delete('/api/admin/apikeys/:id',   auth('admin:apikeys'), (req, res) =>
    res.json(ac.revokeApiKey(req.params.id, req.user.username))
);

app.get('/api/admin/logs', auth('admin:logs'), async (req, res) => {
    try {
        const { limit = 200, username, action, role } = req.query;
        const logs = await LogRepo.list({
            username, action, role, limit: Math.min(+limit, 1000),
        }).catch(() => ac.getLogs(+limit, { username, action, role }));
        res.json(logs);
    } catch (e) { console.error('[logs] error:', e.message); res.status(500).json({ error: 'Internal error' }); }
});

app.get('/api/admin/kyc/pending',       auth('admin:users'), async (req, res) => {
    try { res.json(await KYC.getPending()); } catch { res.json([]); }
});
app.put('/api/admin/kyc/:id/review',    auth('admin:users'), async (req, res) => {
    try {
        const reason = String(req.body.reason || '').slice(0, 500).replace(/[<>"']/g, '');
        const r = await KYC.review(req.params.id, req.user.id, !!req.body.approved, reason);
        res.json({ ok: true, result: r });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/admin/ddos/stats',        auth('admin:users'), (req, res) => res.json(ddos.getStats()));
app.post('/api/admin/ddos/block',       auth('admin:users'), (req, res) => {
    if (!V.ip(req.body.ip)) return res.status(400).json({ error: 'Invalid IP address' });
    ddos.blockIP(req.body.ip, req.body.duration);
    res.json({ ok: true });
});
app.delete('/api/admin/ddos/block/:ip', auth('admin:users'), (req, res) => {
    ddos.unblockIP(req.params.ip); res.json({ ok: true });
});

app.get('/api/admin/chain/validate',    auth('admin:users'), (req, res) => {
    const result = blockchain.validateChain();
    res.json({ ...result, checkedAt: new Date().toISOString() });
});

app.get('/api/admin/mempool/stats',     auth('admin:users'), (req, res) =>
    res.json(mempool.getStats?.() || { count: mempool.size() })
);

// ══════════════════════════════════════════════════════════════
//  🤖 AI ASSISTANT — Claude (Anthropic Free Tier)
//  Provides blockchain intelligence: tx analysis, mining help,
//  address lookup explanations, and general SPN Coin Q&A.
// ══════════════════════════════════════════════════════════════

// Inline context builder — injects live blockchain data into AI prompt
function buildBlockchainContext() {
    const stats = blockchain.getStats();
    const tip   = blockchain.tip;
    return `You are SPN Coin AI — an expert assistant for the SPN Coin blockchain.
Current network status:
- Chain height: ${stats.height} blocks
- Network: ${stats.networkType}
- Current difficulty: ${stats.difficulty}
- UTXO set size: ${stats.utxoCount} outputs
- Latest block hash: ${tip.hash.slice(0, 16)}...
- Mining reward: ${Number(stats.miningReward || 0) / 1e8} SPN per block
- Halvings so far: ${stats.halvings || 0}
- Mempool: ${mempool.size()} pending transactions
- Connected peers: ${p2p.peerCount()}

You help users with: transaction questions, wallet addresses (SPN1.../SPNt...), 
mining, block explorer queries, security, and general blockchain concepts.
Keep answers concise and technical. Do NOT provide financial advice.
Always answer in the same language the user writes in.`;
}

app.post('/api/ai/chat',
    // Public endpoint (no login) so the floating assistant works for everyone.
    // Protected by aiRateLimit (default 20 req/min per IP) + input caps below,
    // so it can't be abused to run up API costs.
    aiRateLimit,
    async (req, res) => {
        // Check API key configured
        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(503).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in .env' });
        }

        const { message, history = [] } = req.body;
        if (!message || typeof message !== 'string' || message.length > 2000) {
            return res.status(400).json({ error: 'Invalid message (max 2000 chars)' });
        }

        // Prompt injection sanitization — strip control sequences and system prompt override attempts
        const sanitizedMsg = message
            .replace(/\x00-\x08\x0b\x0c\x0e-\x1f/g, '')     // control chars
            .replace(/ignore (all |previous |above |prior )?instructions?/gi, '[filtered]')
            .replace(/system prompt/gi, '[filtered]')
            .replace(/you are now/gi, '[filtered]')
            .slice(0, 2000);

        try {
            const systemPrompt = buildBlockchainContext();

            // Build message history (max last 10 turns)
            const messages = [
                ...history.slice(-10).map(m => ({
                    role:    m.role === 'user' ? 'user' : 'assistant',
                    content: String(m.content).slice(0, 1000)
                })),
                { role: 'user', content: sanitizedMsg }
            ];

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method:  'POST',
                headers: {
                    'Content-Type':      'application/json',
                    'x-api-key':         process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model:      'claude-haiku-4-5-20251001',
                    max_tokens:  1024,
                    system:      systemPrompt,
                    messages,
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    return res.status(429).json({ error: 'AI service temporarily busy. Please try again in a moment.' });
                }
                console.error('[AI] Anthropic error:', response.status, err);
                return res.status(503).json({ error: 'AI service unavailable.' });
            }

            const data  = await response.json();
            const reply = data.content?.[0]?.text || 'No response generated.';

            await log(req, 'ai:chat', { messageLen: sanitizedMsg.length });
            res.json({ reply, model: 'claude-haiku', tokensUsed: data.usage?.output_tokens || 0 });

        } catch (e) {
            console.error('[AI] Error:', e.message);
            console.error('[ai] upstream error:', e.message);
            res.status(503).json({ error: 'AI service unavailable' });
        }
    }
);

app.get('/api/ai/status', auth('view:dashboard'), (req, res) => {
    res.json({
        available:   true,
        model:       'claude-haiku-4-5-20251001',
        provider:    'Anthropic',
        rateLimit:   '20 requests/min per user',
        contextInfo: 'Live blockchain data injected automatically',
    });
});

// ── Security threat reporting ─────────────────────────────────
// ── Server connection info (admin only) ──────────────────────
app.get('/api/admin/server-info', auth('admin:users'), (req, res) => {
    const si = stratum.getStats();
    res.json({
        nodeVersion:    process.version,
        platform:       process.platform,
        uptime:         Math.floor(process.uptime()),
        memoryMB:       Math.round(process.memoryUsage().rss / 1024 / 1024),
        httpPort:       HTTP_PORT,
        stratumPath:    '/stratum',
        stratumPort:    process.env.STRATUM_PORT || '(same as HTTP)',
        p2pMode:        'HTTP (PEER_URLS)',
        peers:          p2p.getPeers?.() || [],
        peersCount:     p2p.peerCount(),
        stratumMiners:  si.connected,
        dbConnected:    !!dbPool,
        chainId:        CHAIN_ID,
        network:        CHAIN_ID === 1 ? 'mainnet' : 'testnet',
        chainHeight:    blockchain.height,
        environment:    process.env.NODE_ENV || 'development',
    });
});

app.get('/api/admin/security/threats', auth('admin:users'), (req, res) => {
    res.json({
        topThreats:   threatScorer.getAll(),
        anomalyStats: anomalyDetect.getStats(),
        sessions:     sessionBinder.sessions.size,
        checkedAt:    new Date().toISOString(),
    });
});

app.delete('/api/admin/security/threats/:ip', auth('admin:users'), (req, res) => {
    threatScorer.reset(req.params.ip);
    res.json({ ok: true, message: 'Threat score reset for ' + req.params.ip });
});

// ── New capabilities: token extensions, monitoring, extra admin tools ──────────
// Opt-out with FEATURES=0. Defensive — any group that can't attach is skipped.
if (process.env.FEATURES !== '0') {
    try {
        const { installFeatures } = require('./monitor/features');
        const featureCtx = installFeatures({ app, blockchain, mempool, p2p, auth, ac, idsIps });
        global.__monitor = featureCtx.monitor; // for graceful shutdown
    } catch (e) {
        console.warn('[features] not loaded:', e.message);
    }
}

// ── Error handlers ─────────────────────────────────────────────────────────────
app.use('/api/*splat', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large')
        return res.status(413).json({ error: 'Payload too large' });
    const isDev = process.env.NODE_ENV !== 'production';
    console.error('❌ [Server Error]', err.message, isDev ? err.stack : '');
    res.status(500).json({
        error: 'Internal server error',
        ...(isDev && { detail: err.message })
    });
});

// ══════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════
const HTTP_PORT    = NETWORK.HTTP_PORT;

async function start() {
    try { await initDB(); }
    catch (e) { console.warn('⚠️  [DB] Database unavailable, using in-memory storage:', e.message); }

    bindBlockchain(blockchain, mempool, stratum);
    // Persist chain to PostgreSQL (if DATABASE_URL is set)
    // Falls back to in-memory silently if DATABASE_URL is not configured
    await bindDB(blockchain).catch(e =>
        console.warn('⚠️  [DB] Chain persistence disabled (no DATABASE_URL):', e.message)
    );

    // Register P2P HTTP routes (/api/p2p/message, /api/p2p/status, /api/p2p/peers)
    p2p.registerRoutes(app, auth);

    const { createServers } = require('./middleware/tls');
    const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || HTTP_PORT;
    const { server, protocol, redirector, certSource } =
        createServers(app, { httpPort: HTTP_PORT, httpsPort: HTTPS_PORT });
    const listenPort = protocol === 'https' ? HTTPS_PORT : HTTP_PORT;
    const scheme = protocol; // 'http' or 'https'
    const wsScheme = protocol === 'https' ? 'wss' : 'ws';

    // Real-time WebSocket feed for live UI updates (block/tx/mempool).
    let realtime = null;
    try {
        const { attachRealtime } = require('./p2p/realtime');
        realtime = attachRealtime(server, {
            blockchain, mempool,
            webhooks: global.__spnRTBus,
            network: CHAIN_ID === 1 ? 'mainnet' : 'testnet',
        });
        global.__spnRealtime = realtime; // so tx routes can publish pending txs
    } catch (e) {
        console.warn('[WS] real-time feed unavailable:', e.message);
    }

    server.listen(listenPort, () => {
        const network = CHAIN_ID === 1 ? 'mainnet' : 'testnet';
        const tlsNote = protocol === 'https'
            ? `TLS: ${certSource === 'self-signed' ? 'self-signed (dev)' : 'certificate'}`
            : 'TLS: off (http / proxy)';
        console.log(`
╔══════════════════════════════════════════════╗
║   🚀  ${COIN.NAME} (${COIN.SYMBOL}) Full Node v${COIN.VERSION}        ║
╠══════════════════════════════════════════════╣
║   🌐  API       : ${scheme}://localhost:${listenPort}
║   ⛏️   Stratum  : ${wsScheme}://localhost:${listenPort}/stratum
║   🔗  P2P       : http (PEER_URLS env var)
║   🌍  Network   : ${network}
║   🔒  ${tlsNote}
║   🔍  Explorer  : ${scheme}://localhost:${listenPort}/explorer
║   🔐  Admin     : ${scheme}://localhost:${listenPort}/admin
╚══════════════════════════════════════════════╝
        `.trim());
    });

    // companion http→https redirector (when TLS is terminated here)
    if (redirector) {
        redirector.listen(HTTP_PORT, () => {
            console.log(`🔀 [TLS] HTTP :${HTTP_PORT} → HTTPS :${HTTPS_PORT} redirect active`);
        });
    }

    // TCP servers (Stratum/P2P) are not supported on serverless platforms
    if (process.env.VERCEL || process.env.SERVERLESS) {
        console.log('⚠️  [Vercel] Stratum and P2P disabled (serverless environment)');
        console.log('   For production mining, deploy on a dedicated server.');
    } else {
        // P2P over HTTP — no TCP port needed
    // Peers are discovered via PEER_URLS environment variable
    p2p.listen();
        // The Stratum pool now builds its work from Block.canonicalHeader() — the
        // SAME header the consensus core hashes — and every found block is
        // re-validated by addBlock() before it can enter the chain. So a block the
        // pool produces can never be invalid: worst case is it's rejected and no
        // one is paid, never that a bad block enters. It is still OFF by default
        // (enable with ENABLE_STRATUM_POOL=true) because real-world miner-client
        // wire interop hasn't been field-proven yet.
        if (process.env.ENABLE_STRATUM_POOL === 'true') {
            if (process.env.NODE_ENV === 'production') {
                console.warn('⚠️  [Stratum] Pool enabled in PRODUCTION. Header is consensus-unified and every block is re-validated before acceptance, but miner-client wire interop is not yet field-proven — monitor closely.');
            } else {
                console.warn('⚠️  [Stratum] Pool enabled (consensus-unified header; blocks re-validated on submit).');
            }
            // Attach Stratum WebSocket to the same HTTP server path (/stratum)
            // Miners connect via:  ws://YOUR_HOST/stratum
            stratum.attachTo(server, '/stratum');
            // Also open a dedicated WS port for miners that need port 3333
            if (process.env.STRATUM_PORT && parseInt(process.env.STRATUM_PORT) !== HTTP_PORT) {
                stratum.startExtra(parseInt(process.env.STRATUM_PORT));
            }
        } else {
            console.log('ℹ️  [Stratum] pool disabled (set ENABLE_STRATUM_POOL=true to enable the experimental pool).');
        }

        // ── Standard Bitcoin Stratum (ASIC-compatible) — Phase 2/3 ──────
        // A real ckpool/cpuminer-style TCP server so a SHA-256 ASIC (Whatsminer,
        // Antminer, …) can connect. OFF by default; enable with ENABLE_ASIC_STRATUM=1.
        // IMPORTANT: the blocks it produces are Bitcoin-BINARY, so they are only
        // ACCEPTED once the chain runs full binary consensus (Block.BINARY_HEADER=1
        // AND binary txid/merkle + a fresh binary genesis — Phase 4). Until then
        // this serves the wire protocol (shares work) for real-ASIC interop testing.
        if (process.env.ENABLE_ASIC_STRATUM === '1') {
            const asicPort = parseInt(process.env.ASIC_STRATUM_PORT, 10) || 3333;
            const asicStratum = new StratumBtcServer({
                blockchain, mempool, port: asicPort,
                poolAddress: process.env.POOL_ADDRESS || (wallet && wallet.address) || '',
            });
            asicStratum.on('listening', (p) => console.warn(
                `⚠️  [ASIC-Stratum] Standard Bitcoin Stratum on tcp://0.0.0.0:${p} — EXPERIMENTAL. ` +
                (Block.BINARY_HEADER
                    ? 'Binary mode ON.'
                    : 'Binary mode OFF: shares work but blocks are NOT accepted until full binary consensus (Phase 4).')));
            asicStratum.on('share', (s) =>
                console.log(`  [ASIC-Stratum] share ${s.hash.slice(0, 12)} diff=${s.difficulty} ← ${String(s.address).slice(0, 16)}`));
            asicStratum.on('block', (b) => {
                console.log(`🎉 [ASIC-Stratum] block candidate ${b.hash.slice(0, 16)} ← ${String(b.address).slice(0, 16)}`);
                global.__spnRTBus?.emit?.('asic-block', { hash: b.hash, address: b.address });
                // NOTE: turning this candidate into an accepted chain block requires
                // binary-consensus (Phase 4). Wired here so the hook is ready.
            });
            asicStratum.start();
        }
    }

    // Connect to seed peers from environment
    const peers = (process.env.PEERS || '').split(',').filter(Boolean);
    peers.forEach(peer =>
        setTimeout(() => {
            // p2p-http expects full URLs (http:// or https://)
            const url = peer.startsWith('http') ? peer : `http://${peer}`;
            p2p.connectToPeer?.(url);
        }, 3000)
    );

    // Graceful shutdown
    const shutdown = (signal) => {
        console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
        try { if (global.__monitor?.timer) clearInterval(global.__monitor.timer); } catch { /* ignore */ }
        server.close(() => {
            p2p.close?.();
            dbPool?.end().catch(() => {});
            console.log('✅ Server closed.');
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // Don't let a stray rejection/exception silently corrupt node state.
    process.on('unhandledRejection', (reason) => {
        console.error('⚠️  Unhandled promise rejection:', reason && reason.message ? reason.message : reason);
    });
    process.on('uncaughtException', (err) => {
        console.error('💥 Uncaught exception:', err && err.stack ? err.stack : err);
        // Fatal: shut down cleanly rather than run in an undefined state.
        try { shutdown('uncaughtException'); } catch { process.exit(1); }
    });
}

start().catch(err => {
    console.error('❌ Startup failed:', err);
    process.exit(1);
});

// Vercel serverless export
module.exports = app;
module.exports.default = app;
