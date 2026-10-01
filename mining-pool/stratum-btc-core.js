/**
 * stratum-btc-core.js — the byte-exact core of a STANDARD Bitcoin Stratum pool.
 *
 * PHASE 2 of the ASIC roadmap. These pure functions produce and reconstruct
 * exactly what a real SHA-256 ASIC (via ckpool/cpuminer-style Stratum) does:
 *
 *   • buildCoinbase()      → coinbase1 / coinbase2 split around the extraNonce,
 *                            with a BIP34 height push (height lives in the
 *                            coinbase, not the 80-byte header).
 *   • assembleCoinbase()   → coinbase1 + extraNonce1 + extraNonce2 + coinbase2
 *   • coinbaseHash()       → double-SHA256 of the coinbase (internal order)
 *   • merkleRootFromBranch() → fold coinbase hash through the merkle branch
 *   • headerHash()         → build the 80-byte header and double-SHA256 it
 *
 * The server and the miner run the SAME functions, so a share the miner solves
 * reconstructs the exact same block hash on the server — the property that
 * makes ASIC mining work.
 */
'use strict';
const btc = require('../blockchain/btc-serialize');

function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function u64le(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }

/** BIP34 coinbase height push: <len> <height little-endian, minimal>. */
function heightScript(height) {
    if (!height) return Buffer.from([0x00]);
    const bytes = [];
    let h = height;
    while (h > 0) { bytes.push(h & 0xff); h = Math.floor(h / 256); }
    // Keep it a positive script number: if the top bit is set, append 0x00.
    if (bytes[bytes.length - 1] & 0x80) bytes.push(0x00);
    return Buffer.concat([Buffer.from([bytes.length]), Buffer.from(bytes)]);
}

/**
 * Split the coinbase transaction around the extraNonce insertion point.
 * @returns {{coinbase1: string, coinbase2: string}} (hex)
 */
function buildCoinbase({ height, scriptPubKeyHex, reward, extraNonce1Size, extraNonce2Size, tag = 'SPN' }) {
    const heightPush = heightScript(height);
    const tagBuf     = Buffer.from(tag, 'utf8');
    const spk        = Buffer.from(scriptPubKeyHex, 'hex');
    const scriptSigLen = heightPush.length + extraNonce1Size + extraNonce2Size + tagBuf.length;

    // everything up to (but not including) the extraNonce
    const coinbase1 = Buffer.concat([
        u32le(1),                          // tx version
        Buffer.from([0x01]),               // input count
        Buffer.alloc(32),                  // prevout txid (null)
        Buffer.from('ffffffff', 'hex'),    // prevout vout
        btc.varint(scriptSigLen),          // scriptSig length
        heightPush,                        // scriptSig: BIP34 height
    ]);
    // everything after the extraNonce
    const coinbase2 = Buffer.concat([
        tagBuf,                            // rest of scriptSig (miner tag)
        Buffer.from('ffffffff', 'hex'),    // input sequence
        Buffer.from([0x01]),               // output count
        u64le(reward),                     // output value (satoshi)
        btc.varint(spk.length), spk,       // output scriptPubKey
        u32le(0),                          // locktime
    ]);
    return { coinbase1: coinbase1.toString('hex'), coinbase2: coinbase2.toString('hex') };
}

/** coinbase = coinbase1 + extraNonce1 + extraNonce2 + coinbase2 (all hex). */
function assembleCoinbase(coinbase1, extraNonce1, extraNonce2, coinbase2) {
    return coinbase1 + extraNonce1 + extraNonce2 + coinbase2;
}

/** double-SHA256 of the coinbase hex → Buffer (internal/LE order). */
function coinbaseHash(coinbaseHex) {
    return btc.dsha256(Buffer.from(coinbaseHex, 'hex'));
}

/** Fold a coinbase hash (Buffer, internal order) through the merkle branch
 *  (array of hex hashes, internal order) → merkle root Buffer (internal order). */
function merkleRootFromBranch(coinbaseHashBuf, branchHex) {
    let h = coinbaseHashBuf;
    for (const b of (branchHex || [])) {
        h = btc.dsha256(Buffer.concat([h, Buffer.from(b, 'hex')]));
    }
    return h;
}

/**
 * Build the 80-byte header and return its double-SHA256 in DISPLAY hex.
 * @param version               int32
 * @param prevHashInternalHex   32-byte prev block hash, INTERNAL (LE) order hex
 * @param merkleRootInternal    Buffer, INTERNAL (LE) order
 * @param ntime, nbits, nonce   uint32
 */
function headerHash({ version, prevHashInternalHex, merkleRootInternal, ntime, nbits, nonce }) {
    const buf = Buffer.concat([
        u32le(version),
        Buffer.from(prevHashInternalHex, 'hex'),
        merkleRootInternal,
        u32le(ntime), u32le(nbits), u32le(nonce),
    ]);
    return Buffer.from(btc.dsha256(buf)).reverse().toString('hex');
}

/** display hash → internal (LE) hex, and vice-versa. */
function toInternalHex(displayHex) { return Buffer.from(displayHex, 'hex').reverse().toString('hex'); }

module.exports = {
    heightScript, buildCoinbase, assembleCoinbase, coinbaseHash,
    merkleRootFromBranch, headerHash, toInternalHex, u32le, u64le,
};
