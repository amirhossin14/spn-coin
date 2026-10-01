/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  pruner.js — Storage optimization
 *
 *  Two independent tools:
 *
 *   1. BlockPruner — once the UTXO set is fully built, historical
 *      block *bodies* below (tip − keepDepth) are no longer needed
 *      to validate new blocks (only their headers are, for the chain
 *      of PoW). This keeps the last `keepDepth` full blocks plus all
 *      headers, and reports how much can be reclaimed. Pruning is
 *      OPT-IN — an archival node keeps everything.
 *
 *   2. compactHeaders — serialize a block header to a fixed ~80-byte
 *      binary layout (Bitcoin-style) instead of verbose JSON, for
 *      cheap header-chain storage and transfer.
 */

'use strict';

// ── 1. Block pruning ─────────────────────────────────────────
class BlockPruner {
    /**
     * @param {object} opts
     * @param {number} opts.keepDepth  how many recent full blocks to retain
     */
    constructor({ keepDepth = 288 } = {}) {   // ~2 days at 10-min blocks
        this.keepDepth = keepDepth;
        this.pruned = new Set();   // heights whose bodies were dropped
    }

    /** Which heights are safe to prune right now (bodies only)? */
    prunable(chainHeight) {
        const cutoff = chainHeight - this.keepDepth;
        const out = [];
        for (let h = 0; h < cutoff; h++) if (!this.pruned.has(h)) out.push(h);
        return out;
    }

    /**
     * Prune block bodies via a caller-supplied dropBody(height) fn
     * (which nulls out transactions but MUST keep the header).
     * Returns count pruned.
     */
    prune(chainHeight, dropBody) {
        let n = 0;
        for (const h of this.prunable(chainHeight)) {
            if (dropBody(h) !== false) { this.pruned.add(h); n++; }
        }
        return n;
    }

    isPruned(height) { return this.pruned.has(height); }

    stats(chainHeight) {
        return {
            keepDepth: this.keepDepth,
            prunedBlocks: this.pruned.size,
            retainedBodies: Math.min(this.keepDepth, chainHeight + 1),
            pendingPrune: this.prunable(chainHeight).length,
        };
    }
}

// ── 2. Compact header codec (~80 bytes, Bitcoin layout) ──────
//  version(4) | prevHash(32) | merkleRoot(32) | timestamp(4) | bits(4) | nonce(4)
const HEADER_SIZE = 80;

function compactHeader(header) {
    const buf = Buffer.alloc(HEADER_SIZE);
    let o = 0;
    buf.writeUInt32LE((header.version >>> 0) || 1, o); o += 4;
    Buffer.from(header.prevHash || '0'.repeat(64), 'hex').copy(buf, o); o += 32;
    Buffer.from(header.merkleRoot || '0'.repeat(64), 'hex').copy(buf, o); o += 32;
    buf.writeUInt32LE(Math.floor((header.timestamp || 0) / 1000) >>> 0, o); o += 4;
    // bits may be a hex string ("nBits") or a number
    const bits = typeof header.bits === 'string' ? parseInt(header.bits, 16) : (header.bits || 0);
    buf.writeUInt32LE(bits >>> 0, o); o += 4;
    buf.writeUInt32LE((header.nonce >>> 0) || 0, o);
    return buf;
}

function parseHeader(buf) {
    let o = 0;
    const version = buf.readUInt32LE(o); o += 4;
    const prevHash = buf.slice(o, o + 32).toString('hex'); o += 32;
    const merkleRoot = buf.slice(o, o + 32).toString('hex'); o += 32;
    const timestamp = buf.readUInt32LE(o) * 1000; o += 4;
    const bits = buf.readUInt32LE(o).toString(16).padStart(8, '0'); o += 4;
    const nonce = buf.readUInt32LE(o);
    return { version, prevHash, merkleRoot, timestamp, bits, nonce };
}

module.exports = { BlockPruner, compactHeader, parseHeader, HEADER_SIZE };
