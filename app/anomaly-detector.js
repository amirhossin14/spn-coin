/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  🔎 Anomaly Detector — pattern analysis for suspicious activity
 *
 *  Learns the network's normal behaviour from recent blocks and
 *  flags transactions / addresses that deviate. This is heuristic
 *  pattern analysis (not ML magic) — transparent, explainable rules
 *  that each contribute to a risk score.
 *
 *  Detected patterns:
 *    - Dust flooding      (many tiny outputs)
 *    - Whale movements    (value far above the rolling norm)
 *    - Fan-out / peeling  (1 input → many outputs, laundering-style)
 *    - Rapid-fire address (same address in a burst of txs)
 *    - Fee anomalies      (fee far from the network norm)
 *    - Self-churn         (address sending mostly to itself)
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

const SAT = 100000000n;

class AnomalyDetector {
  constructor(opts = {}) {
    // Rolling baselines learned from observed transactions.
    this.baseline = {
      avgOutputs:   2,
      avgValue:     0,      // in SPN
      avgFee:       0,      // in SPN
      samples:      0,
    };
    // Short-term memory of address activity for burst detection.
    this.addrActivity = new Map();   // address -> [timestamps]
    this.events = [];                // recent anomaly events (ring buffer)
    this.maxEvents = opts.maxEvents || 500;
    this.burstWindowMs = opts.burstWindowMs || 60000; // 1 min
    this.burstThreshold = opts.burstThreshold || 8;   // txs/min from one addr
    this.dustThreshold = opts.dustThreshold ?? 0.001; // SPN
    this.whaleMultiplier = opts.whaleMultiplier || 20; // x baseline avg value
    this.fanoutThreshold = opts.fanoutThreshold || 10; // outputs from 1 input
  }

  // ── Learn from a confirmed transaction (updates baselines) ──
  observe(tx) {
    if (!tx || tx.isCoinbase) return;
    const outs = (tx.outputs || []).length;
    const value = Number(this._txValue(tx)) / 1e8;
    const fee = Number(tx.fee || 0) / 1e8;

    const n = this.baseline.samples;
    // incremental moving average
    this.baseline.avgOutputs = (this.baseline.avgOutputs * n + outs) / (n + 1);
    this.baseline.avgValue   = (this.baseline.avgValue   * n + value) / (n + 1);
    this.baseline.avgFee     = (this.baseline.avgFee     * n + fee) / (n + 1);
    this.baseline.samples    = Math.min(n + 1, 10000);
  }

  // Learn from an entire block at once.
  observeBlock(block) {
    for (const tx of (block.transactions || [])) this.observe(tx);
  }

  // ── Analyze a transaction → { score, level, flags } ──
  analyze(tx) {
    const flags = [];
    let score = 0;
    if (!tx || tx.isCoinbase) return { score: 0, level: 'clean', flags };

    const outs = tx.outputs || [];
    const ins = tx.inputs || [];
    const value = Number(this._txValue(tx)) / 1e8;
    const fee = Number(tx.fee || 0) / 1e8;

    // 1) Dust flooding — many sub-dust outputs
    const dustOuts = outs.filter(o => (Number(o.amount || 0) / 1e8) < this.dustThreshold).length;
    if (dustOuts >= 5) {
      score += Math.min(40, dustOuts * 3);
      flags.push({ type: 'dust_flood', detail: `${dustOuts} dust outputs`, weight: Math.min(40, dustOuts * 3) });
    }

    // 2) Whale movement — value far above baseline
    if (this.baseline.samples > 20 && this.baseline.avgValue > 0) {
      const ratio = value / this.baseline.avgValue;
      if (ratio >= this.whaleMultiplier) {
        const w = Math.min(30, Math.round(ratio));
        score += w;
        flags.push({ type: 'whale_move', detail: `${ratio.toFixed(1)}× network avg value`, weight: w });
      }
    }

    // 3) Fan-out / peeling — 1-2 inputs to many outputs
    if (ins.length <= 2 && outs.length >= this.fanoutThreshold) {
      const w = Math.min(35, outs.length * 2);
      score += w;
      flags.push({ type: 'fan_out', detail: `${ins.length}→${outs.length} peeling pattern`, weight: w });
    }

    // 4) Fee anomaly — fee wildly off baseline
    if (this.baseline.samples > 20 && this.baseline.avgFee > 0) {
      const feeRatio = fee / this.baseline.avgFee;
      if (feeRatio > 50) {
        score += 15;
        flags.push({ type: 'fee_high', detail: `fee ${feeRatio.toFixed(0)}× normal`, weight: 15 });
      } else if (fee === 0 && value > this.baseline.avgValue) {
        score += 10;
        flags.push({ type: 'fee_zero', detail: 'zero fee on large tx', weight: 10 });
      }
    }

    // 5) Self-churn — most output value returns to an input address
    const inAddrs = new Set(ins.map(i => i.address).filter(Boolean));
    if (inAddrs.size) {
      let selfValue = 0n;
      for (const o of outs) if (inAddrs.has(o.address)) selfValue += BigInt(o.amount || 0);
      const selfRatio = Number(selfValue) / Number(this._txValue(tx) || 1n);
      if (selfRatio > 0.9 && outs.length > 2) {
        score += 12;
        flags.push({ type: 'self_churn', detail: `${(selfRatio * 100).toFixed(0)}% returns to sender`, weight: 12 });
      }
    }

    // 6) Rapid-fire burst — record & check address activity
    for (const addr of inAddrs) {
      const burst = this._recordActivity(addr);
      if (burst >= this.burstThreshold) {
        score += Math.min(25, burst * 2);
        flags.push({ type: 'rapid_fire', detail: `${burst} txs/min from ${addr.slice(0, 10)}…`, weight: Math.min(25, burst * 2) });
        break;
      }
    }

    score = Math.min(100, Math.round(score));
    const level = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : score > 0 ? 'low' : 'clean';

    if (score >= 20) {
      this._pushEvent({ txid: tx.id, score, level, flags, ts: Date.now() });
    }
    return { score, level, flags };
  }

  // ── Scan the whole mempool, return ranked suspicious txs ──
  scanMempool(mempool) {
    // mempool stores entries in a Map (txid → { tx, ... }); support several shapes
    let txs = [];
    if (mempool.txs && typeof mempool.txs.values === 'function')
      txs = Array.from(mempool.txs.values()).map(e => e.tx || e);
    else if (typeof mempool.getAll === 'function')
      txs = mempool.getAll();
    else if (Array.isArray(mempool.transactions))
      txs = mempool.transactions;

    const results = [];
    for (const tx of txs) {
      const r = this.analyze(tx);
      if (r.score >= 20) results.push({ txid: tx.id, ...r });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // ── Helpers ──
  _txValue(tx) {
    let v = 0n;
    for (const o of (tx.outputs || [])) v += BigInt(o.amount || 0);
    return v;
  }

  _recordActivity(addr) {
    const now = Date.now();
    let arr = this.addrActivity.get(addr) || [];
    arr = arr.filter(t => now - t < this.burstWindowMs);
    arr.push(now);
    this.addrActivity.set(addr, arr);
    // prune map occasionally
    if (this.addrActivity.size > 5000) {
      for (const [k, v] of this.addrActivity) if (!v.length || now - v[v.length - 1] > this.burstWindowMs) this.addrActivity.delete(k);
    }
    return arr.length;
  }

  _pushEvent(e) {
    this.events.unshift(e);
    if (this.events.length > this.maxEvents) this.events.pop();
  }

  getEvents(limit = 100) { return this.events.slice(0, limit); }

  getStats() {
    const byLevel = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const e of this.events) if (byLevel[e.level] != null) byLevel[e.level]++;
    return {
      baseline: {
        avgOutputs: +this.baseline.avgOutputs.toFixed(2),
        avgValue:   +this.baseline.avgValue.toFixed(4),
        avgFee:     +this.baseline.avgFee.toFixed(6),
        samples:    this.baseline.samples,
      },
      totalEvents: this.events.length,
      byLevel,
      trackedAddresses: this.addrActivity.size,
    };
  }
}

module.exports = { AnomalyDetector };
