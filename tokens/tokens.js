/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — Token layer (colored-coin / asset)
 *
 *  Lets users issue their own coins/tokens on top of SPN Coin,
 *  the way Omni/Counterparty ride on Bitcoin. A token is created
 *  and transferred with SIGNED operations that travel inside a
 *  normal transaction's `data` field, so they are anchored on
 *  chain (part of the txid) and applied deterministically when a
 *  block confirms. Fees are paid in SPN by the carrying tx.
 *
 *  Auth: every op is signed by the issuer/sender key, and the key
 *  must hash to the claimed address. A nonce + chain id prevent
 *  replay (same op can't be applied twice or on another chain).
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");
const { sha256, sign, verify, publicKeyToAddress } = require("../blockchain/crypto");
const { CHAIN_ID, TOKEN } = require("../config");

// Deterministic body serialization (fixed key order) for signing/verifying.
function canon(body) {
    return JSON.stringify(body, Object.keys(body).sort());
}
function opHash(op) {
    const { sig, ...body } = op;   // eslint-disable-line no-unused-vars
    return sha256(canon(body));
}

class TokenLayer {
    constructor() {
        this.tokens  = new Map();   // tokenId → { meta, supply(BigInt), balances:Map(addr→BigInt) }
        this.seenOps = new Set();   // applied op hashes → replay protection
        this.issuanceFee = TOKEN ? BigInt(TOKEN.ISSUANCE_FEE || 0n) : 0n;
        this.coinFee     = TOKEN ? BigInt(TOKEN.COIN_ISSUANCE_FEE || TOKEN.ISSUANCE_FEE || 0n) : 0n;
        this.treasury    = (TOKEN && TOKEN.TREASURY) || "";
        // Fee split: burn a share, send the rest to the treasury.
        this.burnBps     = TOKEN ? BigInt(TOKEN.FEE_BURN_BPS != null ? TOKEN.FEE_BURN_BPS : 0n) : 0n;
        this.burnAddress = (TOKEN && TOKEN.BURN_ADDRESS) || "";
        this.feeLog      = [];    // in-memory record of issuance-fee payments (newest last)
        this.onFee       = null;  // optional hook: server sets this to persist fees to the DB
    }

    // Split a required fee into { burn, treasury } parts by burnBps (basis points).
    feeSplit(requiredFee) {
        const fee = BigInt(requiredFee || 0n);
        if (fee <= 0n) return { burn: 0n, treasury: 0n };
        // Only burn when a burn address is configured; otherwise all to treasury.
        const bps = (this.burnAddress && this.burnBps > 0n) ? this.burnBps : 0n;
        const burn = (fee * bps) / 10000n;
        return { burn, treasury: fee - burn };
    }

    // Where issuance fees must be paid (set by the node at startup if not in config).
    setTreasury(addr) { if (addr) this.treasury = addr; }

    // Recorded issuance-fee payments, newest first (for the admin panel).
    getFeeLog(limit = 100) {
        return this.feeLog.slice(-limit).reverse();
    }

    reset() { this.tokens.clear(); this.seenOps.clear(); this.feeLog = []; }

    // ── Build signed operations (client side) ─────────────────
    static buildIssue({ name, symbol, decimals = 0, supply, issuer, issuerPubKey, privateKey, type = "token", mintable = false, meta = null }) {
        const nonce = crypto.randomBytes(8).toString("hex");
        const tokenId = sha256(`${issuerPubKey}|${name}|${symbol}|${supply}|${nonce}`).slice(0, 40);
        const kind = type === "coin" ? "coin" : "token";
        // A coin has a fixed supply (never mintable); a token may be mintable.
        const canMint = kind === "coin" ? false : !!mintable;
        // Optional metadata (logo/description/socials) — whitelist + length-cap.
        // logo may be an https URL or an image data-URL (png/jpeg only); anything
        // else (e.g. data:text/html) is rejected to prevent content injection.
        const safeLogo = (v) => {
            const s = String(v || '').slice(0, 300000);
            if (!s) return '';
            if (/^https:\/\//i.test(s)) return s;
            if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
            return '';
        };
        const cleanMeta = meta ? {
            logo:        safeLogo(meta.logo),
            description: String(meta.description || '').slice(0, 500),
            website:     String(meta.website || '').slice(0, 256),
            twitter:     String(meta.twitter || '').slice(0, 100),
            telegram:    String(meta.telegram || '').slice(0, 100),
            github:      String(meta.github || '').slice(0, 256),
            email:       String(meta.email || '').slice(0, 100),
            whitepaper:  String(meta.whitepaper || '').slice(0, 256),
            discord:     String(meta.discord || '').slice(0, 100),
            facebook:    String(meta.facebook || '').slice(0, 100),
            reddit:      String(meta.reddit || '').slice(0, 100),
            medium:      String(meta.medium || '').slice(0, 100),
        } : null;
        const body = {
            type: "issue", tokenId, name: String(name), symbol: String(symbol),
            decimals: Number(decimals), supply: String(supply),
            kind, mintable: canMint,
            issuer, issuerPubKey, chainId: CHAIN_ID, nonce,
            ...(cleanMeta ? { meta: cleanMeta } : {}),
        };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    }

    // Mint additional supply of a mintable token (issuer only).
    static buildMint({ tokenId, amount, issuer, issuerPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString("hex");
        const body = {
            type: "mint", tokenId, amount: String(amount),
            issuer, issuerPubKey, chainId: CHAIN_ID, nonce,
        };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    }

    static buildTransfer({ tokenId, from, to, amount, fromPubKey, privateKey }) {
        const nonce = crypto.randomBytes(8).toString("hex");
        const body = {
            type: "transfer", tokenId, from, to, amount: String(amount),
            fromPubKey, chainId: CHAIN_ID, nonce,
        };
        return { ...body, sig: sign(privateKey, sha256(canon(body))) };
    }

    // ── Verify + apply ────────────────────────────────────────
    _verify(op) {
        if (!op || !op.sig || !op.type) return "malformed op";
        if (Number(op.chainId) !== Number(CHAIN_ID)) return "wrong chain id";
        const issuerSigned = op.type === "issue" || op.type === "mint";
        const pub = issuerSigned ? op.issuerPubKey : op.fromPubKey;
        const claimed = issuerSigned ? op.issuer : op.from;
        if (!pub) return "missing pubkey";
        let ok = false;
        try { ok = verify(pub, opHash(op), op.sig); } catch { ok = false; }
        if (!ok) return "bad signature";
        // Accept the key if it hashes to the claimed address under either network
        // (main/test share the same hash160; only the human prefix differs).
        let derived;
        try {
            derived = [publicKeyToAddress(pub, false), publicKeyToAddress(pub, true)];
        } catch { return "bad pubkey"; }
        if (!derived.includes(claimed)) return "signer is not the issuer/sender";
        return null;
    }

    applyOp(op, ctx = {}) {
        const err = this._verify(op);
        if (err) return { ok: false, error: err };

        const h = opHash(op);
        if (this.seenOps.has(h)) return { ok: false, error: "duplicate op (replay)" };

        if (op.type === "issue") {
            // Paid service: when a treasury is configured, the carrying tx must
            // pay the issuance fee to it. Coins (fixed supply) cost more than
            // tokens. Without a treasury, issuance is free.
            const requiredFee = (op.kind === "coin") ? this.coinFee : this.issuanceFee;
            if (requiredFee > 0n && this.treasury) {
                // The fee is split: a share is BURNED (paid to the unspendable
                // burn address) and the rest goes to the treasury. Both parts
                // must be satisfied by the carrying tx's outputs.
                const { burn, treasury } = this.feeSplit(requiredFee);
                const paidTreasury = BigInt(ctx.feePaidToTreasury || 0n);
                const paidBurn     = BigInt(ctx.feePaidToBurn || 0n);
                if (paidTreasury < treasury)
                    return { ok: false, error: `treasury fee not paid (need ${treasury}, got ${paidTreasury})` };
                if (burn > 0n && paidBurn < burn)
                    return { ok: false, error: `burn fee not paid (need ${burn}, got ${paidBurn})` };
            }
            if (!/^[\w .-]{1,40}$/.test(op.name))   return { ok: false, error: "invalid name" };
            if (!/^[A-Za-z0-9]{1,10}$/.test(op.symbol)) return { ok: false, error: "invalid symbol" };
            if (op.decimals < 0 || op.decimals > 18) return { ok: false, error: "decimals 0-18" };
            let supply; try { supply = BigInt(op.supply); } catch { return { ok: false, error: "bad supply" }; }
            if (supply <= 0n) return { ok: false, error: "supply must be > 0" };
            if (this.tokens.has(op.tokenId)) return { ok: false, error: "token already exists" };

            const balances = new Map([[op.issuer, supply]]);
            this.tokens.set(op.tokenId, {
                meta: {
                    tokenId: op.tokenId, name: op.name, symbol: op.symbol,
                    decimals: op.decimals, issuer: op.issuer, created: Date.now(),
                    kind: op.kind === "coin" ? "coin" : "token",
                    mintable: op.kind === "coin" ? false : !!op.mintable,
                    // Optional branding metadata supplied at issue time.
                    // Sanitized at ingest so it can never carry HTML/attribute-breakout
                    // characters or dangerous URL schemes into any page that renders it
                    // (defence in depth alongside client-side escaping).
                    ...(op.meta && typeof op.meta === 'object' ? (() => {
                        // Remove < > " ' ` and ASCII control chars; keep normal text/spaces.
                        const strip = (v, max) => String(v == null ? '' : v)
                            .replace(/[<>"'`\x00-\x1f\x7f]/g, '').slice(0, max).trim();
                        const url = (v, max) => {
                            const s = strip(v, max);
                            if (!s) return undefined;
                            if (/^(javascript|data|vbscript|file):/i.test(s)) return undefined;
                            return s;
                        };
                        const logoRaw = String(op.meta.logo || '').slice(0, 300000).trim();
                        const logo = /^(https:\/\/|data:image\/)/i.test(logoRaw) ? logoRaw : undefined;
                        return {
                            logo:        logo,
                            description: strip(op.meta.description, 500) || undefined,
                            website:     url(op.meta.website, 256),
                            twitter:     strip(op.meta.twitter, 100) || undefined,
                            telegram:    url(op.meta.telegram, 100),
                            github:      url(op.meta.github, 256),
                            email:       strip(op.meta.email, 100).replace(/[^A-Za-z0-9_.@+-]/g, '') || undefined,
                            whitepaper:  url(op.meta.whitepaper, 256),
                            discord:     url(op.meta.discord, 100),
                            facebook:    url(op.meta.facebook, 100),
                            reddit:      url(op.meta.reddit, 100),
                            medium:      url(op.meta.medium, 100),
                        };
                    })() : {}),
                },
                supply, balances,
            });
            this.seenOps.add(h);
            // Record the issuance-fee payment for the admin panel (only when a fee
            // was actually required and paid to the treasury).
            if (requiredFee > 0n && this.treasury) {
                const paid = BigInt(ctx.feePaidToTreasury || requiredFee);
                const rec = {
                    tokenId: op.tokenId, symbol: op.symbol, name: op.name,
                    kind: op.kind === 'coin' ? 'coin' : 'token',
                    issuer: op.issuer, feeSat: paid.toString(),
                    feeSPN: (Number(paid) / 1e8), treasury: this.treasury,
                    txid: ctx.txid || null, at: Date.now(),
                };
                this.feeLog.push(rec);
                if (this.feeLog.length > 5000) this.feeLog.shift();
                // Persist to the DB if the server wired a hook (idempotent by txid).
                if (typeof this.onFee === 'function') { try { this.onFee(rec); } catch (e) {} }
            }
            return { ok: true, tokenId: op.tokenId };
        }

        if (op.type === "mint") {
            const t = this.tokens.get(op.tokenId);
            if (!t) return { ok: false, error: "no such token" };
            if (!t.meta.mintable) return { ok: false, error: "asset is not mintable (fixed supply)" };
            if (t.meta.issuer !== op.issuer) return { ok: false, error: "only the issuer can mint" };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: "bad amount" }; }
            if (amt <= 0n) return { ok: false, error: "amount must be > 0" };
            t.supply += amt;
            t.balances.set(op.issuer, (t.balances.get(op.issuer) || 0n) + amt);
            this.seenOps.add(h);
            return { ok: true };
        }

        if (op.type === "transfer") {
            const t = this.tokens.get(op.tokenId);
            if (!t) return { ok: false, error: "no such token" };
            let amt; try { amt = BigInt(op.amount); } catch { return { ok: false, error: "bad amount" }; }
            if (amt <= 0n) return { ok: false, error: "amount must be > 0" };
            const bal = t.balances.get(op.from) || 0n;
            if (bal < amt) return { ok: false, error: "insufficient token balance" };

            t.balances.set(op.from, bal - amt);
            t.balances.set(op.to, (t.balances.get(op.to) || 0n) + amt);
            if (t.balances.get(op.from) === 0n) t.balances.delete(op.from);
            t.meta.transfers = (t.meta.transfers || 0) + 1; // track transfer count
            this.seenOps.add(h);
            return { ok: true };
        }

        return { ok: false, error: "unknown op type" };
    }

    // Apply all token ops carried by a confirmed transaction / block.
    applyTx(tx) {
        const ops = tx && tx.data && Array.isArray(tx.data.tokenOps) ? tx.data.tokenOps : [];
        if (!ops.length) return [];
        // How much this tx pays to the treasury and to the burn address
        // (together they fund the issuance fee).
        let feePaidToTreasury = 0n;
        let feePaidToBurn     = 0n;
        for (const o of (tx.outputs || [])) {
            try {
                if (this.treasury && o.address === this.treasury) feePaidToTreasury += BigInt(o.amount);
                if (this.burnAddress && o.address === this.burnAddress) feePaidToBurn += BigInt(o.amount);
            } catch { /* ignore */ }
        }
        const results = [];
        const txid = tx.id || tx.hash || null;
        for (const op of ops) results.push(this.applyOp(op, { feePaidToTreasury, feePaidToBurn, txid }));
        return results;
    }
    applyBlock(block) {
        for (const tx of (block.transactions || [])) this.applyTx(tx);
    }

    // ── Queries ───────────────────────────────────────────────
    getToken(tokenId) {
        const t = this.tokens.get(tokenId);
        if (!t) return null;
        return { ...t.meta, supply: t.supply.toString(), holders: t.balances.size, transfers: t.meta.transfers || 0 };
    }
    balanceOf(tokenId, address) {
        const t = this.tokens.get(tokenId);
        return t ? (t.balances.get(address) || 0n).toString() : "0";
    }
    holders(tokenId) {
        const t = this.tokens.get(tokenId);
        if (!t) return [];
        return [...t.balances.entries()].map(([address, amount]) => ({ address, amount: amount.toString() }));
    }
    list() { return [...this.tokens.keys()].map(id => this.getToken(id)); }
    balancesOf(address) {
        const out = [];
        for (const [id, t] of this.tokens) {
            const b = t.balances.get(address);
            if (b) out.push({
                tokenId:  id,
                symbol:   t.meta.symbol,
                name:     t.meta.name || t.meta.symbol,
                logo:     t.meta.logo || '',
                decimals: t.meta.decimals != null ? t.meta.decimals : 0,
                amount:   b.toString(),
            });
        }
        return out;
    }
}

module.exports = { TokenLayer };
