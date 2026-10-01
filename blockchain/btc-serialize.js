/**
 * btc-serialize.js — Bitcoin-EXACT binary serialization.
 *
 * PHASE 1 of the ASIC-compatibility roadmap. Implements the byte-for-byte
 * binary format that real Bitcoin (and every SHA-256 ASIC / standard Stratum
 * pool software) expects:
 *
 *   • The 80-byte block header  (version | prevHash | merkleRoot | time | bits | nonce)
 *   • double-SHA256 block hash  (little-endian internally, reversed for display)
 *   • varint, transaction serialization, and the binary merkle root
 *
 * Proven correct by reproducing Bitcoin's real genesis-block hash from its
 * header fields (see test/btc-serialize.test.js). Nothing here touches the
 * existing JSON consensus yet — it is a self-contained, verifiable foundation.
 */
'use strict';

const crypto = require('crypto');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function dsha256(buf) { return sha256(sha256(buf)); }

// Reverse a hex string byte-wise (Bitcoin stores hashes in little-endian
// "internal" order but displays them big-endian).
function reverseHexBytes(hex) {
    const b = Buffer.from(hex, 'hex');
    return Buffer.from(b).reverse();
}

// Bitcoin variable-length integer (CompactSize).
function varint(n) {
    n = Number(n);
    if (n < 0xfd) return Buffer.from([n]);
    if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
    if (n <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b; }
    const b = Buffer.alloc(9); b[0] = 0xff; b.writeBigUInt64LE(BigInt(n), 1); return b;
}

/**
 * Serialize the 80-byte block header exactly as Bitcoin does.
 * @param {object} h
 *   h.version    number (int32)
 *   h.prevHash   hex string, DISPLAY order (big-endian) — reversed here
 *   h.merkleRoot hex string, DISPLAY order (big-endian) — reversed here
 *   h.time       number (uint32, seconds)
 *   h.bits       number OR hex string (compact nBits, e.g. 0x1d00ffff)
 *   h.nonce      number (uint32)
 * @returns {Buffer} 80 bytes
 */
function serializeHeader(h) {
    const buf = Buffer.alloc(80);
    let o = 0;
    buf.writeInt32LE(h.version | 0, o); o += 4;
    reverseHexBytes(h.prevHash).copy(buf, o);   o += 32;
    reverseHexBytes(h.merkleRoot).copy(buf, o); o += 32;
    buf.writeUInt32LE(h.time >>> 0, o); o += 4;
    const bits = typeof h.bits === 'string' ? parseInt(h.bits, 16) : h.bits;
    buf.writeUInt32LE(bits >>> 0, o); o += 4;
    buf.writeUInt32LE(h.nonce >>> 0, o); o += 4;
    return buf;
}

/** double-SHA256 of the 80-byte header, returned in DISPLAY (big-endian) hex. */
function headerHash(h) {
    return Buffer.from(dsha256(serializeHeader(h))).reverse().toString('hex');
}

/** Bitcoin binary merkle root from an array of txids (DISPLAY-order hex).
 *  Returns the root in DISPLAY-order hex. Odd rows duplicate the last item. */
function merkleRoot(txidsHex) {
    if (!txidsHex.length) return '0'.repeat(64);
    // work in internal (little-endian) byte order
    let layer = txidsHex.map(reverseHexBytes);
    while (layer.length > 1) {
        if (layer.length % 2) layer.push(layer[layer.length - 1]);
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
            next.push(dsha256(Buffer.concat([layer[i], layer[i + 1]])));
        layer = next;
    }
    return Buffer.from(layer[0]).reverse().toString('hex');
}

/**
 * Serialize a transaction to Bitcoin's exact LEGACY (non-witness) binary form.
 * @param {object} tx
 *   tx.version   number (int32, default 1)
 *   tx.inputs    [{ txid (display hex), vout (uint32), script (hex scriptSig), sequence (uint32) }]
 *   tx.outputs   [{ value (satoshis: number|bigint|string), script (hex scriptPubKey) }]
 *   tx.locktime  number (uint32, default 0)
 * @returns {Buffer}
 */
function serializeTx(tx) {
    const parts = [];
    const v = Buffer.alloc(4); v.writeInt32LE((tx.version || 1) | 0, 0); parts.push(v);

    const ins = tx.inputs || [];
    parts.push(varint(ins.length));
    for (const inp of ins) {
        parts.push(reverseHexBytes(inp.txid));                 // 32 bytes, internal order
        const vo = Buffer.alloc(4); vo.writeUInt32LE(inp.vout >>> 0, 0); parts.push(vo);
        const script = Buffer.from(inp.script || '', 'hex');
        parts.push(varint(script.length), script);
        const sq = Buffer.alloc(4); sq.writeUInt32LE((inp.sequence >>> 0) || 0xffffffff, 0); parts.push(sq);
    }

    const outs = tx.outputs || [];
    parts.push(varint(outs.length));
    for (const out of outs) {
        const val = Buffer.alloc(8); val.writeBigUInt64LE(BigInt(out.value), 0); parts.push(val);
        const script = Buffer.from(out.script || '', 'hex');
        parts.push(varint(script.length), script);
    }

    const lt = Buffer.alloc(4); lt.writeUInt32LE((tx.locktime >>> 0) || 0, 0); parts.push(lt);
    return Buffer.concat(parts);
}

/** Bitcoin txid = double-SHA256 of the serialized tx, in DISPLAY (big-endian) hex. */
function txid(tx) {
    return Buffer.from(dsha256(serializeTx(tx))).reverse().toString('hex');
}

// ── address → scriptPubKey ─────────────────────────────────────
// SPN is address-based; Bitcoin serialization needs a scriptPubKey. Every SPN
// address maps to a 20-byte HASH160, so we emit a standard P2PKH script — the
// most ASIC/Bitcoin-tooling-compatible form:
//   OP_DUP OP_HASH160 <20-byte hash160> OP_EQUALVERIFY OP_CHECKSIG
//   = 76 a9 14 <hash160> 88 ac

/** Build a P2PKH scriptPubKey (hex) from a 20-byte HASH160 (hex). */
function p2pkhScript(hash160Hex) {
    const h = String(hash160Hex || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('hash160 must be 20 bytes (40 hex chars)');
    return '76a914' + h + '88ac';
}

/** Extract the 20-byte HASH160 (hex) from a P2PKH scriptPubKey, or null. */
function p2pkhToHash160(scriptHex) {
    const s = String(scriptHex || '').toLowerCase();
    const m = /^76a914([0-9a-f]{40})88ac$/.exec(s);
    return m ? m[1] : null;
}

/** Convert an SPN address to its scriptPubKey (hex). Lazy-requires crypto to
 *  avoid a circular dependency at module load. */
function addressToScriptPubKey(address) {
    const { parseAddress } = require('./crypto');
    const { hash160Hex } = parseAddress(address);
    return p2pkhScript(hash160Hex);
}

module.exports = {
    sha256, dsha256, reverseHexBytes, varint,
    serializeHeader, headerHash, merkleRoot,
    serializeTx, txid,
    p2pkhScript, p2pkhToHash160, addressToScriptPubKey,
};
