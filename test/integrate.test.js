/**
 * © 2026 SPN Coin Project — tests for bitcoin/integrate.js
 * Verifies the integration layer activates features without breaking core.
 */
'use strict';
const { describe, test } = require('node:test');
require('./_expect');


const { integrateBitcoin } = require('../bitcoin/integrate');
const segwit = require('../bitcoin/segwit');
const crypto = require('crypto');

let c = 0;
const mkTx = (fee = 1000, inputs = null, outputs = null) => {
    c++;
    return {
        id: crypto.createHash('sha256').update('itx' + c + Math.random()).digest('hex'),
        version: 1, timestamp: Date.now(), locktime: 0, fee: BigInt(fee),
        inputs: inputs || [{ txid: '0'.repeat(64), vout: 0, sequence: 0 }],
        outputs: outputs || [{ address: 'A', amount: '5000' }],
    };
};

// Minimal fakes matching the real API shapes
function fakeMempool() {
    const txs = new Map();
    return {
        txs,
        add(tx) { txs.set(tx.id, { tx }); return { ok: true, txid: tx.id }; },
        remove(txid) { return txs.delete(txid); },
        removeConfirmed(list) { for (const t of list) txs.delete(t.id || t); },
        getTopN(n = 500) { return [...txs.values()].map(e => e.tx).slice(0, n); },
        getStats() { return { count: txs.size }; },
        size() { return txs.size; },
    };
}
function fakeBlockchain() {
    return {
        chain: [{ hash: '00'.repeat(32) }],
        addBlock(block) { this.lastAdded = block; return { ok: true }; },
        mineBlock({ transactions = [] }) {
            const coinbase = { id: 'cb', isCoinbase: true,
                inputs: [{ txid: '0'.repeat(64), vout: 0xffffffff }],
                outputs: [{ address: 'miner', amount: '50' }] };
            return { ok: true, block: { height: 1, hash: 'aa'.repeat(32),
                transactions: [coinbase, ...transactions] } };
        },
    };
}

describe('integrateBitcoin', () => {
    test('wires all four hooks', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        const report = integrateBitcoin({ blockchain, mempool, log: () => {} });
        expect(report.mempool).toBe(true);
        expect(report.mining).toBe(true);
        expect(report.validation).toBe(true);
        expect(report.locator).toBe(true);
    });

    test('mempool still adds and selects after wiring', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        integrateBitcoin({ blockchain, mempool, log: () => {} });
        expect(mempool.add(mkTx(5000, [{ txid: 'a1'.repeat(32), vout: 0, sequence: 0 }])).ok).toBe(true);
        expect(mempool.add(mkTx(9000, [{ txid: 'b2'.repeat(32), vout: 0, sequence: 0 }])).ok).toBe(true);
        const top = mempool.getTopN(10);
        expect(top.length).toBe(2);
        expect(mempool.__shadow.size()).toBe(2);
    });

    test('mined block carries a valid witness commitment', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        integrateBitcoin({ blockchain, mempool, log: () => {} });
        const t1 = mkTx(); t1.inputs[0].witness = ['aa'.repeat(72), 'bb'.repeat(33)];
        const { block } = blockchain.mineBlock({ transactions: [t1] });
        const commit = block.transactions[0].witnessCommitment;
        expect(commit).toBeTruthy();
        expect(segwit.verifyWitnessCommitment(block.transactions, commit)).toBe(true);
    });

    test('addBlock rejects a tampered witness commitment', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        integrateBitcoin({ blockchain, mempool, log: () => {} });
        const t1 = mkTx(); t1.inputs[0].witness = ['aa'.repeat(72), 'bb'.repeat(33)];
        const { block } = blockchain.mineBlock({ transactions: [t1] });
        // tamper witness after commitment computed
        block.transactions[1].inputs[0].witness = ['ff'.repeat(72), 'ee'.repeat(33)];
        const res = blockchain.addBlock(block);
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/witness commitment/i);
    });

    test('addBlock accepts a valid block', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        integrateBitcoin({ blockchain, mempool, log: () => {} });
        const { block } = blockchain.mineBlock({ transactions: [mkTx()] });
        expect(blockchain.addBlock(block).ok).toBe(true);
    });

    test('buildLocator produces a descending hash locator', () => {
        const mempool = fakeMempool();
        const blockchain = fakeBlockchain();
        for (let i = 1; i <= 20; i++) blockchain.chain.push({ hash: String(i).repeat(4) });
        integrateBitcoin({ blockchain, mempool, log: () => {} });
        const loc = blockchain.buildLocator();
        expect(loc[0]).toBe(blockchain.chain[blockchain.chain.length - 1].hash);
        expect(loc[loc.length - 1]).toBe(blockchain.chain[0].hash);
    });

    test('fee estimation is available post-integration', () => {
        const mempool = fakeMempool();
        integrateBitcoin({ blockchain: fakeBlockchain(), mempool, log: () => {} });
        for (let i = 0; i < 10; i++) mempool.add(mkTx(1000 + i * 500));
        const rate = mempool.estimateFeeRate(3);
        expect(typeof rate).toBe('number');
        expect(rate).toBeGreaterThanOrEqual(1);
    });
});
