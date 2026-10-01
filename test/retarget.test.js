/**
 * Difficulty retarget boundary tests.
 *
 * Verifies that the target used when MINING the next block (getNextTarget)
 * is identical to the target the VALIDATOR requires (expectedTargetAt) — at
 * ordinary heights AND exactly on a retarget boundary. A mismatch there would
 * make freshly-mined boundary blocks get rejected.
 *
 * Run with:  node --test test/retarget.test.js
 */
'use strict';
process.env.CHAIN_ID = '3';
process.env.DIFF_WINDOW = '4';        // tiny window so boundaries are reachable
process.env.BLOCK_TIME  = '1000';     // 1s target per block

const { test } = require('node:test');
const assert = require('node:assert');
const { Blockchain } = require('../blockchain/blockchain');
const { targetToBits, bitsToTarget, POW_LIMIT } = require('../blockchain/crypto');

const WINDOW = 4;
const BLOCK_TIME = 1000;

// Build a synthetic header-only chain: expectedTargetAt only reads .bits and
// .timestamp of the blocks, so plain objects are enough.
function buildChain(n, { bits, spacingMs = BLOCK_TIME } = {}) {
    const b = bits || targetToBits(POW_LIMIT);
    const chain = [];
    for (let i = 0; i < n; i++) chain.push({ bits: b, timestamp: 1 + i * spacingMs });
    return chain;
}

test('retarget: getNextTarget equals expectedTargetAt for the next block', () => {
    const bc = new Blockchain();
    const a = bc.getNextTarget().toString();
    const b = Blockchain.expectedTargetAt(bc.chain, bc.chain.length).toString();
    assert.equal(a, b, 'mining target must equal validator target for the next block');
});

test('retarget: target is inherited OFF a boundary', () => {
    // index 3 with WINDOW 4 → 3 % 4 !== 0 → inherit previous bits.
    const chain = buildChain(3);
    const got = Blockchain.expectedTargetAt(chain, 3);
    assert.equal(got.toString(), bitsToTarget(chain[2].bits).toString());
});

test('retarget: target IS recomputed exactly ON a boundary', () => {
    // A full window of blocks that came in FASTER than target → difficulty rises
    // (target decreases). index === WINDOW triggers a retarget.
    const fast = buildChain(WINDOW + 1, { spacingMs: BLOCK_TIME / 4 });
    const cur  = bitsToTarget(fast[WINDOW - 1].bits);
    const expected = Blockchain._retarget(cur, fast[1].timestamp, fast[WINDOW - 1].timestamp);
    const got = Blockchain.expectedTargetAt(fast, WINDOW);
    assert.equal(got.toString(), expected.toString(), 'boundary target must match _retarget math');
});

test('retarget: clamps actual timespan to [1/4x, 4x] of the target window', () => {
    const cur = POW_LIMIT / 2n;
    const targetTime = BLOCK_TIME * WINDOW;
    // Extremely fast window (0 elapsed) must clamp to targetTime/4, not divide-by-zero.
    const veryFast = Blockchain._retarget(cur, 1000, 1000);
    const clampFast = (cur * BigInt(Math.floor(targetTime / 4))) / BigInt(targetTime);
    assert.equal(veryFast.toString(), clampFast.toString());
    // Extremely slow window must clamp to targetTime*4.
    const verySlow = Blockchain._retarget(cur, 0, 10 ** 9);
    const clampSlow = (cur * BigInt(targetTime * 4)) / BigInt(targetTime);
    assert.equal(verySlow.toString(), (clampSlow > POW_LIMIT ? POW_LIMIT : clampSlow).toString());
});

test('retarget: never drops below 1 or above POW_LIMIT', () => {
    const t1 = Blockchain._retarget(1n, 0, 10 ** 12);         // huge slowdown from tiny target
    assert.ok(t1 <= POW_LIMIT && t1 >= 1n);
    const t2 = Blockchain._retarget(POW_LIMIT, 1000, 1000);   // speedup from max target
    assert.ok(t2 <= POW_LIMIT && t2 >= 1n);
});
