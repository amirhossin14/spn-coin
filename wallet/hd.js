/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — HD wallet (BIP39 + BIP32)
 *  Bitcoin-style hierarchical deterministic wallet:
 *   - BIP39 mnemonic seed phrase (12 / 24 words) for backup/restore
 *   - BIP32 key derivation over secp256k1 (path m/44'/0'/0'/0/i)
 *  Derived keys are converted to the project's key format so they work
 *  with sign / verify / addresses exactly like a normal wallet.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");
const bip39  = require("bip39");
const EC     = require("elliptic").ec;
const { keyPairFromRawPrivate } = require("../blockchain/crypto");

const ec = new EC("secp256k1");
const N  = ec.curve.n;                     // secp256k1 order
const HARDENED = 0x80000000;

// ── BIP39 ──────────────────────────────────────────────────────
/** Generate a mnemonic. strength 128 → 12 words, 256 → 24 words. */
function generateMnemonic(strength = 128) {
    return bip39.generateMnemonic(strength);
}
function validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(String(mnemonic || "").trim());
}
/** Mnemonic (+ optional passphrase) → 64-byte seed. */
function mnemonicToSeed(mnemonic, passphrase = "") {
    return bip39.mnemonicToSeedSync(String(mnemonic).trim(), passphrase);
}

// ── BIP32 ──────────────────────────────────────────────────────
function ser32(i) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(i >>> 0, 0);
    return b;
}
function ser256(bn) {
    return Buffer.from(bn.toArrayLike(Buffer, "be", 32));
}
function compressedPub(priv32) {
    return Buffer.from(ec.keyFromPrivate(priv32).getPublic(true, "hex"), "hex");
}

/** Master key from seed: { key(32B), chainCode(32B) }. */
function masterFromSeed(seed) {
    const I  = crypto.createHmac("sha512", Buffer.from("Bitcoin seed")).update(seed).digest();
    return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/** CKDpriv: derive child (hardened when index >= 0x80000000). */
function deriveChild(parent, index) {
    const data = index >= HARDENED
        ? Buffer.concat([Buffer.from([0]), parent.key, ser32(index)])
        : Buffer.concat([compressedPub(parent.key), ser32(index)]);
    const I  = crypto.createHmac("sha512", parent.chainCode).update(data).digest();
    const IL = I.slice(0, 32);
    const IR = I.slice(32);

    const kPar = ec.keyFromPrivate(parent.key).getPrivate();
    const ki   = ec.keyFromPrivate(IL).getPrivate().add(kPar).umod(N);
    if (ki.isZero()) throw new Error("Invalid child key (zero); try next index");
    return { key: ser256(ki), chainCode: IR };
}

/** Parse a path like "m/44'/0'/0'/0/0" and derive the node. */
function derivePath(seed, path) {
    let node = masterFromSeed(seed);
    const parts = String(path).replace(/^m\/?/, "").split("/").filter(Boolean);
    for (const p of parts) {
        const hardened = p.endsWith("'") || p.endsWith("h");
        const idx = parseInt(p, 10) + (hardened ? HARDENED : 0);
        node = deriveChild(node, idx);
    }
    return node;
}

// BIP44-style account path: m/44'/0'/0'/0/<index>
function accountPath(index = 0) {
    return `m/44'/0'/0'/0/${index}`;
}

/**
 * Derive a project keypair from a mnemonic at the given account index.
 * @returns { privateKey, publicKey, address, path }
 */
function keyFromMnemonic(mnemonic, index = 0, passphrase = "") {
    if (!validateMnemonic(mnemonic)) throw new Error("Invalid mnemonic");
    const seed = mnemonicToSeed(mnemonic, passphrase);
    const path = accountPath(index);
    const node = derivePath(seed, path);
    const kp   = keyPairFromRawPrivate(node.key.toString("hex"));
    return { ...kp, path };
}

module.exports = {
    generateMnemonic, validateMnemonic, mnemonicToSeed,
    masterFromSeed, deriveChild, derivePath, accountPath, keyFromMnemonic,
};
