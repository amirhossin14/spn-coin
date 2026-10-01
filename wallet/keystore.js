/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — Web3 Secret Storage (keystore v3)
 *  Standard Ethereum/Web3 keystore format (the same JSON geth,
 *  MetaMask and web3.js use): scrypt KDF, AES-128-CTR cipher,
 *  Keccak-256 MAC. Stores the raw 32-byte secp256k1 private key.
 * ─────────────────────────────────────────────────────────────
 */
"use strict";

const crypto = require("crypto");
const { keccak256 } = require("js-sha3");

function uuidv4() {
    const b = crypto.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Encrypt a raw 32-byte private key (hex) into a v3 keystore object.
 * @param {string} privHex  raw private key, 64 hex chars
 * @param {string} password
 * @param {object} [opts]   { address, n, r, p }
 */
function encrypt(privHex, password, opts = {}) {
    const priv = Buffer.from(privHex.replace(/^0x/, ""), "hex");
    if (priv.length !== 32) throw new Error("private key must be 32 bytes (raw secp256k1)");

    const salt = crypto.randomBytes(32);
    const iv   = crypto.randomBytes(16);
    const n = opts.n || 8192, r = opts.r || 8, p = opts.p || 1, dklen = 32;

    const derived = crypto.scryptSync(Buffer.from(password, "utf8"), salt, dklen, {
        N: n, r, p, maxmem: 256 * 1024 * 1024,
    });

    const cipher = crypto.createCipheriv("aes-128-ctr", derived.slice(0, 16), iv);
    const ciphertext = Buffer.concat([cipher.update(priv), cipher.final()]);

    // MAC = keccak256( derivedKey[16:32] || ciphertext )
    const mac = keccak256(Buffer.concat([derived.slice(16, 32), ciphertext]));

    return {
        version: 3,
        id: uuidv4(),
        address: (opts.address || "").replace(/^0x/, "") || undefined,
        crypto: {
            ciphertext: ciphertext.toString("hex"),
            cipherparams: { iv: iv.toString("hex") },
            cipher: "aes-128-ctr",
            kdf: "scrypt",
            kdfparams: { dklen, salt: salt.toString("hex"), n, r, p },
            mac,
        },
    };
}

/** Decrypt a v3 keystore object (or JSON string) back to a raw private key hex. */
function decrypt(keystore, password) {
    const ks = typeof keystore === "string" ? JSON.parse(keystore) : keystore;
    if (ks.version !== 3) throw new Error("unsupported keystore version");
    const c = ks.crypto || ks.Crypto;
    if (!c) throw new Error("invalid keystore");

    const salt = Buffer.from(c.kdfparams.salt, "hex");
    const ciphertext = Buffer.from(c.ciphertext, "hex");
    let derived;
    if (c.kdf === "scrypt") {
        const { n, r, p, dklen } = c.kdfparams;
        derived = crypto.scryptSync(Buffer.from(password, "utf8"), salt, dklen, {
            N: n, r, p, maxmem: 256 * 1024 * 1024,
        });
    } else if (c.kdf === "pbkdf2") {
        const { c: iter, dklen, prf } = c.kdfparams;
        if (prf && prf !== "hmac-sha256") throw new Error("unsupported pbkdf2 prf");
        derived = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iter, dklen, "sha256");
    } else {
        throw new Error("unsupported kdf: " + c.kdf);
    }

    // Verify MAC before decrypting (wrong password → MAC mismatch).
    const mac = keccak256(Buffer.concat([derived.slice(16, 32), ciphertext]));
    if (mac !== c.mac.toLowerCase().replace(/^0x/, ""))
        throw new Error("invalid password (MAC mismatch)");

    const iv = Buffer.from(c.cipherparams.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-128-ctr", derived.slice(0, 16), iv);
    const priv = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return priv.toString("hex");
}

module.exports = { encrypt, decrypt, uuidv4 };
