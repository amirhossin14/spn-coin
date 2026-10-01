/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");
const { ADDRESS, BLOCKCHAIN } = require("../config");
const { encodeBytes, decodeToBytes } = require("./bech32");

const POW_ALGORITHM = (BLOCKCHAIN && BLOCKCHAIN.POW_ALGORITHM) || "sha256d";

// ── Address identity (driven by config.js → ADDRESS) ───────────
const ADDR_PREFIX_MAINNET = ADDRESS.PREFIX_MAINNET;
const ADDR_PREFIX_TESTNET = ADDRESS.PREFIX_TESTNET;
const VERSION_MAINNET     = ADDRESS.VERSION_MAINNET;
const VERSION_TESTNET     = ADDRESS.VERSION_TESTNET;
const ADDR_FORMAT         = ADDRESS.FORMAT;            // 'base58check' | 'bech32'
const HRP_MAINNET         = ADDRESS.HRP_MAINNET;
const HRP_TESTNET         = ADDRESS.HRP_TESTNET;

// ══════════════════════════════════════════════════════════════
//  HASH FUNCTIONS
// ══════════════════════════════════════════════════════════════

function sha256(data) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8")
              : Buffer.isBuffer(data)    ? data
              : Buffer.from(JSON.stringify(data), "utf8");
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256d(data) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8")
              : Buffer.isBuffer(data)    ? data
              : Buffer.from(JSON.stringify(data), "utf8");
    const first = crypto.createHash("sha256").update(buf).digest();
    return crypto.createHash("sha256").update(first).digest("hex");
}

function sha256Raw(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "hex");
    return crypto.createHash("sha256").update(b).digest();
}

// Litecoin-style scrypt PoW hash: scrypt(header, header, N=1024, r=1, p=1, 32B).
function scryptHash(data) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8")
              : Buffer.isBuffer(data)    ? data
              : Buffer.from(JSON.stringify(data), "utf8");
    // maxmem raised so N=1024 r=1 p=1 is permitted by Node's scrypt.
    return crypto.scryptSync(buf, buf, 32, { N: 1024, r: 1, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
}

// Proof-of-Work hash, dispatched by config (sha256d=Bitcoin, scrypt=Litecoin).
function powHash(data) {
    return POW_ALGORITHM === "scrypt" ? scryptHash(data) : sha256d(data);
}

// ══════════════════════════════════════════════════════════════
//  256-BIT TARGET MATH (fine-grained difficulty, Bitcoin-style)
// ══════════════════════════════════════════════════════════════
const MAX256    = (1n << 256n) - 1n;
// Easiest allowed target (difficulty 1). >>4 ⇒ ~1 hex zero ⇒ fast to mine.
const POW_LIMIT = MAX256 >> 4n;
const DIFF_SCALE = 1_000_000n;   // fixed-point scale for float difficulty

/** True if a hash (hex) is <= target (BigInt). Fail-closed on bad input. */
function hashMeetsTarget(hashHex, target) {
    if (typeof target !== "bigint" || target <= 0n) return false;
    if (typeof hashHex !== "string" || !/^[0-9a-fA-F]+$/.test(hashHex)) return false;
    try {
        return BigInt("0x" + hashHex) <= target;
    } catch {
        return false;
    }
}

/** target → float difficulty (POW_LIMIT / target). */
function difficultyForTarget(target) {
    if (target <= 0n) return Infinity;
    return Number((POW_LIMIT * DIFF_SCALE) / target) / Number(DIFF_SCALE);
}

/** float difficulty → target (clamped to POW_LIMIT as the easiest). */
function targetForDifficulty(d) {
    if (!isFinite(d) || d <= 1) return POW_LIMIT;
    const scaled = BigInt(Math.max(1, Math.round(d * Number(DIFF_SCALE))));
    return (POW_LIMIT * DIFF_SCALE) / scaled;
}

/** PoW "work" contributed by a block with this target (Bitcoin formula). */
function workForTarget(target) {
    if (target <= 0n) return 0n;
    return (MAX256 + 1n) / (target + 1n);
}

/** Encode a target (BigInt) to compact "nBits" (returns hex string). */
function targetToBits(target) {
    if (target <= 0n) return "00000000";
    let hex = target.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    let nSize = hex.length / 2;
    let compact;
    if (nSize <= 3) {
        compact = Number(target << BigInt(8 * (3 - nSize)));
    } else {
        compact = Number(target >> BigInt(8 * (nSize - 3)));
    }
    if (compact & 0x00800000) { compact >>= 8; nSize += 1; }
    compact |= nSize << 24;
    return (compact >>> 0).toString(16).padStart(8, "0");
}

/** Decode compact "nBits" (hex string or number) back to a target (BigInt).
 *  Hardened & fail-closed: any malformed input, or a decoded target outside the
 *  valid (0, MAX256] range, returns 0n. A 0 target can never be met by any hash
 *  (hashMeetsTarget stays false), so corrupt `bits` reject the block instead of
 *  crashing validation or — worse — letting an oversized target bypass PoW. */
function bitsToTarget(bits) {
    let b;
    if (typeof bits === "number") {
        b = bits;
    } else if (typeof bits === "string" && /^[0-9a-fA-F]{1,8}$/.test(bits.trim())) {
        b = parseInt(bits.trim(), 16);
    } else {
        return 0n; // malformed type/format → fail-closed
    }
    if (!Number.isFinite(b) || b < 0 || b > 0xffffffff) return 0n;
    const nSize = b >>> 24;
    const word  = BigInt(b & 0x007fffff);
    const target = nSize <= 3 ? word >> BigInt(8 * (3 - nSize)) : word << BigInt(8 * (nSize - 3));
    if (target <= 0n || target > MAX256) return 0n; // out of range → fail-closed
    return target;
}

function ripemd160(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "hex");
    return crypto.createHash("ripemd160").update(b).digest();
}

// HASH160 = RIPEMD160(SHA256(data)) — standard Bitcoin-style
function hash160(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "hex");
    return ripemd160(sha256Raw(b));
}

// ══════════════════════════════════════════════════════════════
//  BASE58 / BASE58CHECK
// ══════════════════════════════════════════════════════════════

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf) {
    let leading = 0;
    for (const b of buf) { if (b === 0) leading++; else break; }
    let n = BigInt("0x" + (buf.length ? buf.toString("hex") : "00"));
    let s = "";
    while (n > 0n) { s = BASE58[Number(n % 58n)] + s; n /= 58n; }
    return "1".repeat(leading) + s;
}

function base58Decode(str) {
    let n = 0n;
    for (const ch of str) {
        const i = BASE58.indexOf(ch);
        if (i < 0) throw new Error("Invalid Base58 character: " + ch);
        n = n * 58n + BigInt(i);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    const decoded = Buffer.from(hex, "hex");
    const leading = str.split("").findIndex(c => c !== "1");
    const zeros   = leading === -1 ? str.length : leading;
    return Buffer.concat([Buffer.alloc(zeros), decoded]);
}

function base58CheckEncode(payload) {
    const cs = sha256Raw(sha256Raw(payload)).slice(0, 4);
    return base58Encode(Buffer.concat([payload, cs]));
}

function base58CheckDecode(str) {
    const buf      = base58Decode(str);
    if (buf.length < 5) throw new Error("Base58Check string too short");
    const payload  = buf.slice(0, -4);
    const checksum = buf.slice(-4);
    const expected = sha256Raw(sha256Raw(payload)).slice(0, 4);
    if (!checksum.equals(expected)) throw new Error("Invalid Base58Check checksum");
    return payload;
}

// ══════════════════════════════════════════════════════════════
//  secp256k1 KEY PAIR
// ══════════════════════════════════════════════════════════════

/** Generate a new secp256k1 key pair. Returns DER-encoded hex strings. */
function generateKeyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
        namedCurve:         "secp256k1",
        publicKeyEncoding:  { type: "spki",  format: "der" },
        privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const privHex = privateKey.toString("hex");
    const pubHex  = publicKey.toString("hex");
    return {
        privateKey: privHex,
        publicKey:  pubHex,
        address:    publicKeyToAddress(pubHex),
    };
}

/** Derive the DER-SPKI public key from a DER-PKCS8 private key. */
function derivePublicKey(privateKeyHex) {
    const privKeyObj = crypto.createPrivateKey({
        key:    Buffer.from(privateKeyHex, "hex"),
        format: "der",
        type:   "pkcs8",
    });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    return pubKeyObj.export({ type: "spki", format: "der" }).toString("hex");
}

/**
 * Extract the raw 33-byte compressed public key from a DER-SPKI buffer.
 * The compressed point starts with 0x02 or 0x03.
 */
function getRawPublicKey(spkiHex) {
    const der = Buffer.isBuffer(spkiHex) ? spkiHex : Buffer.from(spkiHex, "hex");
    // Find compressed point marker (0x02 or 0x03) followed by 32 bytes
    for (let i = 0; i <= der.length - 33; i++) {
        if ((der[i] === 0x02 || der[i] === 0x03) && i > 0) {
            // Make sure what precedes looks like DER structure (not a random 0x02)
            // The byte before a raw public key in SPKI is typically 0x00 or an OID
            return der.slice(i, i + 33);
        }
    }
    // Fallback: uncompressed point (0x04 + 64 bytes) -> compress it
    for (let i = 0; i <= der.length - 65; i++) {
        if (der[i] === 0x04) {
            const x      = der.slice(i + 1, i + 33);
            const yLast  = der[i + 64];
            const prefix = (yLast & 1) ? 0x03 : 0x02;
            return Buffer.concat([Buffer.from([prefix]), x]);
        }
    }
    // Last fallback: hash the full DER (deterministic, won't validate but won't crash)
    return Buffer.from(sha256(der), "hex").slice(0, 33);
}

/** Sign dataHash (hex string) with privateKeyHex (DER-PKCS8). Returns hex DER signature. */
// ── Low-S (canonical) ECDSA enforcement — prevents signature malleability ──
// OpenSSL (Node crypto) and elliptic can emit high-S signatures; Bitcoin-style
// consensus requires the canonical low-S form. We canonicalise on signing and
// reject high-S on verify.
const _elliptic  = require('elliptic');
const _ecLowS    = new _elliptic.ec('secp256k1');
const _Signature = require('elliptic/lib/elliptic/ec/signature');
const _halfN     = _ecLowS.n.shrn(1);
function _toLowS(sigHex) {
    try {
        const sig = new _Signature(Buffer.from(sigHex, 'hex'));
        if (sig.s.cmp(_halfN) > 0) {
            const s = _ecLowS.n.sub(sig.s);
            return Buffer.from(new _Signature({ r: sig.r, s }).toDER()).toString('hex');
        }
        return sigHex;
    } catch { return sigHex; }
}
function isLowS(sigHex) {
    try {
        const sig = new _Signature(Buffer.from(sigHex, 'hex'));
        return sig.r.cmpn(0) > 0 && sig.s.cmpn(0) > 0 && sig.s.cmp(_halfN) <= 0;
    } catch { return false; }
}

function sign(privateKeyHex, dataHash) {
    const privKey = crypto.createPrivateKey({
        key:    Buffer.from(privateKeyHex, "hex"),
        format: "der",
        type:   "pkcs8",
    });
    return _toLowS(crypto.sign("sha256", Buffer.from(dataHash, "hex"), privKey).toString("hex"));
}

/** Verify an ECDSA signature. publicKeyHex = DER-SPKI hex. */
function verify(publicKeyHex, dataHash, signatureHex) {
    try {
        if (!publicKeyHex || !dataHash || !signatureHex) return false;
        const pubKey = crypto.createPublicKey({
            key:    Buffer.from(publicKeyHex, "hex"),
            format: "der",
            type:   "spki",
        });
        const ok = crypto.verify(
            "sha256",
            Buffer.from(dataHash, "hex"),
            pubKey,
            Buffer.from(signatureHex, "hex"),
        );
        // Reject non-canonical (high-S) signatures to prevent txid malleability.
        return ok && isLowS(signatureHex);
    } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
//  ADDRESS DERIVATION
//
//  mainnet: "SPN1" + Base58Check( [0x19] + HASH160(compressed_pubkey) )
//  testnet: "SPNt" + Base58Check( [0x6F] + HASH160(compressed_pubkey) )
// ══════════════════════════════════════════════════════════════

/**
 * Derive a SPN address from a DER-SPKI public key hex.
 * @param {string}  spkiHex - DER SPKI public key as hex
 * @param {boolean} testnet - true for testnet
 * @returns {string} Address like "SPN11BpEgosEc9BzaaCwMCNLJkGgCMpYNgzj"
 */
function publicKeyToAddress(spkiHex, testnet = false) {
    const rawPub = getRawPublicKey(Buffer.from(spkiHex, "hex"));
    const h160   = hash160(rawPub);

    if (ADDR_FORMAT === "bech32") {
        const hrp = testnet ? HRP_TESTNET : HRP_MAINNET;
        return encodeBytes(hrp, h160);
    }
    // default: base58check (Bitcoin-style) with brand prefix
    const version  = testnet ? VERSION_TESTNET : VERSION_MAINNET;
    const payload  = Buffer.concat([Buffer.from([version]), h160]);
    const b58check = base58CheckEncode(payload);
    return (testnet ? ADDR_PREFIX_TESTNET : ADDR_PREFIX_MAINNET) + b58check;
}

/**
 * Validate an address for the active format (prefix/hrp + checksum integrity).
 */
function validateAddress(address) {
    try {
        if (typeof address !== "string" || address.length < 8) return false;

        if (ADDR_FORMAT === "bech32") {
            const { hrp, bytes } = decodeToBytes(address);
            if (hrp !== HRP_MAINNET && hrp !== HRP_TESTNET) return false;
            return bytes.length === 20;   // HASH160 is 20 bytes
        }

        let b58part, expectedVersion;
        if (address.startsWith(ADDR_PREFIX_MAINNET)) {
            b58part = address.slice(ADDR_PREFIX_MAINNET.length);
            expectedVersion = VERSION_MAINNET;
        } else if (address.startsWith(ADDR_PREFIX_TESTNET)) {
            b58part = address.slice(ADDR_PREFIX_TESTNET.length);
            expectedVersion = VERSION_TESTNET;
        } else {
            return false;
        }
        const decoded = base58CheckDecode(b58part);
        return decoded.length === 21 && decoded[0] === expectedVersion;
    } catch { return false; }
}

/** Parse an address into its components, for the active format. */
function parseAddress(address) {
    if (!validateAddress(address)) throw new Error("Invalid address: " + address);

    if (ADDR_FORMAT === "bech32") {
        const { hrp, bytes } = decodeToBytes(address);
        return {
            version:    null,
            hash160Hex: bytes.toString("hex"),
            network:    hrp === HRP_TESTNET ? "testnet" : "mainnet",
        };
    }

    const isTestnet = address.startsWith(ADDR_PREFIX_TESTNET);
    const prefixLen = isTestnet ? ADDR_PREFIX_TESTNET.length : ADDR_PREFIX_MAINNET.length;
    const b58part   = address.slice(prefixLen);
    const decoded   = base58CheckDecode(b58part);
    return {
        version:    decoded[0],
        hash160Hex: decoded.slice(1).toString("hex"),
        network:    isTestnet ? "testnet" : "mainnet",
    };
}

// ══════════════════════════════════════════════════════════════
//  MERKLE TREE
// ══════════════════════════════════════════════════════════════

function merkleRoot(txids) {
    if (!txids || txids.length === 0) return sha256d("empty-block");
    if (txids.length === 1)           return txids[0];
    let layer = [...txids];
    while (layer.length > 1) {
        if (layer.length % 2) layer.push(layer[layer.length - 1]);
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
            next.push(sha256d(layer[i] + layer[i + 1]));
        layer = next;
    }
    return layer[0];
}

function merkleProof(txids, targetTxid) {
    if (!txids.includes(targetTxid)) return null;
    const proof = [];
    let layer = [...txids];
    let idx   = layer.indexOf(targetTxid);
    while (layer.length > 1) {
        if (layer.length % 2) layer.push(layer[layer.length - 1]);
        const next = [];
        for (let i = 0; i < layer.length; i += 2) {
            if (i === idx || i + 1 === idx) {
                proof.push({ hash: i === idx ? layer[i+1] : layer[i],
                             position: i === idx ? "right" : "left" });
            }
            next.push(sha256d(layer[i] + layer[i+1]));
        }
        idx   = Math.floor(idx / 2);
        layer = next;
    }
    return proof;
}

function verifyMerkleProof(txid, proof, root) {
    let h = txid;
    for (const { hash: s, position: p } of proof)
        h = p === "right" ? sha256d(h + s) : sha256d(s + h);
    return h === root;
}

// ══════════════════════════════════════════════════════════════
//  PROOF OF WORK
// ══════════════════════════════════════════════════════════════

// Legacy-compatible meetsTarget — now backed by the REAL 256-bit target
// system (Bitcoin-style) instead of naive leading-zero counting.
// Accepts either an integer difficulty or a fractional one.
function meetsTarget(hash, difficulty) {
    const target = targetForDifficulty(Number(difficulty) || 1);
    return hashMeetsTarget(hash, target);
}
function hashToTarget(hash)       { return BigInt("0x" + hash); }
// Kept for backward compatibility; delegates to the real target function.
function difficultyToTarget(diff) { return targetForDifficulty(Number(diff) || 1); }

// ══════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════

// Build a project keypair (PKCS8/SPKI DER hex) from a raw 32-byte secp256k1
// private key. Used by the HD wallet (BIP32) so derived keys plug straight
// into sign/verify/publicKeyToAddress with the exact same format as
// generateKeyPair(). Requires `elliptic` (already a dependency).
function keyPairFromRawPrivate(rawPrivHex) {
    const EC = require("elliptic").ec;
    const ec = new EC("secp256k1");
    const key = ec.keyFromPrivate(rawPrivHex.replace(/^0x/, ""), "hex");
    const priv32 = key.getPrivate("hex").padStart(64, "0");
    const pubUncompressed = key.getPublic(false, "hex");   // 04 || x || y (65 bytes)

    // Assemble a PKCS8 DER for secp256k1 with the private scalar + public point.
    const pkcs8 = Buffer.concat([
        Buffer.from("308184020100301006072a8648ce3d020106052b8104000a046d306b0201010420", "hex"),
        Buffer.from(priv32, "hex"),
        Buffer.from("a144034200", "hex"),
        Buffer.from(pubUncompressed, "hex"),
    ]);

    // Let Node canonicalize + derive the SPKI so the format matches generateKeyPair().
    const privObj = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const pubObj  = crypto.createPublicKey(privObj);
    const privHex = privObj.export({ type: "pkcs8", format: "der" }).toString("hex");
    const pubHex  = pubObj.export({ type: "spki", format: "der" }).toString("hex");

    return { privateKey: privHex, publicKey: pubHex, address: publicKeyToAddress(pubHex) };
}

module.exports = {
    sha256, sha256d, sha256Raw, ripemd160, hash160, scryptHash, powHash,
    base58Encode, base58Decode, base58CheckEncode, base58CheckDecode,
    generateKeyPair, derivePublicKey, getRawPublicKey, sign, verify, keyPairFromRawPrivate,
    publicKeyToAddress, validateAddress, parseAddress,
    ADDR_PREFIX_MAINNET, ADDR_PREFIX_TESTNET, VERSION_MAINNET, VERSION_TESTNET,
    merkleRoot, merkleProof, verifyMerkleProof,
    meetsTarget, hashToTarget, difficultyToTarget,
    hashMeetsTarget, difficultyForTarget, targetForDifficulty,
    workForTarget, targetToBits, bitsToTarget, POW_LIMIT,
};
