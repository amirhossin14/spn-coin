/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  coinselect.js — Wallet coin selection (Bitcoin Core–style)
 *
 *  Choosing which UTXOs to spend is a real optimization problem.
 *  Bitcoin Core uses "Branch and Bound" (BnB) to find a set of coins
 *  that exactly funds the target + fee with NO change output (cheaper,
 *  more private), and falls back to a randomized knapsack when an exact
 *  match isn't found.
 *
 *  Fee-aware: every input costs bytes, so the effective value of a coin
 *  is (value − inputSize × feeRate). Dust-value coins can even be
 *  negative and are skipped.
 */

'use strict';

const INPUT_VBYTES  = 68;   // approx vbytes an input adds (P2WPKH-ish)
const OUTPUT_VBYTES = 31;   // approx vbytes a change output adds
const BASE_VBYTES   = 11;   // fixed tx overhead

// Convert an amount to BigInt satoshi WITHOUT losing precision. Integer strings
// (the normal on-wire form for satoshi amounts) are parsed straight to BigInt;
// only genuinely fractional/other inputs fall back to Number. The old version ran
// every value through Number() first, corrupting amounts above 2^53.
const n = (v) => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.round(v)) : 0n;
    const s = String(v ?? '0').trim();
    if (/^-?\d+$/.test(s)) return BigInt(s);            // exact integer satoshi
    const f = Number(s);
    return Number.isFinite(f) ? BigInt(Math.round(f)) : 0n;
};

/** Effective value of a utxo after paying for its own input. */
function effectiveValue(utxo, feeRate) {
    return n(utxo.amount ?? utxo.value) - n(Math.ceil(INPUT_VBYTES * feeRate));
}

/**
 * Branch and Bound: try to find a subset whose total effective value
 * lands within [target, target + costOfChange]. Returns the subset or
 * null if no exact-ish match exists.
 */
function branchAndBound(utxos, target, feeRate, costOfChange) {
    const eff = utxos
        .map(u => ({ u, ev: effectiveValue(u, feeRate) }))
        .filter(x => x.ev > 0n)
        .sort((a, b) => (b.ev > a.ev ? 1 : b.ev < a.ev ? -1 : 0));

    const total = eff.reduce((s, x) => s + x.ev, 0n);
    if (total < target) return null;

    const upper = target + costOfChange;
    let best = null;
    const MAX_TRIES = 100_000;
    let tries = 0;

    function recurse(i, selected, sum) {
        if (best || tries++ > MAX_TRIES) return;
        if (sum > upper) return;                 // overshoot → prune
        if (sum >= target) { best = selected.slice(); return; }
        if (i >= eff.length) return;
        // include eff[i]
        recurse(i + 1, [...selected, eff[i].u], sum + eff[i].ev);
        // exclude eff[i]
        recurse(i + 1, selected, sum);
    }
    recurse(0, [], 0n);
    return best;
}

/**
 * Randomized knapsack fallback (single random draw + improvement),
 * always produces a funding set if the wallet has enough, using a
 * change output.
 */
function knapsack(utxos, target, feeRate) {
    const eff = utxos
        .map(u => ({ u, ev: effectiveValue(u, feeRate) }))
        .filter(x => x.ev > 0n);

    // shuffle
    for (let i = eff.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eff[i], eff[j]] = [eff[j], eff[i]];
    }
    const picked = [];
    let sum = 0n;
    const changeCost = n(Math.ceil(OUTPUT_VBYTES * feeRate));
    for (const x of eff) {
        picked.push(x.u);
        sum += x.ev;
        if (sum >= target + changeCost) break;
    }
    if (sum < target) return null;
    return picked;
}

/**
 * Select coins to fund `targetAmount` at `feeRate` (sat/vB).
 * @returns {{ inputs, fee, change, changeNeeded } | null}
 */
function selectCoins(utxos, targetAmount, feeRate = 1) {
    const target = n(targetAmount);
    const costOfChange = n(Math.ceil((OUTPUT_VBYTES + INPUT_VBYTES) * feeRate));

    // 1) try exact-match Branch and Bound (no change)
    let chosen = branchAndBound(utxos, target, feeRate, costOfChange);
    let changeNeeded = false;

    // 2) fall back to knapsack (with change)
    if (!chosen) {
        chosen = knapsack(utxos, target, feeRate);
        changeNeeded = true;
    }
    if (!chosen) return null;

    // compute concrete fee & change for the chosen set
    const inputsValue = chosen.reduce((s, u) => s + n(u.amount ?? u.value), 0n);
    const numOutputs = changeNeeded ? 2 : 1;
    const vbytes = BASE_VBYTES + chosen.length * INPUT_VBYTES + numOutputs * OUTPUT_VBYTES;
    const fee = n(Math.ceil(vbytes * feeRate));
    let change = inputsValue - target - fee;

    if (change < 0n) {
        // fee ate into change; try adding one more coin if available
        return null;
    }
    // if change is dust, drop it into the fee instead of making an output
    const dust = n(Math.ceil((OUTPUT_VBYTES + INPUT_VBYTES) * feeRate));
    if (changeNeeded && change < dust) { change = 0n; changeNeeded = false; }

    return {
        inputs: chosen,
        fee: fee + (changeNeeded ? 0n : 0n),
        change,
        changeNeeded,
        vbytes,
    };
}

module.exports = { selectCoins, effectiveValue, branchAndBound, knapsack,
    INPUT_VBYTES, OUTPUT_VBYTES, BASE_VBYTES };
