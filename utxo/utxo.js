/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

const { sha256, sha256d, sign, verify, publicKeyToAddress } = require('../blockchain/crypto');
const script = require('../blockchain/script');
const crypto = require('crypto');
const { CHAIN_ID } = require('../config');

// Replay protection: every input signature commits to the chain id, so a
// transaction signed for this chain can never be replayed on another chain
// (or on a forked/rebranded network with a different id).
function sigMessage(txId, inp) {
    return sha256(JSON.stringify({
        txid: txId, inp: inp.txid, vout: inp.vout, nonce: inp.nonce, chainId: CHAIN_ID,
    }));
}

// Parse a satoshi amount safely. Returns a non-negative BigInt, or null for
// anything malformed (non-integer, negative, NaN, huge) — so untrusted network
// data can never crash validation via a BigInt() exception.
function toSat(v) {
    if (typeof v === "bigint") return v >= 0n ? v : null;
    if (typeof v === "number") return (Number.isSafeInteger(v) && v >= 0) ? BigInt(v) : null;
    const s = String(v).trim();
    if (!/^\d{1,20}$/.test(s)) return null;   // decimal integer only, capped length
    try { return BigInt(s); } catch { return null; }
}

// ── Constants ──────────────────────────────────────────────────
const SATOSHI          = 100_000_000n;  // 1 SPN = 10^8 satoshis
const MIN_FEE          = 1_000n;        // Minimum fee in satoshis
const DUST_THRESHOLD   = 546n;          // Minimum output value (no dust)
const MAX_TX_SIZE      = 100_000;       // Max transaction size in bytes
const TX_VERSION       = 1;
const COINBASE_MATURITY= 100;           // Blocks until coinbase is spendable
const FEE_PER_BYTE     = 10n;          // Satoshis per byte

// ══════════════════════════════════════════════════════════════
//  UTXO SET
// ══════════════════════════════════════════════════════════════
class UTXOSet {
    constructor() {
        this.utxos     = new Map();  // "txid:vout" → UTXO object
        this.byAddress = new Map();  // address → Set of UTXO keys
        this._spentHistory = new Map(); // txid → original spent UTXOs for safe reorg undo
    }

    // ── Add a new UTXO ────────────────────────────────────────
    add(txid, vout, utxo) {
        const key = `${txid}:${vout}`;
        this.utxos.set(key, { ...utxo, txid, vout, key });
        if (!this.byAddress.has(utxo.address))
            this.byAddress.set(utxo.address, new Set());
        this.byAddress.get(utxo.address).add(key);
    }

    // ── Mark a UTXO as spent ──────────────────────────────────
    spend(txid, vout) {
        const key  = `${txid}:${vout}`;
        const utxo = this.utxos.get(key);
        if (!utxo) return false;
        this.utxos.delete(key);
        this.byAddress.get(utxo.address)?.delete(key);
        return true;
    }

    // ── Retrieve a UTXO by outpoint ───────────────────────────
    get(txid, vout) {
        return this.utxos.get(`${txid}:${vout}`) || null;
    }

    // ── Address balance (sum of all UTXOs) ────────────────────
    getBalance(address) {
        const keys = this.byAddress.get(address) || new Set();
        let total  = 0n;
        for (const key of keys) {
            const u = this.utxos.get(key);
            if (u) total += BigInt(u.amount);
        }
        return total;
    }

    // ── All UTXOs for an address (sorted largest first) ───────
    getUTXOs(address) {
        const keys   = this.byAddress.get(address) || new Set();
        const result = [];
        for (const key of keys) {
            const u = this.utxos.get(key);
            if (u) result.push(u);
        }
        return result.sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
    }

    // ── Select coins to cover a target amount (greedy) ────────
    selectCoins(address, targetAmount, feeRate) {
        const utxos    = this.getUTXOs(address);
        const selected = [];
        let   total    = 0n;
        const target   = BigInt(targetAmount);
        const baseFee  = this._estimateFee(1, 2, feeRate);  // rough initial estimate

        for (const utxo of utxos) {
            if (total >= target + baseFee) break;
            selected.push(utxo);
            total += BigInt(utxo.amount);
        }

        if (total < target + MIN_FEE) return null;  // insufficient funds

        const fee    = this._estimateFee(selected.length, 2, feeRate);
        const change = total - target - fee;

        if (total < target + fee) return null;

        return { selected, total, fee, change };
    }

    // Estimate fee based on transaction structure and a fee rate (sat/byte).
    _estimateFee(inputCount, outputCount, feeRate) {
        const perByte = (feeRate === undefined || feeRate === null)
            ? FEE_PER_BYTE : BigInt(Math.max(1, Math.floor(Number(feeRate))));
        const estimatedBytes = inputCount * 148 + outputCount * 34 + 10;
        const fee = BigInt(estimatedBytes) * perByte;
        return fee < MIN_FEE ? MIN_FEE : fee;
    }

    // ── Apply all transactions in a block ─────────────────────
    applyBlock(block, blockHeight) {
        for (const tx of block.transactions)
            this.applyTx(tx, blockHeight);
    }

    applyTx(tx, blockHeight = 0) {
        // Spend inputs
        if (!tx.isCoinbase) {
            const spent = [];
            for (const inp of tx.inputs) {
                const prev = this.get(inp.txid, inp.vout);
                if (prev) {
                    spent.push({ txid: inp.txid, vout: inp.vout, prevOutput: { ...prev } });
                    this.spend(inp.txid, inp.vout);
                }
            }
            this._spentHistory.set(tx.id, spent);
        }
        // Create new outputs
        for (let i = 0; i < tx.outputs.length; i++) {
            const out = tx.outputs[i];
            this.add(tx.id, i, {
                address:      out.address,
                amount:       out.amount,
                blockHeight,
                isCoinbase:   tx.isCoinbase || false,
                matureHeight: tx.isCoinbase ? blockHeight + COINBASE_MATURITY : blockHeight,
            });
        }
    }

    // ── Undo a block (for chain reorg) ────────────────────────
    undoBlock(block) {
        for (const tx of [...block.transactions].reverse())
            this.undoTx(tx);
    }

    undoTx(tx) {
        // Remove new outputs
        for (let i = 0; i < tx.outputs.length; i++)
            this.spend(tx.id, i);
        // Restore the exact UTXOs that existed before this transaction spent them.
        if (!tx.isCoinbase) {
            const spent = this._spentHistory.get(tx.id) || [];
            for (const item of spent)
                this.add(item.txid, item.vout, item.prevOutput);
            this._spentHistory.delete(tx.id);
        }
    }

    snapshot() {
        return {
            utxos:     Object.fromEntries(this.utxos),
            size:      this.utxos.size,
            addresses: this.byAddress.size,
        };
    }
}

// ══════════════════════════════════════════════════════════════
//  TRANSACTION
// ══════════════════════════════════════════════════════════════
class Transaction {
    constructor({ id, version, inputs, outputs, timestamp, isCoinbase, locktime, fee, data } = {}) {
        this.data       = data      || null;   // optional carrier (e.g. token operations)
        this.id         = id        || Transaction.computeId({ version, inputs, outputs, timestamp, locktime, data, isCoinbase });
        this.version    = version   || TX_VERSION;
        this.inputs     = inputs    || [];
        this.outputs    = outputs   || [];
        this.timestamp  = timestamp || Date.now();
        this.isCoinbase = isCoinbase || false;
        this.locktime   = locktime  || 0;
        this.fee        = fee       || 0n;
    }

    static computeId(data) {
        const base = {
            version:   data.version,
            inputs:    (data.inputs || []).map(i => ({ txid: i.txid, vout: i.vout, sequence: i.sequence })),
            outputs:   data.outputs,
            timestamp: data.timestamp,
            locktime:  data.locktime,
        };
        // Bind the coinbase flag into the id so a coinbase and a normal tx with
        // otherwise-identical fields can never collide on the same txid.
        if (data.isCoinbase) base.isCoinbase = true;
        // Bind the optional data carrier into the txid so it can't be tampered
        // with, while keeping ids of plain (data-less) transactions unchanged.
        if (data.data != null) base.data = data.data;
        return sha256d(JSON.stringify(base));
    }

    // ── Create a coinbase transaction ─────────────────────────
    // `nonce` and `timestamp` may be pinned for DETERMINISTIC coinbases — the
    // Stratum pool needs this so a miner's coinbase txid (and therefore the
    // merkle root and block hash) is reproducible on the server at share time.
    // When omitted they fall back to random / now, preserving old behaviour.
    static createCoinbase({ blockHeight, minerAddress, reward, extraData = '', nonce = null, timestamp = null }) {
        const cbNonce = nonce != null ? String(nonce) : crypto.randomBytes(8).toString('hex');
        const inputs  = [{
            txid:     '0'.repeat(64),
            vout:     0xFFFFFFFF,
            script:   Buffer.from(`${blockHeight}:${extraData}:${cbNonce}`).toString('hex'),
            sequence: 0xFFFFFFFF,
        }];
        const outputs = [{ address: minerAddress, amount: String(reward) }];
        const ts      = timestamp != null ? Number(timestamp) : Date.now();
        return new Transaction({ version: TX_VERSION, inputs, outputs, timestamp: ts, isCoinbase: true, locktime: 0 });
    }

    // ── Create a signed regular transaction ───────────────────
    static create({ inputs, outputs, privateKey, timestamp, data }) {
        const ts     = timestamp || Date.now();
        const nonce  = crypto.randomBytes(4).toString('hex');
        const base   = { version: TX_VERSION, inputs, outputs, timestamp: ts, locktime: 0, data: data || null };
        const txid   = Transaction.computeId(base);

        const signedInputs = inputs.map(inp => ({
            ...inp,
            nonce,
            signature: sign(privateKey, sigMessage(txid, { ...inp, nonce })),
        }));

        return new Transaction({ ...base, id: txid, inputs: signedInputs });
    }

    // ── Validate transaction ──────────────────────────────────
    validate(utxoSet, blockHeight = 0, options = {}) {
        const errors = [];

        if (this.isCoinbase) {
            if (this.inputs.length !== 1)  errors.push('Coinbase must have exactly 1 input');
            if (this.outputs.length === 0) errors.push('Coinbase must have at least 1 output');
            // Bind the coinbase txid to its contents too — otherwise the merkle
            // root (built from tx.id fields) would not actually commit to the
            // coinbase's outputs, allowing coinbase tampering without changing the
            // merkle root. Legit coinbases auto-compute this id, so this only
            // rejects a coinbase whose id was forged to not match its content.
            const cbId = Transaction.computeId({
                version: this.version, inputs: this.inputs, outputs: this.outputs,
                timestamp: this.timestamp, locktime: this.locktime, data: this.data, isCoinbase: true,
            });
            if (cbId !== this.id)
                errors.push(`Coinbase ID mismatch: expected ${cbId}, got ${this.id}`);
            return { valid: errors.length === 0, errors };
        }

        // Transaction ID integrity: the signed transaction must commit to its
        // canonical contents. Signatures/nonces are intentionally excluded from txid.
        const computedId = Transaction.computeId({
            version: this.version,
            inputs: this.inputs,
            outputs: this.outputs,
            timestamp: this.timestamp,
            locktime: this.locktime,
            data: this.data,
            isCoinbase: this.isCoinbase,
        });
        if (computedId !== this.id)
            errors.push(`Transaction ID mismatch: expected ${computedId}, got ${this.id}`);

        // Timestamp checks
        const now        = Date.now();
        const MAX_FUTURE = 7_200_000;           // 2 hours
        const MAX_AGE    = 86_400_000 * 30;     // 30 days
        if (this.timestamp > now + MAX_FUTURE)  errors.push('Transaction timestamp too far in the future');
        if (this.timestamp < now - MAX_AGE)      errors.push('Transaction timestamp too old');

        if (!this.inputs?.length)  errors.push('Transaction has no inputs');
        if (!this.outputs?.length) errors.push('Transaction has no outputs');
        if (errors.length > 0) return { valid: false, errors };

        let inputTotal     = 0n;
        const seenOutpoints = new Set();

        for (const inp of this.inputs) {
            const key = `${inp.txid}:${inp.vout}`;
            if (seenOutpoints.has(key)) { errors.push(`Duplicate input: ${key}`); continue; }
            seenOutpoints.add(key);

            const utxo = utxoSet.get(inp.txid, inp.vout);
            if (!utxo) { errors.push(`UTXO not found: ${key}`); continue; }

            // Coinbase maturity check
            if (utxo.isCoinbase && blockHeight < utxo.matureHeight)
                errors.push(`Coinbase UTXO not yet mature: ${key} (need block ${utxo.matureHeight})`);

            // Signature verification.
            // SECURITY: the public key used to verify MUST hash to the address
            // that owns this UTXO — otherwise an attacker could supply their own
            // pubkey + a matching signature and spend someone else's coins.
            {
                const pubkey = utxo.pubkey || inp.pubkey;
                if (!pubkey) {
                    errors.push(`Missing public key for input: ${key}`);
                } else {
                    // 1) the pubkey must belong to the UTXO's owner address
                    let derived = null;
                    try { derived = publicKeyToAddress(pubkey); } catch (e) { derived = null; }
                    let derivedTestnet = null;
                    try { derivedTestnet = publicKeyToAddress(pubkey, true); } catch (e) { derivedTestnet = null; }
                    if (!utxo.address) {
                        // SECURITY: a UTXO with no owner address cannot be bound to a
                        // pubkey — treat as unspendable rather than skipping the check.
                        errors.push(`UTXO has no owner address (unspendable): ${key}`);
                    } else if (derived !== utxo.address && derivedTestnet !== utxo.address) {
                        errors.push(`Public key does not match UTXO owner address: ${key}`);
                    } else {
                        // 2) the signature must be valid for that pubkey
                        const msgHash = sigMessage(this.id, inp);
                        if (!verify(pubkey, msgHash, inp.signature || ''))
                            errors.push(`Invalid signature for input: ${key}`);
                    }
                }
            }

            // Script verification for script-locked UTXOs (multisig / timelock / P2PKH).
            // Additive: only runs when the spent output carries a locking `script`.
            if (Array.isArray(utxo.script) && utxo.script.length) {
                const sigHash = sigMessage(this.id, inp);
                const res = script.evaluate(inp.scriptSig || [], utxo.script, {
                    sigHash,
                    lockContext: this.locktime || blockHeight || 0,
                    // Relative timelock (CSV): how much newer the spending input is
                    // than the output it spends (confirmations / age).
                    sequenceContext: Number(inp.sequence ?? 0) ||
                        (blockHeight && utxo.height != null ? blockHeight - utxo.height : 0),
                });
                if (!res.ok) errors.push(`Script failed for input ${key}: ${res.error}`);
            }

            const inAmt = toSat(utxo.amount);
            if (inAmt === null) { errors.push(`Invalid input amount for ${key}`); continue; }
            inputTotal += inAmt;
        }

        let outputTotal = 0n;
        for (const out of this.outputs) {
            const amount = toSat(out.amount);
            if (amount === null) { errors.push(`Invalid output amount: ${String(out.amount).slice(0, 20)}`); continue; }
            if (amount < DUST_THRESHOLD) errors.push(`Output below dust threshold: ${amount} < ${DUST_THRESHOLD}`);
            if (!out.address)            errors.push('Output missing address');
            // Accept SPN-prefixed addresses (mainnet: SPN1, testnet: SPNt) or legacy format
            if (out.address && out.address !== 'genesis' &&
                !out.address.startsWith('*') &&
                !/^SPN[1t][A-Za-z0-9]{25,50}$/.test(out.address) &&
                !/^[A-Za-z0-9]{20,60}$/.test(out.address)) {
                errors.push('Invalid output address format: ' + out.address.slice(0, 16));
            }
            outputTotal += amount;
        }

        if (inputTotal < outputTotal)
            errors.push(`Input total (${inputTotal}) < output total (${outputTotal})`);

        // Compute fee
        const fee = inputTotal - outputTotal;
        this.fee  = fee;

        if (!options.skipFeeCheck && fee < MIN_FEE)
            errors.push(`Fee too low: ${fee} < ${MIN_FEE} (minimum)`);

        // Transaction size check
        if (this.size() > MAX_TX_SIZE)
            errors.push(`Transaction too large: ${this.size()} bytes`);

        return { valid: errors.length === 0, errors };
    }

    toJSON() {
        return {
            id:         this.id,
            version:    this.version,
            inputs:     this.inputs,
            outputs:    this.outputs,
            timestamp:  this.timestamp,
            isCoinbase: this.isCoinbase,
            locktime:   this.locktime,
            fee:        this.fee ? this.fee.toString() : '0',
            ...(this.data != null ? { data: this.data } : {}),
        };
    }

    size() {
        // Measure real UTF-8 byte length, not JS character count — otherwise
        // Unicode data could make the consensus size differ from the real size.
        return Buffer.byteLength(JSON.stringify(this.toJSON()), 'utf8');
    }
}

module.exports = { UTXOSet, Transaction, SATOSHI, MIN_FEE, DUST_THRESHOLD, MAX_TX_SIZE, COINBASE_MATURITY, FEE_PER_BYTE };
