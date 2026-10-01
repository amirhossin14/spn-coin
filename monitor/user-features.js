/**
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL. All Rights Reserved.
 *
 * user-features.js — Address book, webhooks, developer API keys, and a
 * transaction-history filter. In-memory stores with JSON persistence hooks.
 */
'use strict';

const crypto = require('crypto');

// ── Address book (per owner address) ─────────────────────────
class AddressBook {
    constructor() { this.books = new Map(); } // owner -> Map(address -> {label, note})
    _book(owner) { if (!this.books.has(owner)) this.books.set(owner, new Map()); return this.books.get(owner); }
    add(owner, address, label, note = '') {
        if (!owner || !address) return { ok: false, error: 'owner and address required' };
        this._book(owner).set(address, { label: String(label || '').slice(0, 64), note: String(note).slice(0, 200) });
        return { ok: true };
    }
    remove(owner, address) { return { ok: this._book(owner).delete(address) }; }
    list(owner) {
        return [...this._book(owner).entries()].map(([address, v]) => ({ address, ...v }));
    }
    toJSON() { return { books: [...this.books].map(([o, m]) => [o, [...m]]) }; }
    static fromJSON(o) { const ab = new AddressBook(); for (const [owner, entries] of o.books || []) ab.books.set(owner, new Map(entries)); return ab; }
}

// ── Webhooks (event subscriptions) ───────────────────────────
// SSRF guard: a webhook URL is attacker-controlled, so we refuse loopback,
// private, link-local and cloud-metadata targets. This blocks a user from
// pointing a hook at internal services (169.254.169.254, localhost, 10.x, …).
function isUnsafeWebhookUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return true; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const host = (u.hostname || '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return true; // cloud metadata
    // IPv6 loopback / link-local / unique-local
    if (host === '::1' || host === '[::1]' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true;
    // IPv4 literal ranges
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const [a, b] = [ +m[1], +m[2] ];
        if (a === 127 || a === 10 || a === 0 || a === 169 && b === 254) return true;      // loopback / private / link-local
        if (a === 192 && b === 168) return true;                                          // private
        if (a === 172 && b >= 16 && b <= 31) return true;                                 // private
        if (a >= 224) return true;                                                        // multicast / reserved
    }
    return false;
}

class WebhookRegistry {
    constructor() { this.hooks = new Map(); } // id -> {url, events:Set, owner, active}
    register({ url, events, owner }) {
        if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: 'valid url required' };
        if (isUnsafeWebhookUrl(url)) return { ok: false, error: 'url points to a private/loopback/internal address (blocked)' };
        const id = crypto.randomBytes(8).toString('hex');
        this.hooks.set(id, { id, url, events: new Set(events && events.length ? events : ['*']), owner, active: true, created: Date.now() });
        return { ok: true, id };
    }
    remove(id) { return { ok: this.hooks.delete(id) }; }
    list(owner = null) { return [...this.hooks.values()].filter(h => !owner || h.owner === owner).map(h => ({ ...h, events: [...h.events] })); }
    /** Fire an event to all matching hooks. Uses fetch if available. */
    async emit(event, payload) {
        const fired = [];
        for (const h of this.hooks.values()) {
            if (!h.active) continue;
            if (!h.events.has('*') && !h.events.has(event)) continue;
            if (isUnsafeWebhookUrl(h.url)) continue; // defense-in-depth re-check at fire time
            fired.push(h.id);
            try {
                if (typeof fetch === 'function') {
                    fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ event, payload, ts: Date.now() }) }).catch(() => {});
                }
            } catch { /* best-effort delivery */ }
        }
        return fired;
    }
}

// ── Developer API keys ───────────────────────────────────────
class ApiKeyStore {
    constructor() { this.keys = new Map(); } // keyHash -> {label, owner, scopes, created, lastUsed}
    _hash(key) { return crypto.createHash('sha256').update(key).digest('hex'); }
    issue({ label, owner, scopes = ['read'] }) {
        const key = 'spn_' + crypto.randomBytes(24).toString('hex');
        this.keys.set(this._hash(key), { label: label || 'key', owner, scopes, created: Date.now(), lastUsed: null });
        return { ok: true, apiKey: key, note: 'store this now — it is not shown again' };
    }
    verify(key, scope = null) {
        const rec = this.keys.get(this._hash(key || ''));
        if (!rec) return { ok: false };
        rec.lastUsed = Date.now();
        if (scope && !rec.scopes.includes(scope) && !rec.scopes.includes('*')) return { ok: false, error: 'missing scope' };
        return { ok: true, owner: rec.owner, scopes: rec.scopes };
    }
    revoke(key) { return { ok: this.keys.delete(this._hash(key)) }; }
    list(owner = null) {
        return [...this.keys.values()].filter(r => !owner || r.owner === owner)
            .map(r => ({ label: r.label, owner: r.owner, scopes: r.scopes, created: r.created, lastUsed: r.lastUsed }));
    }
}

// ── Transaction-history filter ───────────────────────────────
/**
 * Scan the chain for transactions touching an address, with filters.
 * @param {object} blockchain
 * @param {object} opts { address, direction:'in'|'out'|'all', minAmount, fromHeight, toHeight, limit }
 */
function filterTxHistory(blockchain, opts = {}) {
    const { address, direction = 'all', minAmount = 0, fromHeight = 0, toHeight = Infinity, limit = 100 } = opts;
    const chain = blockchain.chain || [];
    const out = [];
    const min = BigInt(minAmount || 0);
    for (let h = Math.max(0, fromHeight); h < chain.length && h <= toHeight; h++) {
        for (const tx of chain[h].transactions || []) {
            let isIn = false, isOut = false, amount = 0n;
            for (const o of tx.outputs || []) {
                if (!address || o.address === address) { isIn = true; try { amount += BigInt(o.amount || 0); } catch {} }
            }
            for (const i of tx.inputs || []) {
                if (address && i.address === address) isOut = true;
            }
            if (address && !isIn && !isOut) continue;
            if (direction === 'in' && !isIn) continue;
            if (direction === 'out' && !isOut) continue;
            if (amount < min) continue;
            out.push({ txid: tx.id, height: h, timestamp: tx.timestamp,
                direction: isOut ? 'out' : 'in', amount: amount.toString(),
                outputs: (tx.outputs || []).length, inputs: (tx.inputs || []).length });
            if (out.length >= limit) return out;
        }
    }
    return out;
}

module.exports = { AddressBook, WebhookRegistry, ApiKeyStore, filterTxHistory };
