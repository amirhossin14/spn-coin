/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — bech32 (BIP173) encode/decode
 *  Self-contained, dependency-free implementation.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
    let chk = 1;
    for (const v of values) {
        const top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) {
            if ((top >> i) & 1) chk ^= GENERATOR[i];
        }
    }
    return chk;
}

function hrpExpand(hrp) {
    const out = [];
    for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
    return out;
}

function createChecksum(hrp, data) {
    const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = polymod(values) ^ 1;
    const out = [];
    for (let i = 0; i < 6; i++) out.push((mod >> (5 * (5 - i))) & 31);
    return out;
}

function verifyChecksum(hrp, data) {
    return polymod(hrpExpand(hrp).concat(data)) === 1;
}

/** Encode 5-bit data words under a human-readable prefix. */
function bech32Encode(hrp, data) {
    const combined = data.concat(createChecksum(hrp, data));
    let ret = hrp + "1";
    for (const d of combined) ret += CHARSET.charAt(d);
    return ret;
}

/** Decode a bech32 string into { hrp, data(5-bit words) } or throws. */
function bech32Decode(str) {
    if (str.length < 8 || str.length > 200) throw new Error("bech32: bad length");
    const lower = str.toLowerCase();
    const upper = str.toUpperCase();
    if (str !== lower && str !== upper) throw new Error("bech32: mixed case");
    const s = lower;
    const pos = s.lastIndexOf("1");
    if (pos < 1 || pos + 7 > s.length) throw new Error("bech32: no separator");
    const hrp = s.slice(0, pos);
    const data = [];
    for (let i = pos + 1; i < s.length; i++) {
        const d = CHARSET.indexOf(s.charAt(i));
        if (d === -1) throw new Error("bech32: invalid char");
        data.push(d);
    }
    if (!verifyChecksum(hrp, data)) throw new Error("bech32: bad checksum");
    return { hrp, data: data.slice(0, data.length - 6) };
}

/** Convert between bit groups (e.g. 8-bit bytes <-> 5-bit words). */
function convertBits(data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
        if (value < 0 || value >> fromBits !== 0) throw new Error("convertBits: bad value");
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            ret.push((acc >> bits) & maxv);
        }
    }
    if (pad) {
        if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
        throw new Error("convertBits: bad padding");
    }
    return ret;
}

/** Encode a raw byte Buffer to a bech32 address with the given hrp. */
function encodeBytes(hrp, bytes) {
    const words = convertBits(Array.from(bytes), 8, 5, true);
    return bech32Encode(hrp, words);
}

/** Decode a bech32 address; returns { hrp, bytes:Buffer }. */
function decodeToBytes(str) {
    const { hrp, data } = bech32Decode(str);
    const bytes = Buffer.from(convertBits(data, 5, 8, false));
    return { hrp, bytes };
}

module.exports = { bech32Encode, bech32Decode, convertBits, encodeBytes, decodeToBytes };
