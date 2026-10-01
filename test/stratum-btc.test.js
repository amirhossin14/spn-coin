/**
 * Standard Bitcoin Stratum core — proven with a SIMULATED ASIC miner.
 *
 * The "miner" here does byte-for-byte what a real SHA-256 ASIC does over
 * Stratum: assemble the coinbase from (coinbase1 + extraNonce1 + extraNonce2 +
 * coinbase2), compute the merkle root through the branch, build the 80-byte
 * header, and roll the nonce until the hash meets the target. The "server" then
 * reconstructs from only (extraNonce2, ntime, nonce) and must arrive at the
 * SAME block hash — the property that makes real ASIC mining work.
 *
 * Run: node --test test/stratum-btc.test.js
 */
'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert');
const S = require('../mining-pool/stratum-btc-core');
const btc = require('../blockchain/btc-serialize');

describe('Standard Bitcoin Stratum — simulated ASIC round-trip', () => {

    // A job the pool would advertise (coinbase-only block: empty merkle branch).
    const job = S.buildCoinbase({
        height: 42,
        scriptPubKeyHex: btc.p2pkhScript('135080cafbe4d43d38296069eb58bdc284c3472f'),
        reward: 5000000000n,
        extraNonce1Size: 4,
        extraNonce2Size: 4,
        tag: 'SPN',
    });
    const merkleBranch = [];                 // no other txs
    const prevDisplay  = 'a'.repeat(64);     // some previous block hash (display order)
    const prevInternal = S.toInternalHex(prevDisplay);
    const version = 1;
    const nbits   = 0x207fffff;              // very easy target (regtest-like)
    const extraNonce1 = 'deadbeef';          // server-assigned (4 bytes)

    // ── The "miner" (what an ASIC does) ──────────────────────────
    function mine(extraNonce2, ntime) {
        const coinbase = S.assembleCoinbase(job.coinbase1, extraNonce1, extraNonce2, job.coinbase2);
        const cbHash   = S.coinbaseHash(coinbase);
        const root     = S.merkleRootFromBranch(cbHash, merkleBranch);
        // roll the nonce until the hash is <= an easy target (top nibble 0)
        for (let nonce = 0; nonce < 200000; nonce++) {
            const hash = S.headerHash({ version, prevHashInternalHex: prevInternal,
                merkleRootInternal: root, ntime, nbits, nonce });
            if (hash.startsWith('0')) return { extraNonce2, ntime, nonce, hash };
        }
        throw new Error('no nonce found');
    }

    // ── The "server" (reconstructs from the submitted share) ─────
    function reconstruct(extraNonce2, ntime, nonce) {
        const coinbase = S.assembleCoinbase(job.coinbase1, extraNonce1, extraNonce2, job.coinbase2);
        const cbHash   = S.coinbaseHash(coinbase);
        const root     = S.merkleRootFromBranch(cbHash, merkleBranch);
        return S.headerHash({ version, prevHashInternalHex: prevInternal,
            merkleRootInternal: root, ntime, nbits, nonce });
    }

    test('coinbase1 begins with the tx version and a single null input', () => {
        assert.ok(job.coinbase1.startsWith('01000000' + '01' + '00'.repeat(32) + 'ffffffff'));
    });

    test('BIP34 height push encodes the height inside the coinbase', () => {
        // height 42 = 0x2a → push "012a"
        assert.strictEqual(S.heightScript(42).toString('hex'), '012a');
        assert.ok(job.coinbase1.includes('012a'));
    });

    test('server reconstructs the EXACT hash the miner solved', () => {
        const share = mine('00000001', 1700000000);
        const serverHash = reconstruct(share.extraNonce2, share.ntime, share.nonce);
        assert.strictEqual(serverHash, share.hash, 'miner and server must agree on the block hash');
        assert.ok(share.hash.startsWith('0'), 'solved hash meets the easy target');
    });

    test('a different extraNonce2 yields a different coinbase → different search space', () => {
        const a = S.assembleCoinbase(job.coinbase1, extraNonce1, '00000001', job.coinbase2);
        const b = S.assembleCoinbase(job.coinbase1, extraNonce1, '00000002', job.coinbase2);
        assert.notStrictEqual(S.coinbaseHash(a).toString('hex'), S.coinbaseHash(b).toString('hex'));
    });

    test('reconstruction is deterministic', () => {
        const h1 = reconstruct('00000001', 1700000000, 12345);
        const h2 = reconstruct('00000001', 1700000000, 12345);
        assert.strictEqual(h1, h2);
    });
});
