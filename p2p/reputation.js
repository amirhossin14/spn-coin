/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — P2P Reputation & Sybil protection
 *
 *   • Reputation: each peer starts neutral; good behaviour raises
 *     its score, misbehaviour (invalid blocks/txs, spam, protocol
 *     violations) lowers it. Peers that drop below the ban
 *     threshold are banned for a cooldown.
 *   • Sybil resistance: limits concurrent connections per IP and a
 *     global peer cap, so one host can't flood the network with
 *     many identities.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

// Penalty weights for common misbehaviours.
const PENALTY = {
    invalid_block:    50,
    invalid_tx:       20,
    bad_message:      15,
    protocol_error:   25,
    spam:             10,
    timeout:           5,
    duplicate:         3,
};
const REWARD = {
    valid_block:      10,
    valid_tx:          2,
    useful_headers:    3,
};

class PeerReputation {
    constructor(opts = {}) {
        this.start        = opts.start ?? 100;
        this.min          = opts.min ?? 0;
        this.max          = opts.max ?? 200;
        this.banThreshold = opts.banThreshold ?? 20;
        this.banMs        = opts.banMs ?? 60 * 60 * 1000;      // 1h
        this.maxPerIp     = opts.maxPerIp ?? 3;                 // Sybil: conns per IP
        this.maxPeers     = opts.maxPeers ?? 50;               // global cap

        this.peers  = new Map();   // peerId → { score, ip, strikes, lastSeen }
        this.bans    = new Map();  // ip → until
        this.ipConns = new Map();  // ip → Set(peerId)
    }

    _rec(peerId, ip) {
        if (!this.peers.has(peerId))
            this.peers.set(peerId, { score: this.start, ip, strikes: 0, lastSeen: Date.now() });
        return this.peers.get(peerId);
    }

    isBanned(ip) {
        const until = this.bans.get(ip);
        if (!until) return false;
        if (Date.now() >= until) { this.bans.delete(ip); return false; }
        return true;
    }

    /** Sybil/limit gate — call before accepting a new connection. */
    canConnect(ip, peerId) {
        if (this.isBanned(ip)) return { ok: false, reason: 'ip banned' };
        if (this.totalConns() >= this.maxPeers) return { ok: false, reason: 'peer cap reached' };
        const set = this.ipConns.get(ip);
        if (set && set.size >= this.maxPerIp && !set.has(peerId))
            return { ok: false, reason: `too many connections from ${ip} (Sybil guard)` };
        return { ok: true };
    }

    register(peerId, ip) {
        this._rec(peerId, ip);
        if (!this.ipConns.has(ip)) this.ipConns.set(ip, new Set());
        this.ipConns.get(ip).add(peerId);
    }

    remove(peerId) {
        const p = this.peers.get(peerId);
        if (p && this.ipConns.has(p.ip)) {
            this.ipConns.get(p.ip).delete(peerId);
            if (this.ipConns.get(p.ip).size === 0) this.ipConns.delete(p.ip);
        }
    }

    reward(peerId, kind, ip) {
        const p = this._rec(peerId, ip);
        p.score = Math.min(this.max, p.score + (REWARD[kind] || 1));
        p.lastSeen = Date.now();
        return p.score;
    }

    /** Penalise a peer; auto-ban its IP if it drops below the threshold. */
    penalize(peerId, kind, ip) {
        const p = this._rec(peerId, ip);
        p.score = Math.max(this.min, p.score - (PENALTY[kind] || 10));
        p.strikes++;
        p.lastSeen = Date.now();
        if (p.score <= this.banThreshold) {
            this.bans.set(p.ip, Date.now() + this.banMs);
            return { banned: true, ip: p.ip, score: p.score, reason: kind };
        }
        return { banned: false, score: p.score };
    }

    score(peerId) { return this.peers.get(peerId)?.score ?? null; }
    totalConns() { let n = 0; for (const s of this.ipConns.values()) n += s.size; return n; }
    getBans() {
        const out = [];
        for (const [ip, until] of this.bans)
            if (Date.now() < until) out.push({ ip, expiresInSec: Math.ceil((until - Date.now()) / 1000) });
        return out;
    }
    stats() {
        return {
            peers: this.peers.size,
            connections: this.totalConns(),
            uniqueIps: this.ipConns.size,
            bannedIps: this.getBans().length,
            maxPerIp: this.maxPerIp,
            maxPeers: this.maxPeers,
        };
    }
}

module.exports = { PeerReputation, PENALTY, REWARD };
