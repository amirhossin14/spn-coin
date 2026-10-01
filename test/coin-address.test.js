'use strict';
const { describe, test } = require('node:test');
require('./_expect');

const {
    deriveCoinAddress, generateCoinWallet, generateVanity, guessNetworkPrefixLen,
} = require('../tokens/coin-address');
const { validateAddress } = require('../blockchain/crypto');

describe('coin address generation', () => {
    test('deriveCoinAddress is deterministic and valid', () => {
        const a = deriveCoinAddress('token123', 'SPNissuerAddr');
        const b = deriveCoinAddress('token123', 'SPNissuerAddr');
        expect(a.address).toBe(b.address);                 // reproducible
        expect(a.spendable).toBe(false);
        expect(validateAddress(a.address)).toBeTruthy();   // valid format
    });

    test('different coins get different addresses', () => {
        const a = deriveCoinAddress('tokenA', 'iss');
        const b = deriveCoinAddress('tokenB', 'iss');
        expect(a.address).not.toBe(b.address);
    });

    test('generateCoinWallet produces a spendable keypair', () => {
        const w = generateCoinWallet();
        expect(w.spendable).toBe(true);
        expect(w.privateKey).toBeTruthy();
        expect(w.publicKey).toBeTruthy();
        expect(validateAddress(w.address)).toBeTruthy();
    });

    test('vanity requires a pattern', () => {
        const r = generateVanity({});
        expect(r.found).toBe(false);
    });

    test('vanity finds a 1-char prefix quickly', () => {
        // 1 char over 58-alphabet → found within a few hundred tries
        const pfxLen = guessNetworkPrefixLen();
        const r = generateVanity({ prefix: 'a', caseSensitive: false, maxAttempts: 20000, timeoutMs: 6000 });
        expect(r.found).toBe(true);
        expect(validateAddress(r.address)).toBeTruthy();
        // the vanity char should appear right after the network prefix
        expect(r.address.slice(pfxLen).toLowerCase().startsWith('a')).toBe(true);
        expect(r.privateKey).toBeTruthy();
    });

    test('vanity respects maxAttempts and reports not found', () => {
        // an implausible long pattern with tiny budget → not found, bounded
        const r = generateVanity({ prefix: 'zzzzzz', maxAttempts: 50, timeoutMs: 2000 });
        expect(r.found).toBe(false);
        expect(r.attempts).toBeLessThanOrEqual(50);
    });
});
