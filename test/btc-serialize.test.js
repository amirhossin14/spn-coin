/**
 * Proves the binary serialization is BYTE-EXACT with Bitcoin by reproducing
 * real Bitcoin mainnet values — the same values every SHA-256 ASIC computes.
 * Run: node --test test/btc-serialize.test.js
 */
'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert');
const B = require('../blockchain/btc-serialize');

describe('Bitcoin-exact binary serialization', () => {

    // Bitcoin genesis block — the most famous test vector in existence.
    const genesis = {
        version:    1,
        prevHash:   '0000000000000000000000000000000000000000000000000000000000000000',
        merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        time:       1231006505,
        bits:       0x1d00ffff,
        nonce:      2083236893,
    };
    const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

    test('80-byte header serializes to the exact Bitcoin bytes', () => {
        const buf = B.serializeHeader(genesis);
        assert.strictEqual(buf.length, 80, 'header must be exactly 80 bytes');
        // Known hex of Bitcoin's genesis header:
        const expected =
            '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
        assert.strictEqual(buf.toString('hex'), expected);
    });

    test('double-SHA256 reproduces the real Bitcoin genesis block hash', () => {
        assert.strictEqual(B.headerHash(genesis), GENESIS_HASH);
    });

    test('merkle root of a single tx equals that tx id', () => {
        const txid = genesis.merkleRoot; // genesis has one tx; root == its txid
        assert.strictEqual(B.merkleRoot([txid]), txid);
    });

    test('varint encodes CompactSize correctly', () => {
        assert.strictEqual(B.varint(0x10).toString('hex'), '10');
        assert.strictEqual(B.varint(0xfd).toString('hex'), 'fdfd00');
        assert.strictEqual(B.varint(0x10000).toString('hex'), 'fe00000100');
    });

    // Bitcoin genesis coinbase transaction — a real, famous test vector.
    const genesisCoinbase = {
        version: 1,
        inputs: [{
            txid: '0000000000000000000000000000000000000000000000000000000000000000',
            vout: 0xffffffff,
            script: '04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73',
            sequence: 0xffffffff,
        }],
        outputs: [{
            value: 5000000000, // 50 BTC in satoshi
            script: '4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac',
        }],
        locktime: 0,
    };
    const GENESIS_COINBASE_RAW =
        '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

    test('transaction serializes to the exact Bitcoin bytes', () => {
        assert.strictEqual(B.serializeTx(genesisCoinbase).toString('hex'), GENESIS_COINBASE_RAW);
    });

    test('txid reproduces the real Bitcoin genesis coinbase txid', () => {
        // The genesis coinbase txid IS the genesis merkle root.
        assert.strictEqual(B.txid(genesisCoinbase), GENESIS_HASH_MERKLE);
    });

    test('merkle root of the genesis coinbase equals the block merkle root', () => {
        assert.strictEqual(B.merkleRoot([B.txid(genesisCoinbase)]), GENESIS_HASH_MERKLE);
    });

    test('P2PKH scriptPubKey builds and round-trips', () => {
        const h = '135080cafbe4d43d38296069eb58bdc284c3472f';
        const spk = B.p2pkhScript(h);
        assert.strictEqual(spk, '76a914' + h + '88ac');
        assert.strictEqual(B.p2pkhToHash160(spk), h);
    });

    test('an address-based (SPN) output serializes to binary end-to-end', () => {
        process.env.CHAIN_ID = '3';
        const { Wallet } = require('../wallet/wallet');
        const addr = new Wallet().address;
        // Map the SPN address output → Bitcoin scriptPubKey, then serialize.
        const tx = {
            version: 1,
            inputs: [{ txid: '00'.repeat(32), vout: 0xffffffff, script: '00', sequence: 0xffffffff }],
            outputs: [{ value: 5000000000n, script: B.addressToScriptPubKey(addr) }],
            locktime: 0,
        };
        const id = B.txid(tx);
        assert.match(id, /^[0-9a-f]{64}$/, 'txid must be 32-byte hex');
        // Deterministic: same tx ⇒ same txid.
        assert.strictEqual(B.txid(tx), id);
    });
});

const GENESIS_HASH_MERKLE = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
