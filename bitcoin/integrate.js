/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  integrate.js — Activate the Bitcoin feature modules in the LIVE core.
 *
 *  Everything here is applied by calling integrateBitcoin({...}) once
 *  at startup. Each hook is defensive: if anything unexpected happens
 *  it falls back to the original behavior, so enabling integration can
 *  never break block production or validation.
 *
 *  What it wires:
 *    1. Mempool  → fee-rate (vsize) accounting, RBF, CPFP-aware
 *                  block-template selection.
 *    2. mineBlock→ adds a SegWit witness commitment to the coinbase.
 *    3. addBlock → verifies the witness commitment of incoming blocks.
 *    4. Blockchain.buildLocator() for the headers-first sync manager.
 */

'use strict';

const feerate = require('./feerate');
const segwit = require('./segwit');
const { FeeMempool } = require('./feemempool');
const compact = require('./compactblock');
const { BloomFilter, buildMerkleProof } = require('./spv');

function integrateBitcoin({ blockchain, mempool, p2p, app, log = console.log } = {}) {
    const report = { mempool: false, mining: false, validation: false, locator: false,
                     compactBlocks: false, spv: false };

    // ── 1. Upgrade the mempool with fee-rate + RBF + CPFP ──────
    if (mempool) {
        try {
            const shadow = new FeeMempool({
                minRate: parseInt(process.env.MIN_RELAY_RATE, 10) || 1,
            });

            // wrap add(): keep original validation, then mirror into the
            // fee-aware shadow pool so selection/RBF can use it.
            const origAdd = mempool.add?.bind(mempool);
            if (origAdd) {
                mempool.add = function (tx, utxoSet, blockHeight = 0) {
                    const res = origAdd(tx, utxoSet, blockHeight);
                    if (res && res.ok) {
                        try { shadow.add(tx, BigInt(tx.fee || 0), { allowLowFee: true }); } catch { /* ignore */ }
                    }
                    return res;
                };
            }

            const origRemove = mempool.remove?.bind(mempool);
            if (origRemove) {
                mempool.remove = function (txid) {
                    try { shadow.remove(txid); } catch { /* ignore */ }
                    return origRemove(txid);
                };
            }

            const origRemoveConf = mempool.removeConfirmed?.bind(mempool);
            if (origRemoveConf) {
                mempool.removeConfirmed = function (txs) {
                    try { shadow.removeConfirmed(txs); } catch { /* ignore */ }
                    return origRemoveConf(txs);
                };
            }

            // CPFP/vsize-aware selection: prefer the shadow's block template,
            // fall back to the original fee-rate ordering.
            const origTopN = mempool.getTopN?.bind(mempool);
            mempool.getTopN = function (n = 500) {
                try {
                    const tmpl = shadow.buildBlockTemplate();
                    if (tmpl.txs.length) return tmpl.txs.slice(0, n);
                } catch { /* fall through */ }
                return origTopN ? origTopN(n) : [];
            };

            // expose fee estimation + richer stats
            mempool.estimateFeeRate = (target = 3) => feerate.estimateFeeRate(shadow.snapshot(), target);
            const origStats = mempool.getStats?.bind(mempool);
            mempool.getStats = function () {
                const base = origStats ? origStats() : { count: mempool.size?.() };
                let ext = {};
                try { ext = shadow.stats(); } catch { /* ignore */ }
                return { ...base, feeMempool: ext };
            };

            mempool.__shadow = shadow; // for inspection/tests
            report.mempool = true;
        } catch (e) { log('[integrate] mempool wiring skipped:', e.message); }
    }

    // ── 2. mineBlock: attach witness commitment to coinbase ────
    if (blockchain && typeof blockchain.mineBlock === 'function') {
        try {
            const origMine = blockchain.mineBlock.bind(blockchain);
            blockchain.mineBlock = function (args) {
                const res = origMine(args);
                try {
                    const block = res && (res.block || res);
                    if (block && Array.isArray(block.transactions) && block.transactions.length) {
                        const commit = segwit.witnessCommitment(block.transactions);
                        const cb = block.transactions[0];
                        cb.witnessCommitment = commit;
                        if (Array.isArray(cb.outputs)) {
                            // OP_RETURN-style commitment output (value 0)
                            cb.outputs.push({ address: null, amount: '0', commitment: commit });
                        }
                    }
                } catch { /* commitment is best-effort; never block mining */ }
                return res;
            };
            report.mining = true;
        } catch (e) { log('[integrate] mining wiring skipped:', e.message); }
    }

    // ── 3. addBlock: verify witness commitment if present ──────
    if (blockchain && typeof blockchain.addBlock === 'function') {
        try {
            const origAdd = blockchain.addBlock.bind(blockchain);
            blockchain.addBlock = function (block) {
                try {
                    const cb = block?.transactions?.[0];
                    const stated = cb?.witnessCommitment
                        || cb?.outputs?.find?.(o => o && o.commitment)?.commitment;
                    if (stated && !segwit.verifyWitnessCommitment(block.transactions, stated)) {
                        return { ok: false, error: 'Invalid SegWit witness commitment' };
                    }
                } catch { /* if verification itself errors, defer to original */ }
                return origAdd(block);
            };
            report.validation = true;
        } catch (e) { log('[integrate] validation wiring skipped:', e.message); }
    }

    // ── 4. buildLocator() for headers-first sync ───────────────
    if (blockchain && typeof blockchain.buildLocator !== 'function') {
        try {
            blockchain.buildLocator = function () {
                const loc = [];
                let step = 1;
                let h = (this.chain?.length ?? 1) - 1;
                while (h >= 0) {
                    loc.push(this.chain[h].hash);
                    if (h === 0) break;
                    h = Math.max(0, h - step);
                    if (loc.length > 10) step *= 2;
                }
                return loc;
            };
            report.locator = true;
        } catch (e) { log('[integrate] locator wiring skipped:', e.message); }
    }

    // ── 5. Compact block relay (BIP-152) ──────────────────────
    if (p2p && typeof p2p.broadcastBlock === 'function') {
        try {
            // Offer a compact broadcast that peers can reconstruct from their
            // mempool. We keep the original broadcastBlock as the fallback the
            // receiver requests when it is missing transactions.
            p2p.broadcastCompactBlock = function (block) {
                try {
                    const cmpct = compact.encodeCompact(block);
                    if (typeof p2p._broadcast === 'function') {
                        p2p._broadcast('cmpctblock', cmpct);
                        return true;
                    }
                } catch { /* fall back below */ }
                return p2p.broadcastBlock(block);
            };

            // Reconstruct incoming compact blocks from our mempool.
            p2p.reconstructCompactBlock = function (cmpct) {
                const byTxid = new Map();
                // prefer the fee-aware shadow pool if present, else the base pool
                const pool = mempool?.__shadow || mempool;
                if (pool && typeof pool.get === 'function' && pool.map) {
                    for (const txid of pool.map.keys()) byTxid.set(txid, pool.get(txid));
                } else if (mempool?.txs) {
                    for (const [txid, e] of mempool.txs) byTxid.set(txid, e.tx || e);
                }
                return compact.reconstruct(cmpct, byTxid);
            };

            // When mining, prefer compact relay for lower propagation latency.
            if (blockchain && typeof blockchain.mineBlock === 'function') {
                const prevMine = blockchain.mineBlock.bind(blockchain);
                blockchain.mineBlock = function (args) {
                    const res = prevMine(args);
                    try {
                        const block = res && (res.block || res);
                        if (block && p2p.broadcastCompactBlock) p2p.broadcastCompactBlock(block);
                    } catch { /* relay is best-effort */ }
                    return res;
                };
            }
            report.compactBlocks = true;
        } catch (e) { log('[integrate] compact-block wiring skipped:', e.message); }
    }

    // ── 6. SPV endpoints for light clients ────────────────────
    if (app && typeof app.get === 'function') {
        try {
            // A light client posts a bloom filter of its addresses; we return
            // matching transactions from recent blocks + merkle proofs.
            app.post('/api/spv/filter', (req, res) => {
                try {
                    const { filter, fromHeight = 0 } = req.body || {};
                    if (!filter) return res.status(400).json({ error: 'filter required' });
                    const bf = BloomFilter.fromJSON(filter);
                    const matches = [];
                    const chain = blockchain.chain || [];
                    for (let h = Math.max(0, fromHeight); h < chain.length; h++) {
                        const block = chain[h];
                        const txs = block.transactions || [];
                        const txids = txs.map(t => t.id);
                        txs.forEach((tx, i) => {
                            if (bf.matchesTx(tx)) {
                                const proof = buildMerkleProof(txids, i);
                                matches.push({ height: h, tx, proof });
                            }
                        });
                    }
                    res.json({ ok: true, matches, tip: chain.length - 1 });
                } catch (e) { res.status(400).json({ error: 'spv filter failed' }); }
            });

            // Merkle proof for a single txid in a given block height.
            app.get('/api/spv/proof/:height/:txid', (req, res) => {
                try {
                    const h = parseInt(req.params.height, 10);
                    const block = (blockchain.chain || [])[h];
                    if (!block) return res.status(404).json({ error: 'no such block' });
                    const txids = (block.transactions || []).map(t => t.id);
                    const idx = txids.indexOf(req.params.txid);
                    if (idx < 0) return res.status(404).json({ error: 'tx not in block' });
                    res.json({ ok: true, ...buildMerkleProof(txids, idx), height: h });
                } catch (e) { res.status(400).json({ error: 'proof failed' }); }
            });
            report.spv = true;
        } catch (e) { log('[integrate] spv wiring skipped:', e.message); }
    }

    log('🔗 [integrate] bitcoin core wiring:',
        Object.entries(report).filter(([, v]) => v).map(([k]) => k).join(' · ') || 'none');
    return report;
}

module.exports = { integrateBitcoin };
