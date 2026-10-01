/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

const { sha256d, merkleRoot, powHash,
        hashMeetsTarget, difficultyForTarget, targetForDifficulty,
        workForTarget, targetToBits, bitsToTarget, POW_LIMIT } = require('./crypto');
const { UTXOSet, Transaction } = require('../utxo/utxo');
const btcSer = require('./btc-serialize');
const nodeCrypto = require('crypto');
const { TokenLayer } = require('../tokens/tokens');

// ── Chain constants ────────────────────────────────────────────
const GENESIS_HASH       = '0000000000000000000000000000000000000000000000000000000000000000';
const BLOCK_TIME_TARGET  = parseInt(process.env.BLOCK_TIME)       || 600_000;   // 10 min (ms)
const DIFFICULTY_WINDOW  = parseInt(process.env.DIFF_WINDOW)      || 2016;      // blocks
const MAX_BLOCK_SIZE     = parseInt(process.env.MAX_BLOCK_SIZE)   || 1_000_000; // 1 MB
const MAX_BLOCK_TXS      = parseInt(process.env.MAX_BLOCK_TXS)    || 3000;
const MIN_DIFFICULTY     = parseInt(process.env.MIN_DIFFICULTY)   || 1;
const HALVING_INTERVAL   = parseInt(process.env.HALVING_INTERVAL) || 210_000;
const INITIAL_REWARD     = BigInt(process.env.INITIAL_REWARD      || '5000000000'); // 50 SPN
const CHAIN_ID           = parseInt(process.env.CHAIN_ID)         || 1;  // 1=mainnet 3=testnet
const EXPECTED_GENESIS_HASH = '0'.repeat(64);

// ══════════════════════════════════════════════════════════════
//  BLOCK
// ══════════════════════════════════════════════════════════════
class Block {
    constructor({ height, timestamp, prevHash, merkleRoot: mr, difficulty, nonce,
                  transactions, hash, miner, chainId, version, bits, size }) {
        this.version      = version      || 1;
        this.height       = height       || 0;
        this.timestamp    = timestamp != null ? Number(timestamp) : Date.now();
        this.prevHash     = prevHash     || GENESIS_HASH;
        this.merkleRoot   = mr           || '0'.repeat(64);
        // 256-bit target is the PoW authority, carried in the compact `bits`.
        // If only a (legacy) integer difficulty is given, derive bits from it.
        if (bits) {
            this.bits = bits;
        } else {
            this.bits = targetToBits(targetForDifficulty(difficulty || MIN_DIFFICULTY));
        }
        // `difficulty` is a derived float kept for display & legacy consumers.
        this.difficulty   = difficultyForTarget(bitsToTarget(this.bits));
        this.nonce        = nonce        || 0;
        this.miner        = miner        || '';
        this.chainId      = chainId      || CHAIN_ID;
        this.transactions = transactions || [];
        this.hash         = hash         || this.computeHash();
        // SECURITY: always compute the size from actual contents. Never trust a
        // `size` field from received data — otherwise a peer could send a huge
        // block with a small fake `size` to bypass the MAX_BLOCK_SIZE check.
        this.size         = this._calcSize();
    }

    /** The 256-bit PoW target for this block (BigInt), from `bits`. */
    target() {
        return bitsToTarget(this.bits);
    }

    // Convert difficulty integer to compact bits field (Bitcoin-style)
    static diffToBits(difficulty) {
        const zeros = Math.min(difficulty, 56);
        return (0x1f000000 | (zeros << 16)).toString(16);
    }

    // ── Bitcoin-EXACT 80-byte binary header hash (ASIC-compatible) ──
    // When Block.BINARY_HEADER is on, the block is hashed exactly like Bitcoin:
    // the 80-byte header (version|prevHash|merkleRoot|time|bits|nonce), double-
    // SHA256. This is what every SHA-256 ASIC / standard Stratum pool computes.
    // NOTE: Bitcoin's header has no `height`/`chainId` fields — in binary mode
    // those must be committed in the coinbase (BIP34-style), not the header.
    // Timestamps are seconds here (Bitcoin uses uint32 seconds), not ms.
    binaryHeaderHash() {
        return btcSer.headerHash({
            version:    this.version,
            prevHash:   this.prevHash,
            merkleRoot: this.merkleRoot,
            time:       Math.floor(Number(this.timestamp) / 1000),
            bits:       typeof this.bits === 'string' ? parseInt(this.bits, 16) : this.bits,
            nonce:      this.nonce >>> 0,
        });
    }

    computeHash() {
        if (Block.BINARY_HEADER) return this.binaryHeaderHash();
        return sha256d(this._headerString());
    }

    // PoW hash (may differ from the identity hash, e.g. scrypt for Litecoin-style).
    powHash() {
        // In binary mode the chain is SHA-256d, so the PoW hash IS the header
        // hash — the exact value an ASIC returns.
        if (Block.BINARY_HEADER) return this.binaryHeaderHash();
        return powHash(this._headerString());
    }

    // PoW "work" of this block, from its 256-bit target (Bitcoin formula).
    work() {
        return workForTarget(this.target());
    }

    // ── Canonical consensus header ──────────────────────────────
    // SINGLE SOURCE OF TRUTH for what the Proof-of-Work commits to. Both the
    // consensus core (computeHash / powHash) AND the Stratum mining pool build
    // their header from here, so a share the miner solves is byte-identical to
    // the block the chain validates. Field order here IS the consensus and must
    // never change without a hard fork.
    canonicalHeader() {
        return {
            version:    this.version,
            height:     this.height,
            prevHash:   this.prevHash,
            merkleRoot: this.merkleRoot,
            timestamp:  this.timestamp,
            bits:       this.bits,
            nonce:      this.nonce,
            chainId:    this.chainId,
        };
    }

    canonicalHeaderString() {
        return JSON.stringify(this.canonicalHeader());
    }

    _headerString() {
        return this.canonicalHeaderString();
    }

    _calcSize() {
        // Measure real UTF-8 byte length, not JS string .length (UTF-16 code
        // units). A block full of multi-byte characters would otherwise report a
        // smaller size than it actually is and could slip past MAX_BLOCK_SIZE.
        return Buffer.byteLength(JSON.stringify(this.transactions), 'utf8');
    }

    // ── Full block validation ──────────────────────────────────
    validate(prevBlock, utxoSet, blockHeight, medianTimePast = 0) {
        const errors = [];

        // SECURITY/DoS guard: reject malformed transaction payloads BEFORE any
        // code touches tx fields (merkle, size, per-tx validation). A received
        // block with a non-array `transactions`, or entries that aren't plain
        // objects (null, string, number), must be rejected — never crash.
        if (!Array.isArray(this.transactions)) {
            return { valid: false, errors: ['Block transactions is not an array'] };
        }
        for (const tx of this.transactions) {
            if (tx === null || typeof tx !== 'object' || Array.isArray(tx) ||
                typeof tx.id !== 'string') {
                return { valid: false, errors: ['Block contains a malformed transaction'] };
            }
        }

        // Reject a malformed/out-of-range PoW target (bits) explicitly.
        if (this.target() <= 0n) {
            errors.push('Invalid or malformed bits/PoW target');
        }

        // Hash integrity check
        const computed = this.computeHash();
        if (computed !== this.hash)
            errors.push(`Invalid block hash: expected ${computed.slice(0, 8)}...`);

        // Proof of Work check: powHash must be <= the 256-bit target
        if (!hashMeetsTarget(this.powHash(), this.target()))
            errors.push(`PoW insufficient: powHash ${this.powHash().slice(0, 12)} exceeds target`);

        // Previous hash link
        if (prevBlock && this.prevHash !== prevBlock.hash)
            errors.push(`Invalid prevHash: expected ${prevBlock.hash.slice(0, 8)}...`);

        // Height sequence
        if (prevBlock && this.height !== prevBlock.height + 1)
            errors.push(`Invalid height: expected ${prevBlock.height + 1}, got ${this.height}`);

        // Timestamp sanity (allow max 2h in the future). Coerce to Number in
        // case timestamps arrive as strings (e.g. Postgres BIGINT columns).
        const now  = Date.now();
        const ts   = Number(this.timestamp);
        const mtp  = Number(medianTimePast) || 0;
        if (ts > now + 7_200_000)
            errors.push('Block timestamp too far in the future');
        if (prevBlock && ts < Number(prevBlock.timestamp))
            errors.push('Block timestamp earlier than previous block');
        // BIP-113: block time must be strictly greater than median-time-past
        if (mtp && ts <= mtp)
            errors.push(`Block timestamp ${ts} <= median-time-past ${mtp}`);

        // Chain ID (replay protection)
        if (this.chainId !== CHAIN_ID)
            errors.push(`Wrong chainId: ${this.chainId} (expected ${CHAIN_ID})`);

        // Merkle root validation
        const txids      = this.transactions.map(tx => tx.id);
        const computedMR = merkleRoot(txids);
        if (computedMR !== this.merkleRoot)
            errors.push(`Invalid Merkle root: ${computedMR.slice(0, 8)} ≠ ${this.merkleRoot.slice(0, 8)}`);

        // Block size limits
        if (this.size > MAX_BLOCK_SIZE)
            errors.push(`Block too large: ${this.size} bytes > ${MAX_BLOCK_SIZE}`);
        if (this.transactions.length > MAX_BLOCK_TXS)
            errors.push(`Too many transactions: ${this.transactions.length} > ${MAX_BLOCK_TXS}`);

        // Coinbase requirement: exactly one, must be first
        const coinbases = this.transactions.filter(tx => tx.isCoinbase);
        if (coinbases.length !== 1)
            errors.push(`Expected exactly 1 coinbase transaction, got ${coinbases.length}`);
        if (this.transactions.length > 0 && !this.transactions[0].isCoinbase)
            errors.push('First transaction must be coinbase');

        // strictSat rejects (returns null for) negative/malformed amounts so
        // an invalid coinbase can't slip a bad value into the UTXO set.
        const strictSat = (v) => {
            const s = String(v).trim();
            return /^\d{1,20}$/.test(s) ? BigInt(s) : null;
        };

        // Sum the coinbase outputs now, but defer the reward-cap comparison until
        // AFTER the transactions are validated — the fee cap must be based on the
        // REAL fees (inputTotal − outputTotal, computed during tx validation), never
        // on the attacker-controlled `tx.fee` field, which would allow coin inflation.
        const expectedReward = Block.getReward(blockHeight);
        let   coinbaseOut    = null;   // null = skip cap check (malformed/absent coinbase)
        if (coinbases.length === 1) {
            const cbOutputs = coinbases[0].outputs;
            if (!Array.isArray(cbOutputs) || cbOutputs.length === 0) {
                errors.push('Coinbase has no valid outputs');
            } else {
                let sum = 0n;
                let bad = false;
                for (const o of cbOutputs) {
                    const amt = o && strictSat(o.amount);
                    if (amt === null || amt === undefined) { bad = true; break; }
                    sum += amt;
                }
                if (bad) errors.push('Coinbase output has an invalid amount');
                else     coinbaseOut = sum;
            }
        }

        // Validate all non-coinbase transactions, accumulating the REAL total fee.
        const seenTxids  = new Set();
        const spentInBlock = new Set();
        let   totalFees  = 0n;

        for (const tx of this.transactions) {
            if (tx.isCoinbase) continue;

            if (seenTxids.has(tx.id)) {
                errors.push(`Duplicate transaction: ${tx.id.slice(0, 16)}`);
                continue;
            }
            seenTxids.add(tx.id);

            const txObj = Object.assign(new Transaction({}), tx);
            const { valid, errors: txErrors } = txObj.validate(utxoSet, blockHeight);
            if (!valid) {
                errors.push(...txErrors.map(e => `TX ${tx.id.slice(0, 8)}: ${e}`));
            } else if (typeof txObj.fee === 'bigint' && txObj.fee > 0n) {
                // Only valid transactions contribute their computed fee to the cap.
                totalFees += txObj.fee;
            }

            // Check for double-spend within the same block
            for (const inp of tx.inputs || []) {
                const key = `${inp.txid}:${inp.vout}`;
                if (spentInBlock.has(key))
                    errors.push(`Double-spend within block: ${key}`);
                spentInBlock.add(key);
            }
        }

        // Now enforce the coinbase reward cap using the real, computed fees.
        if (coinbaseOut !== null && coinbaseOut > expectedReward + totalFees) {
            errors.push(`Coinbase reward too large: ${coinbaseOut} > ${expectedReward + totalFees}`);
        }

        return { valid: errors.length === 0, errors };
    }

    // Calculate block subsidy at given height (with halving)
    static getReward(height) {
        // Guard against NaN/undefined/negative — otherwise BigInt() throws and
        // could crash validation on a malformed block (a DoS vector).
        const h = Number(height);
        if (!Number.isFinite(h) || h < 0) return 0n;
        const halvings = Math.floor(h / HALVING_INTERVAL);
        if (halvings >= 64) return 0n;
        return INITIAL_REWARD >> BigInt(halvings);
    }

    // Genesis block definition
    static genesis() {
        // FAIR LAUNCH — ZERO PREMINE.
        // The genesis coinbase creates NO spendable output, exactly like Bitcoin's
        // genesis (whose coinbase output is unspendable and never enters the UTXO set).
        // Every SPN must therefore be produced by proof-of-work mining from block 1
        // onward: there is no founder allocation and no pre-mined supply.
        // SECURITY: these are HARD-CODED consensus constants, NOT env-overridable, so
        // no operator can inject a premine without changing the source code.
        const genesisTx = new Transaction({
            id:         '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            isCoinbase: true,
            inputs:     [{ txid: '0'.repeat(64), vout: 0xFFFFFFFF,
                           script: '4d79436f696e2047656e65736973', sequence: 0xFFFFFFFF }],
            outputs:    [],   // zero premine — no coins created at genesis
            timestamp:  1,
        });

        return new Block({
            height:       0,
            version:      1,
            timestamp:    1,
            prevHash:     GENESIS_HASH,
            merkleRoot:   genesisTx.id,
            difficulty:   MIN_DIFFICULTY,
            bits:         targetToBits(POW_LIMIT),
            nonce:        0,
            chainId:      CHAIN_ID,
            transactions: [genesisTx],
            hash:         '000' + '0'.repeat(61),
            miner:        'genesis',
        });
    }

    toJSON() {
        return {
            version:      this.version,
            height:       this.height,
            hash:         this.hash,
            prevHash:     this.prevHash,
            merkleRoot:   this.merkleRoot,
            timestamp:    this.timestamp,
            difficulty:   this.difficulty,
            bits:         this.bits,
            nonce:        this.nonce,
            miner:        this.miner,
            chainId:      this.chainId,
            size:         this.size,
            txCount:      this.transactions.length,
            transactions: this.transactions.map(tx =>
                typeof tx.toJSON === 'function' ? tx.toJSON() : tx
            ),
        };
    }
}

// Opt-in Bitcoin-binary header mode (ASIC-compatible). OFF by default so the
// existing JSON consensus is untouched; a full switchover happens with a fresh
// genesis once Phase 2 (standard Stratum) is ready. Enable with BINARY_HEADER=1.
Block.BINARY_HEADER = process.env.BINARY_HEADER === '1';

// ══════════════════════════════════════════════════════════════
//  BLOCKCHAIN
// ══════════════════════════════════════════════════════════════
class Blockchain {
    constructor() {
        const genesis     = Block.genesis();
        this.chain        = [genesis];
        this.utxoSet      = new UTXOSet();
        this.utxoSet.applyBlock(genesis, 0);
        this.tokens       = new TokenLayer();
        this.tokens.applyBlock(genesis);
        this.bestHash     = genesis.hash;
        this.blockIndex   = new Map([[genesis.hash, genesis]]);
    }

    get height() { return this.chain.length - 1; }
    get tip()    { return this.chain[this.chain.length - 1]; }

    // ── Add a validated block to the chain ────────────────────
    addBlock(block) {
        // Blocks arriving over P2P are plain JSON objects, not Block instances,
        // so they have no .validate()/.powHash() methods. Reconstruct them into a
        // real Block first — otherwise every peer-received block throws and inbound
        // block sync is completely broken.
        if (!(block instanceof Block)) {
            try { block = new Block(block); }
            catch (e) { return { ok: false, error: 'Malformed block: ' + e.message }; }
        }
        const prevBlock = this.tip;
        const mtp = this.getMedianTimePast();
        const { valid, errors } = block.validate(prevBlock, this.utxoSet, this.chain.length, mtp);

        if (!valid) {
            console.error(`❌ Block rejected [${block.height}]:`, errors.join('; '));
            return { ok: false, error: errors.join('; ') };
        }

        // CONSENSUS: enforce the network-required difficulty on the add path too.
        // Block.validate() only checks PoW against the block's OWN declared bits;
        // without this a block carrying artificially easy `bits` would be accepted
        // here — minting a cheap coinbase and splitting from peers that already
        // enforce the required target in validateChain(). Mirrors validateChain().
        try {
            const expectedTarget = Blockchain.expectedTargetAt(this.chain, this.chain.length);
            // Compare on the COMPACT (bits) representation — targetToBits is lossy,
            // so normalise both sides through it or a legit retarget block would be
            // wrongly rejected.
            if (bitsToTarget(block.bits) !== bitsToTarget(targetToBits(expectedTarget))) {
                console.error(`❌ Block rejected [${block.height}]: wrong difficulty (bits do not match consensus target)`);
                return { ok: false, error: 'Block has wrong difficulty (bits do not match consensus target)' };
            }
        } catch (e) {
            console.error(`❌ Block rejected [${block.height}]: difficulty check failed: ${e.message}`);
            return { ok: false, error: 'Difficulty check failed: ' + e.message };
        }

        this.chain.push(block);
        this.blockIndex.set(block.hash, block);
        this.utxoSet.applyBlock(block, block.height);
        this.tokens.applyBlock(block);
        this.bestHash = block.hash;

        console.log(`✅ Block [${block.height}] accepted | hash=${block.hash.slice(0, 16)} | txs=${block.transactions.length} | diff=${block.difficulty}`);
        return { ok: true, block };
    }

    // Sum of PoW work across a chain (Nakamoto: most work wins, not longest).
    static chainWork(chain) {
        let total = 0n;
        for (const blk of chain) {
            total += (typeof blk.work === 'function') ? blk.work() : workForTarget(bitsToTarget(blk.bits));
        }
        return total;
    }

    // ── Chain Reorganization (most-cumulative-work rule) ──────
    replaceChain(newChain) {
        const newWork = Blockchain.chainWork(newChain);
        const curWork = Blockchain.chainWork(this.chain);
        if (newWork <= curWork)
            return { replaced: false, reason: 'New chain does not have more cumulative work' };

        const { valid, errors } = this.validateChain(newChain);
        if (!valid) return { replaced: false, reason: errors.join('; ') };

        // A reorg rebuilds the UTXO set by replaying every block's transactions.
        // If the candidate chain contains PRUNED blocks (header kept, tx bodies
        // dropped), that replay would silently produce an INCORRECT UTXO set.
        // Refuse the reorg rather than corrupting state.
        if (Blockchain._hasPrunedBlocks(newChain))
            return { replaced: false, reason: 'Cannot reorg onto a chain containing pruned blocks (UTXO set cannot be rebuilt)' };

        const forkHeight = this._findForkHeight(newChain);
        console.warn(`⚠️  Chain reorg: fork at height ${forkHeight}, work ${curWork} → ${newWork}`);

        // Adopt the new chain.
        this.chain = newChain.slice();
        this.blockIndex = new Map();
        for (const b of this.chain) this.blockIndex.set(b.hash, b);
        this.bestHash = this.tip.hash;

        // Rebuild BOTH ledgers deterministically from the winning chain rather
        // than relying on in-memory undo history. This is the ONLY reorg path
        // that is correct after a restart (when _spentHistory is empty) — the
        // chain itself is the single source of truth.
        this._rebuildState();
        return { replaced: true, forkHeight };
    }

    // Does this chain contain any PRUNED block (header kept, tx bodies dropped)?
    // Such blocks cannot be replayed to reconstruct the UTXO set.
    static _hasPrunedBlocks(chain) {
        for (const b of (chain || [])) {
            const pruned = b && b.merkleRoot && b.merkleRoot !== '0'.repeat(64) &&
                           (!Array.isArray(b.transactions) || b.transactions.length === 0);
            if (pruned) return true;
        }
        return false;
    }

    // Rebuild the UTXO set and token ledger from scratch by replaying the whole
    // chain. Deterministic and restart-safe (no dependence on RAM-only undo).
    _rebuildState() {
        // Guard: replaying a chain with pruned blocks would corrupt the UTXO set
        // (their transactions are gone). Never wipe good state in that case.
        if (Blockchain._hasPrunedBlocks(this.chain)) {
            console.warn('[Chain] _rebuildState skipped: chain contains pruned blocks; UTXO set left unchanged.');
            return;
        }
        this.utxoSet = new UTXOSet();
        this.tokens.reset();
        for (let i = 0; i < this.chain.length; i++) {
            this.utxoSet.applyBlock(this.chain[i], i);
            this.tokens.applyBlock(this.chain[i]);
        }
    }

    _findForkHeight(newChain) {
        for (let i = Math.min(this.chain.length, newChain.length) - 1; i >= 0; i--)
            if (this.chain[i]?.hash === newChain[i]?.hash) return i;
        return 0;
    }

    // ── Full chain validation ──────────────────────────────────
    validateChain(chain = this.chain) {
        const errors   = [];
        if (!Array.isArray(chain) || chain.length === 0)
            return { valid: false, errors: ['Chain is empty'], blocksChecked: 0 };

        // Genesis is a consensus anchor and must be exactly the configured network genesis.
        const expectedGenesis = Block.genesis();
        const genesis = chain[0];
        if (genesis.hash !== EXPECTED_GENESIS_HASH ||
            genesis.height !== 0 ||
            genesis.prevHash !== GENESIS_HASH ||
            genesis.chainId !== CHAIN_ID ||
            genesis.merkleRoot !== expectedGenesis.merkleRoot ||
            genesis.transactions.length !== expectedGenesis.transactions.length) {
            errors.push('Invalid genesis block');
            return { valid: false, errors, blocksChecked: 0 };
        }
        // Explicitly verify the genesis PREMINE outputs (address + amount) against
        // the expected genesis. The merkleRoot alone is a fixed constant that does
        // not derive from the outputs, so without this an altered premine could
        // pass. This anchors the initial coin supply.
        {
            const gTx = (genesis.transactions || [])[0] || {};
            const eTx = expectedGenesis.transactions[0];
            const gOut = JSON.stringify((gTx.outputs || []).map(o => ({ address: o.address, amount: String(o.amount) })));
            const eOut = JSON.stringify((eTx.outputs || []).map(o => ({ address: o.address, amount: String(o.amount) })));
            if (gTx.id !== eTx.id || gOut !== eOut) {
                errors.push('Genesis premine outputs do not match the expected network genesis');
                return { valid: false, errors, blocksChecked: 0 };
            }
        }

        const tempUTXO = new UTXOSet();
        tempUTXO.applyBlock(genesis, 0);

        for (let i = 1; i < chain.length; i++) {
            // A pruned block has had its tx bodies dropped but keeps a real
            // merkleRoot. We can't re-check its transactions, so validate only
            // its header (PoW, difficulty, links) and skip the body checks.
            const b = chain[i];
            const isPruned = b && b.merkleRoot && b.merkleRoot !== '0'.repeat(64) &&
                             (!Array.isArray(b.transactions) || b.transactions.length === 0);
            if (isPruned) {
                if (b.prevHash !== chain[i - 1].hash) {
                    errors.push(`Block ${i} (pruned) has broken link`);
                    break;
                }
                try {
                    const expected = Blockchain.expectedTargetAt(chain, i);
                    if (bitsToTarget(b.bits) !== bitsToTarget(targetToBits(expected))) {
                        errors.push(`Block ${i} (pruned) has wrong difficulty`);
                        break;
                    }
                } catch (e) { errors.push(`Block ${i} (pruned) difficulty check failed`); break; }
                continue;   // can't apply tx bodies for a pruned block
            }

            // Candidate chains from peers are plain objects — reconstruct so
            // .validate() exists, and enforce the SAME BIP-113 median-time-past
            // rule addBlock() uses, or replaceChain could adopt a block the normal
            // add path would reject (a consensus split between the two code paths).
            let blk = chain[i];
            if (!(blk instanceof Block)) {
                try { blk = new Block(blk); chain[i] = blk; }
                catch (e) { errors.push(`Block ${i} malformed: ${e.message}`); break; }
            }
            const mtpWindow = [];
            for (let j = Math.max(0, i - 11); j < i; j++)
                if (chain[j]) mtpWindow.push(Number(chain[j].timestamp));
            mtpWindow.sort((a, b) => a - b);
            const mtpAt = mtpWindow.length ? mtpWindow[Math.floor(mtpWindow.length / 2)] : 0;

            const { valid, errors: blkErrors } = blk.validate(chain[i - 1], tempUTXO, i, mtpAt);
            if (!valid) {
                errors.push(`Block ${i} invalid: ` + blkErrors.join('; '));
                break;
            }
            // CONSENSUS: enforce the network-required difficulty. A block must
            // carry exactly the target the retarget rules dictate — otherwise a
            // chain of easy blocks could accumulate fake "work" and force a reorg.
            try {
                const expected = bitsToTarget(targetToBits(Blockchain.expectedTargetAt(chain, i)));
                const actual   = bitsToTarget(chain[i].bits);
                if (actual !== expected) {
                    errors.push(`Block ${i} has wrong difficulty (bits do not match consensus target)`);
                    break;
                }
            } catch (e) {
                errors.push(`Block ${i} difficulty check failed: ${e.message}`);
                break;
            }
            tempUTXO.applyBlock(chain[i], i);
        }

        return {
            valid:         errors.length === 0,
            errors,
            blocksChecked: errors.length === 0 ? chain.length : chain.length - 1,
        };
    }

    // Lightweight header validation for headers-first sync. Checks that the
    // header's proof-of-work actually meets its stated target. This is the
    // minimum needed so a peer can't feed us junk headers during sync.
    validateHeader(h) {
        try {
            if (!h || typeof h !== 'object') return false;
            if (h.bits === undefined && h.difficulty === undefined) return false;
            // Reconstruct a Block from the header to compute powHash + target.
            const blk = new Block({
                height: h.height, timestamp: h.timestamp, prevHash: h.prevHash,
                merkleRoot: h.merkleRoot, difficulty: h.difficulty, nonce: h.nonce,
                bits: h.bits, chainId: h.chainId,
            });
            // PoW must meet the target encoded in the header itself.
            return hashMeetsTarget(blk.powHash(), blk.target());
        } catch (e) {
            return false;
        }
    }

    // ── Difficulty Adjustment (256-bit target, fine-grained) ──
    getNextTarget() {
        // The target for the NEXT block (index = chain.length) MUST be computed
        // with the exact same rule the validator uses (expectedTargetAt) —
        // otherwise mining and validation disagree at a retarget boundary and a
        // freshly-mined block gets rejected. Delegate to the single source of truth.
        return Blockchain.expectedTargetAt(this.chain, this.chain.length);
    }

    // Pure retarget math, usable for BOTH mining and validating an arbitrary
    // chain. Given the current target and the window's start/end timestamps,
    // returns the next target. This is the ONLY source of truth for difficulty.
    static _retarget(curTarget, startTs, endTs) {
        let actualTime = Number(endTs) - Number(startTs);
        const targetTime = BLOCK_TIME_TARGET * DIFFICULTY_WINDOW;
        actualTime = Math.max(Math.floor(targetTime / 4), Math.min(actualTime, targetTime * 4));
        let newTarget = (curTarget * BigInt(actualTime)) / BigInt(targetTime);
        if (newTarget > POW_LIMIT) newTarget = POW_LIMIT;
        if (newTarget < 1n) newTarget = 1n;
        return newTarget;
    }

    // The target a block at `index` in `chain` MUST have, per consensus rules.
    // Enforced during chain validation so a chain of low-difficulty blocks
    // cannot be accepted just by piling up fake "work".
    static expectedTargetAt(chain, index) {
        if (index === 0) return bitsToTarget(chain[0].bits);
        // Only recompute on retarget boundaries; otherwise inherit previous target.
        if (index < DIFFICULTY_WINDOW || index % DIFFICULTY_WINDOW !== 0) {
            return bitsToTarget(chain[index - 1].bits);
        }
        const curTarget   = bitsToTarget(chain[index - 1].bits);
        const windowStart = chain[index - DIFFICULTY_WINDOW + 1];
        const windowEnd   = chain[index - 1];
        return Blockchain._retarget(curTarget, windowStart.timestamp, windowEnd.timestamp);
    }

    // Legacy float difficulty for display / Stratum vardiff.
    // ── Median-Time-Past (Bitcoin BIP-113 consensus rule) ─────
    // Returns the median timestamp of the last 11 blocks. Block
    // timestamps must exceed this, preventing timestamp manipulation.
    getMedianTimePast(height = this.height) {
        const times = [];
        for (let i = Math.max(0, height - 10); i <= height; i++)
            if (this.chain[i]) times.push(Number(this.chain[i].timestamp));
        if (!times.length) return 0;
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
    }

    getNextDifficulty() {
        return difficultyForTarget(this.getNextTarget());
    }

    // The current network PoW target (BigInt) — used by miners/pools.
    currentTarget() {
        return this.tip.target();
    }

    // ── Lookup helpers ────────────────────────────────────────
    getBlock(hash)         { return this.blockIndex.get(hash)    || null; }
    getBlockByHeight(h)    { return this.chain[h]                || null; }

    getTransaction(txid) {
        for (const block of [...this.chain].reverse()) {
            const tx = block.transactions.find(t => t.id === txid);
            if (tx) return { tx, block };
        }
        return null;
    }

    getBalance(address)  { return this.utxoSet.getBalance(address); }
    getUTXOs(address)    { return this.utxoSet.getUTXOs(address); }

    // ── Node statistics ───────────────────────────────────────
    getStats() {
        const tip = this.tip;
        const halvings = Math.floor(this.height / HALVING_INTERVAL);
        const currentReward = halvings >= 64 ? 0n : INITIAL_REWARD >> BigInt(halvings);
        return {
            height:        this.height,
            hash:          tip.hash,
            difficulty:    tip.difficulty,
            hashrate:      Math.pow(2, tip.difficulty),
            totalBlocks:   this.chain.length,
            utxoCount:     this.utxoSet.utxos.size,
            chainId:       CHAIN_ID,
            networkType:   CHAIN_ID === 1 ? 'mainnet' : 'testnet',
            miningReward:  currentReward.toString(),
            halvings,
            nextHalving:   (halvings + 1) * HALVING_INTERVAL,
        };
    }
}

// ── CPU Mining helper (testnet / development) ─────────────────
const { sha256d: _sha256d, meetsTarget: _meets, merkleRoot: _merkle } = require('./crypto');

Blockchain.prototype.mineBlock = function({ miner, transactions = [] }) {
    const prevBlock = this.tip;
    const target    = this.getNextTarget();
    const bits      = targetToBits(target);
    const height    = this.chain.length;

    const halvings = Math.floor(height / HALVING_INTERVAL);
    const reward   = halvings >= 64 ? 0n : INITIAL_REWARD >> BigInt(halvings);

    const coinbase = {
        id:         nodeCrypto.randomBytes(32).toString('hex'),
        isCoinbase: true,
        inputs:     [{ txid: '0'.repeat(64), vout: 0xFFFFFFFF, script: Buffer.from(`Height:${height}`).toString('hex'), sequence: 0xFFFFFFFF }],
        outputs:    [{ address: miner, amount: reward.toString() }],
        timestamp:  Date.now(),
    };

    const txList = [coinbase, ...transactions];
    const txids  = txList.map(t => t.id);
    const mr     = _merkle(txids);
    let nonce    = 0;
    // Timestamp must exceed median-time-past (BIP-113) and not predate the tip.
    // When mining fast, Date.now() can equal MTP — bump to MTP+1 to stay valid.
    const mtp = Number(this.getMedianTimePast());
    const ts  = Math.max(Date.now(), mtp + 1, Number(prevBlock.timestamp) + 1);

    while (nonce < 0x7FFFFFFF) {
        const candidate = new Block({
            height, timestamp: ts, prevHash: prevBlock.hash,
            merkleRoot: mr, bits, nonce, miner,
            transactions: txList, chainId: CHAIN_ID,
        });
        if (hashMeetsTarget(candidate.powHash(), target)) {
            const result = this.addBlock(candidate);
            if (result.ok) return result;
            return { ok: false, error: result.error };
        }
        nonce++;
        if (nonce % 100_000 === 0) process.stdout.write('.');
    }
    return { ok: false, error: 'Nonce space exhausted' };
};

module.exports = {
    Blockchain, Block,
    GENESIS_HASH, BLOCK_TIME_TARGET, HALVING_INTERVAL, INITIAL_REWARD, CHAIN_ID,
};
