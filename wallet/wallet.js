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
const fs     = require("fs");
const path   = require("path");

const {
    generateKeyPair, derivePublicKey, sign, verify, sha256, publicKeyToAddress,
    validateAddress,
} = require("../blockchain/crypto");
const { Transaction, MIN_FEE } = require("../utxo/utxo");

const CHAIN_ID     = parseInt(process.env.CHAIN_ID) || 1;
const IS_TESTNET   = CHAIN_ID !== 1;

class Wallet {
    /**
     * @param {string|null} privateKeyHex - DER-PKCS8 private key as hex, or null to generate new
     */
    constructor(privateKeyHex = null) {
        if (privateKeyHex) {
            // Restore from existing private key — derive public key correctly
            this.privateKey = privateKeyHex;
            this.publicKey  = derivePublicKey(privateKeyHex);   // ← always correct derivation
        } else {
            // Generate a brand new key pair
            const pair      = generateKeyPair();
            this.privateKey = pair.privateKey;
            this.publicKey  = pair.publicKey;
        }

        // Derive the SPN address (SPN1... or SPNt...)
        this.address = publicKeyToAddress(this.publicKey, IS_TESTNET);
        this.network = IS_TESTNET ? "testnet" : "mainnet";
    }

    // ── HD wallet (BIP39 / BIP32) ─────────────────────────────
    /** Create a brand-new HD wallet: returns { wallet, mnemonic }. */
    static createHD(strength = 128, index = 0) {
        const hd = require("./hd");
        const mnemonic = hd.generateMnemonic(strength);
        const { privateKey } = hd.keyFromMnemonic(mnemonic, index);
        return { wallet: new Wallet(privateKey), mnemonic };
    }

    /** Restore a wallet from a BIP39 mnemonic at the given account index. */
    static fromMnemonic(mnemonic, index = 0, passphrase = "") {
        const hd = require("./hd");
        const { privateKey } = hd.keyFromMnemonic(mnemonic, index, passphrase);
        return new Wallet(privateKey);
    }

    // ── Web3 standard keystore (v3) ───────────────────────────
    // The raw 32-byte secp256k1 key (what geth/MetaMask store).
    _rawPrivateKeyHex() {
        const jwk = crypto.createPrivateKey({
            key: Buffer.from(this.privateKey, "hex"), format: "der", type: "pkcs8",
        }).export({ format: "jwk" });
        return Buffer.from(jwk.d, "base64url").toString("hex").padStart(64, "0");
    }

    /** Export this wallet as a Web3 keystore v3 object (password-encrypted). */
    toKeystore(password) {
        const keystore = require("./keystore");
        return keystore.encrypt(this._rawPrivateKeyHex(), password, { address: this.address });
    }

    /** Restore a wallet from a Web3 keystore v3 object/JSON + password. */
    static fromKeystore(keystoreJson, password) {
        const keystore = require("./keystore");
        const { keyPairFromRawPrivate } = require("../blockchain/crypto");
        const rawHex = keystore.decrypt(keystoreJson, password);
        const kp = keyPairFromRawPrivate(rawHex);
        return new Wallet(kp.privateKey);
    }

    // ── Transaction building ──────────────────────────────────

    /**
     * Build and sign a transaction to send SPN.
     * @param {object} opts
     * @param {string}   opts.recipient  - destination SPN address
     * @param {bigint}   opts.amount     - amount in satoshis
     * @param {UTXOSet}  opts.utxoSet    - current UTXO set
     * @param {number}   opts.feeRate    - satoshis per byte (default 10)
     */
    createTransaction({ recipient, amount, utxoSet, feeRate = 10, data = null }) {
        if (!validateAddress(recipient))
            throw new Error(`Invalid SPN address: ${recipient}`);

        const amountBig = BigInt(amount);
        const coins     = utxoSet.selectCoins(this.address, amountBig, feeRate);

        if (!coins) {
            const balance = utxoSet.getBalance(this.address);
            throw new Error(
                `Insufficient balance. ` +
                `Have: ${balance} satoshis (${(Number(balance)/1e8).toFixed(8)} SPN), ` +
                `Need: ${amountBig + MIN_FEE} satoshis minimum`
            );
        }

        const { selected, total, fee } = coins;
        const change = total - amountBig - fee;

        const inputs = selected.map(utxo => ({
            txid:     utxo.txid,
            vout:     utxo.vout,
            sequence: 0xFFFFFFFF,
        }));

        const outputs = [{ address: recipient, amount: amountBig.toString() }];
        if (change > 546n) // above dust threshold
            outputs.push({ address: this.address, amount: change.toString() });

        const tx = Transaction.create({ inputs, outputs, privateKey: this.privateKey, data });

        // Attach public key to inputs for signature verification
        tx.inputs = tx.inputs.map(inp => ({ ...inp, pubkey: this.publicKey }));
        tx.fee    = fee;

        return tx;
    }

    // Alias used by server.js
    buildTransaction({ to, amount, utxoSet, feeRate = 10 }) {
        return this.createTransaction({
            recipient: to,
            amount:    typeof amount === "bigint" ? amount : BigInt(Math.round(Number(amount))),
            utxoSet,
            feeRate,
        });
    }

    // ── Crypto helpers ────────────────────────────────────────
    sign(dataHash)        { return sign(this.privateKey, dataHash); }
    verify(dataHash, sig) { return verify(this.publicKey, dataHash, sig); }

    // ── Wallet info ───────────────────────────────────────────
    getInfo(utxoSet) {
        const balance = utxoSet ? utxoSet.getBalance(this.address) : 0n;
        const utxos   = utxoSet ? utxoSet.getUTXOs(this.address)   : [];
        return {
            address:    this.address,
            network:    this.network,
            publicKey:  this.publicKey,
            balance:    balance.toString(),
            balanceMYC: (Number(balance) / 1e8).toFixed(8),
            utxoCount:  utxos.length,
        };
    }

    // ── Wallet file persistence ───────────────────────────────

    /**
     * Save wallet to a JSON file.
     * @param {string} filePath   - output path
     * @param {string} passphrase - if provided, encrypts private key with AES-256-GCM
     */
    save(filePath, passphrase = "") {
        const encrypted = passphrase !== "";
        const data = {
            version:    3,
            software:   "SPN Coin Node v4.1",
            network:    this.network,
            address:    this.address,
            publicKey:  this.publicKey,
            privateKey: encrypted
                ? this._encrypt(this.privateKey, passphrase)
                : this.privateKey,
            encrypted,
            checksum:   sha256(this.address + this.publicKey),
            createdAt:  new Date().toISOString(),
        };
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
        console.log(`💾 Wallet saved: ${filePath} (${this.address})`);
        return filePath;
    }

    /**
     * Load wallet from a JSON file.
     * @param {string} filePath
     * @param {string} passphrase - required if file was saved with encryption
     */
    static load(filePath, passphrase = "") {
        const data    = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const privKey = data.encrypted
            ? Wallet._decrypt(data.privateKey, passphrase)
            : data.privateKey;
        const wallet  = new Wallet(privKey);

        // Verify the address matches what was stored
        if (data.address && wallet.address !== data.address) {
            console.warn(`⚠️  Address mismatch! Stored: ${data.address}, Derived: ${wallet.address}`);
        }
        console.log(`📂 Wallet loaded: ${wallet.address} (${wallet.network})`);
        return wallet;
    }

    // ── AES-256-GCM + scrypt encryption ──────────────────────
    _encrypt(plaintext, passphrase) {
        const salt = crypto.randomBytes(32);
        const key  = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
        const iv   = crypto.randomBytes(16);
        const ciph = crypto.createCipheriv("aes-256-gcm", key, iv);
        const enc  = Buffer.concat([ciph.update(plaintext, "utf8"), ciph.final()]);
        const tag  = ciph.getAuthTag();
        // Format: salt:iv:tag:ciphertext (all hex)
        return [salt, iv, tag, enc].map(b => b.toString("hex")).join(":");
    }

    static _decrypt(ciphertext, passphrase) {
        const parts = ciphertext.split(":");
        if (parts.length === 4) {
            // New format with salt
            const [saltHex, ivHex, tagHex, encHex] = parts;
            const salt   = Buffer.from(saltHex, "hex");
            const key    = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
            const deciph = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
            deciph.setAuthTag(Buffer.from(tagHex, "hex"));
            return deciph.update(Buffer.from(encHex, "hex")).toString("utf8") + deciph.final("utf8");
        }
        // Legacy 3-part format (iv:tag:ciphertext) — static salt
        const [ivHex, tagHex, encHex] = parts;
        const key    = crypto.scryptSync(passphrase, "spncoin-wallet-salt", 32);
        const deciph = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
        deciph.setAuthTag(Buffer.from(tagHex, "hex"));
        return deciph.update(Buffer.from(encHex, "hex")).toString("utf8") + deciph.final("utf8");
    }

    toJSON() {
        return {
            address:   this.address,
            publicKey: this.publicKey,
            network:   this.network,
        };
    }
}

module.exports = { Wallet };
