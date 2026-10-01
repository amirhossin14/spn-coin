/**
 * mining-pool/blocktemplate.js
 *
 * The bridge that makes Stratum mining CONSENSUS-EXACT.
 *
 * Both Stratum servers (TCP and WebSocket) build their work from here, so the
 * header a miner solves is byte-identical to the block the core validates:
 *
 *   • buildTemplate()  — snapshot the next block's shared parts (height, prevHash,
 *                        bits from the real getNextDifficulty(), mempool txs, fees,
 *                        a base timestamp). One template is shared by all miners.
 *   • buildCandidate() — turn the template + a specific miner into a real Block,
 *                        with a DETERMINISTIC coinbase (so the same (miner, jobId,
 *                        nonce) always reproduces the same block hash on the server).
 *
 * The candidate returned is a genuine Block, so candidate.canonicalHeader(),
 * candidate.powHash() and candidate.target() are exactly what consensus uses.
 */
'use strict';

const { Block }       = require('../blockchain/blockchain');
const { Transaction } = require('../utxo/utxo');
const { merkleRoot, targetToBits } = require('../blockchain/crypto');

/** Snapshot the shared, miner-independent parts of the next block. */
function buildTemplate(blockchain, mempool) {
    const tip        = blockchain.tip;
    const height     = blockchain.height + 1;
    const difficulty = blockchain.getNextDifficulty ? blockchain.getNextDifficulty() : tip.difficulty;
    const bits       = (typeof blockchain.getNextTarget === 'function') ? targetToBits(blockchain.getNextTarget()) : Block.diffToBits(difficulty);
    const sel        = mempool.selectForBlock(900_000, 2999);
    const totalFees  = BigInt(sel.totalFees || 0n);
    // BIP-113 safe base time: strictly after median-time-past and the tip.
    const mtp        = Number(blockchain.getMedianTimePast ? blockchain.getMedianTimePast() : 0);
    const baseTs     = Math.max(Date.now(), mtp + 1, Number(tip.timestamp) + 1);
    return {
        height,
        prevHash:     tip.hash,
        bits,
        difficulty,
        transactions: sel.transactions || [],
        totalFees,
        baseTs,
        version:      1,
        chainId:      tip.chainId,
    };
}

/**
 * Build the real candidate Block for one miner. Deterministic in
 * (minerAddress, workerId, jobId, nonce, timestamp) — so the server can
 * reproduce the exact block a miner solved, byte for byte.
 */
function buildCandidate(tpl, opts) {
    const {
        minerAddress, workerId = '', jobId = '',
        nonce = 0, timestamp = null,
        poolFee = 0, poolAddress = null,
    } = opts;

    const expectedReward = Block.getReward(tpl.height);
    const gross          = expectedReward + BigInt(tpl.totalFees || 0n);
    const feeBps         = BigInt(Math.max(0, Math.min(10000, Math.round((poolFee || 0) * 10000))));
    const poolFeeAmt     = (gross * feeBps) / 10000n;
    const minerReward    = gross - poolFeeAmt;

    // Deterministic coinbase → stable txid → stable merkle root → stable hash.
    const coinbaseTx = Transaction.createCoinbase({
        blockHeight:  tpl.height,
        minerAddress,
        reward:       minerReward,
        extraData:    `${workerId}:${jobId}`,
        nonce:        '00000000',   // pinned
        timestamp:    tpl.baseTs,   // pinned
    });

    const txs = [coinbaseTx, ...tpl.transactions];
    const mr  = merkleRoot(txs.map(t => t.id));

    const block = new Block({
        version:      tpl.version,
        height:       tpl.height,
        prevHash:     tpl.prevHash,
        merkleRoot:   mr,
        timestamp:    timestamp != null ? Number(timestamp) : tpl.baseTs,
        difficulty:   tpl.difficulty,
        bits:         tpl.bits,
        nonce:        typeof nonce === 'bigint' ? Number(nonce) : (nonce | 0),
        miner:        minerAddress,
        transactions: txs,
        chainId:      tpl.chainId,
    });

    return { block, gross, minerReward, poolFeeAmt };
}

module.exports = { buildTemplate, buildCandidate };
