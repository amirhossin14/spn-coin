/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  ddos-guard.js — Layered DDoS resistance for the HTTP surface.
 *
 *  Complements the existing per-IP / per-message rate limiters with
 *  the pieces that actually matter under a real flood:
 *
 *   1. Concurrent-connection cap per IP     (connection flooding)
 *   2. Adaptive global budget               (whole-node overload → tighten)
 *   3. Slow-request / Slowloris defense     (request duration cap)
 *   4. Burst/anomaly auto-ban               (sudden request spikes)
 *   5. Reputation with time-decay           (repeat offenders escalate,
 *                                            good behavior heals)
 *
 *  Everything is in-memory, dependency-free, and fail-open: if the
 *  guard itself errors it must never take the node down, so each hook
 *  is wrapped and defaults to allowing the request.
 */

'use strict';

const DEFAULTS = {
    maxConnPerIP: parseInt(process.env.DDOS_MAX_CONN_PER_IP, 10) || 50,
    globalSoftLimit: parseInt(process.env.DDOS_GLOBAL_SOFT, 10) || 800,   // req/sec across all IPs → start shedding
    globalHardLimit: parseInt(process.env.DDOS_GLOBAL_HARD, 10) || 1500,  // req/sec → aggressive shedding
    burstWindowMs: 10_000,
    burstThreshold: parseInt(process.env.DDOS_BURST, 10) || 300,          // >N req / 10s from one IP → ban
    slowRequestMs: parseInt(process.env.DDOS_SLOW_MS, 10) || 30_000,      // request open longer than this = abusive
    banMs: parseInt(process.env.DDOS_BAN_MS, 10) || 15 * 60_000,
    decayPerSec: 1,                                                       // reputation points healed per second
    trustProxy: process.env.TRUST_PROXY === '1',
};

class DDoSGuard {
    constructor(opts = {}) {
        this.cfg = { ...DEFAULTS, ...opts };
        this.conns = new Map();        // ip -> active connection count
        this.reputation = new Map();   // ip -> score (higher = worse)
        this.bans = new Map();         // ip -> unban timestamp
        this.hits = new Map();         // ip -> [timestamps] within burst window
        this.whitelist = new Set(['127.0.0.1', '::1']);
        this._ring = [];               // global request timestamps (1s ring)
        this._lastDecay = Date.now();
    }

    whitelistIP(ip) { this.whitelist.add(ip); }

    clientIP(req) {
        // Trust Express's resolved req.ip (bounded by the app's `trust proxy`
        // setting) rather than the raw, client-spoofable X-Forwarded-For header.
        return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    }

    _decay() {
        const now = Date.now();
        const secs = (now - this._lastDecay) / 1000;
        if (secs < 1) return;
        this._lastDecay = now;
        const heal = this.cfg.decayPerSec * secs;
        for (const [ip, score] of this.reputation) {
            const next = score - heal;
            if (next <= 0) this.reputation.delete(ip); else this.reputation.set(ip, next);
        }
    }

    _penalize(ip, points) {
        const s = (this.reputation.get(ip) || 0) + points;
        this.reputation.set(ip, s);
        return s;
    }

    ban(ip, ms = this.cfg.banMs) { this.bans.set(ip, Date.now() + ms); }
    unban(ip) { this.bans.delete(ip); this.reputation.delete(ip); this.hits.delete(ip); }

    isBanned(ip) {
        const until = this.bans.get(ip);
        if (!until) return false;
        if (Date.now() > until) { this.bans.delete(ip); return false; }
        return true;
    }

    /** current global requests-per-second estimate */
    _globalRate() {
        const now = Date.now();
        this._ring = this._ring.filter(t => now - t < 1000);
        return this._ring.length;
    }

    /** record a burst hit and return count within window */
    _burst(ip) {
        const now = Date.now();
        const arr = (this.hits.get(ip) || []).filter(t => now - t < this.cfg.burstWindowMs);
        arr.push(now);
        this.hits.set(ip, arr);
        return arr.length;
    }

    /**
     * Express middleware. Decides allow/deny before the route runs.
     */
    middleware() {
        return (req, res, next) => {
            let ip = 'unknown';
            try {
                this._decay();
                ip = this.clientIP(req);
                if (this.whitelist.has(ip)) return next();

                // 1. hard ban check
                if (this.isBanned(ip)) return this._reject(res, 429, 'temporarily banned');

                // 2. global adaptive shedding
                this._ring.push(Date.now());
                const gRate = this._globalRate();
                if (gRate > this.cfg.globalHardLimit) {
                    // under heavy attack: only let low-reputation-free IPs through
                    if ((this.reputation.get(ip) || 0) > 0) return this._reject(res, 503, 'overloaded');
                } else if (gRate > this.cfg.globalSoftLimit) {
                    // soft: probabilistically shed a fraction, worst reputations first
                    const rep = this.reputation.get(ip) || 0;
                    const shedProb = Math.min(0.9, (gRate - this.cfg.globalSoftLimit) / this.cfg.globalSoftLimit);
                    if (rep > 5 && Math.random() < shedProb) return this._reject(res, 503, 'overloaded');
                }

                // 3. burst / anomaly detection
                const burst = this._burst(ip);
                if (burst > this.cfg.burstThreshold) {
                    const score = this._penalize(ip, 50);
                    this.ban(ip);
                    return this._reject(res, 429, 'burst limit exceeded');
                }
                if (burst > this.cfg.burstThreshold * 0.7) this._penalize(ip, 1);

                // 4. concurrent connection cap
                const active = (this.conns.get(ip) || 0) + 1;
                this.conns.set(ip, active);
                let released = false;
                let slowTimer = null;
                const release = () => {
                    if (released) return; released = true;
                    const n = (this.conns.get(ip) || 1) - 1;
                    if (n <= 0) this.conns.delete(ip); else this.conns.set(ip, n);
                    if (slowTimer) clearTimeout(slowTimer);
                };
                if (active > this.cfg.maxConnPerIP) {
                    release();
                    this._penalize(ip, 5);
                    return this._reject(res, 429, 'too many concurrent connections');
                }

                // 5. slow-request / Slowloris guard
                slowTimer = setTimeout(() => {
                    this._penalize(ip, 10);
                    try { res.destroy?.(); req.destroy?.(); } catch { /* ignore */ }
                }, this.cfg.slowRequestMs);

                res.on('finish', release);
                res.on('close', release);
                return next();
            } catch (e) {
                // fail-open: never block traffic because the guard errored
                return next();
            }
        };
    }

    _reject(res, code, msg) {
        try {
            res.setHeader('Retry-After', Math.ceil(this.cfg.banMs / 1000));
            res.status(code).json({ error: 'rejected by DDoS guard', reason: msg });
        } catch { try { res.end(); } catch { /* ignore */ } }
    }

    /** Snapshot for the admin/monitoring UI. */
    stats() {
        return {
            globalRatePerSec: this._globalRate(),
            activeConnections: [...this.conns.values()].reduce((a, b) => a + b, 0),
            uniqueActiveIPs: this.conns.size,
            trackedReputations: this.reputation.size,
            activeBans: [...this.bans.entries()].filter(([, t]) => t > Date.now()).length,
            topOffenders: [...this.reputation.entries()]
                .sort((a, b) => b[1] - a[1]).slice(0, 10)
                .map(([ip, score]) => ({ ip, score: Math.round(score) })),
            thresholds: {
                maxConnPerIP: this.cfg.maxConnPerIP,
                globalSoftLimit: this.cfg.globalSoftLimit,
                globalHardLimit: this.cfg.globalHardLimit,
                burstThreshold: this.cfg.burstThreshold,
            },
        };
    }

    getBans() {
        return [...this.bans.entries()]
            .filter(([, t]) => t > Date.now())
            .map(([ip, until]) => ({ ip, until, remainingSec: Math.round((until - Date.now()) / 1000) }));
    }
}

module.exports = { DDoSGuard, DEFAULTS };
