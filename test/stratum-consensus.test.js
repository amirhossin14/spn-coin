/**
 * Stratum ↔ Consensus unification tests.
 *
 * Proves the mining pool now produces work that is byte-identical to what the
 * consensus core validates: a header the miner solves reconstructs the exact
 * block the chain accepts. Run:  node --test test/stratum-consensus.test.js
 */
'use strict';
process.env.CHAIN_ID = '3';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const { Blockchain, Block } = require('../blockchain/blockchain');
const { buildTemplate, buildCandidate } = require('../mining-pool/blocktemplate');

const MINER = 'SPN1TestMinerAAAAAAAAAAAAAAAAAA';

// Minimal mempool stub: no pending txs, zero fees.
const mockMempool = {
    selectForBlock: () => ({ transactions: [], totalFees: 0n }),
    removeConfirmed: () => {},
};

describe('Stratum ↔ Consensus unification', () => {

    test('Block.canonicalHeader is the single source for hash & PoW', () => {
        const bc = new Blockchain();
        const tpl = buildTemplate(bc, mockMempool);
        const { block } = buildCandidate(tpl, { minerAddress: MINER, workerId: 'w1', jobId: 'job1' });
        // computeHash / powHash must be derived from canonicalHeaderString.
        const { sha256d, powHash } = require('../blockchain/crypto');
        assert.equal(block.computeHash(), sha256d(block.canonicalHeaderString()));
        assert.equal(block.powHash(),     powHash(block.canonicalHeaderString()));
    });

    test('a solved candidate IS a valid consensus block', () => {
        const bc = new Blockchain();
        const tpl = buildTemplate(bc, mockMempool);

        // "Mine": iterate nonce until the candidate's own PoW target is met.
        let solved = null;
        for (let nonce = 0; nonce < 500000; nonce++) {
            const { block } = buildCandidate(tpl, {
                minerAddress: MINER, workerId: 'w1', jobId: 'job1', nonce,
            });
            const { hashMeetsTarget } = require('../blockchain/crypto');
            if (hashMeetsTarget(block.powHash(), block.target())) { solved = block; break; }
        }
        assert.ok(solved, 'should find a nonce that meets the (low testnet) target');

        // The solved block must pass full consensus validation and be accepted.
        solved.hash = solved.computeHash();
        const res = solved.validate(bc.tip, bc.utxoSet, bc.chain.length, Number(bc.getMedianTimePast()));
        assert.strictEqual(res.valid, true, 'solved candidate must pass consensus validate(): ' + res.errors.join('; '));

        const added = bc.addBlock(solved);
        assert.strictEqual(added.ok, true, 'chain must accept the solved candidate');
        assert.strictEqual(bc.tip.hash, solved.hash, 'accepted block is the exact candidate');
    });

    test('rebuilding with the same (miner, jobId, nonce) is deterministic', () => {
        const bc = new Blockchain();
        const tpl = buildTemplate(bc, mockMempool);
        const a = buildCandidate(tpl, { minerAddress: MINER, workerId: 'w1', jobId: 'j', nonce: 42 }).block;
        const b = buildCandidate(tpl, { minerAddress: MINER, workerId: 'w1', jobId: 'j', nonce: 42 }).block;
        assert.equal(a.computeHash(), b.computeHash(), 'same inputs ⇒ same block hash (deterministic coinbase)');
    });

    test('different miners get different candidates (per-miner jobs)', () => {
        const bc = new Blockchain();
        const tpl = buildTemplate(bc, mockMempool);
        const a = buildCandidate(tpl, { minerAddress: MINER, workerId: 'w1', jobId: 'j', nonce: 1 }).block;
        const b = buildCandidate(tpl, { minerAddress: 'SPN1OtherMinerBBBBBBBBBBBBBBBBB', workerId: 'w2', jobId: 'j', nonce: 1 }).block;
        assert.notEqual(a.merkleRoot, b.merkleRoot, 'different coinbase ⇒ different merkle root');
        assert.notEqual(a.computeHash(), b.computeHash(), 'different miners ⇒ different block');
    });
});
