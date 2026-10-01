/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  feerate.js — Fee-rate accounting (Bitcoin-style)
 *
 *  Bitcoin prioritizes transactions by fee *rate* (satoshi per virtual
 *  byte), not absolute fee. This module computes a transaction's size
 *  and virtual size (vsize — which discounts SegWit witness data),
 *  derives its fee rate, and offers a simple fee estimator based on
 *  recent mempool contents.
 *
 *  vsize = ceil(weight / 4), weight = base*3 + total  (BIP-141)
 *  Non-witness bytes count 4× (weight), witness bytes count 1×, so
 *  witness data is effectively "discounted" — the SegWit incentive.
 */

'use strict';

const WITNESS_SCALE = 4;

/** Rough byte size of a JSON-serialized value. */
function jsonBytes(obj) {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

/**
 * Split a transaction into base (non-witness) and witness byte counts.
 * A witness is any input field named `witness` (array of hex pushes).
 */
function measure(tx) {
    let witnessBytes = 0;
    const stripped = {
        version: tx.version,
        inputs: (tx.inputs || []).map(i => {
            if (i.witness) witnessBytes += jsonBytes(i.witness);
            const { witness, ...rest } = i;
            return rest;
        }),
        outputs: tx.outputs || [],
        locktime: tx.locktime || 0,
        timestamp: tx.timestamp,
        data: tx.data || null,
    };
    const baseBytes = jsonBytes(stripped);
    const totalBytes = baseBytes + witnessBytes;
    return { baseBytes, witnessBytes, totalBytes };
}

/** BIP-141 weight & virtual size. */
function weight(tx) {
    const { baseBytes, totalBytes } = measure(tx);
    return baseBytes * (WITNESS_SCALE - 1) + totalBytes; // == base*3 + total
}
function vsize(tx) {
    return Math.ceil(weight(tx) / WITNESS_SCALE);
}

/**
 * Fee rate in satoshi per virtual byte.
 * @param {bigint|number|string} fee absolute fee in satoshis
 */
function feeRate(tx, fee) {
    let vs = vsize(tx);
    if (!Number.isFinite(vs) || vs < 1) vs = 1;          // guard malformed tx / zero vsize
    const f = typeof fee === 'bigint' ? Number(fee) : Number(fee || 0);
    if (!Number.isFinite(f) || f < 0) return 0;          // guard NaN / negative fee
    return f / vs;
}

/**
 * Estimate a fee rate (sat/vB) that should get confirmed within
 * `targetBlocks`, from a snapshot of mempool entries [{ feeRate }].
 * Falls back to `minRate` when the mempool is thin.
 */
function estimateFeeRate(entries, targetBlocks = 3, minRate = 1) {
    if (!Array.isArray(entries) || entries.length < 5) return minRate;
    // Keep only finite, non-negative rates so a single NaN can't corrupt the sort.
    const rates = entries.map(e => Number(e && e.feeRate))
        .filter(r => Number.isFinite(r) && r >= 0)
        .sort((a, b) => b - a);
    if (rates.length < 5) return minRate;
    // assume ~ (mempool / targetBlocks) txs clear per block; pick that percentile
    const perBlock = Math.max(1, Math.floor(rates.length / Math.max(1, targetBlocks * 4)));
    const idx = Math.min(rates.length - 1, perBlock * targetBlocks);
    return Math.max(minRate, Math.ceil(rates[idx]));
}

module.exports = { measure, weight, vsize, feeRate, estimateFeeRate, WITNESS_SCALE };
