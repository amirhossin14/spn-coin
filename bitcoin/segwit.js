/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  segwit.js — Segregated Witness (BIP-141)
 *
 *  SegWit moves the signature ("witness") out of the transaction body.
 *  Consequences implemented here:
 *
 *   • txid   = hash of the tx WITHOUT witness data (so signatures no
 *              longer change the txid → fixes transaction malleability).
 *   • wtxid  = hash of the tx WITH witness data.
 *   • The block's coinbase carries a *witness commitment*: the merkle
 *     root of all wtxids, so witness data is still committed to by PoW
 *     without bloating the txid-based merkle tree.
 *
 *  This is a model implementation over the project's JSON tx format,
 *  keeping the same security properties (malleability fix, witness
 *  discount via feerate.js) without depending on Bitcoin's exact
 *  serialization.
 */

'use strict';

const crypto = require('crypto');

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest();
}
function hash256(buf) {
    return sha256(sha256(buf));
}
function hash256hex(str) {
    return hash256(Buffer.from(str, 'utf8')).toString('hex');
}

/**
 * Strip witness data from a tx to compute the malleability-free txid.
 * Witness lives on each input as `input.witness` (array of hex items).
 */
function stripWitness(tx) {
    return {
        version: tx.version,
        inputs: (tx.inputs || []).map(i => ({
            txid: i.txid, vout: i.vout, sequence: i.sequence, script: i.script,
        })),
        outputs: tx.outputs || [],
        locktime: tx.locktime || 0,
        timestamp: tx.timestamp,
        data: tx.data || null,
    };
}

/** Malleability-free transaction id (no witness). */
function computeTxid(tx) {
    return hash256hex(JSON.stringify(stripWitness(tx)));
}

/** Witness transaction id (includes witness). Equals txid if no witness. */
function computeWtxid(tx) {
    const hasWitness = (tx.inputs || []).some(i => i.witness && i.witness.length);
    if (!hasWitness) return computeTxid(tx);
    const full = {
        ...stripWitness(tx),
        witnesses: (tx.inputs || []).map(i => i.witness || []),
    };
    return hash256hex(JSON.stringify(full));
}

function isSegwit(tx) {
    return (tx.inputs || []).some(i => i.witness && i.witness.length);
}

/** Move a signature into the witness area of an input (P2WPKH-style). */
function toWitnessInput(input, signature, pubkey) {
    const { signature: _s, ...rest } = input;
    return { ...rest, script: '', witness: [signature, pubkey] };
}

// ── Merkle root helper (double-sha over hex leaves) ──────────
function merkleRoot(hexLeaves) {
    if (!hexLeaves.length) return '0'.repeat(64);
    let layer = hexLeaves.map(h => Buffer.from(h, 'hex'));
    while (layer.length > 1) {
        if (layer.length % 2) layer.push(layer[layer.length - 1]); // duplicate last
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
            next.push(hash256(Buffer.concat([layer[i], layer[i + 1]])));
        layer = next;
    }
    return layer[0].toString('hex');
}

/**
 * Compute the witness commitment for a block's transactions.
 * The coinbase wtxid is defined as all-zero (it has no meaningful
 * witness of its own), exactly as in BIP-141.
 */
function witnessCommitment(txs, witnessReservedValue = '00'.repeat(32)) {
    const wtxids = txs.map((tx, i) => (i === 0 ? '0'.repeat(64) : computeWtxid(tx)));
    const witnessMerkle = merkleRoot(wtxids);
    // commitment = hash256(witnessMerkleRoot || reservedValue)
    return hash256(Buffer.concat([
        Buffer.from(witnessMerkle, 'hex'),
        Buffer.from(witnessReservedValue, 'hex'),
    ])).toString('hex');
}

/** Verify a block's coinbase witness commitment matches its txs. */
function verifyWitnessCommitment(txs, commitment, witnessReservedValue = '00'.repeat(32)) {
    return witnessCommitment(txs, witnessReservedValue) === commitment;
}

module.exports = {
    stripWitness, computeTxid, computeWtxid, isSegwit, toWitnessInput,
    merkleRoot, witnessCommitment, verifyWitnessCommitment,
};
