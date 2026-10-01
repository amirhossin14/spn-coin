'use strict';
const { describe, test, beforeEach } = require('node:test');
require('./_expect');

const { TokenLayer } = require('../tokens/tokens');
const { extendTokenLayer, ExtOps } = require('../tokens/token-extensions');
const { generateKeyPair, publicKeyToAddress } = require('../blockchain/crypto');

function issuer() {
    const kp = generateKeyPair();
    return { ...kp, address: publicKeyToAddress(kp.publicKey) };
}
// issue a token directly into layer state for testing
function seedToken(tokens, iss, { mintable = true } = {}) {
    const op = TokenLayer.buildIssue({
        name: 'TestCoin', symbol: 'TST', decimals: 0, supply: '1000',
        issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey,
        type: 'token', mintable,
    });
    const r = tokens.applyOp(op);
    return op.tokenId;
}

describe('token extensions', () => {
    let tokens, iss, tokenId;
    beforeEach(() => {
        tokens = extendTokenLayer(new TokenLayer());
        iss = issuer();
        tokenId = seedToken(tokens, iss);
    });

    test('burn reduces holder balance and total supply', () => {
        const before = BigInt(tokens.getToken(tokenId).supply);
        const op = ExtOps.buildBurn({ tokenId, amount: '100', holder: iss.address,
            holderPubKey: iss.publicKey, privateKey: iss.privateKey });
        const r = tokens.applyOp(op);
        expect(r.ok).toBe(true);
        expect(BigInt(tokens.getToken(tokenId).supply)).toBe(before - 100n);
    });

    test('burn more than balance fails', () => {
        const op = ExtOps.buildBurn({ tokenId, amount: '999999', holder: iss.address,
            holderPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(op).ok).toBe(false);
    });

    test('freeze blocks transfers from the frozen address', () => {
        const victim = issuer();
        // move some tokens to victim first
        const tOp = TokenLayer.buildTransfer({ tokenId, from: iss.address, to: victim.address,
            amount: '50', fromPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(tOp).ok).toBe(true);
        // issuer freezes victim
        const fOp = ExtOps.buildFreeze({ tokenId, target: victim.address, freeze: true,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(fOp).ok).toBe(true);
        expect(tokens.isFrozen(tokenId, victim.address)).toBe(true);
        // victim now tries to transfer → blocked
        const bad = TokenLayer.buildTransfer({ tokenId, from: victim.address, to: iss.address,
            amount: '10', fromPubKey: victim.publicKey, privateKey: victim.privateKey });
        expect(tokens.applyOp(bad).ok).toBe(false);
    });

    test('unfreeze restores transfers', () => {
        const v = issuer();
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: v.address,
            amount: '50', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        tokens.applyOp(ExtOps.buildFreeze({ tokenId, target: v.address, freeze: true,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey }));
        tokens.applyOp(ExtOps.buildFreeze({ tokenId, target: v.address, freeze: false,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey }));
        expect(tokens.isFrozen(tokenId, v.address)).toBe(false);
    });

    test('only issuer can freeze', () => {
        const attacker = issuer();
        const op = ExtOps.buildFreeze({ tokenId, target: iss.address, freeze: true,
            issuer: attacker.address, issuerPubKey: attacker.publicKey, privateKey: attacker.privateKey });
        expect(tokens.applyOp(op).ok).toBe(false);
    });

    test('ownership transfer changes issuer', () => {
        const next = issuer();
        const op = ExtOps.buildTransferOwner({ tokenId, newIssuer: next.address,
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(op).ok).toBe(true);
        expect(tokens.getToken(tokenId).issuer).toBe(next.address);
    });

    test('set-meta attaches metadata', () => {
        const op = ExtOps.buildSetMeta({ tokenId, meta: { description: 'A test token', website: 'https://x.io', logo: 'https://x.io/l.png' },
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey });
        expect(tokens.applyOp(op).ok).toBe(true);
        const m = tokens.getMeta(tokenId);
        expect(m.extra.description).toBe('A test token');
        expect(m.extra.website).toBe('https://x.io');
    });

    test('distribution returns holder buckets', () => {
        const a = issuer(), b = issuer();
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: a.address, amount: '200', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: b.address, amount: '100', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        const d = tokens.distribution(tokenId, 3);
        expect(d.totalHolders).toBe(3);
        expect(d.top.length).toBeLessThanOrEqual(3);
        expect(d.top[0].percent).toBeGreaterThan(0);
    });

    test('search filters by query and kind', () => {
        const found = tokens.search({ q: 'TST', kind: 'token' });
        expect(found.length).toBe(1);
        expect(tokens.search({ q: 'nonexistent' }).length).toBe(0);
    });
});
