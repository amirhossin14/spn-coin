/**
 * © 2026 SPN Coin Project — tests for advanced networking modules.
 * Run with: npx jest test/network.test.js
 */
'use strict';
const { describe, test } = require('node:test');
require('./_expect');


const { AddrMan } = require('../p2p/addrman');
const { NetGuard } = require('../p2p/netguard');
const { BlockPruner, compactHeader, parseHeader } = require('../p2p/pruner');
const { SyncManager } = require('../p2p/syncmanager');
const { enhanceNode } = require('../p2p/net-enhance');
const EventEmitter = require('events');

describe('AddrMan', () => {
    test('adds and dedupes addresses', () => {
        const am = new AddrMan();
        expect(am.add('1.2.3.4', 8333)).toBe(true);
        expect(am.add('1.2.3.4', 8333)).toBe(false);
    });
    test('promotes to tried after success', () => {
        const am = new AddrMan();
        am.add('1.2.3.4', 8333);
        am.onSuccess('1.2.3.4', 8333);
        expect(am.size().tried).toBe(1);
    });
    test('drops repeatedly-failing new peer', () => {
        const am = new AddrMan();
        am.add('5.6.7.8', 8333);
        am.map.get('5.6.7.8:8333').attempts = 3;
        am.onFailure('5.6.7.8', 8333);
        expect(am.map.has('5.6.7.8:8333')).toBe(false);
    });
    test('serializes and restores', () => {
        const am = new AddrMan();
        am.add('1.2.3.4', 8333); am.onSuccess('1.2.3.4', 8333);
        const restored = AddrMan.fromJSON(am.toJSON());
        expect(restored.size().total).toBe(am.size().total);
    });
});

describe('NetGuard', () => {
    test('allows normal traffic and bans on severe violation', () => {
        const g = new NetGuard();
        expect(g.allow('9.9.9.9', 'inv')).toBe(true);
        g.penalize('9.9.9.9', 'BAD_HANDSHAKE');
        expect(g.isBanned('9.9.9.9')).toBe(true);
        expect(g.allow('9.9.9.9', 'inv')).toBe(false);
    });
    test('rate-limits a flooding peer', () => {
        const g = new NetGuard();
        let blocked = false;
        for (let i = 0; i < 40; i++) if (!g.allow('8.8.8.8', 'getblocks')) blocked = true;
        expect(blocked).toBe(true);
    });
});

describe('BlockPruner + header codec', () => {
    test('prunes bodies beyond keepDepth', () => {
        const pr = new BlockPruner({ keepDepth: 10 });
        expect(pr.prunable(5).length).toBe(0);
        expect(pr.prunable(100).length).toBe(90);
        let dropped = 0; pr.prune(100, () => { dropped++; return true; });
        expect(dropped).toBe(90);
    });
    test('compact header round-trips', () => {
        const h = { version: 1, prevHash: 'ab'.repeat(32), merkleRoot: 'cd'.repeat(32),
            timestamp: 1700000000000, bits: '1d00ffff', nonce: 12345 };
        const buf = compactHeader(h);
        expect(buf.length).toBe(80);
        const back = parseHeader(buf);
        expect(back.prevHash).toBe(h.prevHash);
        expect(back.nonce).toBe(h.nonce);
        expect(back.bits).toBe(h.bits);
    });
});

describe('SyncManager', () => {
    test('requests headers when a peer is ahead', () => {
        const chain = { height: 0, chain: [{ hash: '00'.repeat(32) }] };
        const sm = new SyncManager({ blockchain: chain });
        let asked = false; sm.on('getheaders', () => { asked = true; });
        sm.start({ id: 'p1' }, 100);
        expect(asked).toBe(true);
        expect(sm.progress().target).toBe(100);
        sm._disarm();
    });
});

describe('enhanceNode integration', () => {
    function fakeNode() {
        class N extends EventEmitter {
            constructor() { super(); this.blockchain = { height: 0, chain: [{ hash: '0'.repeat(64) }] };
                this.peers = new Map(); this.port = 8333; }
            _handleMessage(msg) { if (msg.boom) throw new Error('boom'); this.lastMsg = msg; }
            _handleAddr(a) { this.gotAddr = a; }
            connect() {}
            getStats() { return { peers: 0 }; }
            stop() { this.stopped = true; }
        }
        return new N();
    }
    test('attaches modules and guards messages', () => {
        const node = fakeNode();
        enhanceNode(node, { minPeers: 2, maintIntervalMs: 10_000_000 });
        expect(node.__enhanced).toBe(true);
        expect(node.addrman && node.guard && node.sync).toBeTruthy();
        node._handleMessage({ type: 'inv' }, { ip: '1.1.1.1', port: 1 });
        expect(node.lastMsg.type).toBe('inv');
        node.guard.ban('2.2.2.2'); node.lastMsg = null;
        node._handleMessage({ type: 'inv' }, { ip: '2.2.2.2', port: 1, destroy() {} });
        expect(node.lastMsg).toBeNull();
        clearInterval(node.__maint);
    });
    test('handler throw is penalized, not fatal', () => {
        const node = fakeNode();
        enhanceNode(node, { maintIntervalMs: 10_000_000 });
        node._handleMessage({ type: 'x', boom: true }, { ip: '3.3.3.3', port: 1, destroy() {} });
        expect(node.guard.scoreOf('3.3.3.3')).toBeGreaterThan(0);
        clearInterval(node.__maint);
    });
});
