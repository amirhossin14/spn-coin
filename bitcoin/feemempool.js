/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  feemempool.js — Fee-aware mempool (Bitcoin Core–style)
 *
 *  Wraps transactions with fee-rate metadata and provides the four
 *  behaviors a real Bitcoin mempool needs:
 *
 *   • Block-template selection   — greedy by *ancestor* fee rate so a
 *                                  high-fee child can pull a low-fee
 *                                  parent into a block (CPFP).
 *   • Eviction under memory limit — drop the lowest fee-rate packages
 *                                  first and raise the dynamic min fee.
 *   • RBF (BIP-125)              — a conflicting tx may replace another
 *                                  if it pays a strictly higher fee AND
 *                                  a higher fee rate.
 *   • Dynamic min-relay fee     — rises as the pool fills, so spam is
 *                                  priced out.
 *
 *  Storage-agnostic: it keeps its own index and does not require the
 *  project's existing mempool — it can wrap or replace it.
 */

'use strict';

const { vsize, feeRate } = require('./feerate');

const DEFAULT_MAX_BYTES   = 300 * 1024 * 1024; // 300 MB, like Bitcoin default
const DEFAULT_MIN_RATE    = 1;                 // sat/vB floor
const DEFAULT_MAX_BLOCK   = 1_000_000;         // block weight budget proxy (vbytes)

class MempoolEntry {
    constructor(tx, fee) {
        this.tx = tx;
        this.txid = tx.id;
        this.fee = typeof fee === 'bigint' ? fee : BigInt(fee || 0);
        this.vsize = vsize(tx);
        this.feeRate = feeRate(tx, this.fee);      // sat/vB (standalone)
        this.time = Date.now();
        // ancestor/descendant aggregates (for CPFP), filled by the pool
        this.ancFee = this.fee;
        this.ancVsize = this.vsize;
        this.ancFeeRate = this.feeRate;
        // outpoints this tx spends — used for conflict/RBF detection
        this.spends = (tx.inputs || []).map(i => `${i.txid}:${i.vout}`);
    }
}

class FeeMempool {
    constructor({ maxBytes = DEFAULT_MAX_BYTES, minRate = DEFAULT_MIN_RATE,
                  blockBudget = DEFAULT_MAX_BLOCK } = {}) {
        this.maxBytes = maxBytes;
        this.minRate = minRate;         // dynamic floor
        this.baseMinRate = minRate;
        this.blockBudget = blockBudget;
        this.map = new Map();           // txid -> MempoolEntry
        this.spentBy = new Map();       // outpoint -> txid (conflict index)
        this.bytes = 0;
    }

    size() { return this.map.size; }
    has(txid) { return this.map.has(txid); }
    get(txid) { return this.map.get(txid)?.tx || null; }

    /**
     * Try to add a transaction with an absolute fee.
     * @returns {{ok:boolean, reason?:string, replaced?:string[]}}
     */
    add(tx, fee, opts = {}) {
        if (this.map.has(tx.id)) return { ok: false, reason: 'duplicate' };
        const entry = new MempoolEntry(tx, fee);

        // Reject below dynamic min relay fee — UNLESS this tx will be
        // rescued by CPFP: either it has an in-mempool child that already
        // pays a high rate, or the caller marks it as part of a package
        // (allowLowFee) because a high-fee child is arriving next.
        if (entry.feeRate < this.minRate && !opts.allowLowFee) {
            const rescuedByChild = [...this.map.values()].some(e =>
                e.tx.inputs?.some(i => i.txid === tx.id) && e.feeRate >= this.minRate);
            if (!rescuedByChild)
                return { ok: false, reason: `fee rate ${entry.feeRate.toFixed(2)} < min ${this.minRate}` };
        }

        // detect conflicts (double-spends of the same outpoint)
        const conflicts = new Set();
        for (const op of entry.spends) {
            const other = this.spentBy.get(op);
            if (other && other !== tx.id) conflicts.add(other);
        }

        if (conflicts.size) {
            // BIP-125 Replace-By-Fee: replacement must beat ALL conflicts
            // on both absolute fee and fee rate.
            let totalConflictFee = 0n;
            let maxConflictRate = 0;
            for (const cid of conflicts) {
                const c = this.map.get(cid);
                totalConflictFee += c.fee;
                maxConflictRate = Math.max(maxConflictRate, c.feeRate);
            }
            if (!(entry.fee > totalConflictFee && entry.feeRate > maxConflictRate))
                return { ok: false, reason: 'RBF: replacement fee not high enough' };
            // evict the replaced transactions (and their descendants)
            for (const cid of conflicts) this._removeWithDescendants(cid);
        }

        this._insert(entry);
        this._updateAncestors(entry);

        // enforce memory limit
        const replaced = [];
        while (this.bytes > this.maxBytes) {
            const victim = this._lowestPackage();
            if (!victim || victim.txid === tx.id) break;
            replaced.push(victim.txid);
            this._removeWithDescendants(victim.txid);
            // raising the floor prices out future spam at the eviction level
            this.minRate = Math.max(this.minRate, victim.feeRate + 1);
        }

        return { ok: true, replaced: [...conflicts, ...replaced] };
    }

    remove(txid) { this._removeWithDescendants(txid); }

    /** Remove txs that got mined in a block. */
    removeConfirmed(txs) {
        for (const tx of txs) if (this.map.has(tx.id)) this._removeWithDescendants(tx.id, false);
        this._relaxMinRate();
    }

    /**
     * Build a block template: pick transactions greedily by ancestor
     * fee rate until the weight budget is filled. Ensures parents are
     * included before children (topological), enabling CPFP.
     */
    buildBlockTemplate(budget = this.blockBudget) {
        const chosen = [];
        const included = new Set();
        let used = 0;

        // order by ancestor fee rate (CPFP-aware), highest first
        const ordered = [...this.map.values()].sort((a, b) => b.ancFeeRate - a.ancFeeRate);

        for (const entry of ordered) {
            if (included.has(entry.txid)) continue;
            // gather this tx + any in-mempool ancestors, in dependency order
            const pkg = this._ancestorPackage(entry.txid);
            const pkgVsize = pkg.reduce((s, e) => s + e.vsize, 0);
            if (used + pkgVsize > budget) continue;
            for (const e of pkg) {
                if (!included.has(e.txid)) {
                    included.add(e.txid);
                    chosen.push(e.tx);
                    used += e.vsize;
                }
            }
        }
        return { txs: chosen, vsize: used, count: chosen.length };
    }

    snapshot() {
        return [...this.map.values()].map(e => ({
            txid: e.txid, feeRate: e.feeRate, ancFeeRate: e.ancFeeRate, vsize: e.vsize,
        }));
    }

    stats() {
        return {
            count: this.map.size,
            bytes: this.bytes,
            maxBytes: this.maxBytes,
            minRate: this.minRate,
            fullPct: Math.round((this.bytes / this.maxBytes) * 100),
        };
    }

    // ── internals ──────────────────────────────────────────────
    _insert(entry) {
        this.map.set(entry.txid, entry);
        this.bytes += entry.vsize;
        for (const op of entry.spends) this.spentBy.set(op, entry.txid);
    }

    _removeWithDescendants(txid, cascade = true) {
        const entry = this.map.get(txid);
        if (!entry) return;
        if (cascade) {
            // remove any tx that spends an output of this one
            for (const [id, e] of this.map) {
                if (id === txid) continue;
                if (e.tx.inputs?.some(i => i.txid === txid)) this._removeWithDescendants(id, true);
            }
        }
        this.map.delete(txid);
        this.bytes -= entry.vsize;
        for (const op of entry.spends) if (this.spentBy.get(op) === txid) this.spentBy.delete(op);
    }

    _ancestorPackage(txid, seen = new Set()) {
        const entry = this.map.get(txid);
        if (!entry || seen.has(txid)) return [];
        const pkg = [];
        for (const inp of entry.tx.inputs || []) {
            if (this.map.has(inp.txid)) pkg.push(...this._ancestorPackage(inp.txid, seen));
        }
        seen.add(txid);
        pkg.push(entry);
        return pkg;
    }

    _updateAncestors(entry) {
        const pkg = this._ancestorPackage(entry.txid);
        let fee = 0n, vs = 0;
        for (const e of pkg) { fee += e.fee; vs += e.vsize; }
        entry.ancFee = fee;
        entry.ancVsize = vs;
        entry.ancFeeRate = vs ? Number(fee) / vs : entry.feeRate;
    }

    _lowestPackage() {
        let lowest = null;
        for (const e of this.map.values())
            if (!lowest || e.ancFeeRate < lowest.ancFeeRate) lowest = e;
        return lowest;
    }

    _relaxMinRate() {
        // slowly decay the dynamic floor back toward base when there's room
        if (this.bytes < this.maxBytes * 0.5 && this.minRate > this.baseMinRate)
            this.minRate = Math.max(this.baseMinRate, Math.floor(this.minRate / 2));
    }
}

module.exports = { FeeMempool, MempoolEntry };
