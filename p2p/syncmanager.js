/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  syncmanager.js — Headers-first initial block download (IBD)
 *
 *  Instead of pulling full blocks one at a time in lockstep (slow,
 *  and easy for one slow peer to stall), we:
 *    1. Download the header chain first (tiny — validates PoW & links).
 *    2. Once we know the best header chain, request the full blocks
 *       for those headers in parallel across peers, in windowed
 *       batches, filling gaps and re-requesting on timeout.
 *
 *  This module tracks the sync state machine. It is transport-agnostic:
 *  it emits "need" callbacks the P2P layer wires to real messages.
 */

'use strict';

const EventEmitter = require('events');

const STATE = {
    IDLE:            'idle',
    SYNC_HEADERS:    'sync_headers',
    SYNC_BLOCKS:     'sync_blocks',
    SYNCED:          'synced',
};

const BLOCK_WINDOW   = 16;       // max in-flight block requests
const REQUEST_TIMEOUT = 30_000;  // re-request a block after this long
const HEADERS_BATCH  = 2000;     // headers per getheaders round

class SyncManager extends EventEmitter {
    constructor({ blockchain }) {
        super();
        this.blockchain = blockchain;
        this.state = STATE.IDLE;
        this.headerChain = [];       // ordered header metadata not yet in chain
        this.inFlight = new Map();    // hash -> { peerId, sentAt }
        this.pending = [];            // hashes with known headers, awaiting body
        this.bestPeerHeight = 0;
        this._timer = null;
    }

    /** Kick off sync against a peer that advertised a longer chain. */
    start(peer, peerHeight) {
        this.bestPeerHeight = Math.max(this.bestPeerHeight, peerHeight || 0);
        if (peerHeight <= this.blockchain.height) return; // already ahead
        if (this.state === STATE.IDLE || this.state === STATE.SYNCED) {
            this.state = STATE.SYNC_HEADERS;
            this.emit('getheaders', { peer, locator: this._locator() });
            this._arm();
        }
    }

    /** Called when a batch of headers arrives. Validates links + PoW. */
    onHeaders(headers, peer) {
        if (!headers || !headers.length) {
            // no more headers → move to block download phase
            this._beginBlockDownload(peer);
            return;
        }
        for (const h of headers) {
            // basic linkage / PoW sanity is delegated to the caller's
            // validator via the 'validateHeader' event (sync hook).
            let ok = true;
            this.emit('validateHeader', h, (valid) => { ok = valid; });
            if (!ok) { this.emit('misbehave', peer, 'INVALID_BLOCK'); return; }
            this.headerChain.push(h);
        }
        // ask for the next batch if the peer sent a full batch
        if (headers.length >= HEADERS_BATCH) {
            this.emit('getheaders', { peer, locator: [headers[headers.length - 1].hash] });
        } else {
            this._beginBlockDownload(peer);
        }
    }

    _beginBlockDownload(peer) {
        this.state = STATE.SYNC_BLOCKS;
        // queue every header we don't yet have a body for
        this.pending = this.headerChain.map(h => h.hash);
        this._fillWindow(peer);
    }

    /** Fill the in-flight window with block requests. */
    _fillWindow(peer) {
        const items = [];
        while (this.inFlight.size < BLOCK_WINDOW && this.pending.length) {
            const hash = this.pending.shift();
            this.inFlight.set(hash, { peerId: peer?.id, sentAt: Date.now() });
            items.push({ type: 2 /* BLOCK */, hash });
        }
        if (items.length) this.emit('getdata', { peer, items });
        this._checkDone();
    }

    /** Called when a full block body is accepted into the chain. */
    onBlock(hash, peer) {
        this.inFlight.delete(hash);
        // drop matching header from the staging chain
        const idx = this.headerChain.findIndex(h => h.hash === hash);
        if (idx >= 0) this.headerChain.splice(idx, 1);
        this._fillWindow(peer);
    }

    /** Periodic: re-request blocks that stalled. */
    _tick() {
        const now = Date.now();
        for (const [hash, meta] of this.inFlight) {
            if (now - meta.sentAt > REQUEST_TIMEOUT) {
                this.inFlight.delete(hash);
                this.pending.unshift(hash);         // retry
                this.emit('stall', meta.peerId, hash);
            }
        }
        if (this.state === STATE.SYNC_BLOCKS) this.emit('refill');
        this._checkDone();
    }

    _checkDone() {
        if (this.state === STATE.SYNC_BLOCKS &&
            !this.inFlight.size && !this.pending.length && !this.headerChain.length) {
            this.state = this.blockchain.height >= this.bestPeerHeight ? STATE.SYNCED : STATE.IDLE;
            this.emit('synced', { height: this.blockchain.height });
            this._disarm();
        }
    }

    _locator() {
        // reuse the blockchain's exponential block locator if available
        if (typeof this.blockchain.buildLocator === 'function')
            return this.blockchain.buildLocator();
        const loc = [];
        let step = 1, h = this.blockchain.height;
        while (h >= 0) {
            loc.push(this.blockchain.chain[h].hash);
            if (h === 0) break;
            h = Math.max(0, h - step);
            if (loc.length > 10) step *= 2;
        }
        return loc;
    }

    _arm()   { if (!this._timer) this._timer = setInterval(() => this._tick(), 5000); }
    _disarm(){ if (this._timer) { clearInterval(this._timer); this._timer = null; } }

    progress() {
        const have = this.blockchain.height;
        const target = Math.max(this.bestPeerHeight, have);
        return {
            state: this.state,
            height: have,
            target,
            percent: target ? Math.min(100, Math.round((have / target) * 100)) : 100,
            inFlight: this.inFlight.size,
            queued: this.pending.length,
        };
    }
}

module.exports = { SyncManager, STATE };
