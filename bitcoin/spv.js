/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  spv.js — Bloom filters (BIP-37) + SPV merkle proofs
 *
 *  A light (SPV) wallet doesn't store the whole chain. Instead it:
 *   1. Sends the full node a Bloom filter of the addresses/outpoints
 *      it cares about.
 *   2. The node returns only matching transactions plus a *merkle
 *      proof* that each tx is in a given block — so the light client
 *      can verify inclusion against the block header it already trusts
 *      (via PoW) without downloading the block.
 *
 *  This module provides the Bloom filter and the merkle-proof
 *  generate/verify pair.
 */

'use strict';

const crypto = require('crypto');

// ── Bloom filter (BIP-37 style, murmur-ish via sha256 seeds) ──
class BloomFilter {
    /**
     * @param {number} n  expected element count
     * @param {number} fp desired false-positive rate (e.g. 0.001)
     */
    constructor(n = 100, fp = 0.001, { size, hashes, bits } = {}) {
        if (size && hashes) {
            this.size = size;
            this.hashes = hashes;
        } else {
            // optimal m (bits) and k (hash functions)
            this.size = Math.max(8, Math.ceil((-n * Math.log(fp)) / (Math.LN2 ** 2)));
            this.hashes = Math.max(1, Math.round((this.size / n) * Math.LN2));
        }
        this.bits = bits ? Buffer.from(bits, 'hex') : Buffer.alloc(Math.ceil(this.size / 8));
    }

    _indexes(item) {
        const buf = Buffer.isBuffer(item) ? item : Buffer.from(String(item), 'utf8');
        const idxs = [];
        for (let i = 0; i < this.hashes; i++) {
            const h = crypto.createHash('sha256')
                .update(buf).update(Buffer.from([i])).digest();
            const v = h.readUInt32BE(0) % this.size;
            idxs.push(v);
        }
        return idxs;
    }

    insert(item) {
        for (const i of this._indexes(item)) this.bits[i >> 3] |= (1 << (i & 7));
        return this;
    }

    contains(item) {
        return this._indexes(item).every(i => (this.bits[i >> 3] & (1 << (i & 7))) !== 0);
    }

    /** Does this tx touch anything in the filter? (addresses / outpoints) */
    matchesTx(tx) {
        if (this.contains(tx.id)) return true;
        for (const o of tx.outputs || []) if (o.address && this.contains(o.address)) return true;
        for (const i of tx.inputs || []) {
            if (this.contains(`${i.txid}:${i.vout}`)) return true;
            if (i.address && this.contains(i.address)) return true;
        }
        return false;
    }

    toJSON() {
        return { size: this.size, hashes: this.hashes, bits: this.bits.toString('hex') };
    }
    static fromJSON(o) {
        return new BloomFilter(0, 0, { size: o.size, hashes: o.hashes, bits: o.bits });
    }
}

// ── Merkle proof (SPV inclusion) ─────────────────────────────
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function hash256(buf) { return sha256(sha256(buf)); }

/** Build a merkle proof that txid at `index` is under `txids`' root. */
function buildMerkleProof(txids, index) {
    if (index < 0 || index >= txids.length) return null;
    let layer = txids.map(h => Buffer.from(h, 'hex'));
    const proof = [];
    let idx = index;
    while (layer.length > 1) {
        if (layer.length % 2) layer.push(layer[layer.length - 1]);
        const pairIndex = idx ^ 1;
        proof.push({ hash: layer[pairIndex].toString('hex'), right: (idx & 1) === 0 });
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
            next.push(hash256(Buffer.concat([layer[i], layer[i + 1]])));
        layer = next;
        idx = Math.floor(idx / 2);
    }
    return { txid: txids[index], index, proof, root: layer[0].toString('hex') };
}

/** Verify a merkle proof against a trusted merkle root. */
function verifyMerkleProof(txid, proof, root) {
    let acc = Buffer.from(txid, 'hex');
    for (const step of proof) {
        const sib = Buffer.from(step.hash, 'hex');
        acc = step.right ? hash256(Buffer.concat([acc, sib]))
                         : hash256(Buffer.concat([sib, acc]));
    }
    return acc.toString('hex') === root;
}

module.exports = { BloomFilter, buildMerkleProof, verifyMerkleProof };
