'use strict';
const { describe, test } = require('node:test');
require('./_expect');

const { DDoSGuard } = require('../middleware/ddos-guard');

// fake req/res
function mkReq(ip, headers = {}) { return { ip, headers, socket: { remoteAddress: ip }, destroy() {} }; }
function mkRes() {
    const res = { statusCode: 200, headers: {}, ended: false, body: null, listeners: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; this.ended = true; return this; },
        on(ev, fn) { this.listeners[ev] = fn; },
        destroy() { this.destroyed = true; },
        finish() { this.listeners.finish && this.listeners.finish(); } };
    return res;
}
function run(guard, req, res) {
    let passed = false;
    guard.middleware()(req, res, () => { passed = true; });
    return passed;
}

describe('DDoSGuard', () => {
    test('allows normal traffic', () => {
        const g = new DDoSGuard();
        const res = mkRes();
        expect(run(g, mkReq('1.2.3.4'), res)).toBe(true);
        res.finish();
    });

    test('whitelisted localhost always passes', () => {
        const g = new DDoSGuard();
        for (let i = 0; i < 1000; i++) {
            const res = mkRes();
            expect(run(g, mkReq('127.0.0.1'), res)).toBe(true);
            res.finish();
        }
    });

    test('bans an IP that bursts past the threshold', () => {
        const g = new DDoSGuard({ burstThreshold: 20, burstWindowMs: 10000 });
        const ip = '9.9.9.9';
        let blocked = false;
        for (let i = 0; i < 40; i++) {
            const res = mkRes();
            const passed = run(g, mkReq(ip), res);
            if (!passed) { blocked = true; break; }
            res.finish();
        }
        expect(blocked).toBe(true);
        expect(g.isBanned(ip)).toBe(true);
    });

    test('concurrent-connection cap rejects extra open requests', () => {
        const g = new DDoSGuard({ maxConnPerIP: 5, burstThreshold: 100000 });
        const ip = '8.8.8.8';
        const open = [];
        let rejected = false;
        for (let i = 0; i < 8; i++) {
            const res = mkRes();
            const passed = run(g, mkReq(ip), res);
            if (!passed) { rejected = true; } else { open.push(res); } // keep open (no finish)
        }
        expect(rejected).toBe(true);
        // closing connections frees capacity
        open.forEach(r => r.finish());
        const res = mkRes();
        expect(run(g, mkReq(ip), res)).toBe(true);
    });

    test('reputation heals over time (decay)', () => {
        const g = new DDoSGuard({ decayPerSec: 1000 });
        g._penalize('5.5.5.5', 10);
        expect(g.reputation.get('5.5.5.5')).toBe(10);
        // force time forward
        g._lastDecay = Date.now() - 2000;
        g._decay();
        expect(g.reputation.get('5.5.5.5')).toBeUndefined(); // fully healed
    });

    test('clientIP ignores spoofable X-Forwarded-For and uses req.ip', () => {
        // SECURITY: the raw X-Forwarded-For header is client-controlled, so the
        // guard must NOT trust it. It relies on Express's resolved req.ip (which
        // honours the app-level bounded `trust proxy` setting) instead.
        const g = new DDoSGuard({ trustProxy: true });
        const ip = g.clientIP(mkReq('10.0.0.1', { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }));
        expect(ip).toBe('10.0.0.1');
    });

    test('manual ban / unban works', () => {
        const g = new DDoSGuard();
        g.ban('4.4.4.4', 60000);
        expect(g.isBanned('4.4.4.4')).toBe(true);
        const res = mkRes();
        expect(run(g, mkReq('4.4.4.4'), res)).toBe(false);
        g.unban('4.4.4.4');
        expect(g.isBanned('4.4.4.4')).toBe(false);
    });

    test('expired ban auto-clears', () => {
        const g = new DDoSGuard();
        g.ban('3.3.3.3', -1); // already expired
        expect(g.isBanned('3.3.3.3')).toBe(false);
    });

    test('stats snapshot has expected shape', () => {
        const g = new DDoSGuard();
        run(g, mkReq('1.1.1.1'), mkRes());
        const s = g.stats();
        expect(s).toHaveProperty('globalRatePerSec');
        expect(s).toHaveProperty('activeBans');
        expect(Array.isArray(s.topOffenders)).toBe(true);
    });

    test('guard fails open on internal error', () => {
        const g = new DDoSGuard();
        // break an internal structure to force an exception path
        g._decay = () => { throw new Error('boom'); };
        const res = mkRes();
        expect(run(g, mkReq('2.2.2.2'), res)).toBe(true); // still allowed
    });
});
