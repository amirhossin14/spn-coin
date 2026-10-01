/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved.
 * ─────────────────────────────────────────────────────────────
 *
 *  net-enhance.js — wires the advanced networking modules into an
 *  existing P2PNode/P2PServer WITHOUT modifying its source.
 *
 *  Call enhanceNode(node, opts) once after constructing the node.
 *  It attaches:
 *    • AddrMan      → smart peer discovery + persistence
 *    • NetGuard     → per-peer rate limiting + ban scoring
 *    • SyncManager  → headers-first fast sync
 *    • BlockPruner  → opt-in storage pruning
 *    • a maintenance loop that keeps ≥ minPeers connections alive
 *
 *  Everything degrades gracefully: if the node shape is unexpected,
 *  we skip that hook rather than crash.
 */

'use strict';

const { AddrMan }     = require('./addrman');
const { NetGuard }    = require('./netguard');
const { SyncManager } = require('./syncmanager');
const { BlockPruner } = require('./pruner');

function enhanceNode(node, opts = {}) {
    if (!node || node.__enhanced) return node;
    node.__enhanced = true;

    const minPeers   = opts.minPeers   ?? 4;
    const maxPeers   = opts.maxPeers   ?? 8;
    const enablePrune = opts.prune     ?? false;

    const addrman = new AddrMan();
    const guard   = new NetGuard();
    const sync    = new SyncManager({ blockchain: node.blockchain });
    const pruner  = enablePrune ? new BlockPruner({ keepDepth: opts.keepDepth ?? 288 }) : null;

    node.addrman = addrman;
    node.guard   = guard;
    node.sync    = sync;
    node.pruner  = pruner;

    // advertise our own address so we never dial ourselves
    if (node.port) addrman.markSelf(node.publicIp || '127.0.0.1', node.port);

    // ── 1. Guard incoming messages (rate-limit + ban check) ──
    if (typeof node._handleMessage === 'function') {
        const original = node._handleMessage.bind(node);
        node._handleMessage = function (msg, peer) {
            const ip = peer?.ip || '';
            if (guard.isBanned(ip)) { peer?.destroy?.('banned'); return; }
            if (msg?.type && !guard.allow(ip, msg.type)) {
                // dropped by rate limiter; occasional flooding is penalized inside allow()
                return;
            }
            try {
                return original(msg, peer);
            } catch (e) {
                // a throw while handling a peer message is treated as misbehavior
                guard.penalize(ip, 'INVALID_MESSAGE');
                peer?.destroy?.('handler error');
            }
        };
    }

    // ── 2. Learn addresses from successful connections ──
    node.on?.('peer:connect', (peer) => {
        if (peer?.ip && peer?.port) addrman.onSuccess(peer.ip, peer.port);
    });
    node.on?.('peer:disconnect', (peer) => {
        // nothing to do; addrman keeps history for backoff
    });

    // ── 3. Feed ADDR gossip into the address manager ──
    const origHandleAddr = node._handleAddr?.bind(node);
    if (origHandleAddr) {
        node._handleAddr = function (addrs) {
            addrman.addMany(addrs, 'gossip');
            // don't auto-dial here; the maintenance loop decides.
        };
    }

    // ── 4. Misbehavior hooks from sync manager ──
    sync.on('misbehave', (peer, reason) => { if (peer?.ip) guard.penalize(peer.ip, reason); });
    sync.on('validateHeader', (h, cb) => {
        // Validate the header's PoW via the blockchain. If no validator is
        // available, REJECT rather than blindly accepting — accepting unchecked
        // headers would let a peer poison the header chain during sync.
        try {
            if (typeof node.blockchain.validateHeader === 'function')
                return cb(!!node.blockchain.validateHeader(h));
        } catch { /* fall through to reject */ }
        cb(false);
    });

    // ── 5. Maintenance loop: keep enough peers, prune, decay ──
    const connectedKeys = () => new Set([...(node.peers?.values?.() || [])].map(p => `${p.ip}:${p.port}`));

    node.__maint = setInterval(() => {
        // (a) top up connections toward minPeers
        const have = node.peers?.size ?? 0;
        if (have < minPeers) {
            const exclude = connectedKeys();
            for (let i = have; i < minPeers; i++) {
                const pick = addrman.select(exclude);
                if (!pick) break;
                exclude.add(pick.key);
                addrman.onAttempt(pick.ip, pick.port);
                try { node.connect?.(pick.ip, pick.port); } catch { /* ignore */ }
            }
        }
        // (b) opt-in pruning once we're past the retain window
        if (pruner && node.blockchain?.height > pruner.keepDepth) {
            pruner.prune(node.blockchain.height, (h) => {
                const blk = node.blockchain.chain?.[h];
                if (blk && blk.transactions) { blk._prunedTxCount = blk.transactions.length; blk.transactions = null; return true; }
                return false;
            });
        }
    }, opts.maintIntervalMs ?? 15_000);

    // ── 6. Convenience: richer stats merged onto the node ──
    const origStats = node.getStats?.bind(node);
    node.getStats = function () {
        const base = origStats ? origStats() : {};
        return {
            ...base,
            addrman: addrman.size(),
            guard: guard.stats(),
            sync: sync.progress(),
            pruning: pruner ? pruner.stats(node.blockchain.height) : { enabled: false },
        };
    };

    // clean shutdown
    const origStop = node.stop?.bind(node);
    if (origStop) node.stop = function () { clearInterval(node.__maint); return origStop(); };

    return node;
}

module.exports = { enhanceNode };
