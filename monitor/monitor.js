/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  monitor.js — Node monitoring: system health, time-series metrics,
 *  and a simple threshold-based alert engine.
 *
 *  • SystemHealth   — CPU load, memory, uptime, process stats.
 *  • MetricSeries   — ring-buffer time series for live charts
 *                     (hashrate, tx/s, block interval, mempool size…).
 *  • AlertEngine    — evaluate rules each tick; raise/clear alerts.
 *
 *  Pure Node core (os/process) — no external deps. Designed to be
 *  polled by an interval in server.js and exposed over REST/WS.
 */

'use strict';

const os = require('os');

// ── System health snapshot ───────────────────────────────────
class SystemHealth {
    constructor() { this._lastCpu = this._cpuTimes(); }

    _cpuTimes() {
        const cpus = os.cpus();
        let idle = 0, total = 0;
        for (const c of cpus) {
            for (const k in c.times) total += c.times[k];
            idle += c.times.idle;
        }
        return { idle, total };
    }

    snapshot() {
        const now = this._cpuTimes();
        const idleDiff = now.idle - this._lastCpu.idle;
        const totalDiff = now.total - this._lastCpu.total;
        this._lastCpu = now;
        const cpuPct = totalDiff > 0 ? Math.max(0, Math.min(100, 100 - (idleDiff / totalDiff) * 100)) : 0;

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const mem = process.memoryUsage();

        return {
            time: Date.now(),
            cpu: {
                percent: Math.round(cpuPct * 10) / 10,
                cores: os.cpus().length,
                load: os.loadavg().map(n => Math.round(n * 100) / 100),
            },
            memory: {
                systemUsedPct: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
                systemTotalMB: Math.round(totalMem / 1048576),
                systemFreeMB: Math.round(freeMem / 1048576),
                processRssMB: Math.round(mem.rss / 1048576),
                heapUsedMB: Math.round(mem.heapUsed / 1048576),
            },
            uptime: {
                processSec: Math.round(process.uptime()),
                systemSec: Math.round(os.uptime()),
            },
            platform: { type: os.type(), release: os.release(), arch: os.arch(), node: process.version },
        };
    }
}

// ── Ring-buffer time series ───────────────────────────────────
class MetricSeries {
    constructor(maxPoints = 120) { this.maxPoints = maxPoints; this.series = {}; }

    push(name, value, time = Date.now()) {
        if (!this.series[name]) this.series[name] = [];
        const arr = this.series[name];
        arr.push({ t: time, v: value });
        if (arr.length > this.maxPoints) arr.shift();
    }

    get(name) { return this.series[name] || []; }
    all() { return this.series; }

    latest(name) { const a = this.series[name]; return a && a.length ? a[a.length - 1].v : null; }

    stats(name) {
        const a = this.series[name] || [];
        if (!a.length) return null;
        const vals = a.map(p => p.v);
        return {
            latest: vals[vals.length - 1],
            min: Math.min(...vals),
            max: Math.max(...vals),
            avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
            points: vals.length,
        };
    }
}

// ── Threshold alert engine ────────────────────────────────────
class AlertEngine {
    /**
     * rules: [{ id, metric, op:'>'|'<'|'>='|'<=', value, message, severity }]
     * `metric` can be a dotted path into the health snapshot (e.g.
     * 'cpu.percent') or a MetricSeries name (resolved via getMetric).
     */
    constructor(rules = []) {
        this.rules = rules;
        this.active = new Map();   // id -> alert object
        this.history = [];         // recent fired/cleared events
    }

    addRule(rule) { this.rules.push(rule); }

    _cmp(a, op, b) {
        switch (op) { case '>': return a > b; case '<': return a < b;
            case '>=': return a >= b; case '<=': return a <= b; default: return false; }
    }

    evaluate(getMetric) {
        const events = [];
        for (const r of this.rules) {
            const val = getMetric(r.metric);
            if (val == null || Number.isNaN(val)) continue;
            const breached = this._cmp(val, r.op, r.value);
            const isActive = this.active.has(r.id);
            if (breached && !isActive) {
                const alert = { id: r.id, metric: r.metric, value: val, threshold: r.value,
                    op: r.op, message: r.message, severity: r.severity || 'warning', since: Date.now() };
                this.active.set(r.id, alert);
                this.history.unshift({ ...alert, event: 'raised', at: Date.now() });
                events.push(alert);
            } else if (!breached && isActive) {
                const cleared = this.active.get(r.id);
                this.active.delete(r.id);
                this.history.unshift({ ...cleared, event: 'cleared', at: Date.now() });
            }
        }
        if (this.history.length > 200) this.history.length = 200;
        return { fired: events, active: [...this.active.values()] };
    }

    getActive() { return [...this.active.values()]; }
    getHistory(n = 50) { return this.history.slice(0, n); }
}

// Sensible default alert rules for a full node.
function defaultRules() {
    return [
        { id: 'cpu-high', metric: 'cpu.percent', op: '>', value: 90, severity: 'warning',
          message: 'CPU usage above 90%' },
        { id: 'mem-high', metric: 'memory.systemUsedPct', op: '>', value: 92, severity: 'warning',
          message: 'System memory above 92%' },
        { id: 'heap-high', metric: 'memory.heapUsedMB', op: '>', value: 1024, severity: 'critical',
          message: 'Node heap above 1 GB' },
        { id: 'no-peers', metric: 'peers', op: '<', value: 1, severity: 'warning',
          message: 'Node has no connected peers' },
        { id: 'mempool-flood', metric: 'mempoolSize', op: '>', value: 50000, severity: 'warning',
          message: 'Mempool unusually large' },
    ];
}

module.exports = { SystemHealth, MetricSeries, AlertEngine, defaultRules };
