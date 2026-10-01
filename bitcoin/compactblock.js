/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  compactblock.js — Compact Block relay (BIP-152)
 *
 *  When a node already has most of a block's transactions in its
 *  mempool, sending the whole block again wastes bandwidth. Instead
 *  the sender transmits:
 *    • the block header,
 *    • the coinbase (always sent in full),
 *    • short 6-byte IDs for every other transaction.
 *
 *  The receiver reconstructs the block from its mempool, and only
 *  requests (getblocktxn) the few transactions it is missing. This
 *  cuts block propagation latency dramatically — a key defense against
 *  orphan blocks and centralization pressure.
 */

'use strict';

const crypto = require('crypto');

/**
 * Derive a per-block SipHash-style key from the header so short IDs
 * can't be grinded across blocks. We use sha256(header||nonce) as the
 * keyed base and take a 6-byte truncation of a keyed hash per txid.
 */
function shortIdKey(headerHash, nonce) {
    return crypto.createHash('sha256')
        .update(Buffer.from(headerHash, 'hex'))
        .update(Buffer.from(String(nonce)))
        .digest();
}

function shortId(txid, key) {
    const h = crypto.createHash('sha256').update(key).update(Buffer.from(txid, 'hex')).digest();
    return h.slice(0, 6).toString('hex');   // 48-bit short id
}

/**
 * Build a compact block from a full block.
 * @returns {{ header, nonce, coinbase, shortIds:string[], count:number }}
 */
function encodeCompact(block) {
    const nonce = crypto.randomBytes(8).toString('hex');
    const headerHash = block.hash;
    const key = shortIdKey(headerHash, nonce);
    const txs = block.transactions || [];
    const coinbase = txs[0] || null;
    const shortIds = txs.slice(1).map(tx => shortId(tx.id, key));
    return {
        header: {
            height: block.height, hash: block.hash, prevHash: block.prevHash,
            merkleRoot: block.merkleRoot, timestamp: block.timestamp,
            bits: block.bits, nonce: block.nonce, difficulty: block.difficulty,
        },
        nonce,
        coinbase,
        shortIds,
        count: txs.length,
    };
}

/**
 * Try to reconstruct the full transaction list from a compact block
 * using the receiver's mempool.
 * @param {object} compact  output of encodeCompact
 * @param {Map|object} mempoolByTxid  txid -> tx (any getter with .get or plain map)
 * @returns {{ txs:(object|null)[], missing:number[] }}
 *   `txs` has nulls where a tx is missing; `missing` lists those indexes
 *   (1-based against the block, since index 0 is the coinbase).
 */
function reconstruct(compact, mempoolByTxid) {
    const key = shortIdKey(compact.header.hash, compact.nonce);
    const getTx = (txid) => (typeof mempoolByTxid.get === 'function'
        ? mempoolByTxid.get(txid) : mempoolByTxid[txid]);

    // index mempool by short id for this block
    const byShort = new Map();
    const allTxids = typeof mempoolByTxid.keys === 'function'
        ? [...mempoolByTxid.keys()]
        : Object.keys(mempoolByTxid);
    for (const txid of allTxids) byShort.set(shortId(txid, key), getTx(txid));

    const txs = [compact.coinbase];
    const missing = [];
    compact.shortIds.forEach((sid, i) => {
        const tx = byShort.get(sid);
        if (tx) txs.push(tx);
        else { txs.push(null); missing.push(i + 1); }
    });
    return { txs, missing };
}

/** Fill in previously-missing transactions once fetched via getblocktxn. */
function fillMissing(txs, missingIndexes, fetchedTxs) {
    const out = txs.slice();
    missingIndexes.forEach((idx, k) => { out[idx] = fetchedTxs[k]; });
    return out;
}

module.exports = { encodeCompact, reconstruct, fillMissing, shortId, shortIdKey };
