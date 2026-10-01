/**
 * © 2026 SPN Coin — verifies client-side signing matches server verification.
 * Simulates what public/token-sign.js does in the browser (using elliptic +
 * Node crypto for sha256) and checks the node accepts the result.
 */
'use strict';
const { describe, test } = require('node:test');
require('./_expect');


const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const { sha256, verify } = require('../blockchain/crypto');
const { TokenLayer } = require('../tokens/tokens');
const { CHAIN_ID } = require('../config');

// mimic token-sign.js helpers on Node
function canon(body) { return JSON.stringify(body, Object.keys(body).sort()); }
function sha256HexOfBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function signHash(key, dataHashHex) {
    const inner = crypto.createHash('sha256').update(Buffer.from(dataHashHex, 'hex')).digest();
    return Buffer.from(key.sign(inner, { canonical: true }).toDER()).toString("hex");
}

const SPKI_HEADER = '3056301006072a8648ce3d020106052b8104000a034200';
function makeKey() {
    const key = ec.genKeyPair();
    const pub = SPKI_HEADER + key.getPublic(false, 'hex'); // DER-SPKI, uncompressed
    return { key, pub };
}

describe('client-side signing → server verification', () => {
    test('a client-built ISSUE op verifies on the server', () => {
        const { key, pub } = makeKey();
        const nonce = 'aabbccdd11223344';
        const tokenId = sha256(`${pub}|MyCoin|MYC|1000|${nonce}`).slice(0, 40);
        const body = {
            type: 'issue', tokenId, name: 'MyCoin', symbol: 'MYC',
            decimals: 0, supply: '1000', kind: 'token', mintable: false,
            issuer: 'SPNissuerAddr', issuerPubKey: pub, chainId: CHAIN_ID, nonce,
        };
        const sig = signHash(key, sha256(canon(body)));
        const op = { ...body, sig };

        // server-side verification path (same as TokenLayer._verify)
        const { sig: _s, ...bodyOnly } = op;
        const opHash = sha256(canon(bodyOnly));
        expect(verify(pub, opHash, sig)).toBe(true);
    });

    test('a client-built TRANSFER op verifies on the server', () => {
        const { key, pub } = makeKey();
        const nonce = '1122334455667788';
        const body = {
            type: 'transfer', tokenId: 'tok123', from: 'SPNfrom', to: 'SPNto',
            amount: '50', fromPubKey: pub, chainId: CHAIN_ID, nonce,
        };
        const sig = signHash(key, sha256(canon(body)));
        const { sig: _s, ...bodyOnly } = { ...body, sig };
        expect(verify(pub, sha256(canon(bodyOnly)), sig)).toBe(true);
    });

    test('tampering the op body breaks the signature', () => {
        const { key, pub } = makeKey();
        const body = { type: 'mint', tokenId: 't', amount: '5',
            issuer: 'SPNi', issuerPubKey: pub, chainId: CHAIN_ID, nonce: 'ff' };
        const sig = signHash(key, sha256(canon(body)));
        const tampered = { ...body, amount: '99999' };
        expect(verify(pub, sha256(canon(tampered)), sig)).toBe(false);
    });

    test('a client-signed carrier tx input verifies with sigMessage', () => {
        const { key, pub } = makeKey();
        const txid = sha256('faketxid');
        const nonce = 'deadbeef';
        const inp = { txid: 'prevtx', vout: 0 };
        // sigMessage EXACT shape from utxo.js
        const sigMsg = sha256(JSON.stringify({
            txid, inp: inp.txid, vout: inp.vout, nonce, chainId: CHAIN_ID,
        }));
        const signature = signHash(key, sigMsg);
        expect(verify(pub, sigMsg, signature)).toBe(true);
    });
});
