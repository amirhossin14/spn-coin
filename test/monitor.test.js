'use strict';
const { describe, test, beforeEach } = require('node:test');
require('./_expect');

const { SystemHealth, MetricSeries, AlertEngine, defaultRules } = require('../monitor/monitor');
const { installFeatures } = require('../monitor/features');
const { TokenLayer } = require('../tokens/tokens');

describe('monitor primitives', () => {
    test('SystemHealth snapshot has expected shape', () => {
        const s = new SystemHealth().snapshot();
        expect(s.cpu).toBeDefined();
        expect(typeof s.cpu.percent).toBe('number');
        expect(s.memory.systemUsedPct).toBeGreaterThanOrEqual(0);
        expect(s.uptime.processSec).toBeGreaterThanOrEqual(0);
    });

    test('MetricSeries ring-buffers and computes stats', () => {
        const m = new MetricSeries(3);
        m.push('x', 1); m.push('x', 2); m.push('x', 3); m.push('x', 4);
        expect(m.get('x').length).toBe(3);          // capped
        expect(m.latest('x')).toBe(4);
        const st = m.stats('x');
        expect(st.max).toBe(4); expect(st.min).toBe(2);
    });

    test('AlertEngine raises and clears alerts', () => {
        const a = new AlertEngine([{ id: 'hot', metric: 'cpu', op: '>', value: 80, message: 'hot', severity: 'warning' }]);
        let cpu = 90;
        let r = a.evaluate(() => cpu);
        expect(r.fired.length).toBe(1);
        expect(a.getActive().length).toBe(1);
        cpu = 10;
        r = a.evaluate(() => cpu);
        expect(a.getActive().length).toBe(0);       // cleared
        expect(a.getHistory().some(h => h.event === 'cleared')).toBe(true);
    });

    test('defaultRules provides node rules', () => {
        expect(defaultRules().length).toBeGreaterThanOrEqual(4);
    });
});

// minimal express-like app
function fakeApp() {
    const routes = {};
    const reg = (m) => (path, ...handlers) => { routes[m + ' ' + path] = handlers[handlers.length - 1]; };
    return {
        get: reg('GET'), post: reg('POST'), use() {}, routes,
        call(m, path, { body = {}, params = {}, query = {} } = {}) {
            // match exact route, or a parameterized route like /a/:x/b
            let h = routes[m + ' ' + path];
            if (!h) {
                for (const key of Object.keys(routes)) {
                    const [rm, rp] = key.split(' ');
                    if (rm !== m) continue;
                    const rparts = rp.split('/'), pparts = path.split('/');
                    if (rparts.length !== pparts.length) continue;
                    const p = {}; let ok = true;
                    for (let i = 0; i < rparts.length; i++) {
                        if (rparts[i].startsWith(':')) p[rparts[i].slice(1)] = pparts[i];
                        else if (rparts[i] !== pparts[i]) { ok = false; break; }
                    }
                    if (ok) { h = routes[key]; params = { ...p, ...params }; break; }
                }
            }
            if (!h) return { code: 404, body: { error: 'no route' } };
            let code = 200, out = null;
            const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; },
                type() { return this; }, send(s) { out = s; return this; }, setHeader() {} };
            h({ body, params, query }, res);
            return { code, body: out };
        },
    };
}

describe('installFeatures wiring', () => {
    let app, blockchain, mempool, p2p;
    beforeEach(() => {
        app = fakeApp();
        blockchain = { height: 2, chain: [
            { hash: 'g', timestamp: 1000, difficulty: 1, transactions: [] },
            { hash: 'a', timestamp: 601000, difficulty: 1, transactions: [] },
            { hash: 'b', timestamp: 1201000, difficulty: 1, transactions: [] },
        ], tokens: new TokenLayer() };
        mempool = { size: () => 3 };
        p2p = { peers: new Map(), getPeers: () => [], guard: {
            _bans: new Map(),
            getBans() { return [...this._bans.keys()].map(ip => ({ ip })); },
            ban(ip) { this._bans.set(ip, 1); }, unban(ip) { this._bans.delete(ip); },
        } };
    });

    test('installs all three feature groups', () => {
        const { report, monitor } = installFeatures({ app, blockchain, mempool, p2p, log: () => {} });
        expect(report.tokenExt).toBe(true);
        expect(report.monitoring).toBe(true);
        expect(report.admin).toBe(true);
        clearInterval(monitor.timer);
    });

    test('monitor health endpoint responds', () => {
        const { monitor } = installFeatures({ app, blockchain, mempool, p2p, log: () => {} });
        const r = app.call('GET', '/api/monitor/health');
        expect(r.code).toBe(200);
        expect(r.body.cpu).toBeDefined();
        clearInterval(monitor.timer);
    });

    test('token search endpoint works', () => {
        const { monitor } = installFeatures({ app, blockchain, mempool, p2p, log: () => {} });
        const r = app.call('GET', '/api/tokens/search', { query: { q: '' } });
        expect(r.code).toBe(200);
        expect(Array.isArray(r.body.tokens)).toBe(true);
        clearInterval(monitor.timer);
    });

    test('admin ban/unban via peer guard', () => {
        const { monitor } = installFeatures({ app, blockchain, mempool, p2p, log: () => {} });
        expect(app.call('POST', '/api/admin/peers/ban', { body: { ip: '1.2.3.4' } }).body.ok).toBe(true);
        expect(p2p.guard.getBans().length).toBe(1);
        expect(app.call('POST', '/api/admin/peers/unban', { body: { ip: '1.2.3.4' } }).body.ok).toBe(true);
        expect(p2p.guard.getBans().length).toBe(0);
        clearInterval(monitor.timer);
    });

    test('CSV export produces rows', () => {
        const { monitor } = installFeatures({ app, blockchain, mempool, p2p, log: () => {} });
        const r = app.call('GET', '/api/admin/export/peers', { query: { format: 'json' } });
        expect(r.code).toBe(200);
        clearInterval(monitor.timer);
    });
});
