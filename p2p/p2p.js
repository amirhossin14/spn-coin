/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
const net          = require('net');
const crypto       = require('crypto');
const EventEmitter = require('events');
const { PeerReputation } = require('./reputation');

const PROTOCOL_VERSION = 70015;
const MAX_PEERS        = parseInt(process.env.MAX_PEERS)    || 8;
const P2P_PORT         = parseInt(process.env.P2P_PORT)     || 8333;
const PING_INTERVAL    = 30_000;
const HANDSHAKE_TIMEOUT= 10_000;
const MAX_MSG_SIZE     = 5_000_000; // 5MB

// ── Protocol messages ──────────────────────────────────────────
const MSG = {
    VERSION:   'version',
    VERACK:    'verack',
    PING:      'ping',
    PONG:      'pong',
    GETBLOCKS: 'getblocks',
    INV:       'inv',
    GETDATA:   'getdata',
    BLOCK:     'block',
    TX:        'tx',
    REJECT:    'reject',
    ADDR:      'addr',
    GETADDR:   'getaddr',
};

const INV_TYPE = { TX: 1, BLOCK: 2 };

// ── Peer ─────────────────────────────────────────────────────
class Peer extends EventEmitter {
    constructor(socket, isOutbound = false) {
        super();
        this.socket      = socket;
        this.isOutbound  = isOutbound;
        this.id          = crypto.randomBytes(8).toString('hex');
        this.ip          = socket.remoteAddress || 'unknown';
        this.port        = socket.remotePort    || 0;
        this.connectedAt = Date.now();
        this.lastSeen    = Date.now();
        this.handshakeDone = false;
        this.version     = null;
        this.bestHeight  = 0;
        this._buf        = Buffer.alloc(0);
        this._pingTimer  = null;

        socket.on('data',  data  => this._onData(data));
        socket.on('close', ()    => this.emit('disconnect', this));
        socket.on('error', err   => { this.emit('error', err, this); });

        // Handshake timeout
        setTimeout(() => {
            if (!this.handshakeDone) this.destroy('handshake timeout');
        }, HANDSHAKE_TIMEOUT);
    }

    send(type, payload = {}) {
        if (this.socket.destroyed) return;
        try {
            const msg = JSON.stringify({ type, payload, ts: Date.now() });
            const body = Buffer.from(msg, 'utf8');
            if (body.length > MAX_MSG_SIZE) {
                this.destroy('message too large');
                return;
            }
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32BE(body.length, 0);
            this.socket.write(Buffer.concat([lenBuf, body]));
        } catch {}
    }

    _onData(data) {
        this._buf = Buffer.concat([this._buf, data]);
        this.lastSeen = Date.now();

        while (this._buf.length >= 4) {
            const msgLen = this._buf.readUInt32BE(0);
            if (msgLen > MAX_MSG_SIZE) { this.destroy('message too large'); return; }
            if (this._buf.length < 4 + msgLen) break;

            const raw = this._buf.slice(4, 4 + msgLen).toString('utf8');
            this._buf = this._buf.slice(4 + msgLen);

            try {
                const msg = JSON.parse(raw);
                this.emit('message', msg, this);
            } catch { this.destroy('invalid json'); return; }
        }
    }

    startPing() {
        this._pingTimer = setInterval(() => {
            if (Date.now() - this.lastSeen > PING_INTERVAL * 3) {
                this.destroy('ping timeout');
                return;
            }
            this.send(MSG.PING, { nonce: crypto.randomBytes(8).toString('hex') });
        }, PING_INTERVAL);
    }

    destroy(reason = '') {
        if (this._pingTimer) clearInterval(this._pingTimer);
        if (!this.socket.destroyed) this.socket.destroy();
        this.emit('disconnect', this, reason);
    }

    get info() {
        return { id: this.id, ip: this.ip, port: this.port, height: this.bestHeight,
                 direction: this.isOutbound ? 'out' : 'in', connectedAt: this.connectedAt };
    }
}

// ── P2P Node ─────────────────────────────────────────────────
class P2PNode extends EventEmitter {
    constructor({ blockchain, mempool, nodeId }) {
        super();
        this.blockchain = blockchain;
        this.mempool    = mempool;
        this.nodeId     = nodeId || crypto.randomBytes(8).toString('hex');
        this.peers      = new Map();   // id → Peer
        this.knownPeers = new Set();   // "ip:port"
        this.server     = null;
        this.seenInvs   = new LRUSet(10_000);  // برای جلوگیری از flood
        this.reputation = new PeerReputation({ maxPeers: MAX_PEERS });
    }

    // ── راه‌اندازی ────────────────────────────────────────────
    start(port = P2P_PORT) {
        this.port   = port;
        this.server = net.createServer(socket => {
            const _ip = socket.remoteAddress || '';
            const _gate = this.reputation.canConnect(_ip, `${_ip}:${socket.remotePort}`);
            if (this.peers.size >= MAX_PEERS || !_gate.ok) { socket.destroy(); return; }
            this._addPeer(socket, false);
        });

        this.server.listen(port, () => {
            console.log(`🌐 [P2P]  می‌دهد روی پورت ${port}`);
        });

        this.server.on('error', err => console.error('[P2P] server error:', err.message));
    }

    // ── Connect to peer ─────────────────────────────────────────
    connect(host, port) {
        const addr = `${host}:${port}`;
        if (this.knownPeers.has(addr) || this.peers.size >= MAX_PEERS) return;
        this.knownPeers.add(addr);

        const socket = net.createConnection({ host, port, timeout: 10_000 });
        socket.on('connect', () => this._addPeer(socket, true));
        socket.on('error',   err => {
            console.warn(`[P2P] Connection  ${addr} ناSuccess: ${err.message}`);
            this.knownPeers.delete(addr);
        });
    }

    connectToSeeds(seeds) {
        for (const seed of seeds) {
            const [host, port] = seed.split(':');
            this.connect(host, parseInt(port) || P2P_PORT);
        }
    }

    // ── Send block به همه ────────────────────────────────────
    broadcastBlock(block) {
        const inv = [{ type: INV_TYPE.BLOCK, hash: block.hash }];
        this._broadcast(MSG.INV, { inv }, null);
    }

    // ── Send transaction به همه ──────────────────────────────────
    broadcastTx(tx) {
        const key = `tx:${tx.id}`;
        if (this.seenInvs.has(key)) return;
        this.seenInvs.add(key);
        this._broadcast(MSG.INV, { inv: [{ type: INV_TYPE.TX, hash: tx.id }] }, null);
    }

    // ── sync با peer ─────────────────────────────────────────
    syncWith(peer) {
        const locator = this._buildBlockLocator();
        peer.send(MSG.GETBLOCKS, { version: PROTOCOL_VERSION, locator, hashStop: '0'.repeat(64) });
    }

    _addPeer(socket, isOutbound) {
        const peer = new Peer(socket, isOutbound);
        this.reputation.register(peer.id, peer.ip);

        peer.on('message', (msg, p) => this._handleMessage(msg, p));
        peer.on('disconnect', (p, reason) => {
            this.reputation.remove(p.id);
            this.peers.delete(p.id);
            this.knownPeers.delete(`${p.ip}:${p.port}`);
            console.log(`👋 [P2P] Peer Disconnect : ${p.ip}:${p.port} (${reason || ''})`);
            this.emit('peer:disconnect', p);
        });
        peer.on('error', (err, p) => { p.destroy(err.message); });

        this.peers.set(peer.id, peer);
        this.knownPeers.add(`${peer.ip}:${peer.port}`);

        // Send version
        peer.send(MSG.VERSION, {
            version:   PROTOCOL_VERSION,
            nodeId:    this.nodeId,
            height:    this.blockchain.height,
            timestamp: Date.now(),
            port:      this.port,
        });

        console.log(`🤝 [P2P] Peer ${isOutbound ? 'Output' : 'Input'}: ${peer.ip}:${peer.port}`);
    }

    _handleMessage(msg, peer) {
        switch (msg.type) {
            case MSG.VERSION:
                peer.version    = msg.payload.version;
                peer.bestHeight = msg.payload.height || 0;
                peer.send(MSG.VERACK, {});
                break;

            case MSG.VERACK:
                if (!peer.handshakeDone) {
                    peer.handshakeDone = true;
                    peer.startPing();
                    console.log(`✅ [P2P] Handshake : ${peer.ip} (height=${peer.bestHeight})`);
                    this.emit('peer:ready', peer);
                    // اگر peer بلاک بیشتری دارد sync کن
                    if (peer.bestHeight > this.blockchain.height) this.syncWith(peer);
                }
                break;

            case MSG.PING:
                peer.send(MSG.PONG, { nonce: msg.payload.nonce });
                break;

            case MSG.PONG:
                peer.lastSeen = Date.now();
                break;

            case MSG.INV:
                this._handleInv(msg.payload.inv, peer);
                break;

            case MSG.GETDATA:
                this._handleGetData(msg.payload.items, peer);
                break;

            case MSG.BLOCK:
                this._handleBlock(msg.payload, peer);
                break;

            case MSG.TX:
                this._handleTx(msg.payload, peer);
                break;

            case MSG.GETBLOCKS:
                this._handleGetBlocks(msg.payload, peer);
                break;

            case MSG.ADDR:
                this._handleAddr(msg.payload.addrs);
                break;

            case MSG.GETADDR:
                peer.send(MSG.ADDR, {
                    addrs: [...this.peers.values()].map(p => ({ ip: p.ip, port: p.port || this.port }))
                });
                break;
        }
    }

    _handleInv(inv, peer) {
        const needed = [];
        for (const item of inv || []) {
            const key = `${item.type}:${item.hash}`;
            if (this.seenInvs.has(key)) continue;
            this.seenInvs.add(key);

            if (item.type === INV_TYPE.BLOCK && !this.blockchain.getBlock(item.hash)) {
                needed.push(item);
            } else if (item.type === INV_TYPE.TX && !this.mempool.has(item.hash)) {
                needed.push(item);
            }
        }
        if (needed.length > 0) peer.send(MSG.GETDATA, { items: needed });
    }

    _handleGetData(items, peer) {
        for (const item of items || []) {
            if (item.type === INV_TYPE.BLOCK) {
                const block = this.blockchain.getBlock(item.hash);
                if (block) peer.send(MSG.BLOCK, block.toJSON ? block.toJSON() : block);
            } else if (item.type === INV_TYPE.TX) {
                const tx = this.mempool.get(item.hash);
                if (tx) peer.send(MSG.TX, tx.toJSON ? tx.toJSON() : tx);
            }
        }
    }

    _handleBlock(blockData, peer) {
        try {
            const { Block }  = require('../blockchain/blockchain');
            const { Transaction } = require('../utxo/utxo');
            const txs = (blockData.transactions || []).map(t => Object.assign(new Transaction({}), t));
            const block = new Block({ ...blockData, transactions: txs });

            const tip = this.blockchain.tip;
            let accepted = false;

            if (block.prevHash === tip.hash && block.height === tip.height + 1) {
                // Normal case: the block extends our current tip. addBlock does
                // its own full validation and rejects invalid blocks.
                const r = this.blockchain.addBlock(block);
                accepted = !!(r && (r.ok || r.added || r === true));
            } else if (typeof this.blockchain.considerBlock === 'function') {
                // Fork/out-of-order: let the chain store it and reorg only if the
                // resulting chain has more cumulative work AND fully validates.
                const r = this.blockchain.considerBlock(block);
                accepted = !!(r && (r.accepted || r.replaced));
            } else {
                // No fork handler available: only accept a direct extension.
                accepted = false;
            }

            if (accepted) {
                this.mempool.removeConfirmed(block);
                this.reputation.reward(peer.id, 'valid_block', peer.ip);
                this.emit('block:new', block, peer);
                this._broadcast(MSG.INV, { inv: [{ type: INV_TYPE.BLOCK, hash: block.hash }] }, peer);
                console.log(`📦 [P2P]  جدید از ${peer.ip}: height=${block.height}`);
            } else {
                // Not accepted but not malformed — likely a stale/duplicate block.
                this.reputation.penalize(peer.id, 'stale_block', peer.ip);
            }
        } catch (e) {
            // Misbehaviour lowers the peer's reputation; repeat offenders get banned.
            const pen = this.reputation.penalize(peer.id, 'invalid_block', peer.ip);
            console.warn(`[P2P]  Invalid از ${peer.ip}: ${e.message}${pen.banned ? ' — peer banned' : ''}`);
            peer.send(MSG.REJECT, { message: e.message });
            if (pen.banned) peer.destroy('reputation');
        }
    }

    _handleTx(txData, peer) {
        try {
            const { Transaction } = require('../utxo/utxo');
            const tx = Object.assign(new Transaction({}), txData);
            const result = this.mempool.add(tx, this.blockchain.utxoSet, this.blockchain.height + 1);
            if (result.ok) {
                this.emit('tx:new', tx, peer);
                this._broadcast(MSG.INV, { inv: [{ type: INV_TYPE.TX, hash: tx.id }] }, peer);
            }
        } catch (e) {
            console.warn(`[P2P]  Invalid از ${peer.ip}: ${e.message}`);
        }
    }

    _handleGetBlocks(payload, peer) {
        const { locator, hashStop } = payload;
        let startHeight = 0;
        for (const hash of locator || []) {
            const block = this.blockchain.getBlock(hash);
            if (block) { startHeight = block.height + 1; break; }
        }
        const inv = [];
        for (let i = startHeight; i < this.blockchain.chain.length && inv.length < 500; i++) {
            const block = this.blockchain.chain[i];
            inv.push({ type: INV_TYPE.BLOCK, hash: block.hash });
            if (block.hash === hashStop) break;
        }
        if (inv.length > 0) peer.send(MSG.INV, { inv });
    }

    _handleAddr(addrs) {
        for (const addr of addrs || []) {
            if (this.peers.size < MAX_PEERS) this.connect(addr.ip, addr.port);
        }
    }

    _buildBlockLocator() {
        const locator = [];
        let step = 1;
        let height = this.blockchain.height;
        while (height >= 0) {
            locator.push(this.blockchain.chain[height].hash);
            if (height === 0) break;
            height = Math.max(0, height - step);
            if (locator.length > 10) step *= 2;
        }
        return locator;
    }

    _broadcast(type, payload, exclude) {
        for (const [, peer] of this.peers) {
            if (peer !== exclude && peer.handshakeDone) {
                peer.send(type, payload);
            }
        }
    }

    getStats() {
        return {
            peers:     this.peers.size,
            maxPeers:  MAX_PEERS,
            peerList:  [...this.peers.values()].map(p => p.info),
        };
    }

    stop() {
        for (const [, peer] of this.peers) peer.destroy('node shutdown');
        this.server?.close();
    }
}

// ── LRU Set ──────────────────────────────────────────────────
class LRUSet {
    constructor(max) { this.max = max; this.set = new Set(); }
    has(key) { return this.set.has(key); }
    add(key) {
        if (this.set.size >= this.max) {
            const first = this.set.values().next().value;
            this.set.delete(first);
        }
        this.set.add(key);
    }
}

module.exports = { P2PNode, P2P_PORT };

// ── P2PServer alias + compatibility shims ────────────────────
class P2PServer extends P2PNode {
    constructor(opts) { super(opts); }
    listen(port)          { return this.start(port); }
    close()               { return this.stop(); }
    peerCount()           { return this.peers.size; }
    getPeers()            { return [...this.peers.values()].map(p => p.info); }
    connectToPeer(wsUrl)  {
        try {
            const u = new URL(wsUrl);
            this.connect(u.hostname, parseInt(u.port) || P2P_PORT);
        } catch { console.warn('[P2P] Invalid peer URL:', wsUrl); }
    }
}

module.exports = { P2PServer, P2PNode, P2P_PORT };
