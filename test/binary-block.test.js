/**
 * Proves the Block class can produce an ASIC-valid, Bitcoin-exact block hash
 * via its binary header path — reproducing the real Bitcoin genesis hash.
 * The default JSON path is unchanged (BINARY_HEADER stays off elsewhere).
 * Run: node --test test/binary-block.test.js
 */
'use strict';
process.env.CHAIN_ID = '3';
const { describe, test } = require('node:test');
const assert = require('node:assert');
const { Block } = require('../blockchain/blockchain');

describe('Block class → Bitcoin-binary header', () => {

    test('binaryHeaderHash reproduces the real Bitcoin genesis block hash', () => {
        const b = new Block({
            version:    1,
            prevHash:   '0000000000000000000000000000000000000000000000000000000000000000',
            merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            timestamp:  1231006505 * 1000,   // stored ms; binary path uses seconds
            bits:       '1d00ffff',
            nonce:      2083236893,
        });
        assert.strictEqual(
            b.binaryHeaderHash(),
            '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        );
    });

    test('BINARY_HEADER flag routes computeHash/powHash through the binary path', () => {
        const fields = {
            version: 1,
            prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
            merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            timestamp: 1231006505 * 1000, bits: '1d00ffff', nonce: 2083236893,
        };
        const prev = Block.BINARY_HEADER;
        try {
            Block.BINARY_HEADER = true;
            const b = new Block(fields);
            const GEN = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
            assert.strictEqual(b.computeHash(), GEN, 'computeHash uses binary in binary mode');
            assert.strictEqual(b.powHash(), GEN, 'powHash uses binary in binary mode');
        } finally {
            Block.BINARY_HEADER = prev; // never leak the flag into other tests
        }
    });

    test('default (JSON) mode is unchanged — hash differs from the binary hash', () => {
        const b = new Block({
            version: 1,
            prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
            merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            timestamp: 1231006505 * 1000, bits: '1d00ffff', nonce: 2083236893,
        });
        assert.notStrictEqual(b.computeHash(), b.binaryHeaderHash(),
            'JSON path (default) must not equal the binary path');
    });
});
