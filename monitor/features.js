/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  features.js — Wire the new capabilities into a running node:
 *    • Token extensions   (burn / freeze / owner / meta / search / dist)
 *    • Monitoring         (health, live metric series, alerts)
 *    • Extra admin tools  (node control, peer/ban mgmt, exports)
 *
 *  Called once from server.js with the live objects + an `auth`
 *  middleware factory. Every route is defensive and additive.
 */

'use strict';

const { extendTokenLayer } = require('../tokens/token-extensions');
const { installAirdrops } = require('../tokens/airdrop');
const { installVestingStaking } = require('../tokens/vesting-staking');
const { installTokenStats } = require('../tokens/token-stats');
const { AddressBook, WebhookRegistry, ApiKeyStore, filterTxHistory } = require('./user-features');
const { SystemHealth, MetricSeries, AlertEngine, defaultRules } = require('./monitor');

function installFeatures({ app, blockchain, mempool, p2p, auth, log = console.log,
                           ac = null, idsIps = null } = {}) {
    const report = { tokenExt: false, monitoring: false, admin: false };
    const noAuth = () => (req, res, next) => next();
    const guard = typeof auth === 'function' ? auth : noAuth;

    // ── 1. Token extensions ───────────────────────────────────
    if (blockchain?.tokens) {
        try {
            extendTokenLayer(blockchain.tokens);
            installAirdrops(blockchain.tokens);
            installVestingStaking(blockchain.tokens);
            installTokenStats(blockchain.tokens);
            const T = blockchain.tokens;

            // keep the token layer aware of the current height for vesting/staking reads
            const syncHeight = () => { try { T.currentHeight = blockchain.height ?? (blockchain.chain?.length ?? 1) - 1; } catch {} };
            syncHeight();

            // ── explorer: rankings, holders, token detail, global stats ──
            app.get('/api/tokens/top', (req, res) => res.json({ tokens: T.topTokens?.({ by: req.query.by || 'holders', limit: parseInt(req.query.limit, 10) || 20 }) || [] }));
            app.get('/api/tokens/:id/holders', (req, res) => {
                const h = T.topHolders?.(req.params.id, parseInt(req.query.limit, 10) || 20);
                return h ? res.json(h) : res.status(404).json({ error: 'no such token' });
            });
            app.get('/api/tokens/:id/detail', (req, res) => {
                syncHeight();
                const d = T.tokenDetail?.(req.params.id);
                return d ? res.json(d) : res.status(404).json({ error: 'no such token' });
            });
            app.get('/api/tokens/stats/global', (req, res) => res.json(T.globalStats?.() || {}));

            // ── vesting / staking reads ──
            app.get('/api/vesting/:id', (req, res) => { syncHeight(); const v = T.getVesting?.(req.params.id, T.currentHeight); return v ? res.json(v) : res.status(404).json({ error: 'no such vesting' }); });
            app.get('/api/vesting/by/:address', (req, res) => { syncHeight(); res.json({ vestings: T.listVestings?.(req.params.address) || [] }); });
            app.get('/api/staking/:id', (req, res) => { const s = T.getStake?.(req.params.id); return s ? res.json(s) : res.status(404).json({ error: 'no such stake' }); });
            app.get('/api/staking/by/:address', (req, res) => res.json({ stakes: T.listStakes?.(req.params.address) || [] }));
            app.get('/api/staking/:tokenId/pool', (req, res) => { const p = T.getRewardPool?.(req.params.tokenId); return p ? res.json(p) : res.status(404).json({ error: 'no reward pool' }); });

            // airdrop read endpoints (claim/create happen via signed ops
            // through /api/tokens/submit-signed, like all other token ops)
            app.get('/api/tokens/:id/airdrops', (req, res) => {
                res.json({ airdrops: T.listAirdrops?.(req.params.id) || [] });
            });
            app.get('/api/airdrops/:airdropId', (req, res) => {
                const d = T.getAirdrop?.(req.params.airdropId);
                return d ? res.json(d) : res.status(404).json({ error: 'no such airdrop' });
            });
            app.get('/api/airdrops/:airdropId/claimed/:address', (req, res) => {
                res.json({ claimed: !!T.hasClaimed?.(req.params.airdropId, req.params.address) });
            });

            // Issuer publishes the full recipient list (validated against the
            // on-chain merkle root) so eligible users can fetch their proof.
            app.post('/api/airdrops/:airdropId/publish', (req, res) => {
                const { leaves } = req.body || {};
                if (!Array.isArray(leaves)) return res.status(400).json({ error: 'leaves array required' });
                if (leaves.length > 100000) return res.status(400).json({ error: 'list too large' });
                const r = T.registerAirdropList?.(req.params.airdropId, leaves);
                return r?.ok ? res.json(r) : res.status(400).json(r || { error: 'publish failed' });
            });

            // Eligible user fetches their merkle proof + amount to claim.
            app.get('/api/airdrops/:airdropId/proof/:address', (req, res) => {
                const r = T.getAirdropProof?.(req.params.airdropId, req.params.address);
                return r?.ok ? res.json(r) : res.status(404).json(r || { error: 'not found' });
            });

            // read APIs (public)
            app.get('/api/tokens/:id/meta', (req, res) => {
                const m = T.getMeta?.(req.params.id);
                return m ? res.json(m) : res.status(404).json({ error: 'no such token' });
            });
            app.get('/api/tokens/:id/distribution', (req, res) => {
                const d = T.distribution?.(req.params.id, parseInt(req.query.buckets, 10) || 5);
                return d ? res.json(d) : res.status(404).json({ error: 'no such token' });
            });
            app.get('/api/tokens/search', (req, res) => {
                res.json({ tokens: T.search?.({
                    q: req.query.q || '', kind: req.query.kind || 'all',
                    sort: req.query.sort || 'holders', limit: parseInt(req.query.limit, 10) || 50,
                }) || [] });
            });

            // Utility: derive an address from a public key (no private key).
            // Used by the in-browser vanity generator.
            const { publicKeyToAddress } = require('../blockchain/crypto');
            app.post('/api/util/pubkey-to-address', (req, res) => {
                const { publicKey } = req.body || {};
                if (!publicKey) return res.status(400).json({ error: 'publicKey required' });
                try { res.json({ address: publicKeyToAddress(publicKey) }); }
                catch { res.status(400).json({ error: 'invalid public key' }); }
            });

            // Dedicated on-chain address for a coin (deterministic).
            const { deriveCoinAddress, generateVanity, vanityDifficulty } = require('../tokens/coin-address');
            app.get('/api/tokens/:id/address', (req, res) => {
                const meta = T.getMeta?.(req.params.id);
                if (!meta) return res.status(404).json({ error: 'no such token' });
                const derived = deriveCoinAddress(req.params.id, meta.issuer);
                res.json({ tokenId: req.params.id,
                    coinAddress: meta.extra?.coinAddress || derived.address,
                    spendable: false });
            });

            // Vanity address generator (grinds a fresh keypair; key returned
            // to the caller, never stored). Bounded so it can't hang.
            app.post('/api/address/vanity', (req, res) => {
                const { prefix = '', contains = '', caseSensitive = false } = req.body || {};
                if (!prefix && !contains) return res.status(400).json({ error: 'prefix or contains required' });
                if ((prefix + contains).length > 4)
                    return res.status(400).json({ error: 'pattern too long (max 4 chars) — would take too long', difficulty: vanityDifficulty(prefix + contains) });
                const result = generateVanity({ prefix, contains, caseSensitive, maxAttempts: 300000, timeoutMs: 9000 });
                if (!result.found) return res.status(408).json({ ok: false, attempts: result.attempts, error: 'not found within limit — try a shorter pattern' });
                // SECURITY: the private key is generated here and returned once.
                res.json({ ok: true, attempts: result.attempts, address: result.address,
                    publicKey: result.publicKey, privateKey: result.privateKey,
                    warning: 'Store this private key securely. It is not saved by the node.' });
            });

            // signed ext-op submission (client signs; server relays inside a tx)
            // reuses the existing /api/tokens/submit-signed path — nothing to add,
            // because applyTx already routes any op through the extended applyOp.
            report.tokenExt = true;
        } catch (e) { log('[features] token-ext skipped:', e.message); }
    }

    // ── 1b. User features: address book, webhooks, API keys, tx history ──
    try {
        const addressBook = new AddressBook();
        const webhooks = new WebhookRegistry();
        const apiKeys = new ApiKeyStore();
        // expose for other parts (e.g. emit on new block)
        global.__spnWebhooks = webhooks;

        // address book (owner passed explicitly; public data only)
        app.get('/api/addressbook/:owner', (req, res) => res.json({ entries: addressBook.list(req.params.owner) }));
        app.post('/api/addressbook/:owner', (req, res) => {
            const { address, label, note } = req.body || {};
            const r = addressBook.add(req.params.owner, address, label, note);
            return r.ok ? res.json(r) : res.status(400).json(r);
        });
        app.delete('/api/addressbook/:owner/:address', (req, res) => res.json(addressBook.remove(req.params.owner, req.params.address)));

        // webhooks
        app.get('/api/webhooks', guard('admin:users'), (req, res) => res.json({ hooks: webhooks.list() }));
        app.post('/api/webhooks', guard('admin:users'), (req, res) => {
            const r = webhooks.register(req.body || {});
            return r.ok ? res.json(r) : res.status(400).json(r);
        });
        app.delete('/api/webhooks/:id', guard('admin:users'), (req, res) => res.json(webhooks.remove(req.params.id)));

        // developer API keys
        app.get('/api/apikeys', guard('admin:users'), (req, res) => res.json({ keys: apiKeys.list() }));
        app.post('/api/apikeys', guard('admin:users'), (req, res) => res.json(apiKeys.issue(req.body || {})));
        app.delete('/api/apikeys', guard('admin:users'), (req, res) => {
            const { apiKey } = req.body || {};
            return res.json(apiKeys.revoke(apiKey));
        });

        // transaction history with filters
        app.get('/api/history/:address', (req, res) => {
            const rows = filterTxHistory(blockchain, {
                address: req.params.address,
                direction: req.query.direction || 'all',
                minAmount: req.query.minAmount || 0,
                fromHeight: parseInt(req.query.fromHeight, 10) || 0,
                limit: parseInt(req.query.limit, 10) || 100,
            });
            res.json({ address: req.params.address, count: rows.length, transactions: rows });
        });

        report.userFeatures = true;
    } catch (e) { log('[features] user-features skipped:', e.message); }

    // ── 2. Monitoring ─────────────────────────────────────────
    let monitor = null;
    try {
        const health = new SystemHealth();
        const metrics = new MetricSeries(180);
        const alerts = new AlertEngine(defaultRules());
        monitor = { health, metrics, alerts, lastSnapshot: null };

        // resolver that flattens a health snapshot + custom metrics
        const resolve = (path) => {
            const snap = monitor.lastSnapshot || {};
            if (path === 'peers') return p2p?.peers?.size ?? p2p?.getPeers?.().length ?? 0;
            if (path === 'mempoolSize') return mempool?.size?.() ?? 0;
            const parts = path.split('.');
            let cur = snap;
            for (const p of parts) { if (cur == null) return null; cur = cur[p]; }
            return typeof cur === 'number' ? cur : null;
        };

        // sampling loop
        const tick = () => {
            try {
                const snap = health.snapshot();
                monitor.lastSnapshot = snap;
                const height = blockchain?.height ?? (blockchain?.chain?.length ?? 1) - 1;
                const peers = resolve('peers');
                const mp = resolve('mempoolSize');
                metrics.push('cpu', snap.cpu.percent);
                metrics.push('memory', snap.memory.systemUsedPct);
                metrics.push('heapMB', snap.memory.heapUsedMB);
                metrics.push('height', height);
                metrics.push('peers', peers);
                metrics.push('mempool', mp);
                // derive block interval + hashrate proxy if available
                const tip = blockchain?.chain?.[height];
                if (tip?.timestamp) {
                    const prev = blockchain.chain[height - 1];
                    if (prev?.timestamp) metrics.push('blockInterval', Math.round((tip.timestamp - prev.timestamp) / 1000));
                    if (tip.difficulty) metrics.push('difficulty', Number(tip.difficulty));
                }
                alerts.evaluate(resolve);
            } catch { /* never let sampling crash the node */ }
        };
        monitor.timer = setInterval(tick, 5000);
        tick();

        app.get('/api/monitor/health', guard('view:dashboard'), (req, res) => res.json(monitor.lastSnapshot || health.snapshot()));
        app.get('/api/monitor/metrics', guard('view:dashboard'), (req, res) => {
            const name = req.query.series;
            if (name) return res.json({ series: name, data: metrics.get(name), stats: metrics.stats(name) });
            res.json({ series: metrics.all() });
        });
        app.get('/api/monitor/alerts', guard('view:dashboard'), (req, res) =>
            res.json({ active: alerts.getActive(), history: alerts.getHistory(50) }));
        app.post('/api/monitor/alerts/rule', guard('admin:users'), (req, res) => {
            const { id, metric, op, value, message, severity } = req.body || {};
            if (!id || !metric || !op || value == null) return res.status(400).json({ error: 'id, metric, op, value required' });
            alerts.addRule({ id, metric, op, value: Number(value), message: message || id, severity: severity || 'warning' });
            res.json({ ok: true, rules: alerts.rules.length });
        });
        report.monitoring = true;
    } catch (e) { log('[features] monitoring skipped:', e.message); }

    // ── 3. Extra admin tools ──────────────────────────────────
    try {
        // node status/control
        app.get('/api/admin/node/status', guard('admin:users'), (req, res) => {
            res.json({
                height: blockchain?.height,
                peers: p2p?.peers?.size ?? 0,
                mempool: mempool?.size?.() ?? 0,
                mining: !!global.__mining,
                uptime: Math.round(process.uptime()),
                integrations: { tokenExt: report.tokenExt, monitoring: report.monitoring },
            });
        });

        // toggle mining flag (safe, cooperative — actual miner checks the flag)
        app.post('/api/admin/node/mining', guard('admin:users'), (req, res) => {
            global.__mining = !!(req.body && req.body.enabled);
            res.json({ ok: true, mining: global.__mining });
        });

        // peer + ban management (works with the enhanced guard if present)
        app.get('/api/admin/peers/bans', guard('admin:users'), (req, res) => {
            const bans = p2p?.guard?.getBans?.() || [];
            res.json({ bans });
        });
        app.post('/api/admin/peers/ban', guard('admin:users'), (req, res) => {
            const { ip, minutes } = req.body || {};
            if (!ip) return res.status(400).json({ error: 'ip required' });
            if (p2p?.guard?.ban) { p2p.guard.ban(ip, (minutes || 1440) * 60000); return res.json({ ok: true, ip }); }
            res.status(501).json({ error: 'peer guard not available' });
        });
        app.post('/api/admin/peers/unban', guard('admin:users'), (req, res) => {
            const { ip } = req.body || {};
            if (!ip) return res.status(400).json({ error: 'ip required' });
            if (p2p?.guard?.unban) { p2p.guard.unban(ip); return res.json({ ok: true, ip }); }
            res.status(501).json({ error: 'peer guard not available' });
        });

        // data exports (CSV/JSON) for reporting
        app.get('/api/admin/export/:what', guard('admin:users'), (req, res) => {
            const what = req.params.what;
            const fmt = (req.query.format || 'json').toLowerCase();
            let rows = [];
            if (what === 'tokens') rows = blockchain?.tokens?.list?.() || [];
            else if (what === 'peers') rows = (p2p?.getPeers?.() || []).map(p => (typeof p === 'string' ? { peer: p } : p));
            else if (what === 'alerts') rows = monitor?.alerts?.getHistory?.(200) || [];
            else return res.status(400).json({ error: 'unknown export (tokens|peers|alerts)' });

            if (fmt === 'csv') {
                if (!rows.length) return res.type('text/csv').send('');
                const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
                const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
                const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
                res.setHeader('Content-Disposition', `attachment; filename="${what}.csv"`);
                return res.type('text/csv').send(csv);
            }
            res.setHeader('Content-Disposition', `attachment; filename="${what}.json"`);
            res.json({ what, count: rows.length, rows });
        });

        // ── DDoS guard: live stats, ban list, manual ban/unban ──
        app.get('/api/admin/ddos/stats', guard('admin:users'), (req, res) => {
            const g = global.__ddosGuard;
            return g ? res.json(g.stats()) : res.status(503).json({ error: 'ddos guard not active' });
        });
        app.get('/api/admin/ddos/bans', guard('admin:users'), (req, res) => {
            const g = global.__ddosGuard;
            return g ? res.json({ bans: g.getBans() }) : res.status(503).json({ error: 'ddos guard not active' });
        });
        app.post('/api/admin/ddos/ban', guard('admin:users'), (req, res) => {
            const g = global.__ddosGuard; if (!g) return res.status(503).json({ error: 'ddos guard not active' });
            const { ip, minutes } = req.body || {};
            if (!ip) return res.status(400).json({ error: 'ip required' });
            g.ban(ip, (minutes || 15) * 60000);
            res.json({ ok: true, ip });
        });
        app.post('/api/admin/ddos/unban', guard('admin:users'), (req, res) => {
            const g = global.__ddosGuard; if (!g) return res.status(503).json({ error: 'ddos guard not active' });
            const { ip } = req.body || {};
            if (!ip) return res.status(400).json({ error: 'ip required' });
            g.unban(ip);
            res.json({ ok: true, ip });
        });
        app.post('/api/admin/ddos/whitelist', guard('admin:users'), (req, res) => {
            const g = global.__ddosGuard; if (!g) return res.status(503).json({ error: 'ddos guard not active' });
            const { ip } = req.body || {};
            if (!ip) return res.status(400).json({ error: 'ip required' });
            g.whitelistIP(ip);
            res.json({ ok: true, ip });
        });

        report.admin = true;
    } catch (e) { log('[features] admin tools skipped:', e.message); }

    log('🧩 [features] installed:',
        Object.entries(report).filter(([, v]) => v).map(([k]) => k).join(' · ') || 'none');
    return { report, monitor };
}

module.exports = { installFeatures };
