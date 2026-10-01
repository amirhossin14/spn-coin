/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  token-extensions.js — Extra token capabilities layered onto
 *  the existing TokenLayer WITHOUT modifying tokens.js.
 *
 *  Adds these signed operation types:
 *    • burn            — permanently destroy tokens you hold
 *    • freeze/unfreeze — issuer freezes an address (compliance)
 *    • transfer-owner  — hand issuer/admin rights to another address
 *    • set-meta        — attach logo/description/website/social links
 *
 *  Plus read helpers the API/UI use:
 *    • distribution()  — holder buckets for a pie/bar chart
 *    • search()        — filter/sort tokens for the explorer
 *
 *  All state-changing ops are signed and replay-protected exactly
 *  like the core ops (chainId + nonce + issuer/holder signature).
 */

'use strict';

const crypto = require('crypto');
const { sha256, sign, verify } = require('../blockchain/crypto');
const { CHAIN_ID } = require('../config');

// Recursively sorts object keys at EVERY depth (must match public/token-sign.js
// canon()). The old version passed a top-level key array to JSON.stringify, which
// silently dropped nested keys — leaving part of a nested op body unsigned.
function _sortDeep(v) {
    if (Array.isArray(v)) return v.map(_sortDeep);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = _sortDeep(v[k]);
        return out;
    }
    return v;
}
function canon(body) { return JSON.stringify(_sortDeep(body)); }
function opHash(op) { const { sig, ...b } = op; return sha256(canon(b)); }

// ── Client-side op builders (signed) ─────────────────────────
const ExtOps = {
    buildBurn({ tokenId, amount, holder, holderPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'burn', tokenId, amount: String(amount), holder, holderPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildFreeze({ tokenId, target, freeze, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: freeze ? 'freeze' : 'unfreeze', tokenId, target, issuer, issuerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildTransferOwner({ tokenId, newIssuer, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        const body = { type: 'transfer-owner', tokenId, newIssuer, issuer, issuerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
    buildSetMeta({ tokenId, meta, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString('hex');
        // only whitelist a few safe metadata fields
        const clean = {
            logo: String(meta.logo || '').slice(0, 300000),
            description: String(meta.description || '').slice(0, 500),
            website: String(meta.website || '').slice(0, 256),
            twitter: String(meta.twitter || '').slice(0, 100),
            telegram: String(meta.telegram || '').slice(0, 100),
        };
        const body = { type: 'set-meta', tokenId, meta: clean, issuer, issuerPubKey, chainId: CHAIN_ID, nonce };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    },
};

/**
 * Install the extension op handlers + query helpers on a TokenLayer
 * instance. Wraps applyOp so new op types are handled first, and
 * everything else falls through to the original.
 */
function extendTokenLayer(tokens) {
    if (!tokens || tokens.__extended) return tokens;
    tokens.__extended = true;

    // per-token frozen-address sets & extra meta live in side maps so we
    // never fight the core token shape.
    tokens._frozen = new Map();   // tokenId -> Set(address)
    tokens._extraMeta = new Map(); // tokenId -> {logo,description,...}

    const frozenSet = (id) => {
        if (!tokens._frozen.has(id)) tokens._frozen.set(id, new Set());
        return tokens._frozen.get(id);
    };

    // helper mirrors tokens.js _verify for the new ops
    const verifyExt = (op) => {
        if (!op || !op.sig || !op.type) return 'malformed op';
        if (Number(op.chainId) !== Number(CHAIN_ID)) return 'wrong chain id';
        const issuerSigned = op.type !== 'burn';
        const pub = issuerSigned ? op.issuerPubKey : op.holderPubKey;
        if (!pub) return 'missing pubkey';
        let ok = false;
        try { ok = verify(pub, opHash(op), op.sig); } catch { ok = false; }
        return ok ? null : 'bad signature';
    };

    const origApplyOp = tokens.applyOp.bind(tokens);

    // When a coin/token is issued, auto-derive and record its dedicated
    // on-chain address in the extra metadata (deterministic, no key stored).
    const { deriveCoinAddress } = require('./coin-address');
    const applyWithCoinAddr = function (op, ctx = {}) {
        const res = origApplyOp(op, ctx);
        try {
            if (op?.type === 'issue' && res && res.ok) {
                const coin = deriveCoinAddress(op.tokenId, op.issuer);
                const prev = tokens._extraMeta.get(op.tokenId) || {};
                tokens._extraMeta.set(op.tokenId, { ...prev, coinAddress: coin.address });
            }
        } catch { /* best-effort */ }
        return res;
    };

    tokens.applyOp = function (op, ctx = {}) {
        const EXT = ['burn', 'freeze', 'unfreeze', 'transfer-owner', 'set-meta'];
        if (!EXT.includes(op?.type)) return applyWithCoinAddr(op, ctx);

        const err = verifyExt(op);
        if (err) return { ok: false, error: err };
        const h = opHash(op);
        if (tokens.seenOps.has(h)) return { ok: false, error: 'duplicate op (replay)' };

        const t = tokens.tokens.get(op.tokenId);
        if (!t) return { ok: false, error: 'no such token' };

        // issuer-only ops must be signed by the current issuer
        const issuerOnly = ['freeze', 'unfreeze', 'transfer-owner', 'set-meta'];
        if (issuerOnly.includes(op.type) && t.meta.issuer !== op.issuer)
            return { ok: false, error: 'only the issuer can perform this action' };

        if (op.type === 'burn') {
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: 'bad amount' }; }
            if (amt <= 0n) return { ok: false, error: 'amount must be > 0' };
            const bal = t.balances.get(op.holder) || 0n;
            if (bal < amt) return { ok: false, error: 'insufficient balance to burn' };
            t.balances.set(op.holder, bal - amt);
            if (t.balances.get(op.holder) === 0n) t.balances.delete(op.holder);
            t.supply -= amt;               // supply permanently reduced
            tokens.seenOps.add(h);
            return { ok: true, burned: amt.toString(), newSupply: t.supply.toString() };
        }

        if (op.type === 'freeze' || op.type === 'unfreeze') {
            const set = frozenSet(op.tokenId);
            if (op.type === 'freeze') set.add(op.target); else set.delete(op.target);
            tokens.seenOps.add(h);
            return { ok: true, frozen: op.type === 'freeze', target: op.target };
        }

        if (op.type === 'transfer-owner') {
            if (!op.newIssuer) return { ok: false, error: 'newIssuer required' };
            t.meta.issuer = op.newIssuer;
            tokens.seenOps.add(h);
            return { ok: true, newIssuer: op.newIssuer };
        }

        if (op.type === 'set-meta') {
            tokens._extraMeta.set(op.tokenId, { ...(tokens._extraMeta.get(op.tokenId) || {}), ...op.meta });
            tokens.seenOps.add(h);
            return { ok: true };
        }

        return { ok: false, error: 'unknown ext op' };
    };

    // block transfers FROM a frozen address (wrap core transfer check)
    const origApplyOpForFreeze = tokens.applyOp.bind(tokens);
    tokens.applyOp = function (op, ctx = {}) {
        if (op?.type === 'transfer') {
            const set = tokens._frozen.get(op.tokenId);
            if (set && (set.has(op.from) || set.has(op.to)))
                return { ok: false, error: 'address is frozen for this token' };
        }
        return origApplyOpForFreeze(op, ctx);
    };

    tokens.isFrozen = (tokenId, address) => !!tokens._frozen.get(tokenId)?.has(address);

    // ── Query helpers ─────────────────────────────────────────
    tokens.getMeta = function (tokenId) {
        const base = tokens.getToken(tokenId);
        if (!base) return null;
        return { ...base, extra: tokens._extraMeta.get(tokenId) || {}, frozen: [...(tokens._frozen.get(tokenId) || [])] };
    };

    tokens.distribution = function (tokenId, buckets = 5) {
        const t = tokens.tokens.get(tokenId);
        if (!t) return null;
        const holders = [...t.balances.entries()]
            .map(([addr, bal]) => ({ address: addr, amount: bal.toString(), raw: bal }))
            .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0));
        const supply = t.supply || 1n;
        const top = holders.slice(0, buckets).map(h => ({
            address: h.address, amount: h.amount,
            percent: Number((h.raw * 10000n) / supply) / 100,
        }));
        const restRaw = holders.slice(buckets).reduce((s, h) => s + h.raw, 0n);
        return {
            tokenId, totalHolders: holders.length, supply: supply.toString(),
            top,
            others: restRaw > 0n ? { amount: restRaw.toString(), percent: Number((restRaw * 10000n) / supply) / 100 } : null,
        };
    };

    tokens.search = function ({ q = '', kind = 'all', sort = 'holders', limit = 50 } = {}) {
        let list = tokens.list().map(tk => ({ ...tk, ...(tokens._extraMeta.get(tk.tokenId) ? { extra: tokens._extraMeta.get(tk.tokenId) } : {}) }));
        if (q) {
            const s = q.toLowerCase();
            list = list.filter(tk =>
                tk.name.toLowerCase().includes(s) ||
                tk.symbol.toLowerCase().includes(s) ||
                tk.tokenId.includes(s));
        }
        if (kind !== 'all') list = list.filter(tk => tk.kind === kind);
        const sorters = {
            holders: (a, b) => b.holders - a.holders,
            supply: (a, b) => (BigInt(b.supply) > BigInt(a.supply) ? 1 : -1),
            newest: (a, b) => (b.created || 0) - (a.created || 0),
            name: (a, b) => a.name.localeCompare(b.name),
        };
        list.sort(sorters[sort] || sorters.holders);
        return list.slice(0, limit);
    };

    return tokens;
}

module.exports = { extendTokenLayer, ExtOps };
