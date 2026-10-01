/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * ─────────────────────────────────────────────────────────────
 */
// ════════════════════════════════════════════════════════════
//  🌐 SPN Coin P2P-over-HTTP v2.0
//
//  Replaces binary TCP with HTTP REST transport so nodes can
//  communicate across serverless platforms (Vercel, etc.)
//
//  How it works:
//   - Each node exposes  POST /api/p2p/message  endpoint
//   - Peers are registered by URL:  https://node2.vercel.app
//   - Blocks & TXs are gossiped via HTTP POST to all peers
//   - Periodic polling for chain sync via GET /api/p2p/status
//
//  Peer discovery:
//   - PEER_URLS env var: comma-separated list of peer URLs
//   - Manual: POST /api/p2p/peers/add { url: "https://..." }
//
//  Works on:  Vercel ✅  | VPS ✅  | Docker ✅
// ════════════════════════════════════════════════════════════
"use strict";

const crypto       = require("crypto");
const EventEmitter = require("events");
const { Block }    = require("../blockchain/blockchain");

const MAX_PEERS     = parseInt(process.env.MAX_PEERS) || 8;
const SYNC_INTERVAL = parseInt(process.env.P2P_SYNC_INTERVAL) || 30_000;  // 30s
const MSG_TIMEOUT   = parseInt(process.env.P2P_MSG_TIMEOUT)   || 10_000;  // 10s

// Node secret for request signing (prevents spoofing). In a MULTI-NODE network
// every node must share the SAME secret, or peers can't verify each other. A
// random per-process fallback keeps a single node working in dev, but in
// production it silently breaks peer auth — so warn loudly there.
if (!process.env.NODE_SECRET && process.env.NODE_ENV === 'production') {
    console.error('⚠️  [P2P] NODE_SECRET is not set. In production every node must share the SAME NODE_SECRET, otherwise peers cannot authenticate each other. Set NODE_SECRET in your environment.');
}
const NODE_SECRET = process.env.NODE_SECRET
    || crypto.randomBytes(32).toString("hex");

// ── Sign outgoing requests ─────────────────────────────────
function signRequest(body) {
    const ts  = Date.now().toString();
    const sig = crypto.createHmac("sha256", NODE_SECRET)
        .update(ts + JSON.stringify(body)).digest("hex");
    return { "x-p2p-timestamp": ts, "x-p2p-sig": sig };
}

// ── Verify incoming requests ───────────────────────────────
// Replay protection: remember recently-seen signatures so the same signed
// message can't be accepted twice within the validity window.
const _seenSigs = new Map();   // sig -> expiry timestamp
function _rememberSig(sig, ttlMs) {
    const now = Date.now();
    // opportunistic cleanup
    if (_seenSigs.size > 5000) {
        for (const [k, exp] of _seenSigs) if (exp < now) _seenSigs.delete(k);
    }
    _seenSigs.set(sig, now + ttlMs);
}

function verifyRequest(headers, body) {
    const ts  = String(headers["x-p2p-timestamp"] || "");
    const sig = String(headers["x-p2p-sig"] || "").toLowerCase();
    if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
    const tsNum = Number(ts);
    if (!Number.isSafeInteger(tsNum) || Math.abs(Date.now() - tsNum) > 300_000) return false;
    const expected = crypto.createHmac("sha256", NODE_SECRET)
        .update(ts + JSON.stringify(body)).digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return false;
    // Reject a replay of an already-seen (valid) signature.
    if (_seenSigs.has(sig) && _seenSigs.get(sig) > Date.now()) return false;
    _rememberSig(sig, 300_000);
    return true;
}

// ── HTTP fetch with timeout ────────────────────────────────
async function fetchPeer(url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MSG_TIMEOUT);
    try {
        const headers = { "Content-Type": "application/json", ...signRequest(body) };
        const res = await fetch(url, {
            method:  "POST",
            headers,
            body:    JSON.stringify(body),
            signal:  ctrl.signal,
        });
        clearTimeout(timer);
        return res.ok ? await res.json().catch(() => ({})) : null;
    } catch {
        clearTimeout(timer);
        return null;
    }
}

async function getPeer(url, path) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MSG_TIMEOUT);
    try {
        const res = await fetch(url + path, { signal: ctrl.signal });
        clearTimeout(timer);
        return res.ok ? await res.json().catch(() => ({})) : null;
    } catch {
        clearTimeout(timer);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════
//  P2P HTTP SERVER
// ══════════════════════════════════════════════════════════════
class P2PHttpServer extends EventEmitter {
    constructor({ blockchain, mempool }) {
        super();
        this.blockchain  = blockchain;
        this.mempool     = mempool;
        this.peers       = new Map();   // url → { url, height, lastSeen, failures }
        this.seenHashes  = new Set();   // prevent relay loops
        this._syncTimer  = null;
        this._nodeId     = crypto.randomBytes(8).toString("hex");
    }

    // ── Start periodic sync ───────────────────────────────────
    listen(_port = null) {
        // Load peers from environment
        const envPeers = (process.env.PEER_URLS || "").split(",").filter(Boolean);
        for (const url of envPeers) this._addPeer(url.trim());

        this._syncTimer = setInterval(() => this._syncAll(), SYNC_INTERVAL);
        console.log(`🌐 [P2P-HTTP] Started. Peers: ${this.peers.size}. Sync interval: ${SYNC_INTERVAL}ms`);
        // Initial sync after 5s
        setTimeout(() => this._syncAll(), 5_000);
    }

    close() {
        clearInterval(this._syncTimer);
    }

    // ── Register an Express app to handle inbound P2P messages ─
    // Call this from server.js:  p2p.registerRoutes(app)
    registerRoutes(app, auth) {
        // Receive a message from another node
        app.post("/api/p2p/message", (req, res) => {
            // Every P2P message must be authenticated and fresh.
            // All trusted nodes must share NODE_SECRET.
            if (!verifyRequest(req.headers, req.body || {})) {
                return res.status(401).json({ error: "Invalid P2P authentication" });
            }
            const { type, data, fromHeight } = req.body || {};

            if (!type || !data) return res.status(400).json({ error: "Invalid P2P message" });

            // Update peer record
            const peerUrl = req.headers["x-p2p-origin"] || "";
            if (peerUrl) this._updatePeer(peerUrl, fromHeight);

            switch (type) {
                case "block": {
                    // SECURITY: never dedup on the peer-supplied `data.hash` — an
                    // attacker could send a junk message carrying a real block's hash
                    // and permanently suppress that block. Recompute the hash locally.
                    let blk, localHash;
                    try { blk = new Block(data); localHash = blk.computeHash(); }
                    catch { break; } // malformed → ignore, don't poison anything
                    if (this.seenHashes.has(localHash)) break;
                    this.seenHashes.add(localHash);

                    // EventEmitter is synchronous: after emit, the block has already
                    // been through addBlock() in the app. Only RELAY it onward if the
                    // chain actually accepted it — never amplify invalid blocks.
                    this.emit("block:received", { block: data });
                    const accepted = (this.blockchain.blockIndex && this.blockchain.blockIndex.has(localHash))
                        || (this.blockchain.tip && this.blockchain.tip.hash === localHash);
                    if (accepted) setImmediate(() => this._relay(type, data, peerUrl));
                    break;
                }
                case "tx": {
                    if (typeof data.id !== "string" || !/^[0-9a-fA-F]{16,80}$/.test(data.id)) break;
                    if (this.seenHashes.has("tx:" + data.id)) break;
                    this.seenHashes.add("tx:" + data.id);
                    this.emit("tx:received", { tx: data });
                    // Relay only if the tx was actually accepted into the mempool.
                    const inPool = this.mempool && this.mempool.txs && this.mempool.txs.has(data.id);
                    if (inPool) setImmediate(() => this._relay(type, data, peerUrl));
                    break;
                }
                case "ping": {
                    res.json({ ok: true, height: this.blockchain.height, nodeId: this._nodeId });
                    return;
                }
                case "getblocks": {
                    const from   = parseInt(data.fromHeight) || 0;
                    const blocks = this.blockchain.chain
                        .slice(Math.max(0, from), from + 50)
                        .map(b => b.toJSON ? b.toJSON() : b);
                    res.json({ ok: true, blocks });
                    return;
                }
                case "addpeer": {
                    if (data.url) this._addPeer(data.url);
                    break;
                }
            }

            res.json({ ok: true });
        });

        // Status endpoint — public info about this node
        app.get("/api/p2p/status", (req, res) => {
            res.json({
                nodeId:    this._nodeId,
                height:    this.blockchain.height,
                peers:     this.getPeers(),
                chainId:   require("../config").CHAIN_ID,
            });
        });

        // Add a peer manually (admin only)
        app.post("/api/p2p/peers/add", auth("admin:users"), (req, res) => {
            const { url } = req.body;
            if (!url || !/^https?:\/\//.test(url))
                return res.status(400).json({ error: "Invalid peer URL (must start with http:// or https://)" });
            this._addPeer(url.trim());
            res.json({ ok: true, peers: this.peers.size });
        });

        // List peers (admin only)
        app.get("/api/p2p/peers", auth("view:dashboard"), (req, res) => {
            res.json({ peers: this.getPeers(), count: this.peers.size });
        });
    }

    // ── Broadcast block to all peers ─────────────────────────
    broadcastBlock(block) {
        const data = block.toJSON ? block.toJSON() : block;
        if (this.seenHashes.has(data.hash)) return;
        this.seenHashes.add(data.hash);
        this._broadcast("block", data);
    }

    // ── Broadcast transaction to all peers ───────────────────
    broadcastTx(tx) {
        const data = tx.toJSON ? tx.toJSON() : tx;
        if (this.seenHashes.has(data.id)) return;
        this.seenHashes.add(data.id);
        this._broadcast("tx", data);
    }

    // ── Internal broadcast ────────────────────────────────────
    _broadcast(type, data, excludeUrl = null) {
        const body = { type, data, fromNodeId: this._nodeId, fromHeight: this.blockchain.height };
        for (const [url] of this.peers) {
            if (url === excludeUrl) continue;
            fetchPeer(url + "/api/p2p/message", body)
                .then(r => { if (!r) this._markFailure(url); else this._markSuccess(url); })
                .catch(() => this._markFailure(url));
        }
    }

    _relay(type, data, excludeUrl) {
        this._broadcast(type, data, excludeUrl);
    }

    // ── Sync with all peers (get blocks we might be missing) ──
    async _syncAll() {
        for (const [url] of this.peers) {
            try {
                const status = await getPeer(url, "/api/p2p/status");
                if (!status) { this._markFailure(url); continue; }

                this._updatePeer(url, status.height);

                if (status.height > this.blockchain.height) {
                    console.log(`🔄 [P2P-HTTP] Peer ${url.slice(0, 40)} has height ${status.height} > ours ${this.blockchain.height}`);
                    await this._syncFrom(url, this.blockchain.height);
                }
            } catch {
                this._markFailure(url);
            }
        }
        // Clean up seen hashes (keep only recent 10k)
        if (this.seenHashes.size > 10_000) this.seenHashes.clear();
    }

    async _syncFrom(peerUrl, fromHeight) {
        const res = await fetchPeer(peerUrl + "/api/p2p/message", {
            type: "getblocks",
            data: { fromHeight },
            fromNodeId: this._nodeId,
            fromHeight: this.blockchain.height,
        });
        if (!res?.blocks?.length) return;

        for (const blockData of res.blocks) {
            if (this.seenHashes.has(blockData.hash)) continue;
            this.seenHashes.add(blockData.hash);
            this.emit("block:received", { block: blockData });
        }
    }

    // ── Peer management ───────────────────────────────────────
    _addPeer(url) {
        if (!url || this.peers.has(url) || this.peers.size >= MAX_PEERS) return;
        this.peers.set(url, { url, height: 0, lastSeen: 0, failures: 0 });
        console.log(`➕ [P2P-HTTP] Added peer: ${url}`);
    }

    _updatePeer(url, height = 0) {
        const p = this.peers.get(url);
        if (p) { p.height = height; p.lastSeen = Date.now(); p.failures = 0; }
    }

    _markFailure(url) {
        const p = this.peers.get(url);
        if (!p) return;
        p.failures++;
        if (p.failures > 10) {
            console.warn(`🗑️  [P2P-HTTP] Removing unreachable peer: ${url}`);
            this.peers.delete(url);
        }
    }

    _markSuccess(url) {
        const p = this.peers.get(url);
        if (p) { p.failures = 0; p.lastSeen = Date.now(); }
    }

    peerCount() { return this.peers.size; }
    getPeers()  {
        return [...this.peers.values()].map(p => ({
            url:      p.url,
            height:   p.height,
            lastSeen: p.lastSeen,
            failures: p.failures,
        }));
    }

    // Compatibility shim for code that calls p2p.connectToPeer(url)
    connectToPeer(url) { this._addPeer(url); }
}

module.exports = { P2PHttpServer, verifyRequest, NODE_SECRET };
