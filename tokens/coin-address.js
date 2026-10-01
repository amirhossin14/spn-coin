/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  coin-address.js — Dedicated & vanity addresses for coins
 *
 *  Two capabilities:
 *
 *   1. Deterministic per-coin address. Every issued coin gets a
 *      dedicated "coin address" derived from the tokenId + issuer.
 *      It's recorded in the token metadata and can be used as the
 *      coin's treasury / deployer identity on-chain. Being derived,
 *      it's reproducible by anyone and needs no stored key.
 *
 *   2. Vanity address generator. Grinds fresh keypairs until the
 *      resulting address matches a desired pattern (e.g. starts with
 *      the coin's symbol). Runs client- or server-side; the private
 *      key is returned to the caller and never stored by the node.
 *
 *  Grinding is bounded (max attempts / time) so it can't hang.
 */

'use strict';

const crypto = require('crypto');
const {
    generateKeyPair, publicKeyToAddress, keyPairFromRawPrivate,
} = require('../blockchain/crypto');

// ── 1. Deterministic per-coin address ────────────────────────
/**
 * Derive a stable, reproducible address label for a coin. This is NOT
 * a spendable key — it's a deterministic identifier (like a contract
 * address in spirit) so every node computes the same coin address.
 *
 * If you need a *spendable* dedicated wallet for the coin, use
 * generateCoinWallet() instead.
 */
function deriveCoinAddress(tokenId, issuer) {
    const h = crypto.createHash('sha256').update(`coin:${tokenId}:${issuer}`).digest();
    // Build a fake-but-valid-looking address by hashing into the same
    // pipeline the wallet uses: treat the 32-byte hash as a pseudo-pubkey
    // seed, then run it through publicKeyToAddress via a derived keypair.
    // For determinism we derive a private scalar from the hash.
    const scalarHex = h.toString('hex');
    try {
        const kp = keyPairFromRawPrivate(scalarHex);
        return { address: kp.address, derivedFrom: tokenId, spendable: false };
    } catch {
        // extremely unlikely (invalid scalar) — rehash once
        const h2 = crypto.createHash('sha256').update(h).digest('hex');
        const kp = keyPairFromRawPrivate(h2);
        return { address: kp.address, derivedFrom: tokenId, spendable: false };
    }
}

// ── 2. Dedicated spendable wallet for a coin ─────────────────
/**
 * Generate a brand-new keypair to act as a coin's dedicated wallet
 * (treasury/deployer). The caller is responsible for storing the key
 * securely — the node never persists it.
 */
function generateCoinWallet() {
    const kp = generateKeyPair();
    return { address: kp.address, publicKey: kp.publicKey, privateKey: kp.privateKey, spendable: true };
}

// ── 3. Vanity address generator ──────────────────────────────
/**
 * Grind keypairs until the address matches `pattern`.
 * @param {object} opts
 * @param {string} opts.prefix    desired prefix AFTER the network prefix
 *                                 (e.g. "SPN" addresses → match "Cat" so
 *                                 the address reads SPN...Cat-ish). Case
 *                                 sensitivity per `caseSensitive`.
 * @param {string} opts.contains  substring that must appear anywhere.
 * @param {boolean} opts.caseSensitive  default false.
 * @param {number} opts.maxAttempts  hard cap (default 200k).
 * @param {number} opts.timeoutMs    wall-clock cap (default 8s).
 * @returns {{found:boolean, attempts:number, address?, publicKey?, privateKey?}}
 */
function generateVanity({ prefix = '', contains = '', caseSensitive = false,
                          maxAttempts = 200000, timeoutMs = 8000 } = {}) {
    if (!prefix && !contains) return { found: false, attempts: 0, error: 'prefix or contains required' };

    const netPrefixLen = guessNetworkPrefixLen();
    const norm = (s) => (caseSensitive ? s : s.toLowerCase());
    const wantPrefix = norm(prefix);
    const wantContains = norm(contains);

    const start = Date.now();
    let attempts = 0;
    while (attempts < maxAttempts && (Date.now() - start) < timeoutMs) {
        attempts++;
        const kp = generateKeyPair();
        const addr = kp.address;
        // strip the network prefix (e.g. "SPN") before matching the vanity part
        const body = addr.slice(netPrefixLen);
        const nb = norm(body);
        const okPrefix = !wantPrefix || nb.startsWith(wantPrefix);
        const okContains = !wantContains || nb.includes(wantContains);
        if (okPrefix && okContains) {
            return { found: true, attempts, address: addr,
                publicKey: kp.publicKey, privateKey: kp.privateKey };
        }
    }
    return { found: false, attempts, timedOut: (Date.now() - start) >= timeoutMs };
}

/** Estimate how many leading chars are the fixed network prefix. */
function guessNetworkPrefixLen() {
    // Sample several fresh addresses and take their longest common prefix.
    // With a fixed version byte the brand+version prefix (e.g. "SPN1B") is
    // constant, so we must skip ALL of it before matching the vanity part.
    try {
        const samples = [];
        for (let i = 0; i < 8; i++) samples.push(generateKeyPair().address);
        let len = samples[0].length;
        for (const s of samples.slice(1)) {
            let i = 0;
            while (i < len && i < s.length && s[i] === samples[0][i]) i++;
            len = i;
        }
        return Math.min(len, 6); // cap so we never consume the whole address
    } catch { return 5; }
}

/** Difficulty hint: expected attempts for a given pattern length. */
function vanityDifficulty(pattern, alphabetSize = 58) {
    const n = (pattern || '').length;
    if (!n) return 1;
    return Math.pow(alphabetSize, n);
}

// ── 4. Rich per-token contract identity ──────────────────────
/**
 * Build a complete, deterministic on-chain identity for a token —
 * analogous to a smart-contract address, but richer. Every node
 * computes the same identity from the token's immutable fields, so it
 * needs no stored key and can't be forged.
 *
 * Returns:
 *   • contractAddress — the dedicated per-coin address (SPN1…/SPNt…)
 *   • contractId      — a short, human-readable id ("spnc:<12hex>")
 *   • fingerprint     — full 64-hex identity hash (binds all core fields)
 *   • checksum        — 8-char short checksum for quick visual matching
 *   • explorerRef     — canonical explorer path for this token
 *
 * @param {object} meta token meta ({ tokenId, issuer, symbol, name,
 *                       decimals, supply, kind }). Only immutable fields
 *                       feed the fingerprint so branding edits don't change it.
 */
function deriveContractIdentity(meta, testnet = false) {
    if (!meta || !meta.tokenId) return null;
    const core = [
        meta.tokenId,
        meta.issuer || '',
        meta.symbol || '',
        String(meta.decimals != null ? meta.decimals : 0),
        String(meta.supply != null ? meta.supply : ''),
        meta.kind || 'token',
    ].join('|');
    const fingerprint = crypto.createHash('sha256').update('spn-contract:' + core).digest('hex');
    const checksum = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 8);
    const { address } = deriveCoinAddress(meta.tokenId, meta.issuer || '');
    return {
        contractAddress: address,
        contractId:      'spnc:' + fingerprint.slice(0, 12),
        fingerprint,
        checksum,
        network:         testnet ? 'testnet' : 'mainnet',
        explorerRef:     '/token.html?id=' + meta.tokenId,
    };
}

module.exports = {
    deriveCoinAddress, generateCoinWallet, generateVanity,
    vanityDifficulty, guessNetworkPrefixLen, deriveContractIdentity,
};
