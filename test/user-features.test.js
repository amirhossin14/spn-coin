'use strict';
const { describe, test, beforeEach } = require('node:test');
require('./_expect');

const { TokenLayer } = require('../tokens/tokens');
const { extendTokenLayer } = require('../tokens/token-extensions');
const { installTokenStats } = require('../tokens/token-stats');
const { AddressBook, WebhookRegistry, ApiKeyStore, filterTxHistory } = require('../monitor/user-features');
const { generateKeyPair, publicKeyToAddress } = require('../blockchain/crypto');

const acct = () => { const k = generateKeyPair(); return { ...k, address: publicKeyToAddress(k.publicKey) }; };

describe('token stats', () => {
    let tokens, iss, tokenId;
    beforeEach(() => {
        tokens = installTokenStats(extendTokenLayer(new TokenLayer()));
        iss = acct();
        const op = TokenLayer.buildIssue({ name: 'Stat', symbol: 'STA', decimals: 0, supply: '1000',
            issuer: iss.address, issuerPubKey: iss.publicKey, privateKey: iss.privateKey, type: 'token', mintable: false });
        tokens.applyOp(op); tokenId = op.tokenId;
    });
    test('topHolders ranks by balance with percentages', () => {
        const a = acct(), b = acct();
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: a.address, amount: '300', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        tokens.applyOp(TokenLayer.buildTransfer({ tokenId, from: iss.address, to: b.address, amount: '100', fromPubKey: iss.publicKey, privateKey: iss.privateKey }));
        const top = tokens.topHolders(tokenId, 10);
        expect(top.totalHolders).toBe(3);
        expect(top.holders[0].percent).toBeGreaterThanOrEqual(top.holders[1].percent);
    });
    test('topTokens and globalStats work', () => {
        expect(tokens.topTokens({ by: 'holders' }).length).toBe(1);
        const g = tokens.globalStats();
        expect(g.totalAssets).toBe(1);
        expect(g.tokens).toBe(1);
    });
    test('tokenDetail bundles everything', () => {
        const d = tokens.tokenDetail(tokenId);
        expect(d.symbol).toBe('STA');
        expect(Array.isArray(d.topHolders)).toBe(true);
    });
});

describe('address book', () => {
    test('add, list, remove', () => {
        const ab = new AddressBook();
        const owner = 'SPNowner';
        ab.add(owner, 'SPNfriend', 'Alice', 'my friend');
        expect(ab.list(owner).length).toBe(1);
        expect(ab.list(owner)[0].label).toBe('Alice');
        ab.remove(owner, 'SPNfriend');
        expect(ab.list(owner).length).toBe(0);
    });
    test('serializes and restores', () => {
        const ab = new AddressBook(); ab.add('o', 'a', 'L');
        const ab2 = AddressBook.fromJSON(ab.toJSON());
        expect(ab2.list('o')[0].address).toBe('a');
    });
});

describe('webhooks', () => {
    test('register requires a valid url', () => {
        const wr = new WebhookRegistry();
        expect(wr.register({ url: 'not-a-url' }).ok).toBe(false);
        expect(wr.register({ url: 'https://ok.test/hook', events: ['block'] }).ok).toBe(true);
    });
    test('emit fires only matching hooks', async () => {
        const wr = new WebhookRegistry();
        const a = wr.register({ url: 'https://a.test', events: ['block'] });
        const b = wr.register({ url: 'https://b.test', events: ['tx'] });
        const fired = await wr.emit('block', { height: 1 });
        expect(fired).toContain(a.id);
        expect(fired).not.toContain(b.id);
    });
});

describe('api keys', () => {
    test('issue, verify, scope check, revoke', () => {
        const store = new ApiKeyStore();
        const { apiKey } = store.issue({ label: 'dev', owner: 'SPNo', scopes: ['read'] });
        expect(store.verify(apiKey, 'read').ok).toBe(true);
        expect(store.verify(apiKey, 'write').ok).toBe(false);   // missing scope
        expect(store.verify('spn_bogus').ok).toBe(false);
        store.revoke(apiKey);
        expect(store.verify(apiKey).ok).toBe(false);
    });
});

describe('tx history filter', () => {
    test('filters by address and direction', () => {
        const blockchain = { chain: [
            { transactions: [{ id: 't1', timestamp: 1, inputs: [], outputs: [{ address: 'A', amount: '100' }] }] },
            { transactions: [{ id: 't2', timestamp: 2, inputs: [{ address: 'A' }], outputs: [{ address: 'B', amount: '50' }] }] },
        ] };
        const inA = filterTxHistory(blockchain, { address: 'A', direction: 'in' });
        expect(inA.length).toBe(1);
        expect(inA[0].txid).toBe('t1');
        const outA = filterTxHistory(blockchain, { address: 'A', direction: 'out' });
        expect(outA.length).toBe(1);
        expect(outA[0].txid).toBe('t2');
    });
    test('respects minAmount and limit', () => {
        const blockchain = { chain: [{ transactions: [
            { id: 'x', timestamp: 1, inputs: [], outputs: [{ address: 'A', amount: '10' }] },
            { id: 'y', timestamp: 2, inputs: [], outputs: [{ address: 'A', amount: '1000' }] },
        ] }] };
        const big = filterTxHistory(blockchain, { address: 'A', minAmount: 100 });
        expect(big.length).toBe(1);
        expect(big[0].txid).toBe('y');
    });
});
