/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  addrman.js — Address Manager & Peer Discovery
 *
 *  A Bitcoin-inspired address manager. Tracks known peer addresses,
 *  scores them by success/failure, separates "tried" (we have
 *  connected successfully) from "new" (heard about but unverified),
 *  and answers "who should I connect to next?" while avoiding
 *  eclipse-style monoculture (buckets by /16 network group).
 *
 *  This module is storage-agnostic and self-contained: it holds
 *  state in memory and can be serialized to / restored from JSON
 *  so a node can persist its peer table across restarts.
 */

'use strict';

const DAY = 86_400_000;

class AddrEntry {
    constructor(ip, port, source = null) {
        this.ip = ip;
        this.port = port;
        this.source = source;          // who told us about this peer
        this.firstSeen = Date.now();
        this.lastSeen = Date.now();
        this.lastTry = 0;
        this.lastSuccess = 0;
        this.attempts = 0;             // consecutive failed attempts
        this.tried = false;            // promoted to "tried" table?
    }
    get key() { return `${this.ip}:${this.port}`; }
    // /16 network group — used to spread connections across networks
    get group() {
        const parts = this.ip.split('.');
        return parts.length === 4 ? `${parts[0]}.${parts[1]}` : this.ip;
    }
    toJSON() {
        return {
            ip: this.ip, port: this.port, source: this.source,
            firstSeen: this.firstSeen, lastSeen: this.lastSeen,
            lastTry: this.lastTry, lastSuccess: this.lastSuccess,
            attempts: this.attempts, tried: this.tried,
        };
    }
    static fromJSON(o) {
        const e = new AddrEntry(o.ip, o.port, o.source);
        Object.assign(e, o);
        return e;
    }
}

class AddrMan {
    /**
     * @param {object} opts
     * @param {number} opts.maxNew    cap on unverified addresses
     * @param {number} opts.maxTried  cap on verified addresses
     */
    constructor({ maxNew = 4096, maxTried = 1024 } = {}) {
        this.maxNew = maxNew;
        this.maxTried = maxTried;
        this.map = new Map();          // key -> AddrEntry
        this.selfKeys = new Set();     // our own advertised addrs (never dial)
    }

    markSelf(ip, port) { this.selfKeys.add(`${ip}:${port}`); }

    size() {
        let neu = 0, tried = 0;
        for (const e of this.map.values()) (e.tried ? tried++ : neu++);
        return { new: neu, tried, total: this.map.size };
    }

    /** Add or refresh a peer we heard about. Returns true if newly added. */
    add(ip, port, source = null) {
        if (!ip || !port) return false;
        const key = `${ip}:${port}`;
        if (this.selfKeys.has(key)) return false;
        const existing = this.map.get(key);
        if (existing) { existing.lastSeen = Date.now(); return false; }

        // enforce cap on the "new" table by evicting the stalest entry
        const counts = this.size();
        if (counts.new >= this.maxNew) this._evictOldestNew();

        this.map.set(key, new AddrEntry(ip, port, source));
        return true;
    }

    /** Bulk add from an ADDR message. */
    addMany(list, source = null) {
        let added = 0;
        for (const a of list || []) if (this.add(a.ip, a.port, source)) added++;
        return added;
    }

    /** Called when we begin dialing a peer. */
    onAttempt(ip, port) {
        const e = this.map.get(`${ip}:${port}`);
        if (e) { e.lastTry = Date.now(); e.attempts++; }
    }

    /** Called after a successful handshake — promote to "tried". */
    onSuccess(ip, port) {
        const key = `${ip}:${port}`;
        let e = this.map.get(key);
        if (!e) { e = new AddrEntry(ip, port, 'self'); this.map.set(key, e); }
        e.lastSuccess = Date.now();
        e.lastSeen = Date.now();
        e.attempts = 0;
        if (!e.tried) {
            e.tried = true;
            const { tried } = this.size();
            if (tried > this.maxTried) this._evictWorstTried();
        }
    }

    /** Called on connection failure. Drops peers that keep failing. */
    onFailure(ip, port) {
        const key = `${ip}:${port}`;
        const e = this.map.get(key);
        if (!e) return;
        // give up on a "new" peer after too many failures
        const dead = !e.tried && e.attempts >= 3;
        const staleTried = e.tried && e.attempts >= 10;
        if (dead || staleTried) this.map.delete(key);
    }

    /**
     * Pick the next address to connect to.
     * Prefers "tried" peers, spreads across network groups, applies an
     * exponential backoff so we don't hammer a recently-failed peer.
     * @param {Set<string>} exclude keys already connected
     */
    select(exclude = new Set(), preferTried = true) {
        const now = Date.now();
        const eligible = [];
        for (const e of this.map.values()) {
            if (exclude.has(e.key)) continue;
            // exponential backoff: wait longer after each failed attempt
            const backoff = Math.min(60_000 * 2 ** e.attempts, DAY);
            if (e.lastTry && now - e.lastTry < backoff) continue;
            eligible.push(e);
        }
        if (!eligible.length) return null;

        const pool = preferTried
            ? (eligible.filter(e => e.tried).length ? eligible.filter(e => e.tried) : eligible)
            : eligible;

        // weight fresher / more-successful peers higher, but keep randomness
        // and spread across groups to resist eclipse attacks.
        const seenGroups = new Set([...exclude].map(k => k.split(':')[0].split('.').slice(0, 2).join('.')));
        const fresh = pool.filter(e => !seenGroups.has(e.group));
        const candidates = fresh.length ? fresh : pool;

        candidates.sort((a, b) => {
            const sa = (a.lastSuccess || a.firstSeen) - a.attempts * DAY;
            const sb = (b.lastSuccess || b.firstSeen) - b.attempts * DAY;
            return sb - sa;
        });
        // pick randomly among the top third to avoid deterministic targeting
        const top = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 3)));
        return top[Math.floor(Math.random() * top.length)];
    }

    /** Addresses to advertise in an ADDR reply (freshest tried peers). */
    getAddrResponse(max = 100) {
        const now = Date.now();
        return [...this.map.values()]
            .filter(e => e.tried && now - e.lastSuccess < 3 * DAY)
            .sort((a, b) => b.lastSuccess - a.lastSuccess)
            .slice(0, max)
            .map(e => ({ ip: e.ip, port: e.port, ts: e.lastSuccess }));
    }

    _evictOldestNew() {
        let oldest = null;
        for (const e of this.map.values())
            if (!e.tried && (!oldest || e.lastSeen < oldest.lastSeen)) oldest = e;
        if (oldest) this.map.delete(oldest.key);
    }
    _evictWorstTried() {
        let worst = null;
        for (const e of this.map.values())
            if (e.tried && (!worst || e.lastSuccess < worst.lastSuccess)) worst = e;
        if (worst) this.map.delete(worst.key);
    }

    toJSON() { return { entries: [...this.map.values()].map(e => e.toJSON()) }; }
    static fromJSON(o) {
        const am = new AddrMan();
        for (const e of o.entries || []) {
            const entry = AddrEntry.fromJSON(e);
            am.map.set(entry.key, entry);
        }
        return am;
    }
}

module.exports = { AddrMan, AddrEntry };
