/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  netguard.js — P2P denial-of-service & misbehavior protection
 *
 *  Two layers:
 *   1. Token-bucket rate limiter per peer per message-type, so a
 *      single peer can't flood us with INV/GETDATA/etc.
 *   2. A misbehavior score (like Bitcoin's Ban Score). Protocol
 *      violations add points; at a threshold the peer is banned for
 *      a cooldown window. Bans are remembered by IP.
 *
 *  Self-contained and in-memory (with JSON (de)serialization for the
 *  ban list so it can survive restarts).
 */

'use strict';

// How many "points" each kind of violation costs.
const PENALTY = {
    INVALID_MESSAGE:   20,   // unparseable / oversized / wrong shape
    INVALID_BLOCK:     50,   // sent a block that failed validation
    INVALID_TX:        10,   // sent a tx that failed validation
    UNREQUESTED_DATA:  15,   // sent data we never asked for
    BAD_HANDSHAKE:    100,   // protocol/version violation → instant ban
    RATE_ABUSE:        25,   // tripped the rate limiter repeatedly
    STALL:             10,   // asked for data then never delivered
};

const BAN_THRESHOLD = 100;   // score at which a peer is banned
const BAN_DURATION  = 24 * 60 * 60 * 1000; // 24h
const SCORE_DECAY   = 1 * 60 * 60 * 1000;  // score halves every hour of good behavior

// Per-message-type token buckets: { capacity, refillPerSec }
const LIMITS = {
    inv:      { capacity: 500, refill: 100 },
    getdata:  { capacity: 500, refill: 100 },
    getblocks:{ capacity: 20,  refill: 2   },
    block:    { capacity: 50,  refill: 10  },
    tx:       { capacity: 200, refill: 50  },
    addr:     { capacity: 10,  refill: 1   },
    getaddr:  { capacity: 5,   refill: 0.2 },
    ping:     { capacity: 10,  refill: 1   },
    pong:     { capacity: 10,  refill: 1   },
    headers:  { capacity: 50,  refill: 10  },
    getheaders:{capacity: 20,  refill: 2   },
    _default: { capacity: 100, refill: 20  },
};

class TokenBucket {
    constructor({ capacity, refill }) {
        this.capacity = capacity;
        this.refill = refill;          // tokens per second
        this.tokens = capacity;
        this.last = Date.now();
    }
    take(n = 1) {
        const now = Date.now();
        this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refill);
        this.last = now;
        if (this.tokens >= n) { this.tokens -= n; return true; }
        return false;
    }
}

class PeerState {
    constructor() {
        this.score = 0;
        this.lastDecay = Date.now();
        this.buckets = new Map();
        this.rateStrikes = 0;
    }
    bucketFor(type) {
        if (!this.buckets.has(type))
            this.buckets.set(type, new TokenBucket(LIMITS[type] || LIMITS._default));
        return this.buckets.get(type);
    }
    decay() {
        const now = Date.now();
        const elapsed = now - this.lastDecay;
        if (elapsed >= SCORE_DECAY) {
            const halvings = Math.floor(elapsed / SCORE_DECAY);
            this.score = Math.floor(this.score / 2 ** halvings);
            this.lastDecay = now;
        }
    }
}

class NetGuard {
    constructor() {
        this.peers = new Map();   // ip -> PeerState
        this.bans = new Map();    // ip -> banUntil (ms)
    }

    _state(ip) {
        if (!this.peers.has(ip)) this.peers.set(ip, new PeerState());
        return this.peers.get(ip);
    }

    /** Is this IP currently banned? */
    isBanned(ip) {
        const until = this.bans.get(ip);
        if (!until) return false;
        if (Date.now() >= until) { this.bans.delete(ip); return false; }
        return true;
    }

    /**
     * Check a message against the per-type rate limit.
     * @returns {boolean} true if allowed, false if it should be dropped.
     */
    allow(ip, type) {
        if (this.isBanned(ip)) return false;
        const st = this._state(ip);
        st.decay();
        if (!st.bucketFor(type).take(1)) {
            st.rateStrikes++;
            // repeated flooding escalates to a scored penalty
            if (st.rateStrikes % 20 === 0) this.penalize(ip, 'RATE_ABUSE');
            return false;
        }
        return true;
    }

    /** Apply a misbehavior penalty. Returns true if the peer got banned. */
    penalize(ip, reason) {
        const points = PENALTY[reason] ?? 10;
        const st = this._state(ip);
        st.decay();
        st.score += points;
        if (st.score >= BAN_THRESHOLD) { this.ban(ip); return true; }
        return false;
    }

    ban(ip, ms = BAN_DURATION) {
        this.bans.set(ip, Date.now() + ms);
        this.peers.delete(ip);
    }
    unban(ip) { this.bans.delete(ip); }

    scoreOf(ip) { return this._state(ip).score; }

    getBans() {
        const now = Date.now();
        const out = [];
        for (const [ip, until] of this.bans)
            if (until > now) out.push({ ip, until, remainingMs: until - now });
        return out;
    }

    stats() {
        return {
            trackedPeers: this.peers.size,
            activeBans: this.getBans().length,
            threshold: BAN_THRESHOLD,
        };
    }

    toJSON() { return { bans: [...this.bans.entries()].map(([ip, until]) => ({ ip, until })) }; }
    static fromJSON(o) {
        const g = new NetGuard();
        for (const b of o.bans || []) g.bans.set(b.ip, b.until);
        return g;
    }
}

module.exports = { NetGuard, PENALTY, BAN_THRESHOLD };
